import React, { useState, useRef } from "react";
import ModelViewer from "./components/ModelViewer";
import Controls from "./components/Controls";
import OutputPanel from "./components/OutputPanel";
import * as THREE from 'three';
import { DEFAULT_BASE_COLOR, DEFAULT_PATTERN_COLOR } from './constants/colors';

const App = () => {
  const [size, setSize] = useState(300);
  const [thickness, setThickness] = useState(3);
  const [color, setColor] = useState(DEFAULT_BASE_COLOR);
  const [cutoutShapes, setCutoutShapes] = useState<THREE.Shape[] | null>(null);
  const [patternShapes, setPatternShapes] = useState<THREE.Shape[] | null>(null);
  const [extrusionAngle, setExtrusionAngle] = useState(45); // Default to 45 degree taper
  const [patternHeight, setPatternHeight] = useState<number | ''>(''); // Empty string for "Auto"
  const [patternScale, setPatternScale] = useState(1);
  const [isTiled, setIsTiled] = useState(false);
  const [tileSpacing, setTileSpacing] = useState(10);
  const [patternColor, setPatternColor] = useState(DEFAULT_PATTERN_COLOR);
  const [patternDirection, setPatternDirection] = useState<'up' | 'down'>('up');
  const meshRef = useRef<THREE.Group>(null);

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
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
                  patternDirection={patternDirection}
                />
            </div>
        </div>

        {/* Right Panel - Controls & Output */}
        <div className="h-1/2 md:h-auto w-full md:w-96 overflow-y-auto flex flex-col p-4 gap-4 bg-gray-950 md:bg-transparent border-t md:border-t-0 border-gray-800">
            <Controls 
              size={size} 
              setSize={setSize}
              thickness={thickness}
              setThickness={setThickness}
              color={color}
              setColor={setColor}
              patternColor={patternColor}
              setPatternColor={setPatternColor}
              setCutoutShapes={setCutoutShapes}
              setPatternShapes={setPatternShapes}
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
              patternDirection={patternDirection}
              setPatternDirection={setPatternDirection}
            />
            <div>
               <OutputPanel meshRef={meshRef} />
            </div>
        </div>
      </main>
    </div>
  );
};

export default App;
