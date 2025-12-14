import React from 'react';
import Tooltip from './Tooltip';

interface ControlFieldProps {
  label: string;
  tooltip?: string;
  helperText?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

const ControlField: React.FC<ControlFieldProps> = ({ 
  label, 
  tooltip, 
  helperText, 
  error, 
  children,
  className = "",
  action
}) => {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between h-5 overflow-visible">
        <div className="flex items-center">
            <label className="text-sm font-medium text-gray-300 select-none">
            {label}
            </label>
            {tooltip && <Tooltip content={tooltip} />}
        </div>
        {action && (
            <div className="-my-1">
                {action}
            </div>
        )}
      </div>
      
      <div className="relative">
        {children}
      </div>

      {(helperText || error) && (
        <p className={`text-xs ${error ? 'text-red-400' : 'text-gray-500'} px-0.5`}>
          {error || helperText}
        </p>
      )}
    </div>
  );
};

export default ControlField;
