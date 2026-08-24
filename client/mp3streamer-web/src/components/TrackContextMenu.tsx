import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
}

interface TrackContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_MARGIN = 8;

export function TrackContextMenu({ x, y, items, onClose }: TrackContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Any click/right-click elsewhere, or Escape, dismisses the menu —
    // matches standard OS/browser context menu behavior.
    const handleDismiss = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('click', handleDismiss);
    document.addEventListener('contextmenu', handleDismiss);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleDismiss);
      document.removeEventListener('contextmenu', handleDismiss);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Clamp so the menu never renders partly off-screen for a right-click
  // near the window's right/bottom edge.
  const menuWidth = menuRef.current?.offsetWidth ?? 180;
  const menuHeight = menuRef.current?.offsetHeight ?? (items.length + 1) * 36;
  const left = Math.min(x, window.innerWidth - menuWidth - MENU_MARGIN);
  const top = Math.min(y, window.innerHeight - menuHeight - MENU_MARGIN);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className="context-menu-item"
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
      <div className="context-menu-divider" />
      {/* Tapping outside already dismisses the menu (see the document
          click listener above), but on a touch device that's not
          discoverable — a long-press that opened the menu has no other
          visible way out, so once it's open you'd otherwise feel forced
          to pick one of the real options just to make it go away. */}
      <button className="context-menu-item context-menu-cancel" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
