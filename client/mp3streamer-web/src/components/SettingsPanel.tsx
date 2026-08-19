import { useEffect, useState } from 'react';
import { useTheme, type Theme } from '../theme/ThemeContext';
import { useHistorySetting } from '../history/HistoryContext';
import { getRemoveMissingTracks, setRemoveMissingTracks } from '../api/client';

const FULLSCREEN_SUPPORTED = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;

const THEME_OPTIONS: { key: Theme; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'System' },
];

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { theme, setTheme } = useTheme();
  const { historyEnabled, setHistoryEnabled } = useHistorySetting();
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  // Nothing else needs this value reactively (unlike historyEnabled, which
  // gates the sidebar's History nav item across two SettingsPanel render
  // sites), so a local fetch here is enough — no shared context needed.
  const [removeMissing, setRemoveMissingState] = useState<boolean | null>(null);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    getRemoveMissingTracks()
      .then(setRemoveMissingState)
      .catch((err) => console.error('Failed to load remove-missing-tracks setting', err));
  }, []);

  const handleRemoveMissingToggle = (enabled: boolean) => {
    setRemoveMissingState(enabled); // optimistic
    setRemoveMissingTracks(enabled).catch((err) => {
      console.error('Failed to save remove-missing-tracks setting', err);
      setRemoveMissingState(!enabled); // revert on failure
    });
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-label">Theme</div>
          <div className="settings-options">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                className={theme === opt.key ? 'settings-option active' : 'settings-option'}
                onClick={() => setTheme(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Track History</div>
          <div className="settings-options">
            <button
              className={historyEnabled === true ? 'settings-option active' : 'settings-option'}
              onClick={() => setHistoryEnabled(true)}
              disabled={historyEnabled === null}
            >
              On
            </button>
            <button
              className={historyEnabled === false ? 'settings-option active' : 'settings-option'}
              onClick={() => setHistoryEnabled(false)}
              disabled={historyEnabled === null}
            >
              Off
            </button>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Remove Tracks That Do Not Exist</div>
          <div className="settings-options">
            <button
              className={removeMissing === true ? 'settings-option active' : 'settings-option'}
              onClick={() => handleRemoveMissingToggle(true)}
              disabled={removeMissing === null}
            >
              On
            </button>
            <button
              className={removeMissing === false ? 'settings-option active' : 'settings-option'}
              onClick={() => handleRemoveMissingToggle(false)}
              disabled={removeMissing === null}
            >
              Off
            </button>
          </div>
        </div>

        {FULLSCREEN_SUPPORTED ? (
          <div className="settings-section">
            <div className="settings-label">Display</div>
            <button className="settings-option" onClick={toggleFullscreen}>
              {isFullscreen ? 'Exit full screen' : 'Enter full screen'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
