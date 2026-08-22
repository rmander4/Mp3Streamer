import { useEffect, useState } from 'react';
import { useTheme, type Theme } from '../theme/ThemeContext';
import { useHistorySetting } from '../history/HistoryContext';
import { getRemoveMissingTracks, importItunesXml, scanLibrary, setRemoveMissingTracks } from '../api/client';

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
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [itunesFile, setItunesFile] = useState<File | null>(null);
  const [importingItunes, setImportingItunes] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

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

  const handleRefreshLibrary = async () => {
    setScanning(true);
    setScanError(null);
    try {
      await scanLibrary();
      // Simplest way to guarantee whatever view is currently open reflects
      // the fresh scan, without plumbing a refetch callback through every
      // view that renders a track list.
      window.location.reload();
    } catch {
      setScanError('Failed to refresh library — please try again.');
      setScanning(false);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const handleImportItunes = async () => {
    if (!itunesFile) return;
    console.info('[Mp3Streamer] Starting iTunes XML import', {
      fileName: itunesFile.name,
      sizeBytes: itunesFile.size,
    });
    setImportingItunes(true);
    setImportMessage(null);
    try {
      let lastProgressLogAt = 0;
      const result = await importItunesXml(itunesFile, (loadedBytes, totalBytes) => {
        const now = Date.now();
        if (now - lastProgressLogAt < 30_000 && loadedBytes < totalBytes) return;
        lastProgressLogAt = now;
        const percent = ((loadedBytes / totalBytes) * 100).toFixed(1);
        console.info('[Mp3Streamer] iTunes XML upload progress', {
          percent: `${percent}%`,
          loadedBytes,
          totalBytes,
        });
        if (loadedBytes === totalBytes) {
          console.info('[Mp3Streamer] iTunes XML upload complete; waiting for server import');
        }
      });
      console.info('[Mp3Streamer] iTunes XML import completed', result);
      setImportMessage(`Imported ${result.imported.toLocaleString()} tracks.`);
      console.info('[Mp3Streamer] Reloading the page to display imported tracks');
      window.location.reload();
    } catch (error) {
      console.error('[Mp3Streamer] iTunes XML import failed', error);
      setImportMessage('Failed to import iTunes XML.');
      setImportingItunes(false);
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

        <div className="settings-section settings-library">
          <div className="settings-label">Library</div>
          <button className="settings-option" onClick={handleRefreshLibrary} disabled={scanning}>
            {scanning ? 'Refreshing…' : 'Refresh Library'}
          </button>
          {scanError ? <p className="tags-error">{scanError}</p> : null}
          <div className="settings-label">iTunes Library XML</div>
          <input
            type="file"
            accept=".xml,application/xml,text/xml"
            onChange={(event) => {
              const selectedFile = event.target.files?.[0] ?? null;
              setItunesFile(selectedFile);
              if (selectedFile) {
                console.info('[Mp3Streamer] iTunes XML file selected', {
                  fileName: selectedFile.name,
                  sizeBytes: selectedFile.size,
                });
              }
            }}
            disabled={importingItunes}
          />
          <button className="settings-option" onClick={handleImportItunes} disabled={!itunesFile || importingItunes}>
            {importingItunes ? 'Importing…' : 'Import iTunes Library.xml'}
          </button>
          {importMessage ? <p className="tags-error">{importMessage}</p> : null}
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
