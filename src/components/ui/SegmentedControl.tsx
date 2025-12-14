import React from 'react';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
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
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
              isActive
                ? 'bg-gray-700 text-white shadow-sm ring-1 ring-white/10'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
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
