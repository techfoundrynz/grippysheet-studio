import React, { useEffect, useState } from 'react';
import { eventBus, type ToastEvent } from '../../utils/eventBus';

interface ActiveToast extends ToastEvent {
  id: number;
}

/**
 * Global toast host. Subscribes to the `toast` bus event and renders a
 * stack of ephemeral pills bottom-center. Each toast auto-dismisses after
 * ~2.4s. Tones drive the colour treatment (ready / info / error).
 *
 * Mount once near the app root.
 */
// Cap the visible stack so spam-clicks (e.g. rapid Export → Reset → Open)
// don't push toasts past the viewport bottom. Same-content toasts that
// arrive within DEDUPE_WINDOW_MS just refresh the existing toast's expiry
// instead of stacking a duplicate.
const MAX_VISIBLE_TOASTS = 4;
const DEDUPE_WINDOW_MS = 600;
const TOAST_LIFETIME_MS = 2400;

const ToastHost: React.FC = () => {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);

  useEffect(() => {
    return eventBus.on('toast', (e: ToastEvent) => {
      const id = Date.now() + Math.random();
      setToasts((cur) => {
        // Dedupe against the most-recent toast with the same content. Stops
        // chains of identical "Project saved" / "Export failed" toasts from
        // piling on top of each other.
        const last = cur[cur.length - 1];
        if (last && last.message === e.message && last.detail === e.detail && last.tone === e.tone) {
          const sinceLast = Date.now() - Math.floor(last.id);
          if (sinceLast < DEDUPE_WINDOW_MS) {
            // Refresh the existing toast's lifetime by rotating its id +
            // re-arming its timer. Keeps the visible count flat.
            window.setTimeout(() => {
              setToasts((c) => c.filter((t) => t.id !== id));
            }, TOAST_LIFETIME_MS);
            return [...cur.slice(0, -1), { ...last, id }];
          }
        }
        // Otherwise append + truncate to the cap. Last-N kept so the most
        // recent feedback is always visible.
        return [...cur, { ...e, id }].slice(-MAX_VISIBLE_TOASTS);
      });
      window.setTimeout(() => {
        setToasts((cur) => cur.filter((t) => t.id !== id));
      }, TOAST_LIFETIME_MS);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    // role=status + aria-live="polite" announces non-critical toasts to
    // screen readers; the per-toast wrapper escalates to role=alert /
    // assertive when the tone signals an error so users hear failures
    // immediately even if a softer announcement is mid-flight.
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none"
    >
      {toasts.map((t) => {
        const tone = t.tone ?? 'ready';
        const palette = tone === 'error'
          ? 'border-signal-error/40 bg-signal-error/[0.08] text-signal-error'
          : tone === 'info'
            ? 'border-signal-info/40 bg-signal-info/[0.08] text-signal-info'
            : 'border-signal-ready/40 bg-signal-ready/[0.08] text-signal-ready';
        const dot = tone === 'error' ? 'bg-signal-error' : tone === 'info' ? 'bg-signal-info' : 'bg-signal-ready';
        const glow = tone === 'error' ? '0 0 10px rgba(255,56,96,0.7)' : tone === 'info' ? '0 0 10px rgba(0,212,255,0.7)' : '0 0 10px rgba(0,255,136,0.7)';
        return (
          <div
            key={t.id}
            // Error toasts escalate to role=alert + assertive so screen
            // readers interrupt their current speech and announce the
            // failure right away.
            role={tone === 'error' ? 'alert' : undefined}
            aria-live={tone === 'error' ? 'assertive' : undefined}
            className={`flex items-center gap-2.5 px-3.5 py-2 rounded-lg border ${palette} backdrop-blur-md shadow-xl ring-1 ring-black/30 animate-in fade-in slide-in-from-bottom-2 duration-200`}
          >
            <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${dot}`} style={{ boxShadow: glow }} />
            <span className="text-xs font-display font-semibold tracking-wide">{t.message}</span>
            {t.detail && <span className="text-[10px] font-mono opacity-75">{t.detail}</span>}
          </div>
        );
      })}
    </div>
  );
};

export default ToastHost;
