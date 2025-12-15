import React from 'react';
import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  className?: string;
  size?: number;
}

const Spinner: React.FC<SpinnerProps> = ({ className = '', size = 24 }) => {
  return (
    <div className={`flex items-center justify-center animate-spin ${className}`}>
      <Loader2 size={size} />
    </div>
  );
};

export default Spinner;
