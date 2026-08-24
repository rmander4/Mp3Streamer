import { useEffect, useState } from 'react';

const FULLSCREEN_SUPPORTED = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;

// Browser-level fullscreen (Fullscreen API) — not to be confused with the
// "Now Playing Screen" (FullScreenPlayer.tsx), a same-named-but-unrelated
// app concept. Pulled out of SettingsPanel into its own small icon button,
// styled after YouTube's expand/collapse control, so it's a single click
// from wherever the ⋮ settings trigger already is instead of two levels
// deep in a menu.
export function FullscreenToggle() {
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);

  useEffect(() => {
    if (!FULLSCREEN_SUPPORTED) return;
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  if (!FULLSCREEN_SUPPORTED) return null;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  return (
    <button
      className="fullscreen-toggle"
      onClick={toggleFullscreen}
      aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
      title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
    >
      {isFullscreen ? (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
        </svg>
      )}
    </button>
  );
}
