import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TableVirtuoso, type ItemProps, type ScrollSeekPlaceholderProps } from 'react-virtuoso';
import type { Track } from '../api/types';
import { formatDuration } from '../utils/format';
import { downloadUrl } from '../api/client';
import { StarRating } from '../player/StarRating';
import { DownloadIcon } from '../player/icons';
import { TrackContextMenu, type ContextMenuItem } from './TrackContextMenu';
import { EditTagsDialog } from './EditTagsDialog';
import { EditTagsBulkDialog } from './EditTagsBulkDialog';
import { useScrollParent } from '../hooks/useScrollParent';

interface TrackListProps {
  tracks: Track[];
  onPlay: (tracks: Track[], index: number) => void;
  onRate: (track: Track, rating: number) => void;
  onTagsUpdated: (track: Track) => void;
  onBulkTagsUpdated: (tracks: Track[]) => void;
  activeTrackId?: number;
  renderRowActions?: (track: Track, index: number) => ReactNode;
  // Called as the user scrolls near the end of `tracks` — wired to a
  // paged/infinite data source by the owning screen (App.tsx,
  // PlaylistPanel). Omit it for an already-fully-loaded small list (a
  // single playlist, a drilled-into album); the virtualized table works
  // identically either way, it just never has anything left to load.
  onLoadMore?: () => void;
}

// Matches the media query used elsewhere (e.g. NowPlayingBar) for "is this
// a touch device / mobile-width layout" — the Download column is hidden at
// this same breakpoint (see .col-download in App.css), so a long-press is
// offered here as the equivalent way to download a track.
const MOBILE_QUERY = '(pointer: coarse), (max-width: 700px)';

// Drag-select and right-click are mouse-only gestures — gated purely on
// pointer type, deliberately *not* including a width check like
// MOBILE_QUERY above. A desktop browser window narrower than 700px still
// has a real mouse and should still get right-click; width only matters
// for layout decisions (hiding columns, opening the full-screen player),
// not for whether a mouse-specific interaction should work at all.
const COARSE_POINTER_QUERY = '(pointer: coarse)';
const LONG_PRESS_MS = 550;

function triggerDownload(track: Track) {
  const link = document.createElement('a');
  link.href = downloadUrl(track.id);
  link.download = `${track.title}.mp3`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// react-virtuoso remounts the whole list whenever a `components` override's
// function identity changes, so these must be stable module-level
// references, not declared inside TrackList's render (see the
// react-virtuoso README: "Ensure that the component definitions are not
// declared inline... otherwise the [list] will remount with each render").
// Per-render state (selection, active track, handlers) flows in through the
// `context` prop instead of closures, since that's designed to change
// every render without needing a new component reference.
interface RowContext {
  tracks: Track[];
  selectedIds: Set<number>;
  activeTrackId?: number;
  columnCount: number;
  renderRowActions?: (track: Track, index: number) => ReactNode;
  onRate: (track: Track, rating: number) => void;
  onRowClick: (index: number) => void;
  onRowContextMenu: (e: React.MouseEvent, track: Track) => void;
  onRowPointerDown: (e: React.PointerEvent, track: Track) => void;
  onRowMouseDown: (e: React.MouseEvent, index: number, track: Track) => void;
  onRowMouseOver: (e: React.MouseEvent, index: number) => void;
  onClearLongPress: () => void;
}

function TrackTableEl(props: React.ComponentProps<'table'>) {
  return <table {...props} className="track-list" />;
}

function TrackRow({ item: track, context, ...rowProps }: ItemProps<Track> & { context: RowContext }) {
  const index = rowProps['data-index'];
  const classNames = ['track-row'];
  if (track.id === context.activeTrackId) classNames.push('active');
  if (context.selectedIds.has(track.id)) classNames.push('selected');
  if (track.isMissing) classNames.push('missing');

  return (
    <tr
      {...rowProps}
      className={classNames.join(' ')}
      onClick={() => context.onRowClick(index)}
      onContextMenu={(e) => context.onRowContextMenu(e, track)}
      onPointerDown={(e) => context.onRowPointerDown(e, track)}
      onPointerUp={context.onClearLongPress}
      onPointerLeave={context.onClearLongPress}
      onPointerCancel={context.onClearLongPress}
      onMouseDown={(e) => context.onRowMouseDown(e, index, track)}
      onMouseOver={(e) => context.onRowMouseOver(e, index)}
    />
  );
}

function RowScrollSeekPlaceholder({ height, context }: ScrollSeekPlaceholderProps & { context: RowContext }) {
  return (
    <tr style={{ height }}>
      <td colSpan={context.columnCount}>
        <div className="skeleton-row" />
      </td>
    </tr>
  );
}

const trackTableComponents = {
  Table: TrackTableEl,
  TableRow: TrackRow,
  ScrollSeekPlaceholder: RowScrollSeekPlaceholder,
};

function trackItemContent(index: number, track: Track, context: RowContext) {
  return (
    <>
      <td className="col-number">{track.trackNumber ?? '-'}</td>
      <td>
        {track.title}
        {track.isMissing ? <span className="missing-label"> (missing)</span> : null}
        <div className="track-subtitle-mobile">
          {track.artist ?? 'Unknown'} &middot; {track.album ?? 'Unknown'}
        </div>
      </td>
      <td className="col-artist">{track.artist ?? 'Unknown'}</td>
      <td className="col-album">{track.album ?? 'Unknown'}</td>
      <td>{formatDuration(track.durationSeconds)}</td>
      <td className="col-rating" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <StarRating rating={track.rating} onRate={(stars) => context.onRate(track, stars)} size={16} />
      </td>
      <td className="col-download" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <a
          href={downloadUrl(track.id)}
          download={`${track.title}.mp3`}
          className="download-link"
          aria-label={`Download ${track.title}`}
        >
          <DownloadIcon size={16} />
        </a>
      </td>
      {context.renderRowActions ? (
        <td className="row-actions" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          {context.renderRowActions(track, index)}
        </td>
      ) : null}
    </>
  );
}

function fixedHeaderContent(renderRowActions: boolean) {
  return (
    <tr>
      <th className="col-number">#</th>
      <th>Title</th>
      <th className="col-artist">Artist</th>
      <th className="col-album">Album</th>
      <th>Duration</th>
      <th className="col-rating">Rating</th>
      <th className="col-download">Download</th>
      {renderRowActions ? <th></th> : null}
    </tr>
  );
}

const scrollSeekConfiguration = {
  enter: (velocity: number) => Math.abs(velocity) > 500,
  exit: (velocity: number) => Math.abs(velocity) < 20,
};

export function TrackList({
  tracks,
  onPlay,
  onRate,
  onTagsUpdated,
  onBulkTagsUpdated,
  activeTrackId,
  renderRowActions,
  onLoadMore,
}: TrackListProps) {
  const scrollParent = useScrollParent();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [editingBulk, setEditingBulk] = useState<Track[] | null>(null);

  // Drag-to-select state. A plain click (mousedown+mouseup with no motion
  // to a different row) still plays the track, same as before — only an
  // actual drag across rows turns into a multi-select instead.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const dragAnchorIndex = useRef<number | null>(null);
  const didDragRef = useRef(false);

  useEffect(() => {
    const handleMouseUp = () => {
      if (dragAnchorIndex.current !== null && !didDragRef.current) {
        // No drag happened — this was a plain click. Let the browser's own
        // click event (handled by handleRowClick) do the playing; just
        // clear the tentative single-row selection it started with.
        setSelectedIds(new Set());
      }
      dragAnchorIndex.current = null;
      didDragRef.current = false;
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  if (tracks.length === 0) {
    return <p className="empty-state">No tracks found.</p>;
  }

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleRowPointerDown = (e: React.PointerEvent, track: Track) => {
    if (!window.matchMedia(MOBILE_QUERY).matches) return;
    clearLongPress();
    const x = e.clientX;
    const y = e.clientY;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      suppressClick.current = true;
      // Mobile's long-press is the equivalent of desktop's right-click, but
      // only ever targets the single pressed track — multi-select/bulk edit
      // is desktop (drag-select) only for now.
      setContextMenu({
        x,
        y,
        items: [
          { label: 'Edit ID3 Tag', onSelect: () => setEditingTrack(track) },
          { label: 'Download', onSelect: () => triggerDownload(track) },
        ],
      });
    }, LONG_PRESS_MS);
  };

  const handleRowMouseDown = (e: React.MouseEvent, index: number, track: Track) => {
    if (window.matchMedia(COARSE_POINTER_QUERY).matches) return;
    if (e.button !== 0) return; // left button only; right-click is handled separately
    dragAnchorIndex.current = index;
    didDragRef.current = false;
    setSelectedIds(new Set([track.id]));
  };

  const handleRowMouseOver = (e: React.MouseEvent, index: number) => {
    if (dragAnchorIndex.current === null) return;
    if (e.buttons !== 1) return; // button was released outside the table
    if (index === dragAnchorIndex.current) return;
    didDragRef.current = true;
    suppressClick.current = true;
    const [lo, hi] = [Math.min(dragAnchorIndex.current, index), Math.max(dragAnchorIndex.current, index)];
    setSelectedIds(new Set(tracks.slice(lo, hi + 1).map((t) => t.id)));
  };

  const handleRowClick = (index: number) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (tracks[index].isMissing) return; // file's gone — nothing to stream
    onPlay(tracks, index);
  };

  const handleRowContextMenu = (e: React.MouseEvent, track: Track) => {
    if (window.matchMedia(COARSE_POINTER_QUERY).matches) return;
    e.preventDefault();
    // Without this, the event keeps bubbling up to `document` after the menu
    // opens — TrackContextMenu's own useEffect attaches a document-level
    // "contextmenu closes the menu" listener as soon as it mounts, which
    // this same still-bubbling event would immediately trigger, closing the
    // menu the instant it opens (looks like right-click does nothing at all).
    e.stopPropagation();

    // Right-clicking inside the current multi-selection edits the whole
    // selection; right-clicking outside it resets selection to just the
    // clicked row (standard file-explorer convention).
    const inSelection = selectedIds.has(track.id) && selectedIds.size > 1;
    const targetTracks = inSelection ? tracks.filter((t) => selectedIds.has(t.id)) : [track];
    if (!inSelection) setSelectedIds(new Set([track.id]));

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: targetTracks.length > 1 ? 'Edit ID3 Tags' : 'Edit ID3 Tag',
          onSelect: () => (targetTracks.length > 1 ? setEditingBulk(targetTracks) : setEditingTrack(targetTracks[0])),
        },
      ],
    });
  };

  const rowContext: RowContext = {
    tracks,
    selectedIds,
    activeTrackId,
    columnCount: 7 + (renderRowActions ? 1 : 0),
    renderRowActions,
    onRate,
    onRowClick: handleRowClick,
    onRowContextMenu: handleRowContextMenu,
    onRowPointerDown: handleRowPointerDown,
    onRowMouseDown: handleRowMouseDown,
    onRowMouseOver: handleRowMouseOver,
    onClearLongPress: clearLongPress,
  };

  return (
    <>
      <TableVirtuoso
        data={tracks}
        context={rowContext}
        style={{ height: 600 }}
        components={trackTableComponents}
        fixedHeaderContent={() => fixedHeaderContent(!!renderRowActions)}
        itemContent={trackItemContent}
        endReached={() => onLoadMore?.()}
        increaseViewportBy={{ top: 300, bottom: 300 }}
        scrollSeekConfiguration={scrollSeekConfiguration}
      />

      {contextMenu ? (
        <TrackContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {editingTrack ? (
        <EditTagsDialog
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
          // Closing (or not) is the dialog's own call now — "Apply" saves
          // and keeps paging, "Apply and Close" saves and calls onClose
          // itself. This callback just needs to keep the outer track list
          // in sync, not decide whether the dialog stays open.
          onSaved={(updated) => onTagsUpdated(updated)}
        />
      ) : null}

      {editingBulk ? (
        <EditTagsBulkDialog
          tracks={editingBulk}
          onClose={() => setEditingBulk(null)}
          onSaved={(updated) => {
            onBulkTagsUpdated(updated);
            setEditingBulk(null);
            setSelectedIds(new Set());
          }}
        />
      ) : null}
    </>
  );
}
