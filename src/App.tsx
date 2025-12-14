import React, { useState, useRef } from "react";
import ModelViewer from "./components/ModelViewer";
import Controls from "./components/Controls";
import OutputPanel from "./components/OutputPanel";
import * as THREE from 'three';
import { DEFAULT_BASE_COLOR, DEFAULT_PATTERN_COLOR } from './constants/colors';
import { AlertProvider } from './context/AlertContext';

import WelcomeModal from "./components/WelcomeModal";

const App = () => {
  const [size, setSize] = useState(300);
  const [thickness, setThickness] = useState(3);
  const [color, setColor] = useState(DEFAULT_BASE_COLOR);
  const [cutoutShapes, setCutoutShapes] = useState<THREE.Shape[] | null>(null);
  const [patternShapes, setPatternShapes] = useState<any[] | null>(null);
  const [patternType, setPatternType] = useState<'dxf' | 'svg' | 'stl' | null>(null);
  const [extrusionAngle, setExtrusionAngle] = useState(45); // Default to 45 degree taper
  const [patternHeight, setPatternHeight] = useState<number | ''>(''); // Empty string for "Auto"
  const [patternScale, setPatternScale] = useState(1);
  const [isTiled, setIsTiled] = useState(false);
  const [tileSpacing, setTileSpacing] = useState(10);
  const [patternMargin, setPatternMargin] = useState(3);
  const [patternColor, setPatternColor] = useState(DEFAULT_PATTERN_COLOR);
  const [clipToOutline, setClipToOutline] = useState(false);
  const [tilingDistribution, setTilingDistribution] = useState<'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave-v' | 'wave-h' | 'zigzag-v' | 'zigzag-h'>('hex');
  const [tilingRotation, setTilingRotation] = useState<'none' | 'alternate' | 'random' | 'aligned'>('random');

  const [debugMode, setDebugMode] = useState(false);

  // Inlay State
  const [inlayShapes, setInlayShapes] = useState<any[] | null>(null);
  const [inlayDepth, setInlayDepth] = useState(0.6);
  const [inlayScale, setInlayScale] = useState(1);
  const [inlayExtend, setInlayExtend] = useState(0);

  // Welcome Modal State
  const [showWelcome, setShowWelcome] = useState(() => {
      // Check local storage on init
      return !localStorage.getItem('welcome_modal_dismissed');
  });

  const [isControlsCollapsed, setIsControlsCollapsed] = useState(false);

  const meshRef = useRef<THREE.Group>(null);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        setDebugMode(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <AlertProvider>
    <div className="h-[100dvh] flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Panel - 3D Viewer */}
        <div className="h-1/2 md:h-auto flex-1 flex flex-col p-4 min-w-0">
            <div className="flex-1 relative bg-gray-900 rounded-lg border border-gray-800 overflow-hidden shadow-inner">
                <ModelViewer 
                  size={size} 
                  thickness={thickness} 
                  color={color} 
                  patternColor={patternColor}
                  meshRef={meshRef} 
                  cutoutShapes={cutoutShapes}
                  patternShapes={patternShapes}
                  extrusionAngle={extrusionAngle}
                  patternHeight={patternHeight === '' ? 0 : patternHeight}
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
                />
            </div>
        </div>

        {/* Right Panel - Controls & Output */}
        <div className={`
            md:h-auto w-full md:w-96 overflow-hidden flex flex-col p-4 gap-4 bg-gray-950 md:bg-transparent border-t md:border-t-0 border-gray-800 transition-all duration-300 ease-in-out
            ${isControlsCollapsed ? 'h-auto flex-shrink-0 md:flex-none' : 'h-1/2 flex-1 md:flex-none'}
        `}>
            <Controls 
              size={size} 
              setSize={setSize}
              thickness={thickness}
              setThickness={setThickness}
              color={color}
              setColor={setColor}
              patternColor={patternColor}
              setPatternColor={setPatternColor}
              cutoutShapes={cutoutShapes}
              setCutoutShapes={setCutoutShapes}
              setPatternShapes={setPatternShapes}
              patternShapes={patternShapes}
              patternType={patternType}
              setPatternType={setPatternType}
              extrusionAngle={extrusionAngle}
              setExtrusionAngle={setExtrusionAngle}
              patternHeight={patternHeight}
              setPatternHeight={setPatternHeight}
              patternScale={patternScale}
              setPatternScale={setPatternScale}
              isTiled={isTiled}
              setIsTiled={setIsTiled}
              tileSpacing={tileSpacing}
              setTileSpacing={setTileSpacing}
              patternMargin={patternMargin}
              setPatternMargin={setPatternMargin}
              clipToOutline={clipToOutline}
              setClipToOutline={setClipToOutline}
              tilingDistribution={tilingDistribution}
              setTilingDistribution={setTilingDistribution}
              tilingRotation={tilingRotation}
              setTilingRotation={setTilingRotation}

              debugMode={debugMode}
              inlayShapes={inlayShapes}
              setInlayShapes={setInlayShapes}
              inlayDepth={inlayDepth}
              setInlayDepth={setInlayDepth}
              inlayScale={inlayScale}
              setInlayScale={setInlayScale}
              inlayExtend={inlayExtend}
              setInlayExtend={setInlayExtend}
              onReset={() => {
                  setSize(300);
                  setThickness(3);
                  setColor(DEFAULT_BASE_COLOR);
                  setCutoutShapes(null);
                  setPatternShapes(null);
                  setPatternType(null);
                  setExtrusionAngle(45);
                  setPatternHeight('');
                  setPatternScale(1);
                  setIsTiled(false);
                  setTileSpacing(10);
                  setPatternMargin(3);
                  setPatternColor(DEFAULT_PATTERN_COLOR);
                  setClipToOutline(true);
                  setTilingDistribution('offset');
                  setTilingRotation('random');
                  setInlayShapes(null);
                  setInlayDepth(0.6);
                  setInlayScale(1);
                  setInlayExtend(0);
               }}
               onOpenWelcome={() => setShowWelcome(true)}
               isCollapsed={isControlsCollapsed}
               onToggleCollapse={() => setIsControlsCollapsed(!isControlsCollapsed)}
               mobileContent={
                   <OutputPanel 
                        meshRef={meshRef} 
                        debugMode={debugMode} 
                        className="bg-transparent border-0 shadow-none p-0 !p-0"
                   />
               }
            />
            <div className={`flex-shrink-0 transition-opacity duration-300 ${isControlsCollapsed ? 'opacity-0 h-0 overflow-hidden md:opacity-100 md:h-auto md:overflow-visible' : 'opacity-100'}`}>
               <div className="hidden md:block">
                    <OutputPanel meshRef={meshRef} debugMode={debugMode} />
               </div>
            </div>
        </div>
      </main>

      {/* Welcome Modal */}
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
    </div>
    </AlertProvider>
  );
};

export default App; // Force update
