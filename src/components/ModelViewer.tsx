import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera, Line } from '@react-three/drei';
import { Box, Layers, ScanLine, Activity, Ghost, RotateCcw, Camera as CameraIcon, Palette } from 'lucide-react';
import * as THREE from 'three';
import ScreenshotModal from './ScreenshotModal';
import ImperativeModel from './ImperativeModel';
import Spinner from './Spinner';

interface ModelViewerProps {
  size: number;
  thickness: number;
  color: string;
  patternColor: string;
  meshRef: React.RefObject<THREE.Group>;
  cutoutShapes: THREE.Shape[] | null;
  patternShapes: any[] | null;
  patternType: 'dxf' | 'svg' | 'stl' | null;
  patternScale: number;
  patternScaleZ?: number;
  isTiled: boolean;
  tileSpacing: number;
  patternMargin: number;
  tilingDistribution?: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave-v' | 'wave-h' | 'zigzag-v' | 'zigzag-h' | 'warped-grid';
  tilingRotation?: 'none' | 'alternate' | 'random' | 'aligned';
  clipToOutline?: boolean;
  debugMode?: boolean;
  inlayShapes?: any[] | null;
  inlayDepth?: number;
  inlayScale?: number;
  inlayExtend?: number;
}

import CameraRig, { ViewState } from './CameraRig';
import FpsTracker from './FpsTracker';
import ScreenshotManager from './ScreenshotManager';



const ModelViewer: React.FC<ModelViewerProps> = ({ 
  size, 
  thickness, 
  color, 
  patternColor,
  meshRef, 
  cutoutShapes,
  patternShapes,
  patternType,
  patternScale,
  patternScaleZ,
  isTiled,
  tileSpacing,
  patternMargin,
  tilingDistribution = 'hex',
  tilingRotation = 'none',
  clipToOutline = false,
  debugMode = false,
  inlayShapes,
  inlayDepth = 0.6,
  inlayScale = 1,
  inlayExtend = 0
}) => {

  const [viewState, setViewState] = useState<ViewState>({ type: 'ortho', timestamp: Date.now() });
  const [cameraType, setCameraType] = useState<'perspective' | 'orthographic'>('orthographic');

  // Initial sync
  useEffect(() => {
     if (viewState.type === 'ortho') setCameraType('orthographic');
     else setCameraType('perspective');
     // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  const [outlineState, setOutlineState] = useState({ base: false, inlay: false, pattern: false });
  const [wireframeState, setWireframeState] = useState({ base: false, inlay: false, pattern: false });
  const [showOutlinesMenu, setShowOutlinesMenu] = useState(false);
  const [showWireframeMenu, setShowWireframeMenu] = useState(false);
  
  const [showFps, setShowFps] = useState(true);
  const [patternOpacity, setPatternOpacity] = useState(1.0);
  const [showOpacityMenu, setShowOpacityMenu] = useState(false);
  const [displayMode, setDisplayMode] = useState<'normal' | 'toon'>('normal');
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fpsRef = React.useRef<HTMLDivElement>(null);
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);
  const captureRef = React.useRef<((bgColor: string | null) => void) | null>(null);
  const opacityMenuRef = React.useRef<HTMLDivElement>(null);
  const displayMenuRef = React.useRef<HTMLDivElement>(null);
  const outlinesMenuRef = React.useRef<HTMLDivElement>(null);
  const wireframeMenuRef = React.useRef<HTMLDivElement>(null);

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
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [opacityMenuRef, displayMenuRef, outlinesMenuRef, wireframeMenuRef]);


  return (
    <div className="w-full h-full bg-gray-900 rounded-lg overflow-hidden border border-gray-800 relative group">
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-row gap-2 p-2 bg-gray-800/80 backdrop-blur rounded-lg border border-gray-700">


        <button
          onClick={() => setViewState({ type: 'ortho', timestamp: Date.now() })}
          className={`p-2 rounded hover:bg-gray-700 transition-colors ${viewState.type === 'ortho' ? 'bg-blue-500/20 text-blue-400' : 'text-gray-400'}`}
          title="Orthographic View"
        >
          <Layers size={20} />
        </button>
        <button
          onClick={() => setViewState({ type: 'iso', timestamp: Date.now() })}
          className={`p-2 rounded hover:bg-gray-700 transition-colors ${viewState.type === 'iso' ? 'bg-blue-500/20 text-blue-400' : 'text-gray-400'}`}
          title="Isometric View"
        >
          <Box size={20} />
        </button>
        <button
          onClick={() => setViewState(prev => ({ ...prev, timestamp: Date.now() }))}
          className="p-2 rounded hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
          title="Reset View"
        >
          <RotateCcw size={20} />
        </button>

        {debugMode && (
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
          </>
        )}
        
        <div className="w-px bg-gray-700 mx-1" />

        <button
            onClick={() => setShowFps(!showFps)}
            className={`p-2 rounded hover:bg-gray-700 transition-colors ${showFps ? 'bg-purple-500/20 text-purple-400' : 'text-gray-400'}`}
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
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-gray-800 border border-gray-700 rounded shadow-lg p-4 z-50 min-w-[200px]">
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Opacity</span>
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
                        className={`text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors ${displayMode === 'normal' ? 'bg-blue-500/20 text-blue-400' : 'text-gray-300'}`}
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

      {isProcessing && (
          <div className="absolute top-4 right-4 z-20 p-2 bg-gray-800/80 backdrop-blur rounded-lg border border-gray-700 text-blue-400">
             <Spinner size={24} />
          </div>
      )}

      {showFps && (
        <div 
          ref={fpsRef}
          className="absolute bottom-4 right-4 z-10 p-2 bg-gray-800/80 backdrop-blur rounded-lg border border-gray-700 text-purple-400 tabular-nums text-sm font-bold pointer-events-none select-none w-20 text-center"
        >
          0 FPS
        </div>
      )}

      <Canvas shadows>
        <OrthographicCamera makeDefault={cameraType === 'orthographic'} position={[0, -1, 1000]} near={-2000} far={2000} up={[0, 0, 1]} />
        <PerspectiveCamera makeDefault={cameraType === 'perspective'} position={[500, -500, 500]} near={0.1} far={5000} up={[0, 0, 1]} fov={45} />
        
        {showFps && <FpsTracker fpsRef={fpsRef as React.RefObject<HTMLDivElement>} />}
        <ScreenshotManager triggerRef={captureRef} size={size} />
        <CameraRig viewState={viewState} size={size} setCameraType={setCameraType} />
        <OrbitControls 
            makeDefault 
            mouseButtons={{
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.PAN,
                RIGHT: THREE.MOUSE.PAN
            }}
        />
        <ambientLight intensity={0.5} />
        <directionalLight position={[100, -50, 100]} intensity={1} castShadow={false} />
        
            {/* Imperative Model handles Base, Inlays, and Patterns */}
            <ImperativeModel 
                ref={meshRef}
                size={size}
                thickness={thickness}
                color={color}
                patternColor={patternColor}
                cutoutShapes={cutoutShapes}
                patternShapes={patternShapes}
                patternType={patternType}
                // extrusionAngle and patternHeight removed for STL-only mode
                patternScale={patternScale}
                patternScaleZ={patternScaleZ}
                isTiled={isTiled}
                tileSpacing={tileSpacing}
                patternMargin={patternMargin}
                tilingDistribution={tilingDistribution}
                tilingRotation={tilingRotation}
                clipToOutline={clipToOutline}
                inlayShapes={inlayShapes}
                inlayDepth={inlayDepth}
                inlayScale={inlayScale}
                inlayExtend={inlayExtend}
                wireframeBase={wireframeState.base}
                wireframeInlay={wireframeState.inlay}
                wireframePattern={wireframeState.pattern}
                patternOpacity={patternOpacity}
                displayMode={displayMode}
                onProcessingChange={setIsProcessing}
            />
        
        {outlineState.base && cutoutShapes && cutoutShapes.length > 0 && (
            <Line
            points={cutoutShapes[0].getPoints()} 
            color="#4ade80"
            lineWidth={2}
            position={[0, 0, thickness + 0.1]}
            // No rotation. Points are XY.
            scale={[1, 1, 1]}
            />
        )}

        {outlineState.inlay && inlayShapes && inlayShapes.length > 0 && inlayShapes.map((shape, i) => (
            <Line
                key={`inlay-outline-${i}`}
                points={shape.shape ? shape.shape.getPoints() : shape.getPoints()} 
                color="#4ade80"
                lineWidth={2}
                position={[0, 0, thickness + 0.1 + ((i + 1) * 0.001)]}
                scale={[inlayScale, inlayScale, 1]}
            />
        ))}

        {outlineState.pattern && patternShapes && patternShapes.length > 0 && patternShapes[0] instanceof THREE.Shape && (
             <Line
                points={patternShapes[0].getPoints()} 
                color="#4ade80"
                lineWidth={2}
                position={[0, 0, thickness + 0.2]}
            />
        )}

        {/* Rotate GridHelper 90deg X to lie on XY plane */}
        <gridHelper args={[2000, 20]} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} />
      </Canvas>
      <ScreenshotModal 
         isOpen={showScreenshotModal} 
         onClose={() => setShowScreenshotModal(false)}
         onCapture={handleCapture}
      />
    </div>
  );
};

export default ModelViewer;
