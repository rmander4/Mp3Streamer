import { useRef, useState } from 'react';
import type { Album, Track } from '../api/types';
import { artworkUrl, fetchTracks } from '../api/client';
import { TrackContextMenu, type ContextMenuItem } from './TrackContextMenu';
import { EditTagsBulkDialog } from './EditTagsBulkDialog';

interface AlbumGridProps {
  albums: Album[];
  onSelect: (album: Album) => void;
  onTracksEdited?: () => void;
}

// Same gestures/constants TrackList.tsx uses for its own right-click /
// long-press context menu — duplicated rather than shared, matching how
// this codebase already keeps these small per-component rather than in a
// shared module (e.g. NowPlayingBar has its own MOBILE_QUERY too).
const MOBILE_QUERY = '(pointer: coarse), (max-width: 700px)';
const COARSE_POINTER_QUERY = '(pointer: coarse)';
const LONG_PRESS_MS = 550;

export function AlbumGrid({ albums, onSelect, onTracksEdited }: AlbumGridProps) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
  const [editingBulk, setEditingBulk] = useState<Track[] | null>(null);

  if (albums.length === 0) {
    return <p className="empty-state">No albums found.</p>;
  }

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Right-clicking (or long-pressing) an album edits every one of its
  // tracks at once, through the same bulk ID3 editor as selecting all of
  // an album's tracks from the track list and right-clicking there.
  const openBulkEditor = async (album: Album) => {
    const result = await fetchTracks({ album: album.album, artist: album.artist ?? undefined, pageSize: 1000 });
    setEditingBulk(result.items);
  };

  const handleCardContextMenu = (e: React.MouseEvent, album: Album) => {
    if (window.matchMedia(COARSE_POINTER_QUERY).matches) return;
    e.preventDefault();
    // Same reasoning as TrackList's handleRowContextMenu: without this the
    // still-bubbling event reaches TrackContextMenu's own document-level
    // dismiss listener the instant it mounts, closing the menu immediately.
    e.stopPropagation();

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [{ label: 'Edit ID3 Tags', onSelect: () => openBulkEditor(album) }],
    });
  };

  const handleCardPointerDown = (e: React.PointerEvent, album: Album) => {
    if (!window.matchMedia(MOBILE_QUERY).matches) return;
    clearLongPress();
    const x = e.clientX;
    const y = e.clientY;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      suppressClick.current = true;
      setContextMenu({
        x,
        y,
        items: [{ label: 'Edit ID3 Tags', onSelect: () => openBulkEditor(album) }],
      });
    }, LONG_PRESS_MS);
  };

  const handleCardClick = (album: Album) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onSelect(album);
  };

  return (
    <>
      <div className="album-grid">
        {albums.map((album) => (
          <button
            key={`${album.artist}-${album.album}`}
            className="album-card"
            onClick={() => handleCardClick(album)}
            onContextMenu={(e) => handleCardContextMenu(e, album)}
            onPointerDown={(e) => handleCardPointerDown(e, album)}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
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

      {contextMenu ? (
        <TrackContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {editingBulk ? (
        <EditTagsBulkDialog
          tracks={editingBulk}
          onClose={() => setEditingBulk(null)}
          onSaved={() => {
            setEditingBulk(null);
            onTracksEdited?.();
          }}
        />
      ) : null}
    </>
  );
}
