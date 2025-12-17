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
          ? 'bg-purple-500/10 text-purple-400 border-purple-500'
          : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600 hover:text-gray-300'
      } ${className}`}
    >
      {icon}
      {label}
    </button>
  );
};

export default ToggleButton;
