interface IconProps {
  size?: number;
}

// Plain geometric SVG icons, rendered with currentColor — deliberately not
// Unicode symbols (⏮ ⏸ ▶ ⏭). Some platforms render those as full-color
// emoji glyphs (fixed bitmaps immune to CSS `color`), which is exactly what
// caused the pause button to show up as a yellow emoji square on iOS.

export function PlayIcon({ size = 24 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <polygon points="8,5 19,12 8,19" />
    </svg>
  );
}

export function PauseIcon({ size = 24 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function PreviousIcon({ size = 24 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <rect x="5" y="5" width="2.5" height="14" rx="1" />
      <polygon points="19,5 19,19 8,12" />
    </svg>
  );
}

export function NextIcon({ size = 24 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
      <polygon points="5,5 5,19 16,12" />
      <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
    </svg>
  );
}
