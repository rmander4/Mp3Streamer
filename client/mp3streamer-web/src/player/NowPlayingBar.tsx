import { useEffect, useRef, useState } from 'react';
import { usePlayer } from './PlayerContext';
import { artworkUrl, clearPlaybackState, recordPlay, savePlaybackState, setTrackRating, streamUrl } from '../api/client';
import { formatDuration } from '../utils/format';
import { FullScreenPlayer } from './FullScreenPlayer';
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon } from './icons';
import { bufferTrack } from './bufferTrack';

// A touch device (any orientation/width) or a narrow desktop window counts as "mobile" here.
const MOBILE_QUERY = '(pointer: coarse), (max-width: 700px)';

// How close to the end of the pre-buffered portion (in seconds) to trigger
// the handoff to live network streaming for tracks longer than the buffer
// cap — early enough that the swap's own brief loading gap doesn't cause an
// audible stall, and generous enough to absorb bufferTrack's byte-to-seconds
// estimate being a little optimistic (see bufferedSeconds in bufferTrack.ts).
const HANDOFF_LEAD_SECONDS = 5;

// How often to checkpoint the current position to the server while playing,
// as a backstop for the cross-device resume feature — covers the case where
// the browser/tab dies without ever firing a `pause` event (crash, phone
// force-killed, battery dies), so a session is never more than this many
// seconds of position out of date.
const AUTOSAVE_INTERVAL_MS = 10_000;

export function NowPlayingBar() {
  const {
    currentTrack,
    isPlaying,
    setIsPlaying,
    setCurrentTrackRating,
    selectionSeq,
    resumeSeconds,
    clearResumeSeconds,
    next,
    previous,
  } = usePlayer();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);

  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isPartialRef = useRef(false);
  const bufferedSecondsRef = useRef(0);
  const handoffDoneRef = useRef(false);

  // Selecting a track (including re-selecting the current one) pre-buffers
  // it (the whole file, or the first few minutes for a long track — see
  // bufferTrack.ts) into memory before starting playback, so a temporary
  // connection drop mid-song doesn't interrupt it. The <audio> element's
  // own play/pause events remain the source of truth for isPlaying; we
  // drive playback imperatively here rather than reacting to isPlaying.
  // Keyed on selectionSeq (bumped on every explicit play action), not
  // currentTrack?.id — id alone doesn't change when re-selecting the same
  // track, which used to silently no-op the re-selection entirely (found
  // via a real bug: repeatedly clicking the same track from History wasn't
  // recording new history entries, since this effect never re-ran).
  useEffect(() => {
    setCurrentTime(0);
    isPartialRef.current = false;
    bufferedSecondsRef.current = 0;
    handoffDoneRef.current = false;

    abortRef.current?.abort();
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    if (!currentTrack) {
      setDuration(0);
      return;
    }

    // The API's own duration (from the file's ID3 tags) is accurate and
    // available immediately — no need to wait on the audio element's own
    // metadata, which would otherwise briefly reflect only the buffered
    // portion's (shorter) duration for a partially-buffered long track.
    setDuration(currentTrack.durationSeconds);

    // Records one history entry per track selection (not per pause/resume —
    // those don't re-trigger this effect, since it only depends on
    // currentTrack.id). The server decides whether to actually persist it
    // based on the Track History on/off setting; the client doesn't need to
    // know that state just to fire this.
    recordPlay(currentTrack.id).catch((err) => {
      console.error('Failed to record play history', err);
    });

    const controller = new AbortController();
    abortRef.current = controller;
    setIsBuffering(true);

    bufferTrack(currentTrack, controller.signal)
      .then(({ blobUrl, isPartial, bufferedSeconds }) => {
        blobUrlRef.current = blobUrl;
        isPartialRef.current = isPartial;
        bufferedSecondsRef.current = bufferedSeconds;
        const audio = audioRef.current;
        if (!audio) return;
        audio.src = blobUrl;

        // Resuming from the cross-device "Continue playing?" prompt — seek
        // to the saved position instead of starting from 0. Past what's
        // actually buffered needs the same live-stream handoff a manual
        // seek there would trigger (see swapToLiveStream/handleSeek below).
        if (resumeSeconds != null) {
          if (isPartial && resumeSeconds > bufferedSeconds - HANDOFF_LEAD_SECONDS) {
            swapToLiveStream(resumeSeconds);
          } else {
            audio.currentTime = resumeSeconds;
          }
          clearResumeSeconds();
        }

        audio.play().catch(() => {
          /* autoplay may be blocked until the user interacts with the page again */
        });
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        console.error('Failed to pre-buffer track, falling back to direct streaming', err);
        const audio = audioRef.current;
        if (!audio) return;
        audio.src = streamUrl(currentTrack.id);
        if (resumeSeconds != null) {
          const seekOnLoad = () => {
            audio.currentTime = resumeSeconds;
            audio.play().catch(() => {});
            audio.removeEventListener('loadedmetadata', seekOnLoad);
          };
          audio.addEventListener('loadedmetadata', seekOnLoad);
          clearResumeSeconds();
        } else {
          audio.play().catch(() => {});
        }
      })
      .finally(() => setIsBuffering(false));

    return () => controller.abort();
  }, [selectionSeq]);

  // Final safety net for a genuine component unmount (not just a track
  // change, which the effect above already cleans up after itself).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // Cross-device resume: checkpoint the position periodically while
  // playing, as a backstop for the case a `pause` event never fires at all
  // (crash, phone force-killed, battery dies) — see handlePause below for
  // the main save path.
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    const trackId = currentTrack.id;
    const interval = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;
      savePlaybackState(trackId, audio.currentTime).catch((err) => {
        console.error('Failed to save playback position', err);
      });
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isPlaying, currentTrack]);

  if (!currentTrack) {
    return null;
  }

  // Switches the <audio> element from the pre-buffered blob to live network
  // streaming, resuming at `resumeAt` — used both when the buffered cushion
  // naturally runs out (see handleTimeUpdate) and if the user manually
  // seeks past the buffered portion of a long track.
  const swapToLiveStream = (resumeAt: number) => {
    const audio = audioRef.current;
    if (!audio || handoffDoneRef.current) return;
    handoffDoneRef.current = true;
    const oldBlobUrl = blobUrlRef.current;
    blobUrlRef.current = null;
    audio.src = streamUrl(currentTrack.id);
    const onLoaded = () => {
      audio.currentTime = resumeAt;
      audio.play().catch(() => {});
      audio.removeEventListener('loadedmetadata', onLoaded);
      if (oldBlobUrl) URL.revokeObjectURL(oldBlobUrl);
    };
    audio.addEventListener('loadedmetadata', onLoaded);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  // Cross-device resume: the main save path (the periodic autosave above is
  // just a backstop). Deliberately skipped when the pause is really the
  // track ending — a `pause` event fires right before `ended`, but there's
  // nothing meaningful to resume once a track has actually finished (that
  // case clears the saved position entirely instead — see handleEnded).
  const handlePause = () => {
    setIsPlaying(false);
    const audio = audioRef.current;
    if (!audio) return;
    const nearEnd = audio.duration > 0 && audio.duration - audio.currentTime < 1;
    if (nearEnd) return;
    savePlaybackState(currentTrack.id, audio.currentTime).catch((err) => {
      console.error('Failed to save playback position', err);
    });
  };

  const handleEnded = () => {
    clearPlaybackState().catch((err) => {
      console.error('Failed to clear playback position', err);
    });
    next();
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    setCurrentTime(audio.currentTime);

    if (isPartialRef.current && !handoffDoneRef.current && audio.currentTime >= bufferedSecondsRef.current - HANDOFF_LEAD_SECONDS) {
      swapToLiveStream(audio.currentTime);
    }
  };

  // Safety net for bufferTrack's byte-to-seconds estimate coming in short —
  // if playback genuinely runs out of buffered data before our predicted
  // cutoff, the <audio> element stalls waiting for more (which will never
  // arrive, since it's a static blob); hand off immediately rather than
  // leaving playback stuck. `waiting`/`stalled` can also fire for brief,
  // benign reasons unrelated to running out of data (seen firing seconds
  // into fresh blob playback in testing), so only trust it as "ran out of
  // buffered data" once we're already near the expected cutoff — well
  // outside that window, the proactive check in handleTimeUpdate is what's
  // supposed to catch it, so ignore the event instead of reacting to noise.
  const handleStalled = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    const nearExpectedCutoff = audio.currentTime >= bufferedSecondsRef.current - 20;
    if (isPartialRef.current && !handoffDoneRef.current && nearExpectedCutoff) {
      swapToLiveStream(audio.currentTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const value = Number(e.target.value);

    // Seeking past what's actually been buffered (only possible for a long
    // track's partial buffer) needs the live-stream handoff immediately,
    // rather than trying to seek within data that was never downloaded.
    if (isPartialRef.current && !handoffDoneRef.current && value > bufferedSecondsRef.current - HANDOFF_LEAD_SECONDS) {
      swapToLiveStream(value);
    } else {
      audio.currentTime = value;
    }
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
          onEnded={handleEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={handlePause}
          onTimeUpdate={handleTimeUpdate}
          onStalled={handleStalled}
          onWaiting={handleStalled}
        />
        <div className="now-playing-main">
          <div className="now-playing-identity">
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
              <div className="now-playing-artist">
                {currentTrack.artist ?? 'Unknown'}
                {isBuffering ? ' · Buffering…' : ''}
              </div>
            </div>
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
          isBuffering={isBuffering}
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
