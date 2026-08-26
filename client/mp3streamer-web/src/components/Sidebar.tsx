import { useState } from 'react';
import { SettingsPanel } from './SettingsPanel';
import { FullscreenToggle } from './FullscreenToggle';
import { useHistorySetting } from '../history/HistoryContext';

export type ViewKey = 'all' | 'albumArtists' | 'artists' | 'albums' | 'genres' | 'playlists' | 'history';

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'all', label: 'All Tracks' },
  { key: 'albumArtists', label: 'Album Artist' },
  { key: 'artists', label: 'Artists' },
  { key: 'albums', label: 'Albums' },
  { key: 'genres', label: 'Genres' },
  { key: 'playlists', label: 'Playlists' },
  { key: 'history', label: 'History' },
];

interface SidebarProps {
  active: ViewKey;
  onSelect: (view: ViewKey) => void;
}

export function Sidebar({ active, onSelect }: SidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { historyEnabled } = useHistorySetting();
  // Hide History until we've actually confirmed it's on — avoids the item
  // briefly appearing then disappearing on load if it turns out disabled.
  const visibleViews = VIEWS.filter((v) => v.key !== 'history' || historyEnabled === true);

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">MP3 Streamer</h1>
        <div className="sidebar-header-actions">
          <FullscreenToggle />
          <button className="settings-trigger" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            ⋮
          </button>
        </div>
      </div>
      <ul>
        {visibleViews.map((v) => (
          <li key={v.key}>
            <button
              className={v.key === active ? 'nav-item active' : 'nav-item'}
              onClick={() => onSelect(v.key)}
            >
              {v.label}
            </button>
          </li>
        ))}
      </ul>
      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
    </nav>
  );
}
