import React, { useEffect, useRef } from 'react';
import type { AutoSaveSnapshot } from '../utils/autoSave';

/**
 * "Resume last session?" surface. Mounted by `App.tsx` when a valid
 * auto-save snapshot is detected on first load AND the user doesn't
 * already have non-default state in flight.
 *
 * Style follows `ToastHost`: backdrop-blur dark pill, brand orange
 * ring, signal-info dot. Lives just above the viewer's 2D/3D toolbar.
 *
 * Lifecycle (driven by the host App):
 *   - "Open"        → host applies snapshot + dismisses + toasts.
 *   - "Start fresh" → host clears snapshot + dismisses.
 *   - Auto-dismiss after 30s of no interaction (banner-local timer).
 *   - Click-outside dismisses WITHOUT clearing the snapshot — user
 *     can still resume from a refresh.
 */

interface ResumeBannerProps {
  snapshot: AutoSaveSnapshot;
  onResume: () => void;
  onDiscard: () => void;
  onDismiss: () => void;
}

function formatTimeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return sec <= 5 ? 'just now' : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

const AUTO_DISMISS_MS = 30_000;

const ResumeBanner: React.FC<ResumeBannerProps> = ({ snapshot, onResume, onDiscard, onDismiss }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Auto-dismiss after 30s of no interaction. Plain timer — the user
  // pressing a button unmounts the banner via the host, which cleans
  // the timer up via the effect's return.
  useEffect(() => {
    const id = window.setTimeout(() => onDismiss(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [onDismiss]);

  // Click-outside dismiss. We listen on `mousedown` so the dismiss
  // beats focus changes on whatever the user clicked. Banner buttons
  // (inside `rootRef`) are excluded; their own onClick handlers fire.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && !root.contains(e.target)) {
        onDismiss();
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onDismiss]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Resume last session"
      className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 bg-gray-950/85 backdrop-blur-md rounded-xl border border-brand-500/40 shadow-xl ring-1 ring-brand-500/30 animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <span
        aria-hidden="true"
        className="inline-block w-2 h-2 rounded-full bg-signal-info"
        style={{ boxShadow: '0 0 10px rgba(0,212,255,0.7)' }}
      />
      <div className="flex flex-col leading-tight">
        <span className="text-xs font-display font-semibold tracking-wide text-white">
          Pick up where you left off?
        </span>
        <span className="text-[10px] font-mono opacity-70 text-gray-300">
          Last session saved {formatTimeAgo(snapshot.savedAt)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 ml-1">
        <button
          type="button"
          onClick={onResume}
          className="px-3 py-1.5 rounded-md bg-gradient-to-br from-brand-500 to-accent-500 text-white text-xs font-display font-semibold tracking-wide shadow-glow-brand hover:brightness-110 transition"
        >
          Open
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="px-3 py-1.5 rounded-md bg-gray-800/80 border border-gray-700/70 text-gray-300 text-xs font-display font-semibold tracking-wide hover:bg-gray-700/80 hover:text-white transition"
        >
          Start fresh
        </button>
      </div>
    </div>
  );
};

export default ResumeBanner;
