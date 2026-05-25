import React from 'react';

interface Props {
  phase?: string;
  error?: string;
  paletteLength: number;
}

export const StatusFooter: React.FC<Props> = ({ phase, error, paletteLength }) => (
  <div className="text-xs min-h-[28px]">
    {phase && (
      <span className="inline-flex items-center gap-2 text-signal-info bg-signal-info/[0.06] border border-signal-info/30 rounded-md px-2.5 py-1">
        <span className="inline-block w-2 h-2 rounded-full bg-signal-info animate-pulse shadow-[0_0_8px_rgba(0,212,255,0.6)]" />
        <span className="font-medium tracking-wide">WORKING</span>
        <span className="text-signal-info/70 font-mono text-[10px]">{phase}…</span>
      </span>
    )}
    {error && (
      <span className="inline-flex items-center gap-2 text-signal-error bg-signal-error/[0.06] border border-signal-error/30 rounded-md px-2.5 py-1">
        <span className="inline-block w-2 h-2 rounded-full bg-signal-error shadow-[0_0_8px_rgba(255,56,96,0.6)]" />
        <span className="font-medium tracking-wide">ERROR</span>
        <span className="text-signal-error/80 font-mono text-[10px]">{error}</span>
      </span>
    )}
    {!phase && !error && paletteLength > 0 && (
      <span className="inline-flex items-center gap-2 text-signal-ready bg-signal-ready/[0.06] border border-signal-ready/30 rounded-md px-2.5 py-1">
        <span className="inline-block w-2 h-2 rounded-full bg-signal-ready shadow-[0_0_10px_rgba(0,255,136,0.7)]" />
        <span className="font-medium tracking-wide">READY</span>
        <span className="text-signal-ready/80 font-mono text-[10px]">{paletteLength} colors traced</span>
      </span>
    )}
  </div>
);
