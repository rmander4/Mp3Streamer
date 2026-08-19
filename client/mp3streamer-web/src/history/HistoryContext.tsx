import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getHistoryEnabled, setHistoryEnabled as apiSetHistoryEnabled } from '../api/client';

interface HistoryContextValue {
  // null = not loaded from the server yet.
  historyEnabled: boolean | null;
  setHistoryEnabled: (enabled: boolean) => void;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

// The server is the single source of truth (recording happens server-side
// regardless of which device is playing), so this is fetched once here and
// shared — both Sidebar (to show/hide the History nav item) and every
// SettingsPanel instance (the Mini Player's and the Now Playing Screen's)
// need the same value in sync, not independent copies.
export function HistoryProvider({ children }: { children: ReactNode }) {
  const [historyEnabled, setHistoryEnabledState] = useState<boolean | null>(null);

  useEffect(() => {
    getHistoryEnabled()
      .then(setHistoryEnabledState)
      .catch((err) => console.error('Failed to load history setting', err));
  }, []);

  const setHistoryEnabled = useCallback((enabled: boolean) => {
    setHistoryEnabledState(enabled); // optimistic
    apiSetHistoryEnabled(enabled).catch((err) => {
      console.error('Failed to save history setting', err);
      setHistoryEnabledState(!enabled); // revert on failure
    });
  }, []);

  return <HistoryContext.Provider value={{ historyEnabled, setHistoryEnabled }}>{children}</HistoryContext.Provider>;
}

export function useHistorySetting(): HistoryContextValue {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error('useHistorySetting must be used within a HistoryProvider');
  return ctx;
}
