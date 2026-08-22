import { useState } from 'react';
import type { AlbumArt, Facet } from '../api/types';
import { artworkUrl } from '../api/client';

interface FacetListProps {
  facets: Facet[];
  onSelect: (name: string) => void;
  onSelectAlbum?: (album: string) => void;
}

interface AlbumArtStackProps {
  albumArt: AlbumArt[];
  onSelectAlbum: (album: string) => void;
}

function AlbumArtStack({ albumArt, onSelectAlbum }: AlbumArtStackProps) {
  const [failed, setFailed] = useState<Set<number>>(new Set());

  if (albumArt.length === 0) return null;

  // Each thumbnail navigates to its own album — stopPropagation keeps that
  // from also triggering the parent row's artist-select handler.
  const handleSelect = (e: React.SyntheticEvent, album: string) => {
    e.stopPropagation();
    onSelectAlbum(album);
  };

  const handleKeyDown = (e: React.KeyboardEvent, album: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    handleSelect(e, album);
  };

  return (
    <div className="album-art-stack">
      {albumArt.map(({ trackId, album }) => (
        <span
          key={trackId}
          className="album-art-item-wrap"
          role="button"
          tabIndex={0}
          onClick={(e) => handleSelect(e, album)}
          onKeyDown={(e) => handleKeyDown(e, album)}
        >
          {failed.has(trackId) ? (
            <span className="album-art-stack-item album-art-stack-fallback">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55a4 4 0 1 0 2 3.45V7h4V3h-6z" />
              </svg>
            </span>
          ) : (
            <img
              className="album-art-stack-item"
              src={artworkUrl(trackId)}
              alt={album}
              onError={() => setFailed((prev) => new Set(prev).add(trackId))}
            />
          )}
          {/* A custom tooltip, not the native `title` attribute — the
              browser's own tooltip renders slightly below-right of the
              cursor, right where the cursor itself covers it. This one is
              anchored above-left of the thumbnail instead. */}
          <span className="album-art-tooltip">{album}</span>
        </span>
      ))}
    </div>
  );
}

export function FacetList({ facets, onSelect, onSelectAlbum }: FacetListProps) {
  if (facets.length === 0) {
    return <p className="empty-state">Nothing found.</p>;
  }

  return (
    <ul className="facet-list">
      {facets.map((f) => (
        <li key={f.name}>
          <button className="facet-item" onClick={() => onSelect(f.name)}>
            <span>{f.name}</span>
            {f.albumArt && onSelectAlbum ? (
              <AlbumArtStack albumArt={f.albumArt} onSelectAlbum={onSelectAlbum} />
            ) : null}
            <span className="facet-count">{f.trackCount}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
