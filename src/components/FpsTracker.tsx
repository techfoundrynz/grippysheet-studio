import React from 'react';
import { useFrame } from '@react-three/fiber';

interface FpsTrackerProps {
  fpsRef: React.RefObject<HTMLDivElement>;
}

const FpsTracker: React.FC<FpsTrackerProps> = ({ fpsRef }) => {
  const lastTimeRef = React.useRef(performance.now());
  const updateInterval = 1000 / 15;

  useFrame((_, delta) => {
      const now = performance.now();
      if (fpsRef.current && now - lastTimeRef.current >= updateInterval) {
          const fps = 1 / Math.max(delta, 0.001);
          const fpsString = String(Math.round(fps)).padStart(3, '\u00A0');
          fpsRef.current.innerText = `${fpsString} FPS`;
          lastTimeRef.current = now;
      }
  });

  return null;
};

export default FpsTracker;
