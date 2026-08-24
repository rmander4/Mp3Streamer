import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AlbumArt, Facet } from '../api/types';
import { artworkUrl } from '../api/client';

interface FacetListProps {
  facets: Facet[];
  onSelect: (name: string) => void;
  onSelectAlbum?: (album: string) => void;
}

interface AlbumArtStackProps {
  albumArt: AlbumArt[];
  onSelectAlbum: (album: string) => void;
}

// Beyond this many albums, a static row gets too wide to be useful — switch
// to an auto-scrolling marquee instead of just truncating the rest away.
const MARQUEE_THRESHOLD = 10;

// Seconds of scroll time per thumbnail (one-way) — each art is a clickable
// link to its album, so this stays slow enough to actually click one rather
// than chasing a moving target (hovering pauses it too, but this sets the
// baseline pace before that kicks in).
const MARQUEE_SECONDS_PER_ITEM = 1.4;

// Must match the corresponding CSS (.album-art-stack-item, gap, and
// .album-art-marquee's width) — used to compute how far the track needs to
// travel to reveal its last thumbnail, since the bounce animation's end
// point depends on how many albums this particular artist has.
// .album-art-stack-item's rendered box is 22px content + its own 1px
// top/bottom *and* left/right border (no box-sizing: border-box), so the
// true per-item footprint is 24px, not 22 — using 22 here undercounts the
// track's real width and makes the bounce stop short of the actual last
// thumbnail.
const THUMB_SIZE = 24;
const THUMB_GAP = 3;
const MARQUEE_WINDOW_WIDTH = 130;

// How long the track sits still at each end before reversing.
const MARQUEE_HOLD_MS = 2000;

function AlbumArtStack({ albumArt, onSelectAlbum }: AlbumArtStackProps) {
  const [failed, setFailed] = useState<Set<number>>(new Set());

  if (albumArt.length === 0) return null;

  // Each thumbnail navigates to its own album — stopPropagation keeps that
  // from also triggering the parent row's artist-select handler.
  const handleSelect = (e: React.SyntheticEvent, album: string) => {
    e.stopPropagation();
    onSelectAlbum(album);
  };

  const handleKeyDown = (e: React.KeyboardEvent, album: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    handleSelect(e, album);
  };

  const renderThumb = ({ trackId, album }: AlbumArt, key: string | number) => (
    <AlbumArtThumb
      key={key}
      trackId={trackId}
      album={album}
      failed={failed.has(trackId)}
      onImgError={() => setFailed((prev) => new Set(prev).add(trackId))}
      onSelect={(e) => handleSelect(e, album)}
      onKeyDown={(e) => handleKeyDown(e, album)}
    />
  );

  if (albumArt.length > MARQUEE_THRESHOLD) {
    return (
      <MarqueeStack albumArt={albumArt} renderThumb={renderThumb} />
    );
  }

  return <div className="album-art-stack">{albumArt.map((a) => renderThumb(a, a.trackId))}</div>;
}

interface AlbumArtThumbProps {
  trackId: number;
  album: string;
  failed: boolean;
  onImgError: () => void;
  onSelect: (e: React.SyntheticEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

// A single thumbnail plus its hover tooltip. The tooltip is portaled to
// document.body (position: fixed, coordinates computed from the
// thumbnail's own getBoundingClientRect on hover/focus) rather than a
// plain absolutely-positioned child — a plain child gets clipped by
// whichever ancestor happens to have overflow/clip-path set (the marquee's
// own clipping window, or .main-content's scroll container), and there's
// no CSS-only way for a descendant to opt out of an ancestor's clip.
function AlbumArtThumb({ trackId, album, failed, onImgError, onSelect, onKeyDown }: AlbumArtThumbProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ bottom: number; right: number } | null>(null);

  const showTooltip = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPos({
      bottom: window.innerHeight - rect.top + 8,
      right: window.innerWidth - rect.right,
    });
  };
  const hideTooltip = () => setTooltipPos(null);

  return (
    <span
      ref={wrapRef}
      className="album-art-item-wrap"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {failed ? (
        <span className="album-art-stack-item album-art-stack-fallback">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3v10.55a4 4 0 1 0 2 3.45V7h4V3h-6z" />
          </svg>
        </span>
      ) : (
        <img className="album-art-stack-item" src={artworkUrl(trackId)} alt={album} onError={onImgError} />
      )}
      {/* A custom tooltip, not the native `title` attribute — the
          browser's own tooltip renders slightly below-right of the
          cursor, right where the cursor itself covers it. This one is
          anchored above-left of the thumbnail instead. */}
      {tooltipPos
        ? createPortal(
            <span className="album-art-tooltip" style={{ bottom: tooltipPos.bottom, right: tooltipPos.right }}>
              {album}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

interface MarqueeStackProps {
  albumArt: AlbumArt[];
  renderThumb: (art: AlbumArt, key: string | number) => React.ReactElement;
}

// Scrolls left until the last thumbnail is in view, holds, reverses back to
// the start, holds, and repeats — a bounce, not a seamless one-way loop, so
// there's only ever one copy of the list (no duplicated content needed to
// hide a wrap point).
//
// The hold at each end means the four keyframe offsets (start-hold-ends,
// travel-ends, end-hold-ends, back-at-start) depend on this artist's own
// album count — plain CSS @keyframes can't express a per-instance offset
// split like that (only the *values* inside keyframes can vary via custom
// properties, not the percentage stops themselves), so this drives the
// animation directly via the Web Animations API instead.
function MarqueeStack({ albumArt, renderThumb }: MarqueeStackProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const trackWidth = albumArt.length * THUMB_SIZE + (albumArt.length - 1) * THUMB_GAP;
    const distance = Math.max(0, trackWidth - MARQUEE_WINDOW_WIDTH);
    if (distance === 0) return;

    const travelMs = albumArt.length * MARQUEE_SECONDS_PER_ITEM * 1000;
    const totalMs = travelMs * 2 + MARQUEE_HOLD_MS * 2;

    const animation = el.animate(
      [
        { transform: 'translateX(0px)', offset: 0 },
        { transform: 'translateX(0px)', offset: MARQUEE_HOLD_MS / totalMs },
        { transform: `translateX(-${distance}px)`, offset: (MARQUEE_HOLD_MS + travelMs) / totalMs },
        { transform: `translateX(-${distance}px)`, offset: (2 * MARQUEE_HOLD_MS + travelMs) / totalMs },
        { transform: 'translateX(0px)', offset: 1 },
      ],
      { duration: totalMs, iterations: Infinity, easing: 'linear' },
    );
    animationRef.current = animation;
    return () => animation.cancel();
  }, [albumArt]);

  return (
    <div
      className="album-art-marquee"
      onMouseEnter={() => animationRef.current?.pause()}
      onMouseLeave={() => animationRef.current?.play()}
    >
      <div ref={trackRef} className="album-art-marquee-track">
        {albumArt.map((a) => renderThumb(a, a.trackId))}
      </div>
    </div>
  );
}

export function FacetList({ facets, onSelect, onSelectAlbum }: FacetListProps) {
  if (facets.length === 0) {
    return <p className="empty-state">Nothing found.</p>;
  }

  return (
    <ul className="facet-list">
      {facets.map((f) => (
        <li key={f.name}>
          <button className="facet-item" onClick={() => onSelect(f.name)}>
            <span>{f.name}</span>
            {f.albumArt && onSelectAlbum ? (
              <AlbumArtStack albumArt={f.albumArt} onSelectAlbum={onSelectAlbum} />
            ) : null}
            <span className="facet-count">{f.trackCount}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
