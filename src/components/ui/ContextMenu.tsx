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
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Stash the element that owned focus before the menu opened so we can
  // restore it on close — accessibility expects focus to return to the
  // trigger, not vanish to document.body.
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  const [activeIdx, setActiveIdx] = useState<number>(-1);

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

  const filtered = items.filter((it): it is ContextMenuItem => !!it);
  // Indices of focusable items (skipping separators + disabled). Used by
  // Arrow/Home/End nav to skip past dividers and disabled entries.
  const focusableIdxs = filtered
    .map((it, i) => (it.separator || it.disabled ? -1 : i))
    .filter((i) => i >= 0);

  // Click-outside + keyboard handler. Use `mousedown` (not click) so a
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
        return;
      }
      if (focusableIdxs.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((cur) => {
          const here = focusableIdxs.indexOf(cur);
          const nextIdx = focusableIdxs[(here + 1 + focusableIdxs.length) % focusableIdxs.length];
          return nextIdx;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((cur) => {
          const here = focusableIdxs.indexOf(cur);
          const nextIdx = focusableIdxs[(here - 1 + focusableIdxs.length) % focusableIdxs.length];
          return nextIdx;
        });
      } else if (e.key === 'Home') {
        e.preventDefault();
        setActiveIdx(focusableIdxs[0]);
      } else if (e.key === 'End') {
        e.preventDefault();
        setActiveIdx(focusableIdxs[focusableIdxs.length - 1]);
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (activeIdx >= 0) {
          e.preventDefault();
          const item = filtered[activeIdx];
          if (item && !item.disabled && !item.separator) {
            onClose();
            item.onClick?.();
          }
        }
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
    // `focusableIdxs` derives from items each render; `activeIdx` is read
    // synchronously inside the Enter/Space branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, activeIdx, items]);

  // Open lifecycle: stash trigger focus, auto-focus the first selectable
  // item so keyboard users can act immediately. Restore focus on close.
  useEffect(() => {
    if (!open) return;
    lastFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    if (focusableIdxs.length > 0) {
      const first = focusableIdxs[0];
      setActiveIdx(first);
      // Move DOM focus on the next frame so the panel exists.
      requestAnimationFrame(() => {
        itemRefs.current[first]?.focus();
      });
    }
    return () => {
      lastFocusRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || activeIdx < 0) return;
    itemRefs.current[activeIdx]?.focus();
  }, [open, activeIdx]);

  if (!open) return null;

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
          return <div key={`sep-${idx}`} className="my-1 mx-2 border-t border-gray-800" role="separator" />;
        }
        const disabled = !!item.disabled;
        const isActive = idx === activeIdx;
        return (
          <button
            key={`item-${idx}`}
            ref={(el) => { itemRefs.current[idx] = el; }}
            role="menuitem"
            disabled={disabled}
            // Roving tabindex — only the active item is in the tab order
            // so arrow-key nav moves the focus ring without polluting Tab.
            tabIndex={isActive ? 0 : -1}
            onMouseEnter={() => !disabled && setActiveIdx(idx)}
            onClick={() => {
              if (disabled) return;
              onClose();
              item.onClick?.();
            }}
            className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs font-medium transition-colors focus:outline-none ${
              disabled
                ? 'text-gray-600 cursor-not-allowed'
                : isActive
                  ? 'bg-brand-500/15 text-brand-300'
                  : 'text-gray-100 hover:bg-brand-500/15 hover:text-brand-300'
            }`}
          >
            <span className="font-display tracking-wide">{item.label}</span>
            {item.shortcut && (
              <kbd aria-hidden="true" className="px-1.5 py-0.5 text-[10px] font-mono text-brand-300 bg-gray-900 border border-gray-700 rounded">
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
