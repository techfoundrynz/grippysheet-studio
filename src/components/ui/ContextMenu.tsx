import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  /** Visible label. Ignored when `separator` is true. */
  label?: string;
  /** Optional shortcut hint shown as a mono kbd pill (e.g. "O"). */
  shortcut?: string;
  /** Click handler. Menu is closed automatically before invoking. */
  onClick?: () => void;
  /** When true, render as a thin divider line instead of a button. */
  separator?: boolean;
  /** Disable the item without removing it from the list. */
  disabled?: boolean;
}

interface ContextMenuProps {
  /** Whether the menu is currently open. */
  open: boolean;
  /** Viewport coordinates (clientX/clientY from the right-click event). */
  x: number;
  y: number;
  /** Items to render top-to-bottom. Falsy entries are filtered. */
  items: Array<ContextMenuItem | false | null | undefined>;
  /** Called on Escape, click-outside, or after a click. */
  onClose: () => void;
}

/**
 * Generic right-click context menu. Portals to `document.body` so it
 * escapes any overflow:hidden parent (toolbar pills, the viewer wrapper,
 * etc.). Visual treatment matches IconTooltip — semi-opaque dark panel,
 * border + ring + shadow + backdrop blur.
 *
 * Positioning clamps to the viewport so the menu never opens partly off
 * screen near a right/bottom edge.
 */
const ContextMenu: React.FC<ContextMenuProps> = ({ open, x, y, items, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // Re-measure after mount so we can clamp to the viewport. Using
  // useLayoutEffect avoids the one-frame "flash off-screen" some menus get.
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) {
      setPos({ left: x, top: y });
      return;
    }
    const rect = panel.getBoundingClientRect();
    const margin = 8;
    const maxLeft = window.innerWidth - rect.width - margin;
    const maxTop = window.innerHeight - rect.height - margin;
    setPos({
      left: Math.max(margin, Math.min(x, maxLeft)),
      top: Math.max(margin, Math.min(y, maxTop)),
    });
  }, [open, x, y]);

  // Click-outside + Escape closers. Use `mousedown` (not click) so a
  // right-click elsewhere on the canvas closes this menu before the new
  // one opens; matches the existing toolbar dropdown pattern.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('contextmenu', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('contextmenu', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const filtered = items.filter((it): it is ContextMenuItem => !!it);

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[9999] min-w-[200px] py-1 rounded-lg bg-gray-950/95 backdrop-blur border border-gray-700 shadow-xl ring-1 ring-black/40 animate-in fade-in zoom-in-95 duration-100"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      // Swallow right-clicks inside the menu so they don't bubble to the
      // viewer and immediately re-open a new menu over the top.
      onContextMenu={(e) => e.preventDefault()}
    >
      {filtered.map((item, idx) => {
        if (item.separator) {
          return <div key={`sep-${idx}`} className="my-1 mx-2 border-t border-gray-800" />;
        }
        const disabled = !!item.disabled;
        return (
          <button
            key={`item-${idx}`}
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              onClose();
              item.onClick?.();
            }}
            className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs font-medium transition-colors ${
              disabled
                ? 'text-gray-600 cursor-not-allowed'
                : 'text-gray-100 hover:bg-brand-500/15 hover:text-brand-300'
            }`}
          >
            <span className="font-display tracking-wide">{item.label}</span>
            {item.shortcut && (
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-brand-300 bg-gray-900 border border-gray-700 rounded">
                {item.shortcut}
              </kbd>
            )}
          </button>
        );
      })}
    </div>,
    document.body
  );
};

export default ContextMenu;
