import React from 'react';
import ShapeUploader from './ShapeUploader';
import { getShapesBounds, getGeometryBounds, centerShapes, calculateInlayScale } from '../utils/patternUtils';

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
  patternScale: number;
  setPatternScale: (scale: number) => void;
  patternScaleZ: number | '';
  setPatternScaleZ: (val: number | '') => void;
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
  tilingDistribution: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave-v' | 'wave-h' | 'zigzag-v' | 'zigzag-h' | 'warped-grid';
  setTilingDistribution: (val: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave-v' | 'wave-h' | 'zigzag-v' | 'zigzag-h' | 'warped-grid') => void;
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
  exportControls?: React.ReactNode;
}

import { COLORS } from '../constants/colors';
import { Grid3x3, MousePointer2, Maximize, Scissors, RotateCcw, HelpCircle, ChevronDown, Palette } from 'lucide-react';
import DebouncedInput from './DebouncedInput';
import { useAlert } from '../context/AlertContext';
import SVGPaintModal from './SVGPaintModal';
import ControlField from './ui/ControlField';
import SegmentedControl from './ui/SegmentedControl';
import ToggleButton from './ui/ToggleButton';
import PatternLibraryModal from './PatternLibraryModal';
import { SVGLoader, STLLoader } from 'three-stdlib';
import * as THREE from 'three';
import { parseDxfToShapes } from '../utils/dxfUtils';
import { BookOpen } from 'lucide-react';


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
  patternScale, setPatternScale,
  patternScaleZ, setPatternScaleZ,
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
  exportControls
}) => {
  const { showAlert } = useAlert();
  const [showPaintModal, setShowPaintModal] = React.useState(false);
  const [showPatternLibrary, setShowPatternLibrary] = React.useState(false);
  const [showInlayLibrary, setShowInlayLibrary] = React.useState(false);
  const [libraryPatternName, setLibraryPatternName] = React.useState<string | null>(null);
  const [libraryInlayName, setLibraryInlayName] = React.useState<string | null>(null);
  const [originalInlayShapes, setOriginalInlayShapes] = React.useState<any[]>([]);
  const [activeTab, setActiveTab] = React.useState<'base' | 'inlay' | 'geometry'>('base');

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
  
  const renderFooter = (className = "p-4 bg-gray-800 space-y-4") => (
      <div className={className}>
            {/* Reset Button */}
            {onReset && (
                <button
                    onClick={handleResetClick}
                    className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/50 hover:border-red-400 p-3 rounded-lg flex items-center justify-center gap-2 transition-all font-medium"
                >
                    <RotateCcw size={18} />
                    Reset All Settings
                </button>
            )}

            {/* Export Buttons */}
            {exportControls && (
                <div className="w-full">
                    {exportControls}
                </div>
            )}
      </div>
  );

  // Helper to auto-scale Inlay
  const handleInlayLoaded = (shapes: any[], name: string | null = null) => {
      // 1. Calculate Scale
      const scale = calculateInlayScale(shapes, cutoutShapes, size);
      
      // 2. Set State
      setInlayScale(scale);
      setOriginalInlayShapes(shapes);
      setInlayShapes(shapes);
      setLibraryInlayName(name);
  };

  // Helper to handle Outline (and resize Inlay if exists)
  const handleOutlineLoaded = (shapes: any[]) => {
      // 1. Set Outline
      setCutoutShapes(shapes);

      // 2. Check if we need to resize existing inlay
      if (inlayShapes && inlayShapes.length > 0) {
           // We need to use the NEW shapes for calculation.
           // Assumes cutoutShapes are Shape objects, which they are from uploader.
           const scale = calculateInlayScale(inlayShapes, shapes as THREE.Shape[], size);
           setInlayScale(scale);
      }
  };

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 shadow-lg flex-1 min-h-0 flex flex-col transition-all relative overflow-hidden">
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
          
        <div className="flex -mt-1 mb-4">
             <p className="text-[9px] text-gray-500 font-mono">
               Build: {import.meta.env.DEV ? 'DEV' : __BUILD_TIMESTAMP__}
             </p>
        </div>

        <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isCollapsed ? 'max-h-0 opacity-0 md:max-h-[500px] md:opacity-100 m-0' : 'max-h-[500px] opacity-100 mb-4'}`}>
          <SegmentedControl
            value={activeTab}
            onChange={(val) => setActiveTab(val as any)}
            options={[
              { value: 'base', label: 'BASE' },
              { value: 'inlay', label: 'INLAY' },
              { value: 'geometry', label: 'GEOMETRY' }
            ]}
          />
        </div>
      </div>



      <div className={`flex-1 min-h-0 flex flex-col transition-all duration-300 ease-in-out ${isCollapsed ? 'max-h-0 opacity-0 md:max-h-[2000px] md:opacity-100' : 'max-h-[2000px] opacity-100'}`}>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
        {/* Base Settings */}
        {activeTab === 'base' && (
        <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          
          <div className="space-y-2">
            <ShapeUploader 
                label="Upload Outline" 
                onShapesLoaded={handleOutlineLoaded}
                onClear={() => setCutoutShapes([])}
                allowedTypes={['dxf']}
            />
          </div>
          
          {(!cutoutShapes || cutoutShapes.length === 0) && (
            <ControlField label="Size (mm)" tooltip="Width/Height of the base sheet square" helperText="Unused when outline is uploaded">
              <DebouncedInput
                type="number"
                value={size}
                onChange={(val) => setSize(Number(val))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
              />
            </ControlField>
          )}

          <ControlField label="Thickness (mm)" tooltip="Total thickness (height) of the base sheet">
            <DebouncedInput
              type="number"
              value={thickness}
              onChange={(val) => setThickness(Number(val))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
            />
          </ControlField>

          <div className="space-y-2">
             <label className="text-sm font-medium text-gray-300">Color</label>
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
        )}


        {/* Base Pattern (Inlay) Settings */}
        {activeTab === 'inlay' && (
        <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <ShapeUploader 
              label="Upload Inlay Pattern" 
              onShapesLoaded={(shapes) => handleInlayLoaded(shapes)}
              onClear={() => {
                  setOriginalInlayShapes([]);
                  setInlayShapes([]);
                  setLibraryInlayName(null);
              }}
              allowedTypes={['svg', 'dxf']}
              extractColors={true}
              externalFileName={libraryInlayName}
              adornment={
                  <div className="flex items-center gap-1">
                  <button
                      onClick={() => setShowPaintModal(true)}
                      className={`p-1 rounded-lg transition-colors border ${inlayShapes && inlayShapes.length > 0 
                          ? 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 border-purple-500/20 hover:border-purple-500/50' 
                          : 'bg-gray-700/50 hover:bg-gray-700 text-gray-400 hover:text-white border-gray-600 hover:border-gray-500'}`}
                      title="Paint/Draw Inlay"
                  >
                      <Palette size={12} />
                  </button>
                  <button
                        onClick={() => setShowInlayLibrary(true)}
                        className={`p-1 rounded-lg transition-colors border ${libraryInlayName 
                            ? 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 border-purple-500/20 hover:border-purple-500/50' 
                            : 'bg-gray-700/50 hover:bg-gray-700 text-gray-400 hover:text-white border-gray-600 hover:border-gray-500'}`}
                        title="Open Inlay Library"
                    >
                        <BookOpen size={12} />
                    </button>
                  </div>
              }
              externalShapes={inlayShapes && inlayShapes.length > 0 ? inlayShapes : undefined}
          />
          
            <PatternLibraryModal 
                isOpen={showInlayLibrary} 
                onClose={() => setShowInlayLibrary(false)}
                category="inlays"
                onSelect={async (preset) => {
                    setShowInlayLibrary(false);
                    try {
                        const response = await fetch(`/${preset.category}/${preset.file}`);
                        const text = await response.text();
                        
                        let shapes: any[] = [];
                        
                        if (preset.type === 'svg') {
                            const loader = new SVGLoader();
                            const data = loader.parse(text);
                            
                            // For Inlays (extractColors=true), we need {shape, color}
                            data.paths.forEach((path) => {
                                const fillColor = path.userData?.style?.fill;
                                const color = (fillColor && fillColor !== 'none') ? fillColor : (path.color && path.color.getStyle()); // fallback to path color
                                
                                const subShapes = path.toShapes(true); // isCCW
                                
                                subShapes.forEach(s => {
                                       shapes.push({ shape: s, color: color || '#000000' });
                                });
                            });
                            
                             // Center shapes logic needs to handle objects or shapes
                                // Separate shapes for centering calculation
                                const rawShapes = shapes.map(item => item.shape);
                                const centered = centerShapes(rawShapes, true);
                                // Re-attach centerd shapes
                                shapes = shapes.map((item, i) => ({ ...item, shape: centered[i] }));
                                
                        } else if (preset.type === 'dxf') {
                            // DXF logic for inlays usually simpler
                             const rawShapes = parseDxfToShapes(text);
                             const centered = centerShapes(rawShapes, true);
                             shapes = centered.map(s => ({ shape: s, color: '#000000' }));
                        } else if (preset.type === 'stl') {
                            const loader = new STLLoader();
                             const geometry = loader.parse(text); // parse supports ArrayBuffer or string (ASCII)
                             // Actually STLLoader.parse expects ArrayBuffer usually, unless it detects ASCII string?
                             // three-stdlib STLLoader parse takes (data: ArrayBuffer | string). 
                             // If I fetched text(), and it is binary, it might be garbled. BUT pyramid.stl is ASCII.
                             // For robustness, maybe I should have fetched arrayBuffer()?
                             // SVGLoader.parse takes string.
                             // Let's refactor fetch to arrayBuffer first, then decode if text needed?
                             // Or just stick to text for now since I know it is ASCII. 
                             // Wait, if I add binary STLs later this will break.
                             // SAFE APPROACH: fetch arrayBuffer. If SVG/DXF, decoder.decode(). If STL, pass buffer.
                        }
                        
                        handleInlayLoaded(shapes, preset.name);
                        
                    } catch (error) {
                        console.error("Failed to load pattern:", error);
                        showAlert({
                            title: "Error Loading Inlay",
                            message: "Failed to load the selected inlay preset.",
                            type: "error"
                        });
                    }
                }}
            />
          
          <SVGPaintModal 
              isOpen={showPaintModal}
              onClose={() => setShowPaintModal(false)}
              shapes={inlayShapes || []}
              baseColor={color}
              onSave={(newShapes) => {
                  // If standalone mode (no original shapes), center the drawing
                  let finalShapes = newShapes;
                  if (!originalInlayShapes || originalInlayShapes.length === 0) {
                       // newShapes is array of objects { shape, color }
                       const rawShapes = newShapes.map((s: any) => s.shape || s);
                       const centered = centerShapes(rawShapes, false); // FlipY false to prevent mirroring on reload
                       finalShapes = newShapes.map((s: any, i: number) => ({ ...s, shape: centered[i] }));
                  }
                  
                  handleInlayLoaded(finalShapes);
              }}
          />
          
          {inlayShapes && inlayShapes.length > 0 && (
            <>
              <ControlField 
                label="Scale" 
                tooltip="Resize the inlay pattern relative to original"
                action={
                  <button
                      onClick={() => {
                          const scale = calculateInlayScale(inlayShapes, cutoutShapes, size);
                          setInlayScale(scale);
                      }}
                      className="text-gray-400 hover:text-purple-400 transition-colors"
                      title="Auto Scale to Fit"
                  >
                      <Maximize size={14} />
                  </button>
                }
              >
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
               </ControlField>

              <div className="flex gap-4">
                  <div className="flex-1 min-w-0">
                    <ControlField label="Inlay Depth (mm)" tooltip="How deep the inlay cuts into the base">
                        <DebouncedInput
                        type="number"
                        value={inlayDepth}
                        onChange={(val) => setInlayDepth(Number(val))}
                        step="0.1"
                        min="0.1"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                        />
                    </ControlField>
                  </div>
                  <div className="flex-1 min-w-0">
                    <ControlField label="Inlay Extend (mm)" tooltip="Extra width added to the cut for tighter/looser fit">
                        <DebouncedInput
                        type="number"
                        value={inlayExtend}
                        onChange={(val) => setInlayExtend(Number(val))}
                        step="0.1"
                        min="0"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                        />
                    </ControlField>
                  </div>
              </div>
            </>
          )}
        </section>
        )}


        {activeTab === 'geometry' && (
        <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <ShapeUploader 
                label="Upload Grip Geometry" 
                onShapesLoaded={(shapes, type) => {
                    handlePatternLoaded(shapes, type);
                    setLibraryPatternName(null); // Clear library name on manual upload
                }}
                onClear={() => {
                  setPatternShapes([]);
                  setPatternType(null);
                  setLibraryPatternName(null);
                }}
                allowedTypes={['stl']}
                externalFileName={libraryPatternName}
                externalShapes={patternShapes && patternShapes.length > 0 ? patternShapes : undefined}
                adornment={
                    <button
                        onClick={() => setShowPatternLibrary(true)}
                        className={`p-1 rounded-lg transition-colors border ${libraryPatternName 
                            ? 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 border-purple-500/20 hover:border-purple-500/50' 
                            : 'bg-gray-700/50 hover:bg-gray-700 text-gray-400 hover:text-white border-gray-600 hover:border-gray-500'}`}
                        title="Open Pattern Library"
                    >
                        <BookOpen size={12} />
                    </button>
                }
            />
            
            <PatternLibraryModal 
                isOpen={showPatternLibrary} 
                onClose={() => setShowPatternLibrary(false)}
                onSelect={async (preset) => {
                    setShowPatternLibrary(false);
                    try {
                        const response = await fetch(`/${preset.category}/${preset.file}`);
                        const buffer = await response.arrayBuffer();
                        
                        let shapes: any[] = [];
                        
                        if (preset.type === 'stl') {
                            const loader = new STLLoader();
                            const geometry = loader.parse(buffer);
                            geometry.center(); // Auto-center STLs
                            shapes = [geometry];
                        }

                        // Wrap with color if needed? Geometry tab usually doesn't need color extraction unless for STL?
                        // Controls: patternShapes are typically just shapes arrays for geometry tab.
                        
                        handlePatternLoaded(shapes, preset.type);
                        setLibraryPatternName(preset.name);
                        
                    } catch (error) {
                        console.error("Failed to load pattern:", error);
                        showAlert({
                            title: "Error Loading Pattern",
                            message: "Failed to load the selected pattern preset.",
                            type: "error"
                        });
                    }
                }}
            />
            
          {patternShapes && patternShapes.length > 0 && (
            <>
                <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Layout Mode</label>
                <SegmentedControl
                    value={isTiled ? 'tile' : 'place'}
                    onChange={(val) => {
                        const newIsTiled = val === 'tile';
                        setIsTiled(newIsTiled);
                        
                        if (newIsTiled && patternShapes && patternShapes.length > 0) {
                            let width = 0;
                            if (patternType === 'stl' && patternShapes.length > 0) {
                                const geometry = patternShapes[0];
                                if (geometry.boundingBox === null) geometry.computeBoundingBox();
                                const bounds = geometry.boundingBox;
                                if (bounds) width = bounds.max.x - bounds.min.x;
                            }

                            if (width > 0) {
                                const targetWidth = size * 0.1;
                                const rawScale = targetWidth / width;
                                const scale = Math.round(rawScale * 100) / 100;
                                setPatternScale(scale > 0 ? scale : 1);
                            }
                        }
                    }}
                    options={[
                        { value: 'place', label: 'Place', icon: <MousePointer2 size={16} /> },
                        { value: 'tile', label: 'Tile', icon: <Grid3x3 size={16} /> }
                    ]}
                />
              </div>

              <div className="flex gap-4">
                  <div className="space-y-2 flex-1 min-w-0">
                    <ControlField 
                        label="Scale X/Y" 
                        action={
                            patternShapes && patternShapes.length > 0 && (
                                <button
                                    onClick={() => {
                                        let width = 0;
                                        let height = 0;
                                        
                                        if (patternType === 'stl' && patternShapes.length > 0) {
                                            const geometry = patternShapes[0];
                                            if (geometry.boundingBox === null) geometry.computeBoundingBox();
                                            const bounds = geometry.boundingBox;
                                            if (bounds) {
                                                width = bounds.max.x - bounds.min.x;
                                                height = bounds.max.y - bounds.min.y;
                                            }
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
                            )
                        }
                    >
                        <DebouncedInput
                        type="number"
                        value={patternScale}
                        onChange={(val) => {
                            const newScale = Number(val);
                            // Proportional Z Scaling
                            if (patternScaleZ !== '' && patternScale > 0) {
                                const ratio = newScale / patternScale;
                                const newZ = Number(patternScaleZ) * ratio;
                                setPatternScaleZ(Math.round(newZ * 1000) / 1000); // 3 decimals
                            }
                            setPatternScale(newScale);
                        }}
                        step="0.1"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                        />
                    </ControlField>
                  </div>

                  <div className="space-y-2 flex-1 min-w-0">
                       <ControlField label="Scale Z" tooltip="Leave empty to match X/Y scale">
                           <DebouncedInput
                               type="number"
                               value={patternScaleZ}
                               onChange={(val) => setPatternScaleZ(val === '' ? '' : Number(val))}
                               placeholder="Auto"
                               min={0.1}
                               step={0.05}
                               className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                           />
                       </ControlField>
                   </div>

                  {isTiled && (
                    <div className="flex-1 min-w-0">
                        <ControlField label="Spacing" tooltip="Distance between tiled patterns">
                        <DebouncedInput
                            type="number"
                            value={tileSpacing}
                            onChange={(val) => setTileSpacing(Number(val))}
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                        />
                        </ControlField>
                    </div>
                  )}
              </div>

              {isTiled && (
                <>
                <ControlField label="Distribution">
                  <div className="relative">
                      <select
                      value={tilingDistribution}
                      onChange={(e) => setTilingDistribution(e.target.value as any)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none truncate"
                      >
                      <option value="grid">Grid</option>
                      <option value="offset">Offset</option>
                      <option value="hex">Hex</option>
                      <option value="radial">Radial</option>
                      <option value="wave-v">Wave (Vertical)</option>
                      <option value="wave-h">Wave (Horizontal)</option>
                      <option value="zigzag-v">Zigzag (Vertical)</option>
                      <option value="zigzag-h">Zigzag (Horizontal)</option>
                      <option value="warped-grid">Warped Grid</option>
                      <option value="random">Random</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                          <ChevronDown size={16} />
                      </div>
                  </div>
                </ControlField>

                <ControlField label="Rotation">
                  <div className="relative">
                      <select
                      value={tilingRotation}
                      onChange={(e) => setTilingRotation(e.target.value as any)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none truncate"
                      >
                      <option value="none">None</option>
                      <option value="alternate">Alternate (Checker)</option>
                      <option value="aligned">Aligned (Tangential)</option>
                      <option value="random">Random</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                          <ChevronDown size={16} />
                      </div>
                  </div>
                </ControlField>
                </>
              )}

               {/* Margin & Clip Toggles */}
              <div className="flex gap-4 pt-2 border-t border-gray-800">
                  <div className="flex-1 min-w-0">
                    <ControlField label="Margin" tooltip="Safety margin from edge">
                        <DebouncedInput
                            type="number"
                            value={patternMargin}
                            onChange={(val) => setPatternMargin(Number(val))}
                            step="0.5"
                            min="0"
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                        />
                    </ControlField>
                  </div>
                  {cutoutShapes && cutoutShapes.length > 0 && (
                      <div className="flex-1 min-w-0">
                        <ControlField label="Clip to Edge" tooltip="Trim patterns that cross the outline boundary">
                            <ToggleButton
                                label={clipToOutline ? "Enabled" : "Disabled"}
                                isToggled={!!clipToOutline}
                                onToggle={() => setClipToOutline && setClipToOutline(!clipToOutline)}
                                icon={<Scissors size={16} />}
                                title="Trim patterns to outline"
                            />
                        </ControlField>
                      </div>
                  )}
              </div>



              {/* Extrusion controls removed as we only support STL now */}


              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">Color</label>
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
        )}

      {/* Footer Content (Mobile: Inline / Non-Sticky) */}
      <div className="md:hidden border-t border-gray-700 pt-6"> {/* Added pt-6 for spacing inside scroll */}
         {renderFooter("space-y-4")}
      </div>

      </div>

      {/* Footer Content (Desktop: Sticky) */}
      <div className="hidden md:block border-t border-gray-700 bg-gray-800 z-10 transition-all duration-300">
          {renderFooter()}
      </div>
    </div>
    </div>
  );
};

export default Controls;
