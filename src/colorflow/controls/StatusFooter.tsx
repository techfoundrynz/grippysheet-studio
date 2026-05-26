import React from 'react';

interface Props {
  phase?: string;
  error?: string;
  paletteLength: number;
}

// Map raw worker phase strings (see colorflow/worker.ts) to a user-facing
// 3-step pipeline. The worker emits granular sub-phases; we collapse them.
//   QUANTIZE: sampling / clustering / assigning + literal "quantize"
//   TRACE:    simplifying / tracing + literal "trace"
//   EXTRUDE:  extruding + literal "extrude"
// Anything else → unknown (caller falls back to the original pill).
const STEP_NAMES = ['QUANTIZE', 'TRACE', 'EXTRUDE'] as const;

function phaseToStep(phase: string): 0 | 1 | 2 | -1 {
  switch (phase) {
    case 'sampling':
    case 'clustering':
    case 'assigning':
    case 'quantize':
      return 0;
    case 'simplifying':
    case 'tracing':
    case 'trace':
      return 1;
    case 'extruding':
    case 'extrude':
      return 2;
    default:
      return -1;
  }
}

const PhaseStepper: React.FC<{ step: 0 | 1 | 2 }> = ({ step }) => (
  <span className="inline-flex items-center gap-2 text-signal-info bg-signal-info/[0.06] border border-signal-info/30 rounded-md px-2.5 py-1">
    <span className="inline-flex items-center gap-1" aria-label={`step ${step + 1} of 3`}>
      {[0, 1, 2].map((i) => {
        if (i < step) {
          return (
            <span
              key={i}
              className="inline-block w-2 h-2 rounded-full bg-signal-info"
            />
          );
        }
        if (i === step) {
          return (
            <span
              key={i}
              className="inline-block w-2 h-2 rounded-full bg-signal-info animate-pulse shadow-[0_0_8px_rgba(0,212,255,0.6)]"
            />
          );
        }
        return (
          <span
            key={i}
            className="inline-block w-2 h-2 rounded-full border border-signal-info/40"
          />
        );
      })}
    </span>
    <span className="font-display font-medium tracking-wide uppercase">
      {STEP_NAMES[step]}
    </span>
    <span className="text-signal-info/70 font-mono text-[10px]">
      ({step + 1}/3)
    </span>
  </span>
);

const PhaseFallback: React.FC<{ phase: string }> = ({ phase }) => (
  <span className="inline-flex items-center gap-2 text-signal-info bg-signal-info/[0.06] border border-signal-info/30 rounded-md px-2.5 py-1">
    <span className="inline-block w-2 h-2 rounded-full bg-signal-info animate-pulse shadow-[0_0_8px_rgba(0,212,255,0.6)]" />
    <span className="font-medium tracking-wide">WORKING</span>
    <span className="text-signal-info/70 font-mono text-[10px]">{phase}…</span>
  </span>
);

export const StatusFooter: React.FC<Props> = ({ phase, error, paletteLength }) => {
  const step = phase ? phaseToStep(phase) : -1;
  return (
    <div className="text-xs min-h-[28px]">
      {phase && (step === -1 ? <PhaseFallback phase={phase} /> : <PhaseStepper step={step} />)}
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
};
