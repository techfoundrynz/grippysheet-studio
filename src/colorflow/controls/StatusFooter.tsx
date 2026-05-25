import React from 'react';

interface Props {
  phase?: string;
  error?: string;
  paletteLength: number;
}

export const StatusFooter: React.FC<Props> = ({ phase, error, paletteLength }) => (
  <div className="text-xs min-h-[28px]">
    {phase && (
      <span className="inline-flex items-center gap-2 text-purple-200 bg-purple-950/30 border border-purple-700/40 rounded-md px-2.5 py-1">
        <span className="inline-block w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
        <span className="font-medium">working</span>
        <span className="text-purple-300/80">· {phase}…</span>
      </span>
    )}
    {error && (
      <span className="inline-flex items-center gap-2 text-red-300 bg-red-950/30 border border-red-700/40 rounded-md px-2.5 py-1">
        <span className="font-medium">error</span>
        <span className="text-red-400/80">· {error}</span>
      </span>
    )}
    {!phase && !error && paletteLength > 0 && (
      <span className="inline-flex items-center gap-2 text-emerald-300 bg-emerald-950/30 border border-emerald-700/40 rounded-md px-2.5 py-1">
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
        <span className="font-medium">ready</span>
        <span className="text-emerald-400/80 font-mono">· {paletteLength} colors traced</span>
      </span>
    )}
  </div>
);
