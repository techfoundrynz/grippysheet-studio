import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera, Line } from '@react-three/drei';
import { Box, Layers, ScanLine, Activity, Ghost, RotateCcw, Camera as CameraIcon } from 'lucide-react';
import * as THREE from 'three';
import ScreenshotModal from './ScreenshotModal';
import ImperativeModel from './ImperativeModel';

interface ModelViewerProps {
  size: number;
  thickness: number;
  color: string;
  patternColor: string;
  meshRef: React.RefObject<THREE.Group>;
  cutoutShapes: THREE.Shape[] | null;
  patternShapes: any[] | null;
  patternType: 'dxf' | 'svg' | 'stl' | null;
  extrusionAngle: number;
  patternHeight: number | string;
  patternScale: number;
  isTiled: boolean;
  tileSpacing: number;
  patternMargin: number;
  tilingDistribution?: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave-v' | 'wave-h' | 'zigzag-v' | 'zigzag-h';
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
  extrusionAngle,
  patternHeight,
  patternScale,
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

  const [showOutline, setShowOutline] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showFps, setShowFps] = useState(true);
  const [isPatternTransparent, setIsPatternTransparent] = useState(false);
  const fpsRef = React.useRef<HTMLDivElement>(null);
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);
  const captureRef = React.useRef<((bgColor: string | null) => void) | null>(null);

  const handleCapture = (bgColor: string | null) => {
      if (captureRef.current) {
          captureRef.current(bgColor);
          setShowScreenshotModal(false);
      }
  };


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
            <div className="w-px bg-gray-700 mx-1" />
        )}
        
        {debugMode && cutoutShapes && cutoutShapes.length > 0 && (
          <>
            <div className="w-px bg-gray-700 mx-1" />
            <button
                onClick={() => setShowOutline(!showOutline)}
                className={`p-2 rounded hover:bg-gray-700 transition-colors ${showOutline ? 'bg-green-500/20 text-green-400' : 'text-gray-400'}`}
                title="Toggle DXF Outline"
            >
                <ScanLine size={20} />
            </button>
          </>
        )}
        
        {debugMode && (
          <button
              onClick={() => setShowWireframe(!showWireframe)}
              className={`p-2 rounded hover:bg-gray-700 transition-colors ${showWireframe ? 'bg-yellow-500/20 text-yellow-400' : 'text-gray-400'}`}
              title="Toggle Wireframe"
            >
              <Box size={20} className="stroke-[1.5]" />
          </button>
        )}
        
        <div className="w-px bg-gray-700 mx-1" />

        <button
            onClick={() => setShowFps(!showFps)}
            className={`p-2 rounded hover:bg-gray-700 transition-colors ${showFps ? 'bg-purple-500/20 text-purple-400' : 'text-gray-400'}`}
            title="Toggle FPS Counter"
        >
            <Activity size={20} />
        </button> 
        <button
            onClick={() => setIsPatternTransparent(!isPatternTransparent)}
            className={`p-2 rounded hover:bg-gray-700 transition-colors ${isPatternTransparent ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-400'}`}
            title="Toggle Pattern Transparency"
        >
            <Ghost size={20} />
        </button>       
        <button
            onClick={() => setShowScreenshotModal(true)}
            className="p-2 rounded hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
            title="Screenshot"
        >
            <CameraIcon size={20} />
        </button>
      </div>

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
                extrusionAngle={extrusionAngle}
                patternHeight={patternHeight}
                patternScale={patternScale}
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
                wireframe={showWireframe}
                isPatternTransparent={isPatternTransparent}
            />
        
        {showOutline && cutoutShapes && cutoutShapes.length > 0 && (
            <Line
            points={cutoutShapes[0].getPoints()} 
            color="#4ade80"
            lineWidth={2}
            position={[0, 0, thickness + 0.1]}
            // No rotation. Points are XY.
            scale={[1, 1, 1]}
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
