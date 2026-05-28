import React from 'react';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Accessible label for the group as a whole (e.g. "Right panel section"
   *  for the tab strip, "Viewer render mode" for 2D/3D). */
  'aria-label'?: string;
  /**
   * ARIA pattern this control implements.
   *
   * - `'radio'` (default): mutually-exclusive choice that doesn't reveal a
   *   panel. Uses `role="radiogroup"` / `role="radio"` + `aria-checked`.
   *   Examples in this app: 2D/3D viewer pill, Inlay Place/Tile toggle,
   *   Geometry Layout Mode toggle.
   * - `'tab'`: a tablist that swaps which panel is visible. Uses
   *   `role="tablist"` / `role="tab"` + `aria-selected`, wires
   *   `id="tab-<value>"` and `aria-controls="tabpanel-<value>"` so the
   *   panel side can `aria-labelledby` back, and enables ArrowLeft/Right
   *   keyboard navigation with edge-wrap. Single-action activation
   *   (selection moves with focus) because all panels are kept mounted
   *   via `react-freeze`, so there is no perf reason to defer activation.
   */
  semantics?: 'radio' | 'tab';
  /** Tighter padding + smaller text so a strip with several entries (e.g.
   *  the 4-section right-panel tabs) fits the fixed-width panel without the
   *  last entry overflowing/clipping. */
  compact?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
  'aria-label': ariaLabel,
  semantics = 'radio',
  compact = false,
}: SegmentedControlProps<T>) {
  const isTab = semantics === 'tab';
  const sizing = compact ? 'py-1.5 px-2 text-xs gap-1' : 'py-1.5 px-3 text-sm gap-2';

  // Arrow-key navigation for the tablist variant. Computes prev/next from
  // the enabled options only, wrapping at the edges. Activates immediately
  // (single-action pattern) since panels are pre-mounted via Freeze.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isTab) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const enabled = options.filter((o) => o.disabled !== true);
    if (enabled.length === 0) return;
    const currentIdx = enabled.findIndex((o) => o.value === value);
    // If the current value is somehow disabled/missing, start from the
    // first enabled entry so ArrowRight still does something useful.
    const baseIdx = currentIdx === -1 ? 0 : currentIdx;
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (baseIdx + delta + enabled.length) % enabled.length;
    const next = enabled[nextIdx];
    if (next.value === value) return;
    e.preventDefault();
    onChange(next.value);
  };

  return (
    // For radio semantics: role=radiogroup so screen readers announce the
    //   group label + the active entry + its position in the set, with
    //   per-button role=radio + aria-checked (mutually-exclusive choice).
    // For tab semantics: role=tablist + per-button role=tab + aria-selected,
    //   plus aria-controls wiring to the panel id so the panel can mirror
    //   back via aria-labelledby.
    <div
      role={isTab ? 'tablist' : 'radiogroup'}
      aria-label={ariaLabel}
      onKeyDown={isTab ? handleKeyDown : undefined}
      className={`flex bg-gray-900 p-1 rounded-lg border border-gray-700 ${className}`}
    >
      {options.map((option) => {
        const isActive = value === option.value;
        const isDisabled = option.disabled === true;
        const tabAttrs = isTab
          ? {
              role: 'tab' as const,
              'aria-selected': isActive,
              id: `tab-${option.value}`,
              'aria-controls': `tabpanel-${option.value}`,
            }
          : {
              role: 'radio' as const,
              'aria-checked': isActive,
            };
        return (
          <button
            key={option.value}
            {...tabAttrs}
            // Roving tabindex — only the active option is in the Tab order,
            // matching both native radiogroup and tablist semantics.
            tabIndex={isActive ? 0 : -1}
            onClick={() => { if (!isDisabled) onChange(option.value); }}
            disabled={isDisabled}
            className={`flex-1 min-w-0 flex items-center justify-center rounded-md font-medium transition-all ${sizing} ${
              isDisabled
                ? 'text-gray-600 cursor-not-allowed opacity-50'
                : isActive
                  ? 'bg-gradient-to-br from-brand-500 to-accent-500 text-white shadow-glow-brand ring-1 ring-white/15 font-display'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
