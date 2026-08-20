import { useState } from 'react';
import type { Facet } from '../api/types';
import { artworkUrl } from '../api/client';

interface FacetListProps {
  facets: Facet[];
  onSelect: (name: string) => void;
}

function AlbumArtStack({ trackIds }: { trackIds: number[] }) {
  const [failed, setFailed] = useState<Set<number>>(new Set());

  if (trackIds.length === 0) return null;

  return (
    <div className="album-art-stack" aria-hidden="true">
      {trackIds.map((trackId) =>
        failed.has(trackId) ? (
          <span key={trackId} className="album-art-stack-item album-art-stack-fallback">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55a4 4 0 1 0 2 3.45V7h4V3h-6z" />
            </svg>
          </span>
        ) : (
          <img
            key={trackId}
            className="album-art-stack-item"
            src={artworkUrl(trackId)}
            alt=""
            onError={() => setFailed((prev) => new Set(prev).add(trackId))}
          />
        ),
      )}
    </div>
  );
}

export function FacetList({ facets, onSelect }: FacetListProps) {
  if (facets.length === 0) {
    return <p className="empty-state">Nothing found.</p>;
  }

  return (
    <ul className="facet-list">
      {facets.map((f) => (
        <li key={f.name}>
          <button className="facet-item" onClick={() => onSelect(f.name)}>
            <span>{f.name}</span>
            {f.albumArtTrackIds ? <AlbumArtStack trackIds={f.albumArtTrackIds} /> : null}
            <span className="facet-count">{f.trackCount}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
