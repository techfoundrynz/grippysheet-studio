import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera, Line } from '@react-three/drei';
import { InlayInteractionHandles } from './interaction/InlayInteractionHandles';
import { Box, Layers, ScanLine, Activity, Ghost, Camera as CameraIcon, Palette, Scissors } from 'lucide-react';
import * as THREE from 'three';
import ScreenshotModal from './ScreenshotModal';
import { ErrorBoundary } from './ErrorBoundary';
import ImperativeModel from './ImperativeModel';
import Spinner from './Spinner';
import { BaseSettings, InlaySettings, GeometrySettings } from '../types/schemas';
import type { ColorFlowSettings } from '../colorflow/schema';
import CameraRig, { ViewState } from './CameraRig';
import FpsTracker from './FpsTracker';
import ScreenshotManager from './ScreenshotManager';
import { ColorFlowModel } from '../colorflow/ColorFlowModel';
import { TwoDViewer } from '../colorflow/TwoDViewer';
import { shapeToPolygon, transformOutlinePolygon, type OutlinePolygon } from '../colorflow/outlineToPolygon';
import type { Centroid } from '../colorflow/pipeline/quantize';
import type { ExtrudedGeometry } from '../colorflow/pipeline/extrude';
import { eventBus } from '../utils/eventBus';

interface ModelViewerProps {
  mode?: 'pattern' | 'colorflow';
  baseSettings: BaseSettings;
  inlaySettings: InlaySettings;
  geometrySettings: GeometrySettings;
  meshRef: React.RefObject<THREE.Group | null>;
  onInlayChange?: (settings: InlaySettings) => void;
  selectedInlayId?: string | null;
  setSelectedInlayId?: (id: string | null) => void;
  previewInlay?: any;
  setPreviewInlay?: (item: any) => void;
  activeTab?: string;
  colorFlowGeom?: {
    base: ExtrudedGeometry;
    layers: { centroid: Centroid; position: number; geom: ExtrudedGeometry }[];
    spikes: { centroidIndex: number; geom: ExtrudedGeometry; color: string }[];
    source?: {
      layersInMm: import('../colorflow/workerProtocol').TracedLayerEntry[];
      palette: Centroid[];
      stackOrder: number[];
    };
  } | null;
  colorFlowSettings: ColorFlowSettings;
}

const ModelViewer: React.FC<ModelViewerProps> = ({
  mode = 'pattern',
  baseSettings,
  inlaySettings,
  geometrySettings,
  meshRef,
  onInlayChange,
  activeTab = 'base',
  selectedInlayId,
  setSelectedInlayId,
  previewInlay,
  setPreviewInlay,
  colorFlowGeom,
  colorFlowSettings
}) => {
  const { size, thickness, color, cutoutShapes, baseOutlineRotation, baseOutlineMirror } = baseSettings;
  

// ... (skipping unchanged parts) ...



  const {
      patternShapes, patternType, patternScale, patternScaleZ,
      isTiled, tileSpacing, patternMargin, 
      tilingDistribution, tilingDirection, tilingOrientation,
      clipToOutline, debugMode, patternColor: geomPatternColor, rotationClamp,
      holeMode
  } = geometrySettings;

  // Default to the lightweight 2D top-down preview. Users opt into 3D when
  // they want a rendered look — saves GPU + main-thread work otherwise.
  const [renderMode, setRenderMode] = useState<'2d' | '3d'>('2d');
  const [viewState, setViewState] = useState<ViewState>({ type: 'ortho', timestamp: Date.now() });
  const [cameraType, setCameraType] = useState<'perspective' | 'orthographic'>('orthographic');

  // Initial sync
  useEffect(() => {
     if (viewState.type === 'ortho') setCameraType('orthographic');
     else setCameraType('perspective');
  }, []); 

  const [outlineState, setOutlineState] = useState({ base: false, inlay: false, pattern: false });
  const [wireframeState, setWireframeState] = useState({ base: false, inlay: false, pattern: false });
  const [showOutlinesMenu, setShowOutlinesMenu] = useState(false);
  const [showWireframeMenu, setShowWireframeMenu] = useState(false);
  
  const [showFps, setShowFps] = useState(true);
  const [baseOpacity, setBaseOpacity] = useState(1.0);
  const [inlayOpacity, setInlayOpacity] = useState(1.0);
  const [patternOpacity, setPatternOpacity] = useState(1.0);
  const [showOpacityMenu, setShowOpacityMenu] = useState(false);
  const [displayMode, setDisplayMode] = useState<'normal' | 'toon'>('normal');
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const [debugState, setDebugState] = useState({ pattern: false, holes: false, inlay: false });
  const [showDebugMenu, setShowDebugMenu] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  // Global processing keys → label. UI shows spinner if non-empty.
  const [processingMap, setProcessingMap] = useState<Map<string, string>>(() => new Map());
  const processingMapRef = React.useRef(processingMap);
  processingMapRef.current = processingMap;

  useEffect(() => {
    return eventBus.on('processing', (e: { key: string; busy: boolean; label?: string }) => {
      const next = new Map(processingMapRef.current);
      if (e.busy) next.set(e.key, e.label ?? '');
      else next.delete(e.key);
      setProcessingMap(next);
    });
  }, []);

  const activeLabels = Array.from(processingMap.values()).filter((l) => l.length > 0);
  const isAnyProcessing = isProcessing || processingMap.size > 0;

  // Outline polygon (with Base rotation/mirror applied) — used by the 2D
  // preview viewer. Recomputed only when the relevant inputs change.
  const outlinePolygon2D = React.useMemo<OutlinePolygon | null>(() => {
    if (!cutoutShapes || cutoutShapes.length === 0) return null;
    const raw = shapeToPolygon(cutoutShapes[0], 64);
    return transformOutlinePolygon(raw, baseOutlineRotation ?? 0, !!baseOutlineMirror);
  }, [cutoutShapes, baseOutlineRotation, baseOutlineMirror]);

  // Pad-dimension readout. Use the loaded outline's bbox; fall back to the
  // configured square `size` when no outline is set.
  const padDims = React.useMemo(() => {
    if (cutoutShapes && cutoutShapes.length > 0) {
      const pts = cutoutShapes[0].getPoints(32);
      if (pts.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of pts) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        return { w: maxX - minX, h: maxY - minY, fromOutline: true };
      }
    }
    return { w: size, h: size, fromOutline: false };
  }, [cutoutShapes, size]);
  const fpsRef = React.useRef<HTMLDivElement>(null);
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);
  const captureRef = React.useRef<((bgColor: string | null) => void) | null>(null);
  const opacityMenuRef = React.useRef<HTMLDivElement>(null);
  const displayMenuRef = React.useRef<HTMLDivElement>(null);
  const outlinesMenuRef = React.useRef<HTMLDivElement>(null);
  const wireframeMenuRef = React.useRef<HTMLDivElement>(null);
  const debugMenuRef = React.useRef<HTMLDivElement>(null);
  const orbitRef = React.useRef<any>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Toggle OrbitControls based on dragging state
  useEffect(() => {
    if (orbitRef.current) {
        orbitRef.current.enabled = !isDragging;
    }
  }, [isDragging]);


  const handleCapture = (bgColor: string | null) => {
      if (captureRef.current) {
          captureRef.current(bgColor);
          setShowScreenshotModal(false);
      }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (opacityMenuRef.current && !opacityMenuRef.current.contains(event.target as Node)) {
        setShowOpacityMenu(false);
      }
      if (displayMenuRef.current && !displayMenuRef.current.contains(event.target as Node)) {
        setShowDisplayMenu(false);
      }
      if (outlinesMenuRef.current && !outlinesMenuRef.current.contains(event.target as Node)) {
        setShowOutlinesMenu(false);
      }
      if (wireframeMenuRef.current && !wireframeMenuRef.current.contains(event.target as Node)) {
        setShowWireframeMenu(false);
      }
      if (debugMenuRef.current && !debugMenuRef.current.contains(event.target as Node)) {
        setShowDebugMenu(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [opacityMenuRef, displayMenuRef, outlinesMenuRef, wireframeMenuRef, debugMenuRef]);


  return (
    <div
      className="w-full h-full rounded-lg overflow-hidden border border-gray-800 relative group"
      style={{
        // Mirror the 2D canvas atmosphere — near-black base with warm/cool
        // radial blooms — so the viewer reads as a "lit surface" regardless
        // of which mode (2D/3D) is active.
        background: '#07090c',
        backgroundImage: [
          'radial-gradient(circle at 18% 22%, rgba(255, 107, 26, 0.10), transparent 55%)',
          'radial-gradient(circle at 85% 85%, rgba(0, 212, 255, 0.06), transparent 55%)',
        ].join(', '),
      }}
    >
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-row items-center gap-2 p-1.5 bg-gray-900/85 backdrop-blur-md rounded-xl border border-gray-700/60 shadow-xl ring-1 ring-black/30">

        {/* 2D / 3D mode toggle — bigger pill with animated active indicator
            so it reads as the primary viewer control, not chrome. */}
        <div className="relative inline-flex bg-gray-950/60 rounded-lg p-0.5 text-xs font-display font-semibold tracking-wide">
          <button
            onClick={() => setRenderMode('2d')}
            className={`relative z-10 px-3.5 py-1.5 rounded-md transition-colors ${renderMode === '2d' ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
            title="2D top-down preview — lightweight, always live"
          >2D</button>
          <button
            onClick={() => setRenderMode('3d')}
            className={`relative z-10 px-3.5 py-1.5 rounded-md transition-colors ${renderMode === '3d' ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
            title="Full 3D render — orbit, ortho, iso views"
          >3D</button>
          {/* Sliding active indicator. */}
          <span
            className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-md bg-gradient-to-br from-brand-500 to-accent-500 shadow-glow-brand transition-transform duration-200 ease-out"
            style={{ transform: renderMode === '2d' ? 'translateX(2px)' : 'translateX(calc(100% + 2px))' }}
          />
        </div>

        <div className="w-px bg-gray-700 mx-1" />

        <button
          onClick={() => setViewState({ type: 'ortho', timestamp: Date.now() })}
          disabled={renderMode === '2d'}
          className={`p-2 rounded hover:bg-gray-700 transition-colors ${viewState.type === 'ortho' && renderMode === '3d' ? 'bg-brand-500/15 text-brand-400' : 'text-gray-400'} disabled:opacity-30 disabled:cursor-not-allowed`}
          title="Orthographic View"
        >
          <Layers size={20} />
        </button>
        <button
          onClick={() => setViewState({ type: 'iso', timestamp: Date.now() })}
          disabled={renderMode === '2d'}
          className={`p-2 rounded hover:bg-gray-700 transition-colors ${viewState.type === 'iso' && renderMode === '3d' ? 'bg-brand-500/15 text-brand-400' : 'text-gray-400'} disabled:opacity-30 disabled:cursor-not-allowed`}
          title="Isometric View"
        >
          <Box size={20} />
        </button>



        {debugMode && renderMode === '3d' && (
          <>
            <div className="w-px bg-gray-700 mx-1" />
            
            <div className="relative" ref={outlinesMenuRef}>
                <button
                onClick={() => setShowOutlinesMenu(!showOutlinesMenu)}
                className={`p-2 rounded hover:bg-gray-700 transition-colors ${Object.values(outlineState).some(v => v) ? 'bg-green-500/20 text-green-400' : 'text-gray-400'}`}
                title="Toggle Outlines"
                >
                <ScanLine size={20} />
                </button>
                
                {showOutlinesMenu && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-gray-800 border border-gray-700 rounded shadow-lg p-2 z-50 min-w-[160px] flex flex-col gap-1">
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={outlineState.base} 
                                onChange={(e) => setOutlineState(prev => ({...prev, base: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-green-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Grip Shape</span>
                        </label>
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={outlineState.inlay} 
                                onChange={(e) => setOutlineState(prev => ({...prev, inlay: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-green-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Inlay</span>
                        </label>
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={outlineState.pattern} 
                                onChange={(e) => setOutlineState(prev => ({...prev, pattern: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-green-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Pattern</span>
                        </label>
                    </div>
                )}
            </div>

            <div className="relative" ref={wireframeMenuRef}>
                <button
                    onClick={() => setShowWireframeMenu(!showWireframeMenu)}
                    className={`p-2 rounded hover:bg-gray-700 transition-colors ${Object.values(wireframeState).some(v => v) ? 'bg-yellow-500/20 text-yellow-400' : 'text-gray-400'}`}
                    title="Toggle Wireframe"
                >
                    <Box size={20} className="stroke-[1.5]" />
                </button>

                {showWireframeMenu && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-gray-800 border border-gray-700 rounded shadow-lg p-2 z-50 min-w-[160px] flex flex-col gap-1">
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={wireframeState.base} 
                                onChange={(e) => setWireframeState(prev => ({...prev, base: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-yellow-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Grip Shape</span>
                        </label>
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={wireframeState.inlay} 
                                onChange={(e) => setWireframeState(prev => ({...prev, inlay: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-yellow-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Inlay</span>
                        </label>
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={wireframeState.pattern} 
                                onChange={(e) => setWireframeState(prev => ({...prev, pattern: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-yellow-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Pattern</span>
                        </label>
                    </div>
                )}
            </div>

            <div className="relative" ref={debugMenuRef}>
                <button
                    onClick={() => setShowDebugMenu(!showDebugMenu)}
                    className={`p-2 rounded hover:bg-gray-700 transition-colors ${Object.values(debugState).some(v => v) ? 'bg-red-500/20 text-red-400' : 'text-gray-400'}`}
                    title="Toggle Cutting Zones"
                >
                    <Scissors size={20} />
                </button>

                {showDebugMenu && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-gray-800 border border-gray-700 rounded shadow-lg p-2 z-50 min-w-[200px] flex flex-col gap-1">
                        <button
                            onClick={() => setDebugState(prev => ({...prev, pattern: !prev.pattern}))}
                            className={`w-full text-left px-3 py-2 rounded transition-colors text-sm flex items-center gap-2 ${
                                debugState.pattern 
                                    ? 'bg-brand-500/15 text-brand-400' 
                                    : 'text-gray-300 hover:bg-gray-700'
                            }`}
                        >
                            <span>Pattern Cutter</span>
                        </button>
                        
                        <button
                            onClick={() => setDebugState(prev => ({...prev, inlay: !prev.inlay}))}
                             className={`w-full text-left px-3 py-2 rounded transition-colors text-sm flex items-center gap-2 ${
                                debugState.inlay 
                                    ? 'bg-green-500/20 text-green-400' 
                                    : 'text-gray-300 hover:bg-gray-700'
                            }`}
                        >
                            <span>Inlay Cutter</span>
                        </button>
                        
                        <button
                            onClick={() => setDebugState(prev => ({...prev, holes: !prev.holes}))}
                             className={`w-full text-left px-3 py-2 rounded transition-colors text-sm flex items-center gap-2 ${
                                debugState.holes 
                                    ? 'bg-red-500/20 text-red-400' 
                                    : 'text-gray-300 hover:bg-gray-700'
                            }`}
                        >
                            <span>Hole Cutter</span>
                        </button>
                    </div>
                )}
            </div>
          </>
        )}
        
        <div className="w-px bg-gray-700 mx-1" />

        <button
            onClick={() => setShowFps(!showFps)}
            className={`p-2 rounded hover:bg-gray-700 transition-colors ${showFps ? 'bg-signal-info/15 text-signal-info' : 'text-gray-400'}`}
            title="Toggle FPS Counter"
        >
            <Activity size={20} />
        </button> 
        <div className="relative" ref={opacityMenuRef}>
            <button
            onClick={() => setShowOpacityMenu(!showOpacityMenu)}
            className={`flex items-center gap-2 p-2 rounded hover:bg-gray-700 transition-colors ${patternOpacity < 1 ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-400'}`}
            title="Grip Geometry Opacity"
            >
            <Ghost size={20} />
            </button>
            
            {showOpacityMenu && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-gray-800 border border-gray-700 rounded shadow-lg p-4 z-50 min-w-[200px] flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Base Opacity</span>
                            <span>{Math.round(baseOpacity * 100)}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={baseOpacity * 100} 
                            onChange={(e) => setBaseOpacity(parseInt(e.target.value) / 100)}
                            className="w-full accent-indigo-500 bg-gray-700 rounded-lg appearance-none h-2 cursor-pointer"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Inlay Opacity</span>
                            <span>{Math.round(inlayOpacity * 100)}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={inlayOpacity * 100} 
                            onChange={(e) => setInlayOpacity(parseInt(e.target.value) / 100)}
                            className="w-full accent-indigo-500 bg-gray-700 rounded-lg appearance-none h-2 cursor-pointer"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Pattern Opacity</span>
                            <span>{Math.round(patternOpacity * 100)}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={patternOpacity * 100} 
                            onChange={(e) => setPatternOpacity(parseInt(e.target.value) / 100)}
                            className="w-full accent-indigo-500 bg-gray-700 rounded-lg appearance-none h-2 cursor-pointer"
                        />
                    </div>
                </div>
            )}
        </div>  
        <div className="relative" ref={displayMenuRef}>
            <button
            onClick={() => setShowDisplayMenu(!showDisplayMenu)}
            className={`flex items-center gap-2 p-2 rounded hover:bg-gray-700 transition-colors ${displayMode === 'toon' ? 'bg-pink-500/20 text-pink-400' : 'text-gray-400'}`}
            title="Display Mode"
            >
            <Palette size={20} />
            </button>
            
            {showDisplayMenu && (
                <div className="absolute top-full right-0 mt-2 bg-gray-800 border border-gray-700 rounded shadow-lg overflow-hidden whitespace-nowrap z-50 flex flex-col min-w-[100px]">
                    <button 
                        className={`text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors ${displayMode === 'normal' ? 'bg-brand-500/15 text-brand-400' : 'text-gray-300'}`}
                        onClick={() => { setDisplayMode('normal'); setShowDisplayMenu(false); }}
                    >
                        Normal
                    </button>
                    <button 
                        className={`text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors ${displayMode === 'toon' ? 'bg-pink-500/20 text-pink-400' : 'text-gray-300'}`}
                        onClick={() => { setDisplayMode('toon'); setShowDisplayMenu(false); }}
                    >
                        Toon
                    </button>
                </div>
            )}
        </div>     
        <button
            onClick={() => setShowScreenshotModal(true)}
            className="p-2 rounded hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
            title="Screenshot"
        >
            <CameraIcon size={20} />
        </button>
      </div>

      {isAnyProcessing && (
          <div className="absolute top-4 right-4 z-20 flex items-center gap-2 p-2 bg-gray-800/80 backdrop-blur rounded-lg border border-gray-700 text-brand-400">
             <Spinner size={20} />
             {activeLabels.length > 0 && (
               <span className="text-[11px] uppercase tracking-wider text-brand-300">{activeLabels.join(' · ')}</span>
             )}
          </div>
      )}

      {(() => {
        // Empty-state guidance overlay — only in 3D mode. The 2D canvas
        // paints its own hero empty state (ghost deck silhouette + headline)
        // so the overlay would double up.
        const hasBase = !!(cutoutShapes && cutoutShapes.length > 0);
        const hasColorFlow = mode === 'colorflow' && !!colorFlowGeom;
        if (hasBase || hasColorFlow || isAnyProcessing || renderMode === '2d') return null;
        return (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="bg-gray-900/85 backdrop-blur border border-gray-700 rounded-lg px-5 py-4 text-center max-w-sm">
              <p className="text-sm text-gray-200 font-medium">Pick a base outline to start</p>
              <p className="text-[11px] text-gray-400 mt-1">
                Use the <span className="text-brand-400">Base tab</span> → Outline Library — or upload your own DXF.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Consolidated bottom-right info chip — pad size + (optional) FPS in
          one panel. Skipped entirely in 2D since TwoDViewer paints its own
          pad-dim chip into the canvas overlay. The FPS counter is kept here
          (separate ref) so FpsTracker can mutate textContent without React. */}
      {renderMode === '3d' && (
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 px-2.5 py-1 bg-gray-900/70 backdrop-blur-sm border border-gray-700/60 rounded-md text-[11px] font-mono tabular-nums pointer-events-none select-none shadow-lg">
          <span className={padDims.fromOutline ? 'text-gray-200' : 'text-gray-500'}>
            <span className="text-gray-500">pad </span>
            {padDims.w.toFixed(1)} × {padDims.h.toFixed(1)} mm
          </span>
          {showFps && (
            <>
              <span className="text-gray-700">·</span>
              <span ref={fpsRef} className="text-signal-ready font-semibold w-14 text-right">0 FPS</span>
            </>
          )}
        </div>
      )}

      {/* Initial-Canvas-load veil — disappears once the renderer reports
          `onCreated`. Avoids a black flash on first paint. Skipped in 2D mode
          since the Three.js Canvas doesn't mount until the user opts in. */}
      {!canvasReady && renderMode === '3d' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm pointer-events-none">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-300">
            <Spinner size={16} />
            <span>Initializing 3D viewer…</span>
          </div>
        </div>
      )}

      {renderMode === '2d' && (
        <TwoDViewer
          outlinePolygon={outlinePolygon2D}
          layersInMm={colorFlowGeom?.source?.layersInMm ?? []}
          palette={colorFlowGeom?.source?.palette ?? []}
          stackOrder={colorFlowGeom?.source?.stackOrder ?? []}
          inlayItems={colorFlowGeom ? undefined : inlaySettings.items}
          geometrySettings={geometrySettings}
          baseColor={color}
          spikeColorMatch={colorFlowSettings.spikeColorMatch}
        />
      )}

      <ErrorBoundary>
      <div className={renderMode === '3d' ? 'absolute inset-0' : 'hidden'}>
      <Canvas shadows onCreated={() => setCanvasReady(true)}>
        <OrthographicCamera makeDefault={cameraType === 'orthographic'} position={[0, -1, 1000]} near={-2000} far={2000} up={[0, 0, 1]} />
        <PerspectiveCamera makeDefault={cameraType === 'perspective'} position={[500, -500, 500]} near={0.1} far={5000} up={[0, 0, 1]} fov={45} />
        
        {showFps && <FpsTracker fpsRef={fpsRef as React.RefObject<HTMLDivElement>} />}
        <ScreenshotManager triggerRef={captureRef} size={size} />
        <CameraRig viewState={viewState} size={size} setCameraType={setCameraType} />
        <OrbitControls 
            ref={orbitRef}
            makeDefault 
            mouseButtons={{
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.PAN,
                RIGHT: THREE.MOUSE.PAN
            }}
        />
        <ambientLight intensity={0.5} />
        <directionalLight position={[100, -50, 100]} intensity={1} castShadow={false} />
        
            {/* Route to ColorFlowModel in colorflow mode, ImperativeModel in pattern mode */}
            {mode === 'colorflow' ? (
              <ColorFlowModel
                ref={meshRef}
                baseGeom={colorFlowGeom?.base ?? null}
                layers={colorFlowGeom?.layers ?? []}
                spikes={colorFlowGeom?.spikes ?? []}
                displayMode={displayMode}
                baseColor={color}
              />
            ) : (
              <ImperativeModel
                ref={meshRef}
                size={size}
                thickness={thickness}
                color={color}
                cutoutShapes={cutoutShapes}
                baseOutlineRotation={baseOutlineRotation}
                baseOutlineMirror={baseOutlineMirror}
                patternColor={geomPatternColor}
                patternShapes={patternShapes}
                patternType={patternType}
                patternScale={patternScale}
                patternScaleZ={patternScaleZ === '' ? undefined : Number(patternScaleZ)}
                isTiled={isTiled}
                tileSpacing={tileSpacing}
                patternMargin={patternMargin}
                tilingDistribution={tilingDistribution}
                tilingDirection={tilingDirection}
                tilingOrientation={tilingOrientation}
                baseRotation={geometrySettings.baseRotation}
                rotationClamp={rotationClamp}
                patternMaxHeight={geometrySettings.patternMaxHeight === '' ? undefined : Number(geometrySettings.patternMaxHeight)}
                clipToOutline={clipToOutline}
                holeMode={holeMode}

                inlayItems={inlaySettings.items}


                wireframeBase={wireframeState.base}
                wireframeInlay={wireframeState.inlay}
                wireframePattern={wireframeState.pattern}
                baseOpacity={baseOpacity}
                inlayOpacity={inlayOpacity}
                patternOpacity={patternOpacity}
                displayMode={displayMode}
                onProcessingChange={setIsProcessing}
                debugShowPatternCutter={debugState.pattern}
                debugShowInlayCutter={debugState.inlay}
                debugShowHoleCutter={debugState.holes}
                isDragging={isDragging}
                previewInlay={previewInlay}
              />
            )}

        {mode === 'pattern' && activeTab === 'inlay' && onInlayChange && (
            <InlayInteractionHandles
                baseSettings={baseSettings}
                inlaySettings={inlaySettings}
                onInlayChange={onInlayChange}
                setIsDragging={setIsDragging}
                thickness={thickness}
                selectedInlayId={selectedInlayId || null}
                setSelectedInlayId={setSelectedInlayId}
                setPreviewInlay={setPreviewInlay}
                cutoutShapes={cutoutShapes}
            />
        )}
        
        {outlineState.base && cutoutShapes && cutoutShapes.length > 0 && (
             (() => {
                const shape = cutoutShapes[0];
                const rawPoints = shape.getPoints();
                 // 1. Mirror
                let pts = baseOutlineMirror ? rawPoints.map(p => new THREE.Vector2(-p.x, p.y)) : rawPoints;
                
                 // 2. Rotate
                if (baseOutlineRotation) {
                    const rad = baseOutlineRotation * (Math.PI / 180);
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    pts = pts.map(p => new THREE.Vector2(
                        p.x * cos - p.y * sin,
                        p.x * sin + p.y * cos
                    ));
                }

                return (
                    <Line
                    points={pts} 
                    color="#4ade80"
                    lineWidth={2}
                    position={[0, 0, thickness + 0.1]}
                    scale={[1, 1, 1]}
                    />
                );
             })()
        )}

        {outlineState.inlay && inlaySettings.items && inlaySettings.items.length > 0 && inlaySettings.items.map((item, itemIdx) => {
             // Calculate effective position for the outline
             // We use the item's x/y directly as we did in ImperativeModel
             const dx = item.x || 0;
             const dy = item.y || 0;
             
             const shapeList = item.shapes || [];
             
             return shapeList.map((shapeParams: any, shapeIdx: number) => {
                const shape = shapeParams.shape || shapeParams;
                const rawPoints = shape.getPoints();
                
                // 1. Mirror
                // Mirroring flips X. 
                let points = item.mirror 
                    ? rawPoints.map((p: THREE.Vector2) => new THREE.Vector2(-p.x, p.y)) 
                    : rawPoints;

                // 2. We can't use simple <Line> rotation prop because we need to apply it around the center 
                // BEFORE translation.
                // Actually <Line> rotation rotates around the object's origin. 
                // If we set position=[dx, dy], rotation will rotate around (dx, dy) which is what we want 
                // IF the geometry is centered at 0,0.
                
                // However, mirroring reverses winding order which might not matter for a Line,
                // but if we mirror points manually, we are good.
                
                return (
                <Line
                    key={`inlay-outline-${item.id}-${shapeIdx}`}
                    points={points} 
                    color="#4ade80"
                    lineWidth={2}
                    position={[dx, dy, thickness + 0.1 + ((itemIdx + 1) * 0.001)]}
                    scale={[item.scale, item.scale, 1]}
                    rotation={[0, 0, item.rotation * (Math.PI / 180)]}
                />
                );
             });
        })}

        {outlineState.pattern && patternShapes && patternShapes.length > 0 && patternShapes[0] instanceof THREE.Shape && (
             <Line
                points={patternShapes[0].getPoints()} 
                color="#4ade80"
                lineWidth={2}
                position={[0, 0, thickness + 0.2]}
            />
        )}

        {/* Rotate GridHelper 90deg X to lie on XY plane. Args 2/3 set the
            center axis colour + grid line colour — picked to disappear into
            the new dark backdrop instead of fighting it. */}
        <gridHelper args={[2000, 20, 0x1a2030, 0x14181f]} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} />
      </Canvas>
      </div>
      </ErrorBoundary>
      <ScreenshotModal 
         isOpen={showScreenshotModal} 
         onClose={() => setShowScreenshotModal(false)}
         onCapture={handleCapture}
      />
    </div>
  );
};

export default ModelViewer;
