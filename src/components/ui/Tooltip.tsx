import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

interface TooltipProps {
  content: string;
}

const Tooltip: React.FC<TooltipProps> = ({ content }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        left: rect.left + rect.width / 2, // Center horizontally
        top: rect.top - 8, // Just above the trigger with some padding
      });
    }
  };

  useEffect(() => {
    if (isVisible) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
    }
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isVisible]);

  return (
    <>
      <div 
        ref={triggerRef}
        className="relative inline-flex items-center ml-2"
        onMouseEnter={() => {
            updatePosition();
            setIsVisible(true);
        }}
        onMouseLeave={() => setIsVisible(false)}
        onClick={(e) => {
            e.stopPropagation();
            updatePosition();
            setIsVisible(!isVisible);
        }}
      >
        <Info 
          size={14} 
          className="text-gray-500 hover:text-purple-400 cursor-help transition-colors" 
        />
      </div>
      
      {isVisible && createPortal(
        <div 
            className="fixed z-[9999] w-48 p-2 bg-gray-900 border border-gray-700 rounded-lg shadow-xl text-xs text-gray-300 pointer-events-none animate-in fade-in zoom-in-95 duration-200"
            style={{
                left: coords.left,
                top: coords.top,
                transform: 'translate(-50%, -100%)', // Center horizontally, move up by 100% height
            }}
        >
          {content}
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-700" />
        </div>,
        document.body
      )}
    </>
  );
};

export default Tooltip;
