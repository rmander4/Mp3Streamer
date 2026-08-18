import type { Album } from '../api/types';
import { artworkUrl } from '../api/client';

interface AlbumGridProps {
  albums: Album[];
  onSelect: (album: Album) => void;
}

export function AlbumGrid({ albums, onSelect }: AlbumGridProps) {
  if (albums.length === 0) {
    return <p className="empty-state">No albums found.</p>;
  }

  return (
    <div className="album-grid">
      {albums.map((album) => (
        <button
          key={`${album.artist}-${album.album}`}
          className="album-card"
          onClick={() => onSelect(album)}
        >
          <img
            src={artworkUrl(album.sampleTrackId)}
            alt={album.album}
            onError={(e) => {
              (e.target as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
          <div className="album-card-title">{album.album}</div>
          <div className="album-card-artist">{album.artist ?? 'Unknown Artist'}</div>
        </button>
      ))}
    </div>
  );
}
