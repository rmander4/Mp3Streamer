import { useRef, useState } from 'react';
import type { Track } from '../api/types';
import { artworkUrl } from '../api/client';
import { formatDuration } from '../utils/format';
import { StarRating } from './StarRating';
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon } from './icons';
import { SettingsPanel } from '../components/SettingsPanel';
import { FullscreenToggle } from '../components/FullscreenToggle';

interface FullScreenPlayerProps {
  track: Track;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  onRate: (stars: number) => void;
}

// Matches the CSS breakpoint that switches the Now Playing Screen to its
// side-by-side landscape layout — the dismiss-swipe direction should agree
// with whichever layout is actually on screen.
const LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)';
const DISMISS_THRESHOLD = 90;

export function FullScreenPlayer({
  track,
  isPlaying,
  isBuffering,
  currentTime,
  duration,
  volume,
  onSeek,
  onVolumeChange,
  onTogglePlay,
  onNext,
  onPrevious,
  onClose,
  onRate,
}: FullScreenPlayerProps) {
  const remaining = Math.max(duration - currentTime, 0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; isLandscape: boolean } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers reject capture for a pointer they don't recognize as
      // active — dragging still works via normal event bubbling either way.
    }
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      isLandscape: window.matchMedia(LANDSCAPE_QUERY).matches,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!dragState.current) return;
    const { startX, startY, isLandscape } = dragState.current;
    // Portrait dismisses downward, landscape dismisses toward the right
    // (the artwork sits on the left side of the screen there).
    const raw = isLandscape ? e.clientX - startX : e.clientY - startY;
    setDragOffset(Math.max(0, raw));
  };

  const endDrag = () => {
    if (!dragState.current) return;
    if (dragOffset > DISMISS_THRESHOLD) {
      onClose();
    }
    setIsDragging(false);
    setDragOffset(0);
    dragState.current = null;
  };

  const isLandscapeDrag = dragState.current?.isLandscape ?? false;
  const artStyle = {
    transform: isLandscapeDrag ? `translateX(${dragOffset}px)` : `translateY(${dragOffset}px)`,
    opacity: Math.max(1 - dragOffset / 400, 0.4),
    transition: isDragging ? 'none' : 'transform 0.2s ease, opacity 0.2s ease',
    touchAction: 'none' as const,
  };

  return (
    <div className="fullscreen-player">
      <div className="fullscreen-header">
        <FullscreenToggle />
        <button className="settings-trigger" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          ⋮
        </button>
      </div>
      <div className="fullscreen-main">
        <img
          className="fullscreen-art"
          style={artStyle}
          src={artworkUrl(track.id)}
          alt=""
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onError={(e) => {
            (e.target as HTMLImageElement).style.visibility = 'hidden';
          }}
        />

        <div className="fullscreen-details">
          <div className="fullscreen-seek-row">
            <div className="fullscreen-seek">
            <input
              type="range"
              min={0}
              max={duration || 0}
              value={Math.min(currentTime, duration || 0)}
              onChange={onSeek}
            />
            <div className="fullscreen-seek-labels">
              <span>{formatDuration(currentTime)}</span>
              <span>-{formatDuration(remaining)}</span>
            </div>
            </div>
            <div className="player-volume" onClick={(e) => e.stopPropagation()}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={onVolumeChange}
                aria-label="Volume"
              />
            </div>
          </div>

          <div className="fullscreen-info">
            <div className="fullscreen-title">{track.title}</div>
            <div className="fullscreen-subtitle">{track.album ?? 'Unknown'}</div>
            <div className="fullscreen-subtitle">
              {track.artist ?? 'Unknown'}
              {isBuffering ? ' · Buffering…' : ''}
            </div>
          </div>

          <StarRating rating={track.rating} onRate={onRate} />

          <div className="fullscreen-controls">
            <button onClick={onPrevious} aria-label="Previous">
              <PreviousIcon size={26} />
            </button>
            <button onClick={onTogglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
            </button>
            <button onClick={onNext} aria-label="Next">
              <NextIcon size={26} />
            </button>
          </div>
        </div>
      </div>

      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
