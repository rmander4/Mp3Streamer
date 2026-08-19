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
  const menuHeight = menuRef.current?.offsetHeight ?? items.length * 36;
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
    </div>
  );
}
