import { useRef, type ReactNode } from 'react';
import type { Track } from '../api/types';
import { formatDuration } from '../utils/format';
import { downloadUrl } from '../api/client';
import { StarRating } from '../player/StarRating';
import { DownloadIcon } from '../player/icons';

interface TrackListProps {
  tracks: Track[];
  onPlay: (tracks: Track[], index: number) => void;
  onRate: (track: Track, rating: number) => void;
  activeTrackId?: number;
  renderRowActions?: (track: Track, index: number) => ReactNode;
}

// Matches the media query used elsewhere (e.g. NowPlayingBar) for "is this
// a touch device / mobile-width layout" — the Download column is hidden at
// this same breakpoint (see .col-download in App.css), so a long-press is
// offered here as the equivalent way to download a track.
const MOBILE_QUERY = '(pointer: coarse), (max-width: 700px)';
const LONG_PRESS_MS = 550;

function triggerDownload(track: Track) {
  const link = document.createElement('a');
  link.href = downloadUrl(track.id);
  link.download = `${track.title}.mp3`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function TrackList({ tracks, onPlay, onRate, activeTrackId, renderRowActions }: TrackListProps) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);

  if (tracks.length === 0) {
    return <p className="empty-state">No tracks found.</p>;
  }

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleRowPointerDown = (track: Track) => {
    if (!window.matchMedia(MOBILE_QUERY).matches) return;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      suppressClick.current = true;
      if (window.confirm(`Download "${track.title}"?`)) {
        triggerDownload(track);
      }
    }, LONG_PRESS_MS);
  };

  const handleRowClick = (tracksForRow: Track[], index: number) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onPlay(tracksForRow, index);
  };

  return (
    <table className="track-list">
      <thead>
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
      </thead>
      <tbody>
        {tracks.map((track, index) => (
          <tr
            key={track.id}
            className={track.id === activeTrackId ? 'track-row active' : 'track-row'}
            onClick={() => handleRowClick(tracks, index)}
            onPointerDown={() => handleRowPointerDown(track)}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
          >
            <td className="col-number">{track.trackNumber ?? '-'}</td>
            <td>
              {track.title}
              <div className="track-subtitle-mobile">
                {track.artist ?? 'Unknown'} &middot; {track.album ?? 'Unknown'}
              </div>
            </td>
            <td className="col-artist">{track.artist ?? 'Unknown'}</td>
            <td className="col-album">{track.album ?? 'Unknown'}</td>
            <td>{formatDuration(track.durationSeconds)}</td>
            <td className="col-rating" onClick={(e) => e.stopPropagation()}>
              <StarRating rating={track.rating} onRate={(stars) => onRate(track, stars)} size={16} />
            </td>
            <td className="col-download" onClick={(e) => e.stopPropagation()}>
              <a
                href={downloadUrl(track.id)}
                download={`${track.title}.mp3`}
                className="download-link"
                aria-label={`Download ${track.title}`}
              >
                <DownloadIcon size={16} />
              </a>
            </td>
            {renderRowActions ? (
              <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                {renderRowActions(track, index)}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
