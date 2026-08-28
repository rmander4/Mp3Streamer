import { useEffect, useRef, useState } from 'react';
import { VirtuosoGrid, type GridScrollSeekPlaceholderProps } from 'react-virtuoso';
import type { Album, Track } from '../api/types';
import { artworkUrl, fetchTracks } from '../api/client';
import { TrackContextMenu, type ContextMenuItem } from './TrackContextMenu';
import { EditTagsBulkDialog } from './EditTagsBulkDialog';
import { useScrollParent } from '../hooks/useScrollParent';

// Pixels/second the text travels — tuned to be readable, not distracting.
const LABEL_MARQUEE_PX_PER_SECOND = 30;
const LABEL_MARQUEE_MIN_SECONDS = 4;

// Keeps a title/artist label to one line, sliding it back and forth (pure
// CSS animation, no pause at the ends — unlike the Artists-tab album-art
// marquee, nothing here is meant to be clicked mid-scroll) instead of
// wrapping to a second line or truncating with an ellipsis. Only the
// overflow *amount* needs measuring in JS — how far the animation has to
// travel varies per label, which a static CSS rule can't know on its own —
// the actual back-and-forth motion is a plain `@keyframes` + `alternate`.
function MarqueeLabel({ text, className }: { text: string; className: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      setOverflowPx(Math.max(0, el.scrollWidth - el.clientWidth));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [text]);

  const isMarquee = overflowPx > 0;

  return (
    <div ref={wrapRef} className={isMarquee ? `${className} marquee-active` : className}>
      <span
        className="marquee-text"
        style={
          isMarquee
            ? ({
                '--marquee-distance': `${overflowPx}px`,
                animationDuration: `${Math.max(LABEL_MARQUEE_MIN_SECONDS, overflowPx / LABEL_MARQUEE_PX_PER_SECOND)}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </div>
  );
}

interface AlbumGridProps {
  albums: Album[];
  onSelect: (album: Album) => void;
  onTracksEdited?: () => void;
  // Called as the user scrolls near the end of `albums` — wired to a
  // paged/infinite data source by App.tsx.
  onLoadMore?: () => void;
}

// Same gestures/constants TrackList.tsx uses for its own right-click /
// long-press context menu — duplicated rather than shared, matching how
// this codebase already keeps these small per-component rather than in a
// shared module (e.g. NowPlayingBar has its own MOBILE_QUERY too).
const MOBILE_QUERY = '(pointer: coarse), (max-width: 700px)';
const COARSE_POINTER_QUERY = '(pointer: coarse)';
const LONG_PRESS_MS = 550;

// Stable module-level reference — react-virtuoso remounts the grid whenever
// a `components` override's function identity changes, so this can't be
// declared inside AlbumGrid's render (see the react-virtuoso README).
// Doesn't need per-render state, so no `context` plumbing required here.
function GridScrollSeekPlaceholder({ height, width }: GridScrollSeekPlaceholderProps) {
  return <div className="album-card skeleton-card" style={{ height, width }} />;
}

const gridComponents = { ScrollSeekPlaceholder: GridScrollSeekPlaceholder };

const gridScrollSeekConfiguration = {
  enter: (velocity: number) => Math.abs(velocity) > 500,
  exit: (velocity: number) => Math.abs(velocity) < 20,
};

export function AlbumGrid({ albums, onSelect, onTracksEdited, onLoadMore }: AlbumGridProps) {
  const scrollParent = useScrollParent();
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
      <VirtuosoGrid
        data={albums}
        customScrollParent={scrollParent ?? undefined}
        listClassName="album-grid"
        computeItemKey={(_index, album) => `${album.artist}-${album.album}`}
        components={gridComponents}
        itemContent={(_index, album) => (
          <button
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
            <MarqueeLabel className="album-card-title" text={album.album} />
            <MarqueeLabel className="album-card-artist" text={album.artist ?? 'Unknown Artist'} />
          </button>
        )}
        endReached={() => onLoadMore?.()}
        increaseViewportBy={{ top: 300, bottom: 300 }}
        scrollSeekConfiguration={gridScrollSeekConfiguration}
      />

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
