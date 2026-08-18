import type { ReactNode } from 'react';
import type { Track } from '../api/types';
import { formatDuration } from '../utils/format';
import { StarRating } from '../player/StarRating';

interface TrackListProps {
  tracks: Track[];
  onPlay: (tracks: Track[], index: number) => void;
  onRate: (track: Track, rating: number) => void;
  activeTrackId?: number;
  renderRowActions?: (track: Track, index: number) => ReactNode;
}

export function TrackList({ tracks, onPlay, onRate, activeTrackId, renderRowActions }: TrackListProps) {
  if (tracks.length === 0) {
    return <p className="empty-state">No tracks found.</p>;
  }

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
          {renderRowActions ? <th></th> : null}
        </tr>
      </thead>
      <tbody>
        {tracks.map((track, index) => (
          <tr
            key={track.id}
            className={track.id === activeTrackId ? 'track-row active' : 'track-row'}
            onClick={() => onPlay(tracks, index)}
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
