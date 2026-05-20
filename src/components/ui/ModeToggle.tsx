import React from 'react';

export type StudioMode = 'pattern' | 'colorflow';

interface Props {
  mode: StudioMode;
  onChange: (mode: StudioMode) => void;
}

export const ModeToggle: React.FC<Props> = ({ mode, onChange }) => {
  return (
    <div className="inline-flex border border-gray-700 rounded overflow-hidden bg-gray-900">
      <button
        onClick={() => onChange('pattern')}
        className={`px-4 py-2 text-xs font-medium tracking-wider uppercase transition-colors ${
          mode === 'pattern'
            ? 'bg-gradient-to-r from-purple-500 to-cyan-500 text-white'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        Pattern
      </button>
      <button
        onClick={() => onChange('colorflow')}
        className={`px-4 py-2 text-xs font-medium tracking-wider uppercase transition-colors ${
          mode === 'colorflow'
            ? 'bg-gradient-to-r from-purple-500 to-cyan-500 text-white'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        ColorFlow
      </button>
    </div>
  );
};
