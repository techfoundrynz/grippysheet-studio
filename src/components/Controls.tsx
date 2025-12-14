import React from 'react';
import ShapeUploader from './ShapeUploader';
import { getShapesBounds, getGeometryBounds, centerShapes } from '../utils/patternUtils';

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
  tilingDistribution: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave-v' | 'wave-h' | 'zigzag-v' | 'zigzag-h';
  setTilingDistribution: (val: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave-v' | 'wave-h' | 'zigzag-v' | 'zigzag-h') => void;
  tilingRotation: 'none' | 'alternate' | 'random' | 'aligned';
  setTilingRotation: (v: 'none' | 'alternate' | 'random' | 'aligned') => void;
  debugMode?: boolean;
  inlayShapes: any[] | null;
  setInlayShapes: (shapes: any[]) => void;
  inlayDepth: number;
  setInlayDepth: (depth: number) => void;
  inlayScale: number;
  setInlayScale: (scale: number) => void;
  inlayExtend: number;
  setInlayExtend: (val: number) => void;
  onReset?: () => void;
  onOpenWelcome?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  mobileContent?: React.ReactNode;
}

import { COLORS } from '../constants/colors';
import { Grid3x3, MousePointer2, Maximize, Scissors, RotateCcw, HelpCircle, ChevronDown, Palette } from 'lucide-react';
import DebouncedInput from './DebouncedInput';
import { useAlert } from '../context/AlertContext';
import SVGPaintModal from './SVGPaintModal';


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
  inlayShapes,
  setInlayShapes,
  inlayDepth,
  setInlayDepth,
  inlayScale,
  setInlayScale,
  inlayExtend,
  setInlayExtend,
  onReset,
  onOpenWelcome,
  isCollapsed = false,
  onToggleCollapse,
  mobileContent
}) => {
  const { showAlert } = useAlert();
  const [showPaintModal, setShowPaintModal] = React.useState(false);
  const [originalInlayShapes, setOriginalInlayShapes] = React.useState<any[]>([]);

  const handleResetClick = () => {
      showAlert({
          title: "Reset Settings?",
          message: "Are you sure you want to reset all settings to their defaults? This action cannot be undone and your current design will be lost.",
          type: "warning",
          confirmText: "Confirm Reset",
          cancelText: "Cancel",
          onConfirm: () => {
              if (onReset) onReset();
          }
      });
  };

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
    <div className="bg-gray-800 rounded-lg border border-gray-700 shadow-lg min-h-0 flex-shrink transition-all overflow-y-auto custom-scrollbar relative">
      <div className="md:sticky md:top-0 z-10 bg-gray-800 p-6 pb-4 border-b border-gray-700/50 mb-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
             {onToggleCollapse && (
                  <button
                      onClick={onToggleCollapse}
                      className="md:hidden p-1 -ml-1 text-gray-400 hover:text-white transition-colors"
                  >
                      <ChevronDown size={20} className={`transition-transform duration-300 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`} />
                  </button>
             )}
             <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                GrippySheet Studio
             </h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onOpenWelcome}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-all"
              title="Help & Info"
            >
              <HelpCircle size={20} />
            </button>
          </div>
        </div>
          
        <div className="flex -mt-1">
             <p className="text-[9px] text-gray-500 font-mono">
               Build: {import.meta.env.DEV ? 'DEV' : __BUILD_TIMESTAMP__}
             </p>
        </div>
      </div>

      <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isCollapsed ? 'max-h-0 opacity-0 md:max-h-[2000px] md:opacity-100' : 'max-h-[2000px] opacity-100'}`}>
      <div className="p-6 pt-2 space-y-6">
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
                    className={`w-6 h-6 rounded-md transition-all hover:scale-110 active:scale-95 ${color === value ? 'ring-2 ring-white' : 'hover:ring-1 hover:ring-white/50'}`}
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
            Inlay
          </h2>
          <ShapeUploader 
              label="Upload Inlay Pattern" 
              onShapesLoaded={(shapes) => {
                  setOriginalInlayShapes(shapes); // Store original
                  setInlayShapes(shapes);
              }}
              onClear={() => {
                  setOriginalInlayShapes([]);
                  setInlayShapes([]);
              }}
              allowedTypes={['svg', 'dxf']}
              extractColors={true}
              adornment={
                  <button
                      onClick={() => setShowPaintModal(true)}
                      className={`p-1.5 rounded-lg transition-colors border ${inlayShapes && inlayShapes.length > 0 
                          ? 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 border-purple-500/20 hover:border-purple-500/50' 
                          : 'bg-gray-700/50 hover:bg-gray-700 text-gray-400 hover:text-white border-gray-600 hover:border-gray-500'}`}
                      title="Paint / Draw Inlay"
                  >
                      <Palette size={16} />
                  </button>
              }
              externalShapes={inlayShapes && inlayShapes.length > 0 ? inlayShapes : undefined}
          />
          
          <SVGPaintModal 
              isOpen={showPaintModal}
              onClose={() => setShowPaintModal(false)}
              shapes={inlayShapes || []}
              baseColor={color}
              onSave={(newShapes) => {
                  // If standalone mode (no original shapes), center the drawing
                  if (!originalInlayShapes || originalInlayShapes.length === 0) {
                       // newShapes is array of objects { shape, color }
                       const rawShapes = newShapes.map((s: any) => s.shape || s);
                       const centered = centerShapes(rawShapes, false); // FlipY false to prevent mirroring on reload
                       const centeredObjs = newShapes.map((s: any, i: number) => ({ ...s, shape: centered[i] }));
                       setInlayShapes(centeredObjs);
                  } else {
                       setInlayShapes(newShapes);
                  }
              }}
          />
          
          {inlayShapes && inlayShapes.length > 0 && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-300">Scale</label>
                  <button
                      onClick={() => {
                          // Extract shapes if they are objects (which they are for inlayShapes)
                          const shapes = inlayShapes.map((s: any) => s.shape || s);
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
                              
                              setInlayScale(targetScale);
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
                    value={inlayScale}
                    onChange={(val) => {
                        const num = Number(val);
                        // Prevent NaN or 0, but allow negative numbers.
                        if (!isNaN(num) && num !== 0) {
                            setInlayScale(num);
                        }
                    }}
                    step="0.1"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Inlay Depth (mm)</label>
                <DebouncedInput
                  type="number"
                  value={inlayDepth}
                  onChange={(val) => setInlayDepth(Number(val))}
                  step="0.1"
                  min="0.1"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Inlay Extend (mm)</label>
                <DebouncedInput
                  type="number"
                  value={inlayExtend}
                  onChange={(val) => setInlayExtend(Number(val))}
                  step="0.1"
                  min="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </div>
            </>
          )}
        </section>


        {/* Pattern Settings */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            Grip Geometry
          </h2>
            <ShapeUploader 
                label="Upload Pattern/Geometry" 
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
                        <option value="grid">Grid (Rectangular)</option>
                        <option value="offset">Offset (Brick)</option>
                        <option value="hex">Hex (Clusters)</option>
                        <option value="radial">Radial</option>
                        <option value="wave-v">Wave (Vertical)</option>
                        <option value="wave-h">Wave (Horizontal)</option>
                        <option value="zigzag-v">Zigzag (Vertical)</option>
                        <option value="zigzag-h">Zigzag (Horizontal)</option>
                        <option value="random">Random</option>
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
                        <option value="aligned">Aligned (Tangential)</option>
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
                       className={`w-6 h-6 rounded-md transition-all hover:scale-110 active:scale-95 ${patternColor === value ? 'ring-2 ring-white' : 'hover:ring-1 hover:ring-white/50'}`}
                       style={{ backgroundColor: value }}
                       title={name}
                     />
                   ))}
                </div>
              </div>
            </>
          )}
        </section>

        {/* Mobile-only Content (Export Buttons) */}
        {mobileContent && (
             <div className="md:hidden pt-6 border-t border-gray-700">
                {mobileContent}
             </div>
        )}

        {/* Reset Button */}
        {onReset && (
             <div className="pt-6 border-t border-gray-700">
                <button
                    onClick={handleResetClick}
                    className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/50 hover:border-red-400 p-3 rounded-lg flex items-center justify-center gap-2 transition-all font-medium"
                >
                    <RotateCcw size={18} />
                    Reset All Settings
                </button>
             </div>
        )}

      </div>
      </div>
    </div>
  );
};

export default Controls;
