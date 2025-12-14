import React from 'react';

interface ToggleButtonProps {
  label: React.ReactNode;
  isToggled: boolean;
  onToggle: () => void;
  icon?: React.ReactNode;
  className?: string;
  title?: string;
}

const ToggleButton: React.FC<ToggleButtonProps> = ({
  label,
  isToggled,
  onToggle,
  icon,
  className = '',
  title
}) => {
  return (
    <button
      onClick={onToggle}
      title={title}
      className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
        isToggled
          ? 'bg-gray-700 text-white border-transparent shadow-sm ring-1 ring-white/10'
          : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600'
      } ${className}`}
    >
      {icon}
      {label}
    </button>
  );
};

export default ToggleButton;
