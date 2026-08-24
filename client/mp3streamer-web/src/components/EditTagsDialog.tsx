import { useEffect, useRef, useState } from 'react';
import type { Track } from '../api/types';
import { applyArtworkFromUrl, artworkUrl, updateTrackArtwork, updateTrackTags } from '../api/client';
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
  const [original] = useState(() => toFormState(track));
  const [form, setForm] = useState(original);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [artworkPreviewUrl, setArtworkPreviewUrl] = useState<string | null>(null);
  const [itunesArtworkUrl, setItunesArtworkUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleApply = async () => {
    if (!canApply) return;
    setSaving(true);
    setError(null);
    try {
      let updated = await updateTrackTags(track.id, {
        title: form.title.trim(),
        artist: form.artist.trim() || null,
        album: form.album.trim() || null,
        genre: form.genre.trim() || null,
        trackNumber: form.trackNumber.trim() ? Number(form.trackNumber) : null,
        year: form.year.trim() ? Number(form.year) : null,
      });
      if (artworkFile) {
        updated = await updateTrackArtwork(track.id, artworkFile);
      } else if (itunesArtworkUrl) {
        updated = await applyArtworkFromUrl(track.id, itunesArtworkUrl);
      }
      onSaved(updated);
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
          <button className="settings-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="tags-form">
          <label className="tags-field tags-art-field">
            <span>Album Art</span>
            <div className="tags-art-row">
              <img
                className="tags-art-preview"
                src={artworkPreviewUrl ?? itunesArtworkUrl ?? artworkUrl(track.id)}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.visibility = 'hidden';
                }}
              />
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
            </div>
            <ItunesArtworkSearch
              artist={form.artist}
              album={form.album}
              selectedUrl={itunesArtworkUrl}
              onSelect={handleItunesArtworkSelected}
            />
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
          <button className="settings-option tags-apply" onClick={handleApply} disabled={!canApply}>
            {saving ? 'Applying…' : 'Apply Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
