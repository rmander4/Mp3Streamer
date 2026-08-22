import { useEffect, useState } from 'react';
import { artworkUrl, clearPlaybackState, fetchPlaybackState } from '../api/client';
import type { PlaybackState } from '../api/types';
import { usePlayer } from './PlayerContext';

// The cross-device "continue where you left off" prompt — fetched once on
// app load. Renders nothing if there's nothing saved (most sessions never
// pause mid-track) or once the user has answered it.
export function ResumePrompt() {
  const { playQueue } = usePlayer();
  const [state, setState] = useState<PlaybackState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetchPlaybackState()
      .then(setState)
      .catch((err) => console.error('Failed to fetch saved playback position', err));
  }, []);

  if (!state || dismissed) return null;

  const handleContinue = () => {
    playQueue([state.track], 0, state.positionSeconds);
    setDismissed(true);
  };

  // Declining clears it server-side too — otherwise the same prompt would
  // just reappear next time for a track the user already said no to.
  const handleDecline = () => {
    setDismissed(true);
    clearPlaybackState().catch((err) => console.error('Failed to clear playback position', err));
  };

  return (
    <div className="settings-backdrop" onClick={handleDecline}>
      <div className="settings-panel resume-panel" onClick={(e) => e.stopPropagation()}>
        <div className="resume-track">
          <img
            className="resume-art"
            src={artworkUrl(state.track.id)}
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
          <div className="resume-info">
            <div className="resume-title">{state.track.title}</div>
            <div className="resume-artist">{state.track.artist ?? 'Unknown'}</div>
          </div>
        </div>
        <p className="resume-question">Continue playing this track?</p>
        <div className="tags-actions">
          <button className="settings-option" onClick={handleDecline}>
            No
          </button>
          <button className="settings-option tags-apply" onClick={handleContinue}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
