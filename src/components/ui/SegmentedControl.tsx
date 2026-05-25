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
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = ''
}: SegmentedControlProps<T>) {
  return (
    <div className={`flex bg-gray-900 p-1 rounded-lg border border-gray-700 ${className}`}>
      {options.map((option) => {
        const isActive = value === option.value;
        const isDisabled = option.disabled === true;
        return (
          <button
            key={option.value}
            onClick={() => { if (!isDisabled) onChange(option.value); }}
            disabled={isDisabled}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
              isDisabled
                ? 'text-gray-600 cursor-not-allowed opacity-50'
                : isActive
                  ? 'bg-gradient-to-br from-purple-600/90 to-blue-600/90 text-white shadow-md ring-1 ring-white/20'
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
