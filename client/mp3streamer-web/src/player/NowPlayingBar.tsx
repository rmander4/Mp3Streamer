import { useEffect, useRef, useState } from 'react';
import { usePlayer } from './PlayerContext';
import { artworkUrl, setTrackRating, streamUrl } from '../api/client';
import { formatDuration } from '../utils/format';
import { FullScreenPlayer } from './FullScreenPlayer';
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon } from './icons';

// A touch device (any orientation/width) or a narrow desktop window counts as "mobile" here.
const MOBILE_QUERY = '(pointer: coarse), (max-width: 700px)';

export function NowPlayingBar() {
  const { currentTrack, isPlaying, setIsPlaying, setCurrentTrackRating, next, previous } = usePlayer();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Selecting a track (including re-selecting the current one) should (re)start playback.
  // The <audio> element's own play/pause events are the source of truth for isPlaying,
  // so we drive playback imperatively here rather than reacting to isPlaying itself.
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    audioRef.current?.play().catch(() => {
      /* autoplay may be blocked until the user interacts with the page again */
    });
  }, [currentTrack?.id]);

  if (!currentTrack) {
    return null;
  }

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const value = Number(e.target.value);
    audio.currentTime = value;
    setCurrentTime(value);
  };

  const openFullScreenOnMobile = () => {
    if (window.matchMedia(MOBILE_QUERY).matches) {
      setIsFullScreen(true);
    }
  };

  const handleRate = (stars: number) => {
    setCurrentTrackRating(stars);
    setTrackRating(currentTrack.id, stars).catch((err) => {
      console.error('Failed to save rating', err);
    });
  };

  return (
    <>
      <div className="now-playing-bar" onClick={openFullScreenOnMobile}>
        <audio
          ref={audioRef}
          src={streamUrl(currentTrack.id)}
          onEnded={next}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
        <img
          className="now-playing-art"
          src={artworkUrl(currentTrack.id)}
          alt=""
          onError={(e) => {
            (e.target as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        <div className="now-playing-info">
          <div className="now-playing-title">{currentTrack.title}</div>
          <div className="now-playing-artist">{currentTrack.artist ?? 'Unknown'}</div>
        </div>
        <div className="now-playing-controls" onClick={(e) => e.stopPropagation()}>
          <button onClick={previous} aria-label="Previous">
            <PreviousIcon size={16} />
          </button>
          <button onClick={togglePlayback} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </button>
          <button onClick={next} aria-label="Next">
            <NextIcon size={16} />
          </button>
        </div>
        <div className="now-playing-seek" onClick={(e) => e.stopPropagation()}>
          <span>{formatDuration(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={Math.min(currentTime, duration || 0)}
            onChange={handleSeek}
          />
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      {isFullScreen ? (
        <FullScreenPlayer
          track={currentTrack}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          onSeek={handleSeek}
          onTogglePlay={togglePlayback}
          onNext={next}
          onPrevious={previous}
          onClose={() => setIsFullScreen(false)}
          onRate={handleRate}
        />
      ) : null}
    </>
  );
}
