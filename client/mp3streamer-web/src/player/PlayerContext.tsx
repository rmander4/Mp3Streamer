import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Track } from '../api/types';

interface PlayerState {
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  // Bumped on every explicit "play this track" action (playQueue, next,
  // previous) — including re-selecting the track that's already playing.
  // NowPlayingBar's buffering/history-recording effect keys off this
  // instead of currentTrack.id, because id alone doesn't change when you
  // click the same track again, which otherwise silently no-ops a
  // re-selection (found via a real bug report: repeatedly clicking the
  // same track from History wasn't adding new history entries).
  selectionSeq: number;
}

interface PlayerContextValue extends PlayerState {
  currentTrack: Track | null;
  playQueue: (tracks: Track[], startIndex: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTrackRating: (rating: number) => void;
  setCurrentTrackFields: (updates: Partial<Track>) => void;
  next: () => void;
  previous: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlayerState>({ queue: [], currentIndex: -1, isPlaying: false, selectionSeq: 0 });

  const playQueue = useCallback((tracks: Track[], startIndex: number) => {
    setState((s) => ({ queue: tracks, currentIndex: startIndex, isPlaying: true, selectionSeq: s.selectionSeq + 1 }));
  }, []);

  const setIsPlaying = useCallback((playing: boolean) => {
    setState((s) => ({ ...s, isPlaying: playing }));
  }, []);

  const setCurrentTrackRating = useCallback((rating: number) => {
    setState((s) => {
      if (s.currentIndex < 0) return s;
      const queue = [...s.queue];
      queue[s.currentIndex] = { ...queue[s.currentIndex], rating };
      return { ...s, queue };
    });
  }, []);

  // General-purpose version of setCurrentTrackRating, for updating other
  // fields (e.g. after an ID3 tag edit) so the Mini Player / Now Playing
  // Screen reflect the change immediately if the edited track is playing.
  const setCurrentTrackFields = useCallback((updates: Partial<Track>) => {
    setState((s) => {
      if (s.currentIndex < 0) return s;
      const queue = [...s.queue];
      queue[s.currentIndex] = { ...queue[s.currentIndex], ...updates };
      return { ...s, queue };
    });
  }, []);

  const next = useCallback(() => {
    setState((s) => {
      if (s.currentIndex + 1 >= s.queue.length) return { ...s, isPlaying: false };
      return { ...s, currentIndex: s.currentIndex + 1, isPlaying: true, selectionSeq: s.selectionSeq + 1 };
    });
  }, []);

  const previous = useCallback(() => {
    setState((s) => {
      if (s.currentIndex <= 0) return s;
      return { ...s, currentIndex: s.currentIndex - 1, isPlaying: true, selectionSeq: s.selectionSeq + 1 };
    });
  }, []);

  const currentTrack = state.currentIndex >= 0 ? state.queue[state.currentIndex] ?? null : null;

  const value = useMemo<PlayerContextValue>(
    () => ({
      ...state,
      currentTrack,
      playQueue,
      setIsPlaying,
      setCurrentTrackRating,
      setCurrentTrackFields,
      next,
      previous,
    }),
    [state, currentTrack, playQueue, setIsPlaying, setCurrentTrackRating, setCurrentTrackFields, next, previous],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider');
  return ctx;
}
