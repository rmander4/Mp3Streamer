import { useEffect, useRef, useState } from 'react';
import type { Track } from '../api/types';
import { applyArtworkFromUrl, updateTrackArtwork, updateTracksBulkTags } from '../api/client';
import { ItunesArtworkSearch } from './ItunesArtworkSearch';

interface EditTagsBulkDialogProps {
  tracks: Track[];
  onClose: () => void;
  onSaved: (updated: Track[]) => void;
}

// A field's shared state across the selection: either every selected track
// agrees on one value, or they don't ("mixed" — shown blank with a
// placeholder, same convention as e.g. iTunes' multi-track Get Info).
interface SharedField {
  mixedAcrossSelection: boolean;
  value: string;
}

interface FieldState {
  text: string;
  touched: boolean;
}

function sharedField(tracks: Track[], getter: (t: Track) => string | number | null): SharedField {
  const values = new Set(tracks.map((t) => getter(t) ?? ''));
  if (values.size === 1) {
    const [only] = values;
    return { mixedAcrossSelection: false, value: String(only) };
  }
  return { mixedAcrossSelection: true, value: '' };
}

export function EditTagsBulkDialog({ tracks, onClose, onSaved }: EditTagsBulkDialogProps) {
  const [shared] = useState(() => ({
    artist: sharedField(tracks, (t) => t.artist),
    album: sharedField(tracks, (t) => t.album),
    genre: sharedField(tracks, (t) => t.genre),
    year: sharedField(tracks, (t) => t.year),
  }));

  const [artist, setArtist] = useState<FieldState>({ text: shared.artist.value, touched: false });
  const [album, setAlbum] = useState<FieldState>({ text: shared.album.value, touched: false });
  const [genre, setGenre] = useState<FieldState>({ text: shared.genre.value, touched: false });
  const [year, setYear] = useState<FieldState>({ text: shared.year.value, touched: false });
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artworkPreviewUrl, setArtworkPreviewUrl] = useState<string | null>(null);
  const [itunesArtworkUrl, setItunesArtworkUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [artworkProgress, setArtworkProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const anyTouched =
    artist.touched || album.touched || genre.touched || year.touched || artworkFile !== null || itunesArtworkUrl !== null;
  const canApply = anyTouched && !saving;

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

  useEffect(() => {
    if (!artworkFile) {
      setArtworkPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(artworkFile);
    setArtworkPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [artworkFile]);

  const handleApply = async () => {
    if (!canApply) return;
    const confirmed = window.confirm(
      `Are you sure? You are editing ${tracks.length} tracks. Changes cannot be undone.`,
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    try {
      let updated = tracks;
      const anyTextTouched = artist.touched || album.touched || genre.touched || year.touched;
      if (anyTextTouched) {
        updated = await updateTracksBulkTags({
          trackIds: tracks.map((t) => t.id),
          setArtist: artist.touched,
          artist: artist.touched ? artist.text.trim() || null : null,
          setAlbum: album.touched,
          album: album.touched ? album.text.trim() || null : null,
          setGenre: genre.touched,
          genre: genre.touched ? genre.text.trim() || null : null,
          setYear: year.touched,
          year: year.touched ? (year.text.trim() ? Number(year.text) : null) : null,
        });
      }
      if (artworkFile || itunesArtworkUrl) {
        // One request per track rather than a single bulk call — a
        // multi-MB image times a couple dozen tracks genuinely takes a
        // while (each one is a full file rewrite via TagLibSharp), and a
        // single opaque request left no way to show real progress.
        // Continues past a single track's failure rather than aborting
        // the whole batch, so one bad file doesn't undo everything else
        // that already succeeded.
        const byId = new Map(updated.map((t) => [t.id, t]));
        setArtworkProgress({ completed: 0, total: tracks.length });
        let failures = 0;
        for (const track of tracks) {
          try {
            const withArt = artworkFile
              ? await updateTrackArtwork(track.id, artworkFile)
              : await applyArtworkFromUrl(track.id, itunesArtworkUrl!);
            byId.set(track.id, withArt);
          } catch {
            failures++;
          }
          setArtworkProgress((p) => (p ? { completed: p.completed + 1, total: p.total } : p));
        }
        updated = tracks.map((t) => byId.get(t.id) ?? t);
        if (failures > 0) {
          setError(`Album art failed to save on ${failures} of ${tracks.length} track(s) — please try again.`);
          setArtworkProgress(null);
          setSaving(false);
          onSaved(updated);
          return;
        }
      }
      onSaved(updated);
    } catch {
      setError('Failed to save changes — please try again.');
      setSaving(false);
      setArtworkProgress(null);
    }
  };

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel tags-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Edit ID3 Tags ({tracks.length} tracks)</h2>
          <button className="settings-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="tags-bulk-hint">
          Only fields tracks can share are editable here. A blank field with "multiple values" means the
          selected tracks don't agree — leave it blank to keep each track's own value, or type something to
          set it on all {tracks.length} tracks.
        </p>

        <div className="tags-form">
          <label className="tags-field tags-art-field">
            <span>Album Art</span>
            <div className="tags-art-row">
              {artworkPreviewUrl || itunesArtworkUrl ? (
                <img className="tags-art-preview" src={artworkPreviewUrl ?? itunesArtworkUrl!} alt="" />
              ) : (
                <span className="tags-art-preview tags-art-placeholder">multiple values</span>
              )}
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
                  artist={artist.touched ? artist.text : shared.artist.value}
                  album={album.touched ? album.text : shared.album.value}
                  selectedUrl={itunesArtworkUrl}
                  onSelect={handleItunesArtworkSelected}
                />
              </div>
            </div>
          </label>
          <label className="tags-field">
            <span>Artist</span>
            <input
              type="text"
              value={artist.text}
              placeholder={shared.artist.mixedAcrossSelection ? 'multiple values' : undefined}
              onChange={(e) => setArtist({ text: e.target.value, touched: true })}
            />
          </label>
          <label className="tags-field">
            <span>Album</span>
            <input
              type="text"
              value={album.text}
              placeholder={shared.album.mixedAcrossSelection ? 'multiple values' : undefined}
              onChange={(e) => setAlbum({ text: e.target.value, touched: true })}
            />
          </label>
          <label className="tags-field">
            <span>Genre</span>
            <input
              type="text"
              value={genre.text}
              placeholder={shared.genre.mixedAcrossSelection ? 'multiple values' : undefined}
              onChange={(e) => setGenre({ text: e.target.value, touched: true })}
            />
          </label>
          <label className="tags-field">
            <span>Year</span>
            <input
              type="number"
              min="0"
              value={year.text}
              placeholder={shared.year.mixedAcrossSelection ? 'multiple values' : undefined}
              onChange={(e) => setYear({ text: e.target.value, touched: true })}
            />
          </label>
        </div>

        {artworkProgress ? (
          <div className="tags-progress">
            <div className="tags-progress-track">
              <div
                className="tags-progress-fill"
                style={{ width: `${(artworkProgress.completed / artworkProgress.total) * 100}%` }}
              />
            </div>
            <span className="tags-progress-label">
              Saving album art: {artworkProgress.completed} / {artworkProgress.total}
            </span>
          </div>
        ) : null}

        {error ? <p className="tags-error">{error}</p> : null}

        <div className="tags-actions">
          <button className="settings-option" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="settings-option tags-apply" onClick={handleApply} disabled={!canApply}>
            {artworkProgress
              ? `Saving art ${artworkProgress.completed}/${artworkProgress.total}…`
              : saving
                ? 'Applying…'
                : 'Apply Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
