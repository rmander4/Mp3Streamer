import { useEffect, useState } from 'react';
import { useTheme, type Theme } from '../theme/ThemeContext';

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
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

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
