import { useEffect, useRef, useState } from 'react';
import { usePlayer } from './PlayerContext';
import { artworkUrl, clearPlaybackState, recordPlay, savePlaybackState, setTrackRating, streamUrl } from '../api/client';
import { formatDuration } from '../utils/format';
import { FullScreenPlayer } from './FullScreenPlayer';
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon } from './icons';
import { bufferTrack } from './bufferTrack';

// A touch device (any orientation/width) or a narrow desktop window counts as "mobile" here.
const MOBILE_QUERY = '(pointer: coarse), (max-width: 700px)';

// How close to the end of the pre-buffered portion (in seconds) the actual
// audible handoff to live network streaming happens, for tracks longer than
// the buffer cap.
const HANDOFF_LEAD_SECONDS = 5;

// How much earlier than that to silently start warming up the live stream
// in the background (see startPreload) — needs a real head start before
// HANDOFF_LEAD_SECONDS so the shadow deck has time to load, seek, and settle
// into sync before it's ever actually heard.
const PRELOAD_LEAD_SECONDS = 20;

// How often to re-check the shadow deck's position against the audible
// deck's during that silent overlap window, snapping it back in sync if it
// drifts — cheap to do since the shadow deck is muted the whole time.
const SYNC_CHECK_INTERVAL_MS = 500;
const SYNC_DRIFT_THRESHOLD_SECONDS = 0.2;

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
  // Two <audio> elements, not one — a live "listen to this" deck and a
  // hidden "shadow" deck used only to silently pre-warm the live network
  // stream ahead of the actual handoff point (see startPreload/
  // performHandoff below). Which one is currently audible flips at
  // handoff; audioIsPrimaryRef tracks that, and getActiveAudio/
  // getShadowAudio read through it rather than any code touching
  // primaryRef/secondaryRef directly.
  const primaryRef = useRef<HTMLAudioElement>(null);
  const secondaryRef = useRef<HTMLAudioElement>(null);
  const audioIsPrimaryRef = useRef(true);
  const getActiveAudio = () => (audioIsPrimaryRef.current ? primaryRef.current : secondaryRef.current);
  const getShadowAudio = () => (audioIsPrimaryRef.current ? secondaryRef.current : primaryRef.current);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = Number.parseFloat(localStorage.getItem('mp3streamer.volume') ?? '');
    return Number.isFinite(saved) ? Math.min(Math.max(saved, 0), 1) : 1;
  });
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);

  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isPartialRef = useRef(false);
  const bufferedSecondsRef = useRef(0);
  const preloadStartedRef = useRef(false);
  const handoffDoneRef = useRef(false);
  const syncIntervalIdRef = useRef<number | null>(null);

  const clearSyncInterval = () => {
    if (syncIntervalIdRef.current != null) {
      window.clearInterval(syncIntervalIdRef.current);
      syncIntervalIdRef.current = null;
    }
  };

  // Pausing/resuming needs to apply to both decks while the shadow one is
  // mid-preload (silently playing in parallel) — otherwise a user pause
  // during that window would only stop the audible deck, leaving the
  // shadow deck running unmuted-audio-free but still consuming bandwidth,
  // and a later handoff would resume playback the user had actually paused.
  const pauseBothDecks = () => {
    getActiveAudio()?.pause();
    const shadow = getShadowAudio();
    if (shadow && shadow.src) shadow.pause();
  };
  const playBothDecks = () => {
    getActiveAudio()?.play().catch(() => {});
    const shadow = getShadowAudio();
    if (shadow && shadow.src) shadow.play().catch(() => {});
  };

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
    const active = getActiveAudio();
    if (active) active.volume = volume;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  useEffect(() => {
    setCurrentTime(0);
    isPartialRef.current = false;
    bufferedSecondsRef.current = 0;
    preloadStartedRef.current = false;
    handoffDoneRef.current = false;
    audioIsPrimaryRef.current = true;
    clearSyncInterval();

    // A shadow deck left over from the previous track's handoff (or an
    // in-flight preload that never got used) shouldn't carry into this
    // one — always start a fresh track on the primary deck with the
    // secondary blank. Primary itself also needs unmuting here: if the
    // *previous* track ended up handed off to the secondary deck, primary
    // is the one left muted from that handoff, and these two DOM elements
    // are reused across tracks (only src/etc. change) — without this, a
    // new track loaded onto a still-muted primary would silently play
    // with no audio at all (confirmed via reproduction: skipped to a new
    // track right after a handoff, primary came back muted: true).
    const primary = primaryRef.current;
    if (primary) primary.muted = false;
    const secondary = secondaryRef.current;
    if (secondary) {
      secondary.pause();
      secondary.removeAttribute('src');
      secondary.load();
      secondary.muted = true;
    }

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
        const audio = primaryRef.current;
        if (!audio) return;
        audio.volume = volume;
        audio.src = blobUrl;

        // Resuming from the cross-device "Continue playing?" prompt — seek
        // to the saved position instead of starting from 0. Past what's
        // actually buffered needs the same live-stream handoff a manual
        // seek there would trigger (see performHandoff/handleSeek below).
        // No shadow deck to hand off to yet this early, so this always
        // takes the cold-swap path inside performHandoff.
        if (resumeSeconds != null) {
          if (isPartial && resumeSeconds > bufferedSeconds - HANDOFF_LEAD_SECONDS) {
            performHandoff(resumeSeconds);
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
        const audio = primaryRef.current;
        if (!audio) return;
        audio.volume = volume;
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
      clearSyncInterval();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-device resume: checkpoint the position periodically while
  // playing, as a backstop for the case a `pause` event never fires at all
  // (crash, phone force-killed, battery dies) — see handlePause below for
  // the main save path.
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    const trackId = currentTrack.id;
    const interval = window.setInterval(() => {
      const audio = getActiveAudio();
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

  // Silently starts warming up the shadow deck with the live stream, well
  // ahead of the actual handoff — loads it, seeks it to match the audible
  // deck's current position, and starts it muted so it plays forward in
  // parallel. performHandoff (below) can then just swap which deck is
  // audible instead of doing a cold src-swap-and-seek in the moment, which
  // is what made the transition audible in the first place (a real network
  // round-trip with nothing playing, landing on an estimated — not exact —
  // seek position for a VBR file).
  const startPreload = () => {
    if (preloadStartedRef.current || handoffDoneRef.current) return;
    const shadow = getShadowAudio();
    const active = getActiveAudio();
    if (!shadow || !active) return;
    preloadStartedRef.current = true;

    shadow.muted = true;
    shadow.volume = 0;
    shadow.src = streamUrl(currentTrack.id);
    const onLoaded = () => {
      shadow.currentTime = active.currentTime;
      shadow.play().catch(() => {});
      shadow.removeEventListener('loadedmetadata', onLoaded);

      clearSyncInterval();
      syncIntervalIdRef.current = window.setInterval(() => {
        if (handoffDoneRef.current) {
          clearSyncInterval();
          return;
        }
        const a = getActiveAudio();
        if (!a) return;
        if (Math.abs(shadow.currentTime - a.currentTime) > SYNC_DRIFT_THRESHOLD_SECONDS) {
          shadow.currentTime = a.currentTime;
        }
      }, SYNC_CHECK_INTERVAL_MS);
    };
    shadow.addEventListener('loadedmetadata', onLoaded);
  };

  // The actual handoff. If the shadow deck has been silently running in
  // parallel long enough to be ready (the common case — see startPreload),
  // this is just an instant mute swap: no network wait, no fresh seek, so
  // nothing for the ear to catch. Falls back to the old cold src-swap path
  // (audible, but functional) if the shadow deck never got the chance to
  // warm up in time — e.g. handoff triggered unusually early (a manual seek
  // past the buffered portion) or a slow connection.
  const performHandoff = (resumeAt: number) => {
    if (handoffDoneRef.current) return;
    const shadow = getShadowAudio();
    const active = getActiveAudio();
    if (!shadow || !active) return;

    handoffDoneRef.current = true;
    clearSyncInterval();

    if (shadow.src && shadow.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !shadow.paused) {
      shadow.muted = false;
      shadow.volume = volume;
      active.pause();
      active.muted = true;
      // Fully retire the old deck, not just pause it — revoking its blob
      // URL invalidates the underlying data but leaves the <audio>'s own
      // src *attribute* as a non-empty string, which would otherwise make
      // playBothDecks/pauseBothDecks's "is the shadow mid-preload?" check
      // (shadow.src truthy) mistake this retired deck for one, and
      // incorrectly resume it on the next play (confirmed via
      // reproduction: both decks audibly playing at once after a
      // pause/resume following a completed handoff).
      active.removeAttribute('src');
      active.load();
      audioIsPrimaryRef.current = !audioIsPrimaryRef.current;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      return;
    }

    // The shadow deck not being ready doesn't mean it's blank — it can be
    // mid-preload (started via handleTimeUpdate's proactive check) when a
    // *different* trigger (handleEnded/handleStalled reacting to the blob
    // genuinely running out early) fires this cold path first. Stop it
    // rather than leaving an orphaned network stream running in the
    // background indefinitely, unmuted-never, until the next track change.
    if (shadow.src) {
      shadow.pause();
      shadow.removeAttribute('src');
      shadow.load();
    }

    const oldBlobUrl = blobUrlRef.current;
    blobUrlRef.current = null;
    active.src = streamUrl(currentTrack.id);
    const onLoaded = () => {
      active.currentTime = resumeAt;
      active.play().catch(() => {});
      active.removeEventListener('loadedmetadata', onLoaded);
      if (oldBlobUrl) URL.revokeObjectURL(oldBlobUrl);
    };
    active.addEventListener('loadedmetadata', onLoaded);
  };

  const togglePlayback = () => {
    const audio = getActiveAudio();
    if (!audio) return;
    if (audio.paused) {
      playBothDecks();
    } else {
      pauseBothDecks();
    }
  };

  // Cross-device resume: the main save path (the periodic autosave above is
  // just a backstop). Deliberately skipped when the pause is really the
  // track ending — a `pause` event fires right before `ended`, but there's
  // nothing meaningful to resume once a track has actually finished (that
  // case clears the saved position entirely instead — see handleEnded).
  const handlePause = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    if (e.currentTarget !== getActiveAudio()) return;
    setIsPlaying(false);
    const audio = e.currentTarget;
    const nearEnd = audio.duration > 0 && audio.duration - audio.currentTime < 1;
    if (nearEnd) return;
    savePlaybackState(currentTrack.id, audio.currentTime).catch((err) => {
      console.error('Failed to save playback position', err);
    });
  };

  // A truncated blob can genuinely run out of decodable audio a bit before
  // bufferTrack's byte-to-seconds estimate predicted — VBR bitrate dipping
  // below the track's average anywhere before the estimated cutoff means
  // the actual audio in those bytes falls short of BUFFER_CAP_SECONDS. The
  // <audio> element can't tell that apart from a real end of playback (it's
  // a complete, static Blob as far as it knows) and fires a normal `ended`
  // either way. handleTimeUpdate/handleStalled are meant to catch this
  // proactively, but neither is guaranteed to — confirmed via reproduction
  // (a real `ended` firing on a 16-minute track at 1:40 in, which advanced
  // straight to the next track with nothing in between). This is the
  // actual safety net: still on the partial blob, short of the track's
  // real (ID3-tag) duration by more than a couple seconds means the audio
  // element ran out of buffered data early, not that the track finished —
  // hand off to live streaming and keep playing instead of skipping ahead.
  const handleEnded = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    if (e.currentTarget !== getActiveAudio()) return;
    const audio = e.currentTarget;
    if (isPartialRef.current && !handoffDoneRef.current && currentTrack.durationSeconds - audio.currentTime > 2) {
      performHandoff(audio.currentTime);
      return;
    }
    clearPlaybackState().catch((err) => {
      console.error('Failed to clear playback position', err);
    });
    next();
  };

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    if (e.currentTarget !== getActiveAudio()) return;
    const audio = e.currentTarget;
    setCurrentTime(audio.currentTime);

    if (isPartialRef.current && !preloadStartedRef.current && audio.currentTime >= bufferedSecondsRef.current - PRELOAD_LEAD_SECONDS) {
      startPreload();
    }
    if (isPartialRef.current && !handoffDoneRef.current && audio.currentTime >= bufferedSecondsRef.current - HANDOFF_LEAD_SECONDS) {
      performHandoff(audio.currentTime);
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
    if (e.currentTarget !== getActiveAudio()) return;
    const audio = e.currentTarget;
    const nearExpectedCutoff = audio.currentTime >= bufferedSecondsRef.current - 20;
    if (isPartialRef.current && !handoffDoneRef.current && nearExpectedCutoff) {
      performHandoff(audio.currentTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = getActiveAudio();
    if (!audio) return;
    const value = Number(e.target.value);

    // Seeking past what's actually been buffered (only possible for a long
    // track's partial buffer) needs the live-stream handoff immediately,
    // rather than trying to seek within data that was never downloaded —
    // the shadow deck won't be synced to an arbitrary jump like this, so
    // performHandoff will fall back to its cold-swap path here, same as
    // before this rework.
    if (isPartialRef.current && !handoffDoneRef.current && value > bufferedSecondsRef.current - HANDOFF_LEAD_SECONDS) {
      performHandoff(value);
    } else {
      audio.currentTime = value;
    }
    setCurrentTime(value);
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setVolume(value);
    const audio = getActiveAudio();
    if (audio) audio.volume = value;
    localStorage.setItem('mp3streamer.volume', String(value));
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
        {/* Two elements, not one — see primaryRef/secondaryRef above. Both
            get the same handlers; each handler checks e.currentTarget
            against getActiveAudio() to ignore events from whichever one is
            currently just the silent shadow deck. */}
        <audio
          ref={primaryRef}
          onEnded={handleEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={handlePause}
          onTimeUpdate={handleTimeUpdate}
          onStalled={handleStalled}
          onWaiting={handleStalled}
        />
        <audio
          ref={secondaryRef}
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
        <div className="player-volume" onClick={(e) => e.stopPropagation()}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={handleVolume}
            aria-label="Volume"
          />
        </div>
      </div>

      {isFullScreen ? (
        <FullScreenPlayer
          track={currentTrack}
          isPlaying={isPlaying}
          isBuffering={isBuffering}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          onSeek={handleSeek}
          onVolumeChange={handleVolume}
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
