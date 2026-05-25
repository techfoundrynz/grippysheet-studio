import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Minus, Plus } from 'lucide-react';

export interface NumberStepperProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  /** Arrow-key / button step. Default 1. */
  step?: number;
  /** Shift-arrow / PageUp/PageDown step. Defaults to `step * 10`. */
  bigStep?: number;
  /** Optional unit suffix (mm, deg, %) rendered muted to the right of the value. */
  unit?: string;
  /** Decimal places to display. Inferred from `step` if omitted (e.g. step=0.1 → 1). */
  precision?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** Infer decimal places from a step value (`0.1` → 1, `0.05` → 2, `1` → 0). */
function inferPrecision(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = step.toString();
  if (s.includes('e-')) {
    const exp = parseInt(s.split('e-')[1], 10);
    return Number.isFinite(exp) ? exp : 0;
  }
  const dot = s.indexOf('.');
  return dot >= 0 ? s.length - dot - 1 : 0;
}

function clamp(v: number, min?: number, max?: number): number {
  let out = v;
  if (typeof min === 'number') out = Math.max(min, out);
  if (typeof max === 'number') out = Math.min(max, out);
  return out;
}

/** Round to N decimal places, avoiding 0.1 + 0.2 = 0.30000000000000004. */
function round(v: number, precision: number): number {
  const f = Math.pow(10, precision);
  return Math.round(v * f) / f;
}

/**
 * NumberStepper — instrument-dial style numeric input with +/− steppers,
 * keyboard nudging, scroll-wheel, and accelerating long-press repeat.
 *
 * Controlled component: parent owns `value`, receives `onChange(next)` on
 * every commit (button click, key press, wheel, blur of typed input, Enter).
 * Typing into the field does NOT fire `onChange` per keystroke — we only
 * commit on blur or Enter so users can type "-12.5" without intermediate
 * "-" and "-1" values blasting through the parent.
 */
const NumberStepper: React.FC<NumberStepperProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  bigStep,
  unit,
  precision,
  placeholder,
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
}) => {
  const effectivePrecision = precision ?? inferPrecision(step);
  const effectiveBigStep = bigStep ?? step * 10;

  // Local draft text while the user types. When `null`, the displayed value
  // is derived from `value` (formatted to precision). When non-null, the
  // input is in "editing" mode and we don't reformat under their cursor.
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const formatted = Number.isFinite(value) ? value.toFixed(effectivePrecision) : '';

  const commit = useCallback(
    (next: number) => {
      if (!Number.isFinite(next)) return;
      const clamped = clamp(round(next, effectivePrecision), min, max);
      if (clamped !== value) onChange(clamped);
    },
    [onChange, min, max, effectivePrecision, value],
  );

  const nudge = useCallback(
    (delta: number) => {
      commit(value + delta);
    },
    [commit, value],
  );

  // --- Long-press repeat for +/− buttons --------------------------------
  // Accelerating: 400ms initial → 200ms → 100ms → 50ms steady-state.
  // Refs (not state) so the running loop doesn't trigger re-renders.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (holdInterval.current) {
      clearInterval(holdInterval.current);
      holdInterval.current = null;
    }
  }, []);

  const startHold = useCallback(
    (delta: number) => {
      stopHold();
      // Wait 400ms before the first auto-repeat (otherwise a normal click
      // would fire twice — once from onClick, once from the repeater).
      holdTimer.current = setTimeout(() => {
        let tickCount = 0;
        // Start at 200ms, accelerate to 100ms after 3 ticks, 50ms after 8.
        const scheduleNext = () => {
          const interval = tickCount < 3 ? 200 : tickCount < 8 ? 100 : 50;
          holdInterval.current = setTimeout(() => {
            nudge(delta);
            tickCount++;
            scheduleNext();
          }, interval) as unknown as ReturnType<typeof setInterval>;
        };
        nudge(delta);
        tickCount++;
        scheduleNext();
      }, 400);
    },
    [nudge, stopHold],
  );

  // Cleanup on unmount so we don't leak timers if the component disappears
  // mid-hold (e.g. tab switch while the user is holding the button).
  useEffect(() => stopHold, [stopHold]);

  // --- Keyboard handling -------------------------------------------------
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      nudge(e.shiftKey ? effectiveBigStep : step);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nudge(e.shiftKey ? -effectiveBigStep : -step);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      nudge(effectiveBigStep);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      nudge(-effectiveBigStep);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flushDraft();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(null);
      inputRef.current?.blur();
    }
  };

  const flushDraft = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.') {
      setDraft(null);
      return;
    }
    const parsed = parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
      commit(parsed);
    }
    setDraft(null);
  };

  // --- Scroll wheel ------------------------------------------------------
  // Only react when the input is focused — otherwise the user is just
  // scrolling the panel past the control and we'd hijack their intent.
  // We use a native non-passive listener because React's synthetic wheel
  // event is passive and can't preventDefault.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (disabled) return;
      if (document.activeElement !== el) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? step : -step;
      nudge(delta);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [step, nudge, disabled]);

  const atMin = typeof min === 'number' && value <= min;
  const atMax = typeof max === 'number' && value >= max;

  const stepperBtnClass =
    'flex-shrink-0 w-8 h-9 flex items-center justify-center text-gray-500 ' +
    'hover:text-brand-300 hover:bg-brand-500/[0.06] active:bg-brand-500/[0.12] ' +
    'transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 ' +
    'disabled:cursor-not-allowed select-none';

  return (
    <div
      className={
        'group relative flex items-center bg-gray-900 border border-gray-800 rounded-lg overflow-hidden ' +
        'transition-all duration-150 ' +
        'focus-within:border-brand-500/40 focus-within:shadow-glow-brand ' +
        (disabled ? 'opacity-50 pointer-events-none ' : '') +
        className
      }
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Decrease"
        disabled={disabled || atMin}
        className={stepperBtnClass}
        onClick={() => nudge(-step)}
        onPointerDown={(e) => {
          // Only left-click should start the auto-repeat. Right/middle clicks
          // would otherwise hang the repeater (no matching pointerup).
          if (e.button !== 0) return;
          startHold(-step);
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
      >
        <Minus size={14} strokeWidth={2.5} />
      </button>

      <div className="flex-1 flex items-center justify-center min-w-0">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          aria-label={ariaLabel}
          value={draft ?? formatted}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={flushDraft}
          onKeyDown={handleKeyDown}
          onFocus={(e) => e.currentTarget.select()}
          className={
            'font-mono font-semibold text-sm text-gray-100 text-center bg-transparent ' +
            'outline-none w-full min-w-0 py-2 px-1 ' +
            'focus:bg-brand-500/[0.04] transition-colors ' +
            'tabular-nums'
          }
        />
        {unit && (
          <span className="text-[10px] font-mono text-gray-500 pr-2 pl-0.5 select-none pointer-events-none">
            {unit}
          </span>
        )}
      </div>

      <button
        type="button"
        tabIndex={-1}
        aria-label="Increase"
        disabled={disabled || atMax}
        className={stepperBtnClass}
        onClick={() => nudge(step)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          startHold(step);
        }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
      >
        <Plus size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
};

export default NumberStepper;
