import React from 'react';
import type { OutlineEntry } from '../outlineLibrary';

interface Props {
  hasOutline: boolean;
  outlineEntry: OutlineEntry | null;
  onSwitchToBase?: () => void;
}

export const BaseStatusBanner: React.FC<Props> = ({ hasOutline, outlineEntry, onSwitchToBase }) => (
  <section>
    <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100 mb-3">
      <span className="text-xs font-mono text-gray-500">01</span>
      <span>Base</span>
    </h3>
    {hasOutline ? (
      <div className="flex items-center justify-between gap-2 text-xs bg-emerald-950/30 border border-emerald-700/40 rounded-md px-3 py-2">
        <span className="text-emerald-300 font-medium">
          ✓ {outlineEntry ? <>{outlineEntry.name} <span className="text-emerald-500/70 font-normal">· {outlineEntry.widthMm}×{outlineEntry.heightMm}mm</span></> : 'custom outline loaded'}
        </span>
        {onSwitchToBase && (
          <button
            type="button"
            onClick={onSwitchToBase}
            className="text-purple-300 hover:text-purple-200 hover:underline text-[10px] whitespace-nowrap"
          >edit in Base ↗</button>
        )}
      </div>
    ) : (
      <div className="text-xs bg-amber-950/30 border border-amber-700/40 rounded-md px-3 py-2 text-amber-200">
        <p className="font-medium">⚠ No outline configured yet</p>
        {onSwitchToBase && (
          <button
            type="button"
            onClick={onSwitchToBase}
            className="text-purple-300 hover:text-purple-200 hover:underline text-[10px] mt-1"
          >Configure in Base tab ↗</button>
        )}
      </div>
    )}
  </section>
);
