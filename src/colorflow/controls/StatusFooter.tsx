import React from 'react';

interface Props {
  phase?: string;
  error?: string;
  paletteLength: number;
}

export const StatusFooter: React.FC<Props> = ({ phase, error, paletteLength }) => (
  <div className="text-xs min-h-[24px]">
    {phase && (
      <span className="inline-flex items-center gap-2 text-blue-400 bg-blue-900/20 border border-blue-700/40 rounded px-2 py-1">
        <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        working: {phase}…
      </span>
    )}
    {error && <span className="text-red-400">error: {error}</span>}
    {!phase && !error && paletteLength > 0 && (
      <span className="text-green-400">ready · {paletteLength} colors traced</span>
    )}
  </div>
);
