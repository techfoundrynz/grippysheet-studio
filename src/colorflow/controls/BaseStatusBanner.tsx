import React from 'react';
import type { OutlineEntry } from '../outlineLibrary';

interface Props {
  hasOutline: boolean;
  outlineEntry: OutlineEntry | null;
  onSwitchToBase?: () => void;
}

export const BaseStatusBanner: React.FC<Props> = ({ hasOutline, outlineEntry, onSwitchToBase }) => (
  <section>
    <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">① Base</h3>
    {hasOutline ? (
      <div className="flex items-center justify-between gap-2 text-xs bg-gray-900 border border-gray-700 rounded px-3 py-2">
        <span className="text-green-400">
          ✓ {outlineEntry ? `${outlineEntry.name} · ${outlineEntry.widthMm}×${outlineEntry.heightMm}mm` : 'custom outline loaded'}
        </span>
        {onSwitchToBase && (
          <button
            type="button"
            onClick={onSwitchToBase}
            className="text-blue-400 hover:underline text-[10px] whitespace-nowrap"
          >edit in Base ↗</button>
        )}
      </div>
    ) : (
      <div className="text-xs bg-yellow-900/20 border border-yellow-700/50 rounded px-3 py-2 text-yellow-200">
        <p>⚠ No outline configured yet.</p>
        {onSwitchToBase && (
          <button
            type="button"
            onClick={onSwitchToBase}
            className="text-blue-400 hover:underline text-[10px] mt-1"
          >Configure in Base tab ↗</button>
        )}
      </div>
    )}
  </section>
);
