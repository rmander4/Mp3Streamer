import { useEffect, useState } from 'react';
import { TableVirtuoso, type ItemProps, type ScrollSeekPlaceholderProps } from 'react-virtuoso';
import type { PlayHistoryEntry } from '../api/types';
import { clearHistory, fetchHistory } from '../api/client';
import { usePlayer } from '../player/PlayerContext';
import { useScrollParent } from '../hooks/useScrollParent';

function formatTime(playedAtUtc: string): string {
  return new Date(playedAtUtc).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Stable module-level references — react-virtuoso remounts the table
// whenever a `components` override's function identity changes, so these
// can't be declared inside HistoryPanel's render (see the react-virtuoso
// README). Per-render state (active track, click handler) flows in
// through the `context` prop instead — same pattern TrackList.tsx uses,
// kept as its own small instance here since the columns differ (Time
// instead of Track#/Rating/Download).
interface HistoryRowContext {
  currentTrackId?: number;
  onRowClick: (index: number) => void;
}

function HistoryTableEl(props: React.ComponentProps<'table'>) {
  return <table {...props} className="track-list" />;
}

function HistoryRow({ item: entry, context, ...rowProps }: ItemProps<PlayHistoryEntry> & { context: HistoryRowContext }) {
  const index = rowProps['data-index'];
  const classNames = ['track-row'];
  if (entry.track.id === context.currentTrackId) classNames.push('active');
  if (entry.track.isMissing) classNames.push('missing');

  return <tr {...rowProps} className={classNames.join(' ')} onClick={() => context.onRowClick(index)} />;
}

function HistoryScrollSeekPlaceholder({ height }: ScrollSeekPlaceholderProps) {
  return (
    <tr style={{ height }}>
      <td colSpan={4}>
        <div className="skeleton-row" />
      </td>
    </tr>
  );
}

const historyTableComponents = {
  Table: HistoryTableEl,
  TableRow: HistoryRow,
  ScrollSeekPlaceholder: HistoryScrollSeekPlaceholder,
};

function historyItemContent(_index: number, entry: PlayHistoryEntry) {
  return (
    <>
      <td className="col-number">{formatTime(entry.playedAtUtc)}</td>
      <td>
        {entry.track.title}
        {entry.track.isMissing ? <span className="missing-label"> (missing)</span> : null}
        <div className="track-subtitle-mobile">
          {entry.track.artist ?? 'Unknown'} &middot; {entry.track.album ?? 'Unknown'}
        </div>
      </td>
      <td className="col-artist">{entry.track.artist ?? 'Unknown'}</td>
      <td className="col-album">{entry.track.album ?? 'Unknown'}</td>
    </>
  );
}

const historyScrollSeekConfiguration = {
  enter: (velocity: number) => Math.abs(velocity) > 500,
  exit: (velocity: number) => Math.abs(velocity) < 20,
};

export function HistoryPanel() {
  const [entries, setEntries] = useState<PlayHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { playQueue, currentTrack } = usePlayer();
  const scrollParent = useScrollParent();

  useEffect(() => {
    fetchHistory()
      .then(setEntries)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return <p className="error-state">{error}</p>;
  }

  if (!entries) {
    return <p className="loading-state">Loading...</p>;
  }

  // Clicking a row queues the whole day's history (in the order shown),
  // starting at that track — so Next/Previous can browse forward and back
  // through it too. Handy for "I heard something great around 3pm but
  // don't remember what" — click around near that time until it turns up.
  const handlePlay = (index: number) => {
    if (entries[index].track.isMissing) return; // file's gone — nothing to stream
    playQueue(entries.map((e) => e.track), index);
  };

  const handleClear = () => {
    if (!window.confirm('Clear today’s play history? This cannot be undone.')) return;
    clearHistory()
      .then(() => setEntries([]))
      .catch((e) => setError(String(e)));
  };

  if (entries.length === 0) {
    return <p className="empty-state">Nothing played yet today.</p>;
  }

  const rowContext: HistoryRowContext = { currentTrackId: currentTrack?.id, onRowClick: handlePlay };

  return (
    <>
      <div className="history-header">
        <button className="settings-option" onClick={handleClear}>
          Clear History
        </button>
      </div>
      <TableVirtuoso
        data={entries}
        context={rowContext}
        customScrollParent={scrollParent ?? undefined}
        components={historyTableComponents}
        fixedHeaderContent={() => (
          <tr>
            <th className="col-number">Time</th>
            <th>Title</th>
            <th className="col-artist">Artist</th>
            <th className="col-album">Album</th>
          </tr>
        )}
        itemContent={historyItemContent}
        increaseViewportBy={{ top: 300, bottom: 300 }}
        scrollSeekConfiguration={historyScrollSeekConfiguration}
      />
    </>
  );
}
