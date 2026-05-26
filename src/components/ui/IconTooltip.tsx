import React, { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

interface IconTooltipProps {
  label: string;
  /** Optional keyboard hint shown in a mono pill after the label (e.g. "⌘ 2"). */
  shortcut?: string;
  /** Side to anchor on. Defaults to 'bottom' which matches toolbar usage. */
  side?: 'bottom' | 'top';
  /** Pointer-enter delay in ms before the tooltip appears. */
  delayMs?: number;
  children: React.ReactElement;
}

/**
 * Wrapper-style tooltip. Use it around any focusable/hoverable element:
 *
 *   <IconTooltip label="Orthographic view" shortcut="O">
 *     <button>…</button>
 *   </IconTooltip>
 *
 * The tooltip portals to <body> so it's never clipped by overflow:hidden
 * parents (the toolbar's panel). Hover-delayed so casual mousing through
 * the toolbar doesn't flash a wall of tooltips.
 */
const IconTooltip: React.FC<IconTooltipProps> = ({ label, shortcut, side = 'bottom', delayMs = 300, children }) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | null>(null);
  // Stable id used to wire aria-describedby on the wrapped child to the
  // portal-rendered tooltip surface.
  const tooltipId = useId();
  // For SR consumers, also project the shortcut into the accessible name —
  // sighted users get the <kbd> chip; SR users get "Orthographic view,
  // shortcut O" in one breath via aria-describedby.
  const accessibleText = shortcut ? `${label}, shortcut ${shortcut}` : label;
  const child = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<{ 'aria-describedby'?: string }>, {
        'aria-describedby': visible ? tooltipId : undefined,
      })
    : children;

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords({
      left: rect.left + rect.width / 2,
      top: side === 'bottom' ? rect.bottom + 8 : rect.top - 8,
    });
  };

  const show = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      updatePosition();
      setVisible(true);
    }, delayMs);
  };
  const hide = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return;
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [visible]);

  return (
    <>
      <span
        ref={triggerRef}
        className="contents"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
      >
        {child}
      </span>
      {visible && createPortal(
        <div
          id={tooltipId}
          role="tooltip"
          className="fixed z-[9999] pointer-events-none animate-in fade-in zoom-in-95 duration-150"
          style={{
            left: coords.left,
            top: coords.top,
            transform: side === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
        >
          {/* Visible label + kbd for sighted users. SR users get
              `accessibleText` via aria-describedby on the trigger and a
              `sr-only` mirror here in case a particular SR reads the
              described element's content directly. */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-gray-950/95 backdrop-blur border border-gray-700 shadow-xl ring-1 ring-black/40">
            <span aria-hidden="true" className="text-xs font-medium text-gray-100 whitespace-nowrap">{label}</span>
            {shortcut && (
              <kbd aria-hidden="true" className="px-1.5 py-0.5 text-[10px] font-mono text-brand-300 bg-gray-900 border border-gray-700 rounded">{shortcut}</kbd>
            )}
            <span className="sr-only">{accessibleText}</span>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default IconTooltip;
