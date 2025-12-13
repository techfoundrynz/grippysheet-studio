import React from 'react';
import ShapeUploader from './ShapeUploader';
import { HeaderLinksSelector } from './HeaderLinksSelector';
import { getShapesBounds, getGeometryBounds } from '../utils/patternUtils';

interface ControlsProps {
  size: number;
  setSize: (val: number) => void;
  thickness: number;
  setThickness: (val: number) => void;
  color: string;
  setColor: (val: string) => void;
  setCutoutShapes: (shapes: any[]) => void;
  cutoutShapes: any[] | null;
  patternShapes: any[] | null;
  setPatternShapes: (shapes: any[]) => void;
  patternType: 'dxf' | 'svg' | 'stl' | null;
  setPatternType: (type: 'dxf' | 'svg' | 'stl' | null) => void;
  extrusionAngle: number;
  setExtrusionAngle: (angle: number) => void;
  patternHeight: number | '';
  setPatternHeight: (height: number | '') => void;
  patternScale: number;
  setPatternScale: (scale: number) => void;
  isTiled: boolean;
  setIsTiled: (val: boolean) => void;
  tileSpacing: number;
  setTileSpacing: (spacing: number) => void;
  patternMargin: number;
  setPatternMargin: (margin: number) => void;
  patternColor: string;
  setPatternColor: (val: string) => void;
  clipToOutline?: boolean;
  setClipToOutline?: (val: boolean) => void;
  tilingDistribution: 'grid' | 'offset' | 'random';
  setTilingDistribution: (v: 'grid' | 'offset' | 'random') => void;
  tilingRotation: 'none' | 'alternate' | 'random';
  setTilingRotation: (v: 'none' | 'alternate' | 'random') => void;
  debugMode?: boolean;
  basePatternShapes: any[] | null;
  setBasePatternShapes: (shapes: any[]) => void;
  basePatternDepth: number;
  setBasePatternDepth: (depth: number) => void;
  basePatternScale: number;
  setBasePatternScale: (scale: number) => void;
}

import { COLORS } from '../constants/colors';
import { Grid3x3, MousePointer2, Maximize, Scissors } from 'lucide-react';
import { DebouncedInput } from './DebouncedInput';


const Controls: React.FC<ControlsProps> = ({
  size, setSize,
  thickness, setThickness,
  color, setColor,
  patternColor, setPatternColor,
  setCutoutShapes,
  cutoutShapes,
  patternShapes,
  setPatternShapes,
  patternType,
  setPatternType,
  extrusionAngle, setExtrusionAngle,
  patternHeight, setPatternHeight,
  patternScale, setPatternScale,
  isTiled, setIsTiled,
  tileSpacing, setTileSpacing,
  patternMargin, setPatternMargin,
  clipToOutline = false,
  setClipToOutline,
  tilingDistribution,
  setTilingDistribution,
  tilingRotation,
  setTilingRotation,

  debugMode = false,
  basePatternShapes,
  setBasePatternShapes,
  basePatternDepth,
  setBasePatternDepth,
  basePatternScale,
  setBasePatternScale
}) => {

  // ... handlePatternLoaded ... (omitted for brevity, assume keeps existing)
  const handlePatternLoaded = (shapes: any[], type?: 'dxf' | 'svg' | 'stl') => {
      setPatternShapes(shapes);
      setPatternType(type || null);
      
      if (shapes && shapes.length > 0) {
          if (type === 'dxf') {
              // DXF defaults to 1.0 (assuming mm 1:1)
              setPatternScale(1);
          } else {
              // Auto-scale SVG, STL or unknown to ~10% of base size
              let width = 0;
              
              if (type === 'stl') {
                   const bounds = getGeometryBounds(shapes[0]);
                   width = bounds.size.x;
              } else {
                   const bounds = getShapesBounds(shapes);
                   width = bounds.size.x;
              }
              
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
            GrippySheet Designer
          </h2>
          <p className="text-gray-400 text-sm">Configure your grip</p>
        </div>
        <HeaderLinksSelector />
      </div>

      <div className="space-y-6">
        {/* Base Settings */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            Base
          </h2>
          
          {!cutoutShapes && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">Size (mm)</label>
              <DebouncedInput
                type="number"
                value={size}
                onChange={(val) => setSize(Number(val))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
              />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">Thickness (mm)</label>
            <DebouncedInput
              type="number"
              value={thickness}
              onChange={(val) => setThickness(Number(val))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
            />
          </div>

          <div className="space-y-2">
            <ShapeUploader 
                label="Upload Outline" 
                onShapesLoaded={(shapes) => setCutoutShapes(shapes)}
                onClear={() => setCutoutShapes([])}
                allowedTypes={['dxf']}
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
          

        </section>


        {/* Base Pattern (Inlay) Settings */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            Base Pattern (Inlay)
          </h2>
          <ShapeUploader 
              label="Upload Inlay Pattern" 
              onShapesLoaded={(shapes) => setBasePatternShapes(shapes)}
              onClear={() => setBasePatternShapes([])}
              allowedTypes={['svg']}
              extractColors={true}
          />
          
          {basePatternShapes && basePatternShapes.length > 0 && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-300">Scale</label>
                  <button
                      onClick={() => {
                          // Extract shapes if they are objects (which they are for basePatternShapes)
                          const shapes = basePatternShapes.map((s: any) => s.shape || s);
                          const bounds = getShapesBounds(shapes);
                          const width = bounds.size.x;
                          const height = bounds.size.y;
                          
                          if (width > 0 && height > 0) {
                              let targetScale = 1;

                              if (cutoutShapes && cutoutShapes.length > 0) {
                                  // Fit within Outline Bounds
                                  const outlineBounds = getShapesBounds(cutoutShapes);
                                  const outlineW = outlineBounds.size.x;
                                  const outlineH = outlineBounds.size.y;
                                  
                                  const scaleX = (outlineW * 0.8) / width;
                                  const scaleY = (outlineH * 0.8) / height;
                                  targetScale = Math.min(scaleX, scaleY);
                              } else {
                                  // Fit within Default Square Size
                                  const maxSize = Math.max(width, height);
                                  targetScale = (size * 0.8) / maxSize;
                              }
                              
                              setBasePatternScale(targetScale);
                          }
                      }}
                      className="text-gray-400 hover:text-purple-400 transition-colors"
                      title="Auto Scale to Fit"
                  >
                      <Maximize size={14} />
                  </button>
                </div>
                <DebouncedInput
                  type="number"
                  value={basePatternScale}
                  onChange={(val) => setBasePatternScale(Number(val))}
                  step="0.1"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Inlay Depth (mm)</label>
                <DebouncedInput
                  type="number"
                  value={basePatternDepth}
                  onChange={(val) => setBasePatternDepth(Number(val))}
                  step="0.1"
                  min="0.1"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </div>
            </>
          )}
        </section>


        {/* Pattern Settings */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            Grip Pattern
          </h2>
            <ShapeUploader 
                label="Upload Pattern" 
                onShapesLoaded={handlePatternLoaded}
                onClear={() => {
                  setPatternShapes([]);
                  setPatternType(null);
                }}
                allowedTypes={['dxf', 'svg', 'stl']}
            />
            
          {patternShapes && patternShapes.length > 0 && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Layout Mode</label>
                <div className="flex bg-gray-900 p-1 rounded-lg border border-gray-700">
                    <button
                        onClick={() => setIsTiled(false)}
                        className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-sm font-medium transition-all ${!isTiled ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        <MousePointer2 size={16} />
                        Place
                    </button>
                    <button
                        onClick={() => {
                            setIsTiled(true);
                            if (patternShapes && patternShapes.length > 0) {
                                let width = 0;
                                if (patternType === 'stl') {
                                    const bounds = getGeometryBounds(patternShapes[0]);
                                    width = bounds.size.x;
                                } else {
                                    const bounds = getShapesBounds(patternShapes);
                                    width = bounds.size.x;
                                }
    
                                if (width > 0) {
                                    const targetWidth = size * 0.1;
                                    const rawScale = targetWidth / width;
                                    const scale = Math.round(rawScale * 100) / 100;
                                    setPatternScale(scale > 0 ? scale : 1);
                                }
                            }
                        }}
                        className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-sm font-medium transition-all ${isTiled ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        <Grid3x3 size={16} />
                        Tile
                    </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="text-sm font-medium text-gray-300">Scale</label>
                        {patternShapes && patternShapes.length > 0 && (
                            <button
                                onClick={() => {
                                    let width = 0;
                                    let height = 0;
                                    
                                    if (patternType === 'stl') {
                                        const bounds = getGeometryBounds(patternShapes[0]);
                                        width = bounds.size.x;
                                        height = bounds.size.y;
                                    } else {
                                        const bounds = getShapesBounds(patternShapes);
                                        width = bounds.size.x;
                                        height = bounds.size.y;
                                    }
                                    
                                    if (width > 0 && height > 0) {
                                      if (isTiled) {
                                          // Tile Mode: Scale to ~10% of base size
                                          const targetWidth = size * 0.1;
                                          const rawScale = targetWidth / width;
                                          const scale = Math.round(rawScale * 100) / 100;
                                          setPatternScale(scale > 0 ? scale : 1);
                                      } else {
                                          // Place Mode: Scale to fit base size
                                          const maxSize = Math.max(width, height);
                                          setPatternScale(size / maxSize);
                                      }
                                    }
                                }}
                                className="text-gray-400 hover:text-purple-400 transition-colors"
                                title={isTiled ? "Auto Scale Tile Pattern" : "Auto Scale to Fit"}
                            >
                                <Maximize size={14} />
                            </button>
                        )}
                    </div>
                    <DebouncedInput
                      type="number"
                      value={patternScale}
                      onChange={(val) => setPatternScale(Number(val))}
                      step="0.1"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                    />
                  </div>

                  {isTiled && (
                    <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300">Spacing</label>
                      <DebouncedInput
                        type="number"
                        value={tileSpacing}
                        onChange={(val) => setTileSpacing(Number(val))}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300">Distribution</label>
                      <select
                        value={tilingDistribution}
                        onChange={(e) => setTilingDistribution(e.target.value as any)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                      >
                        <option value="grid">Grid</option>
                        <option value="offset">Offset Grid (Brick)</option>
                        <option value="random">Random (Scatter)</option>
                      </select>
                    </div>
                     <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300">Rotation</label>
                      <select
                        value={tilingRotation}
                        onChange={(e) => setTilingRotation(e.target.value as any)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                      >
                        <option value="none">None</option>
                        <option value="alternate">Alternate (Checker)</option>
                        <option value="random">Random</option>
                      </select>
                    </div>
                    </>
                  )}
                  

              </div>

              {/* Margin & Clip Toggles */}
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-800">
                  <div className="space-y-2">
                       <label className="text-sm font-medium text-gray-300">Margin</label>
                       <DebouncedInput
                        type="number"
                        value={patternMargin}
                        onChange={(val) => setPatternMargin(Number(val))}
                        step="0.5"
                        min="0"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                      />
                  </div>
                  {isTiled && cutoutShapes && cutoutShapes.length > 0 && (
                      <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-300">Clip to Edge</label>
                          <button
                            onClick={() => setClipToOutline && setClipToOutline(!clipToOutline)}
                            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border ${clipToOutline ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600'}`}
                            title="Trim patterns to outline"
                          >
                            <Scissors size={16} />
                            {clipToOutline ? "Enabled" : "Disabled"}
                          </button>
                      </div>
                  )}
              </div>



              {patternType !== 'stl' && (
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300">Extrusion Angle</label>
                      <div className="relative">
                          <DebouncedInput
                            type="number"
                            value={extrusionAngle}
                            onChange={(val) => setExtrusionAngle(Number(val))}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                          />
                          <div className="absolute right-3 top-2 text-gray-500 text-xs pointer-events-none">deg</div>
                      </div>
                    </div>

                  <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300">Max Height</label>
                      <DebouncedInput
                        type="number"
                        value={patternHeight}
                        onChange={(val) => setPatternHeight(val === '' ? '' : Number(val))}
                        placeholder="Auto"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none placeholder-gray-600"
                      />
                    </div>
                </div>
              )}



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
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default Controls;
