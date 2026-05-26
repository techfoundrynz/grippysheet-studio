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
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    // role=radiogroup so screen readers announce "Tab strip" + the active
    // entry + its position. Individual buttons use aria-checked instead of
    // aria-pressed (radio semantics, since the values are mutually exclusive).
    <div role="radiogroup" aria-label={ariaLabel} className={`flex bg-gray-900 p-1 rounded-lg border border-gray-700 ${className}`}>
      {options.map((option) => {
        const isActive = value === option.value;
        const isDisabled = option.disabled === true;
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={isActive}
            // Roving tabindex — only the active option is in the Tab order,
            // matching native radiogroup semantics.
            tabIndex={isActive ? 0 : -1}
            onClick={() => { if (!isDisabled) onChange(option.value); }}
            disabled={isDisabled}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
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
