import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Track } from '../api/types';

interface PlayerState {
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
}

interface PlayerContextValue extends PlayerState {
  currentTrack: Track | null;
  playQueue: (tracks: Track[], startIndex: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTrackRating: (rating: number) => void;
  next: () => void;
  previous: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlayerState>({ queue: [], currentIndex: -1, isPlaying: false });

  const playQueue = useCallback((tracks: Track[], startIndex: number) => {
    setState({ queue: tracks, currentIndex: startIndex, isPlaying: true });
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

  const next = useCallback(() => {
    setState((s) => {
      if (s.currentIndex + 1 >= s.queue.length) return { ...s, isPlaying: false };
      return { ...s, currentIndex: s.currentIndex + 1, isPlaying: true };
    });
  }, []);

  const previous = useCallback(() => {
    setState((s) => {
      if (s.currentIndex <= 0) return s;
      return { ...s, currentIndex: s.currentIndex - 1, isPlaying: true };
    });
  }, []);

  const currentTrack = state.currentIndex >= 0 ? state.queue[state.currentIndex] ?? null : null;

  const value = useMemo<PlayerContextValue>(
    () => ({ ...state, currentTrack, playQueue, setIsPlaying, setCurrentTrackRating, next, previous }),
    [state, currentTrack, playQueue, setIsPlaying, setCurrentTrackRating, next, previous],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within a PlayerProvider');
  return ctx;
}
