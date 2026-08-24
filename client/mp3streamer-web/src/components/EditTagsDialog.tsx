import { useEffect, useRef, useState } from 'react';
import type { Track } from '../api/types';
import { applyArtworkFromUrl, artworkUrl, fetchTracks, updateTrackArtwork, updateTrackTags } from '../api/client';
import { ItunesArtworkSearch } from './ItunesArtworkSearch';

interface EditTagsDialogProps {
  track: Track;
  onClose: () => void;
  onSaved: (updated: Track) => void;
}

interface FormState {
  title: string;
  artist: string;
  album: string;
  genre: string;
  trackNumber: string;
  year: string;
}

function toFormState(track: Track): FormState {
  return {
    title: track.title,
    artist: track.artist ?? '',
    album: track.album ?? '',
    genre: track.genre ?? '',
    trackNumber: track.trackNumber != null ? String(track.trackNumber) : '',
    year: track.year != null ? String(track.year) : '',
  };
}

function isDirty(form: FormState, original: FormState): boolean {
  return (Object.keys(form) as (keyof FormState)[]).some((key) => form[key] !== original[key]);
}

export function EditTagsDialog({ track, onClose, onSaved }: EditTagsDialogProps) {
  // The track currently shown — starts as the one the dialog was opened
  // for, but Left/Right paging (below) swaps this to a sibling track on
  // the same album without closing/reopening the dialog.
  const [currentTrack, setCurrentTrack] = useState(track);
  const [original, setOriginal] = useState(() => toFormState(track));
  const [form, setForm] = useState(original);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artworkPreviewUrl, setArtworkPreviewUrl] = useState<string | null>(null);
  const [itunesArtworkUrl, setItunesArtworkUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The full album track list, fetched once for the album the dialog was
  // opened on (not re-fetched on every page — editing the Album field
  // mid-session doesn't change what Left/Right page through).
  const [albumTracks, setAlbumTracks] = useState<Track[] | null>(null);

  useEffect(() => {
    if (!track.album) {
      setAlbumTracks(null);
      return;
    }
    let cancelled = false;
    fetchTracks({ album: track.album, artist: track.artist ?? undefined, pageSize: 1000 })
      .then((result) => {
        if (!cancelled) setAlbumTracks(result.items);
      })
      .catch(() => {
        if (!cancelled) setAlbumTracks(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.album, track.artist]);

  // Resets all per-track editing state whenever the displayed track
  // changes (including the very first render, harmlessly re-setting the
  // same initial values) — same reset either way, whether the dialog was
  // just opened or the user paged to a sibling track.
  useEffect(() => {
    const next = toFormState(currentTrack);
    setOriginal(next);
    setForm(next);
    setArtworkFile(null);
    setItunesArtworkUrl(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack.id]);

  const currentIndex = albumTracks?.findIndex((t) => t.id === currentTrack.id) ?? -1;
  const hasPrev = albumTracks !== null && currentIndex > 0;
  const hasNext = albumTracks !== null && currentIndex >= 0 && currentIndex < albumTracks.length - 1;

  const goToPrev = () => {
    if (!albumTracks || !hasPrev) return;
    setCurrentTrack(albumTracks[currentIndex - 1]);
  };
  const goToNext = () => {
    if (!albumTracks || !hasNext) return;
    setCurrentTrack(albumTracks[currentIndex + 1]);
  };

  const dirty = isDirty(form, original) || artworkFile !== null || itunesArtworkUrl !== null;
  const canApply = dirty && form.title.trim().length > 0 && !saving;

  const setField = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const handleArtworkPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setItunesArtworkUrl(null);
    setArtworkFile(file);
  };

  const handleItunesArtworkSelected = (url: string) => {
    setArtworkFile(null);
    setItunesArtworkUrl(url);
  };

  // Local preview of the newly-picked file, before it's actually uploaded.
  useEffect(() => {
    if (!artworkFile) {
      setArtworkPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(artworkFile);
    setArtworkPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [artworkFile]);

  // "Apply" saves and keeps paging through the album; "Apply and Close"
  // saves and closes — the whole point of adding Previous/Next paging was
  // to edit one track after another without the dialog closing on every
  // save, so a plain "Apply Changes" that always closed would defeat it.
  const handleApply = async (closeAfter: boolean) => {
    if (!canApply) return;
    setSaving(true);
    setError(null);
    try {
      let updated = await updateTrackTags(currentTrack.id, {
        title: form.title.trim(),
        artist: form.artist.trim() || null,
        album: form.album.trim() || null,
        genre: form.genre.trim() || null,
        trackNumber: form.trackNumber.trim() ? Number(form.trackNumber) : null,
        year: form.year.trim() ? Number(form.year) : null,
      });
      if (artworkFile) {
        updated = await updateTrackArtwork(currentTrack.id, artworkFile);
      } else if (itunesArtworkUrl) {
        updated = await applyArtworkFromUrl(currentTrack.id, itunesArtworkUrl);
      }
      onSaved(updated);
      // Keep the album tracklist's own copy in sync too — otherwise paging
      // back to a track already saved earlier in this session would show
      // its stale pre-edit data instead of what was just applied.
      setAlbumTracks((prev) => (prev ? prev.map((t) => (t.id === updated.id ? updated : t)) : prev));

      if (closeAfter) {
        onClose();
        return;
      }

      // Staying open: re-baseline the form to the freshly-saved values
      // (clears the dirty state) instead of relying on the
      // currentTrack.id-keyed reset effect, since the id itself hasn't
      // changed here.
      setCurrentTrack(updated);
      const next = toFormState(updated);
      setOriginal(next);
      setForm(next);
      setArtworkFile(null);
      setItunesArtworkUrl(null);
      setSaving(false);
    } catch {
      setError('Failed to save changes — please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel tags-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Edit ID3 Tag</h2>
          <div className="settings-header-actions">
            {/* Always shown (not just when there's actually somewhere to
                page to) so a track with no album, or no other tracks on
                its album, reads as "nothing to page through" via grayed-
                out buttons rather than the controls just disappearing. */}
            <div className="tags-nav">
              <button
                type="button"
                className="page-button"
                onClick={goToPrev}
                disabled={!hasPrev}
                aria-label="Previous track on this album"
              >
                &larr;
              </button>
              <span className="tags-nav-position">{albumTracks ? `${currentIndex + 1} / ${albumTracks.length}` : ''}</span>
              <button
                type="button"
                className="page-button"
                onClick={goToNext}
                disabled={!hasNext}
                aria-label="Next track on this album"
              >
                &rarr;
              </button>
            </div>
            <button className="settings-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        <div className="tags-form">
          <label className="tags-field tags-art-field">
            <span>Album Art</span>
            <div className="tags-art-row">
              <img
                className="tags-art-preview"
                src={artworkPreviewUrl ?? itunesArtworkUrl ?? artworkUrl(currentTrack.id)}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.visibility = 'hidden';
                }}
              />
              <div className="tags-art-buttons">
                <button type="button" className="settings-option" onClick={() => fileInputRef.current?.click()}>
                  Browse…
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="tags-art-input"
                  onChange={handleArtworkPicked}
                />
                <ItunesArtworkSearch
                  artist={form.artist}
                  album={form.album}
                  selectedUrl={itunesArtworkUrl}
                  onSelect={handleItunesArtworkSelected}
                />
              </div>
            </div>
          </label>
          <label className="tags-field">
            <span>Title</span>
            <input type="text" value={form.title} onChange={setField('title')} required />
          </label>
          <label className="tags-field">
            <span>Artist</span>
            <input type="text" value={form.artist} onChange={setField('artist')} />
          </label>
          <label className="tags-field">
            <span>Album</span>
            <input type="text" value={form.album} onChange={setField('album')} />
          </label>
          <label className="tags-field">
            <span>Genre</span>
            <input type="text" value={form.genre} onChange={setField('genre')} />
          </label>
          <label className="tags-field">
            <span>Track #</span>
            <input type="number" min="0" value={form.trackNumber} onChange={setField('trackNumber')} />
          </label>
          <label className="tags-field">
            <span>Year</span>
            <input type="number" min="0" value={form.year} onChange={setField('year')} />
          </label>
        </div>

        {error ? <p className="tags-error">{error}</p> : null}

        <div className="tags-actions">
          <button className="settings-option" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="settings-option" onClick={() => handleApply(false)} disabled={!canApply}>
            {saving ? 'Applying…' : 'Apply'}
          </button>
          <button className="settings-option tags-apply" onClick={() => handleApply(true)} disabled={!canApply}>
            {saving ? 'Applying…' : 'Apply and Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
