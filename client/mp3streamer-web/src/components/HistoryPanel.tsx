import { useEffect, useState } from 'react';
import type { PlayHistoryEntry } from '../api/types';
import { clearHistory, fetchHistory } from '../api/client';
import { usePlayer } from '../player/PlayerContext';

function formatTime(playedAtUtc: string): string {
  return new Date(playedAtUtc).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function HistoryPanel() {
  const [entries, setEntries] = useState<PlayHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { playQueue, currentTrack } = usePlayer();

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

  return (
    <>
      <div className="history-header">
        <button className="settings-option" onClick={handleClear}>
          Clear History
        </button>
      </div>
      <table className="track-list">
      <thead>
        <tr>
          <th className="col-number">Time</th>
          <th>Title</th>
          <th className="col-artist">Artist</th>
          <th className="col-album">Album</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => {
          const classNames = ['track-row'];
          if (entry.track.id === currentTrack?.id) classNames.push('active');
          if (entry.track.isMissing) classNames.push('missing');

          return (
            <tr key={entry.id} className={classNames.join(' ')} onClick={() => handlePlay(index)}>
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
            </tr>
          );
        })}
      </tbody>
      </table>
    </>
  );
}
