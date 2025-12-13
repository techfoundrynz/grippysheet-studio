import React from 'react';
import ShapeUploader from './ShapeUploader';
import { HeaderLinksSelector } from './HeaderLinksSelector';
import { getShapesBounds } from '../utils/patternUtils';

interface ControlsProps {
  size: number;
  setSize: (val: number) => void;
  thickness: number;
  setThickness: (val: number) => void;
  color: string;
  setColor: (val: string) => void;
  setCutoutShapes: (shapes: any[]) => void;
  setPatternShapes: (shapes: any[]) => void;
  extrusionAngle: number;
  setExtrusionAngle: (angle: number) => void;
  patternHeight: number | '';
  setPatternHeight: (height: number | '') => void;
  patternScale: number;
  setPatternScale: (scale: number) => void;
  isTiled: boolean;
  tileSpacing: number;
  setTileSpacing: (spacing: number) => void;
  patternColor: string;
  setPatternColor: (val: string) => void;
  patternDirection: 'up' | 'down';
  setPatternDirection: (dir: 'up' | 'down') => void;
}

import { COLORS } from '../constants/colors';
import { ArrowUp, ArrowDown } from 'lucide-react';


const Controls: React.FC<ControlsProps> = ({
  size, setSize,
  thickness, setThickness,
  color, setColor,
  patternColor, setPatternColor,
  setCutoutShapes,
  setPatternShapes,
  extrusionAngle, setExtrusionAngle,
  patternHeight, setPatternHeight,
  patternScale, setPatternScale,
  isTiled, setIsTiled,
  tileSpacing, setTileSpacing,
  patternDirection, setPatternDirection
}) => {

  // ... handlePatternLoaded ... (omitted for brevity, assume keeps existing)
  const handlePatternLoaded = (shapes: any[], type?: 'dxf' | 'svg') => {
      setPatternShapes(shapes);
      
      if (shapes && shapes.length > 0) {
          if (type === 'dxf') {
              // DXF defaults to 1.0 (assuming mm 1:1)
              setPatternScale(1);
          } else {
              // Auto-scale SVG or unknown to ~10% of base size
              const bounds = getShapesBounds(shapes);
              const width = bounds.size.x;
              
              if (width > 0) {
                  const targetWidth = size * 0.1; 
                  // nice round number
                  const rawScale = targetWidth / width;
                  // Round to 2 decimals for cleaner UI
                  const scale = Math.round(rawScale * 100) / 100;
                  setPatternScale(scale > 0 ? scale : 1);
              }
          }
      }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg space-y-6">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            Pubgrip Generator
          </h2>
          <p className="text-gray-400 text-sm">Configure your grip</p>
        </div>
        <HeaderLinksSelector />
      </div>

      <div className="space-y-6">
        {/* Base Settings */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            Base Model
          </h2>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Size (mm)</label>
            <input
              type="number"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Thickness (mm)</label>
            <input
              type="number"
              value={thickness}
              onChange={(e) => setThickness(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
            />
          </div>

          <div className="space-y-2">
             <label className="text-sm font-medium text-gray-300">Base Color</label>
             <div className="grid grid-cols-7 gap-y-2 p-1.5 bg-gray-800 rounded-lg border border-gray-700 w-full justify-items-center">
                {Object.entries(COLORS).map(([name, value]) => (
                  <button
                    key={value}
                    onClick={() => setColor(value)}
                    className={`w-6 h-6 rounded-md transition-all hover:scale-110 active:scale-95 ${color === value ? 'ring-2 ring-white z-10' : 'hover:ring-1 hover:ring-white/50'}`}
                    style={{ backgroundColor: value }}
                    title={name}
                  />
                ))}
             </div>
          </div>
          
           <div className="space-y-2">
            <ShapeUploader 
                label="Upload Outline" 
                onShapesLoaded={(shapes) => setCutoutShapes(shapes)}
                onClear={() => setCutoutShapes([])}
                allowedTypes={['dxf']}
            />
          </div>
        </section>


        {/* Pattern Settings */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            Grip Pattern
          </h2>
            <ShapeUploader 
                label="Upload Pattern" 
                onShapesLoaded={handlePatternLoaded}
                onClear={() => setPatternShapes([])}
            />

          <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Scale</label>
                <input
                  type="number"
                  value={patternScale}
                  onChange={(e) => setPatternScale(Number(e.target.value))}
                  step="0.1"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Spacing</label>
                <input
                  type="number"
                  value={tileSpacing}
                  onChange={(e) => setTileSpacing(Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Extrusion Angle</label>
                <div className="relative">
                    <input
                      type="number"
                      value={extrusionAngle}
                      onChange={(e) => setExtrusionAngle(Number(e.target.value))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                    />
                    <div className="absolute right-3 top-2 text-gray-500 text-xs pointer-events-none">deg</div>
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Max Height</label>
                <input
                  type="number"
                  value={patternHeight}
                  onChange={(e) => setPatternHeight(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="Auto"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none placeholder-gray-600"
                />
              </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Extrusion Direction</label>
            <div className="flex bg-gray-900 p-1 rounded-lg border border-gray-700">
                <button
                    onClick={() => setPatternDirection('up')}
                    className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-sm font-medium transition-all ${patternDirection === 'up' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                >
                    <ArrowUp size={16} />
                    Up
                </button>
                <button
                    onClick={() => setPatternDirection('down')}
                    className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-sm font-medium transition-all ${patternDirection === 'down' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                >
                    <ArrowDown size={16} />
                    Down
                </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Pattern Color</label>
            <div className="grid grid-cols-7 gap-y-2 p-1.5 bg-gray-800 rounded-lg border border-gray-700 w-full justify-items-center">
               {Object.entries(COLORS).map(([name, value]) => (
                 <button
                   key={value}
                   onClick={() => setPatternColor(value)}
                   className={`w-6 h-6 rounded-md transition-all hover:scale-110 active:scale-95 ${patternColor === value ? 'ring-2 ring-white z-10' : 'hover:ring-1 hover:ring-white/50'}`}
                   style={{ backgroundColor: value }}
                   title={name}
                 />
               ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="tiled"
              checked={isTiled}
              onChange={(e) => setIsTiled(e.target.checked)}
              className="bg-gray-800 border-gray-700 rounded text-purple-500 focus:ring-purple-500 focus:ring-offset-gray-900"
            />
            <label htmlFor="tiled" className="text-sm font-medium text-gray-300 cursor-pointer select-none">
              Tile Surface
            </label>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Controls;
