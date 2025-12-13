import React, { useState, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Line, Stats } from '@react-three/drei';
import { Box, Layers, RotateCcw, ScanLine, Activity } from 'lucide-react';
import * as THREE from 'three';
import { Geometry, Base, Intersection, Subtraction } from '@react-three/csg';
import { tileShapes } from '../utils/patternUtils';

interface ModelViewerProps {
  size: number;
  thickness: number;
  color: string;
  patternColor: string;
  meshRef: React.RefObject<THREE.Group>;
  cutoutShapes: THREE.Shape[] | null;
  patternShapes: THREE.Shape[] | null;
  extrusionAngle: number;
  patternHeight: number | string;
  patternScale: number;
  isTiled: boolean;
  tileSpacing: number;
  patternDirection: 'up' | 'down';
}

type ViewType = 'iso' | 'top' | 'front';

const CameraRig: React.FC<{ view: ViewType }> = ({ view }) => {
  const { camera, controls } = useThree();

  useEffect(() => {
    // We need to cast controls to any or proper type if available to access 'reset' or object
    const ctrl = controls as any;
    
    if (view === 'top') {
      camera.position.set(0, 1000, 0);
      camera.lookAt(0, 0, 0);
    } else if (view === 'front') {
      camera.position.set(0, 0, 1000);
      camera.lookAt(0, 0, 0);
    } else if (view === 'iso') {
      camera.position.set(500, 500, 500);
      camera.lookAt(0, 0, 0);
    }
    
    if (ctrl) {
      ctrl.update();
    }
  }, [view, camera, controls]);

  return null;
};

const FpsTracker: React.FC<{ fpsRef: React.RefObject<HTMLDivElement> }> = ({ fpsRef }) => {
  const { gl } = useThree();
  
  React.useEffect(() => {
      let frameCount = 0;
      let lastTime = performance.now();
      let animationFrameId: number;

      const loop = () => {
          const time = performance.now();
          frameCount++;
          if (time >= lastTime + 1000) {
              if (fpsRef.current) {
                  fpsRef.current.innerText = `${Math.round((frameCount * 1000) / (time - lastTime))} FPS`;
              }
              frameCount = 0;
              lastTime = time;
          }
          animationFrameId = requestAnimationFrame(loop);
      };
      
      loop();
      
      return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return null;
};

const ModelViewer: React.FC<ModelViewerProps> = ({ 
  size, 
  thickness, 
  color, 
  patternColor,
  meshRef, 
  cutoutShapes,
  patternShapes,
  extrusionAngle,
  patternHeight,
  patternScale,
  isTiled,
  tileSpacing,
  patternDirection
}) => {
  const [view, setView] = useState<ViewType>('iso');
  const [showOutline, setShowOutline] = useState(false);
  const [showPatternOutline, setShowPatternOutline] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showFps, setShowFps] = useState(false);
  const fpsRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cutoutShapes && cutoutShapes.length > 0) {
      console.log('Rendering cutout with shapes:', cutoutShapes.length);
    }
  }, [cutoutShapes]);

  // Process pattern shapes (Tiling + Scaling)
  const finalPatternShapes = React.useMemo(() => {
    if (!patternShapes || patternShapes.length === 0) return null;

    // Standardize Unit Source Shapes (always correct winding)
    const unitShapes = patternShapes.map(shape => {
         const newShape = new THREE.Shape();
         const points = shape.getPoints();
         if (THREE.ShapeUtils.area(points) < 0) points.reverse();
         newShape.setFromPoints(points);
         if (shape.holes) {
             shape.holes.forEach(h => {
                 const hp = h.getPoints();
                 newShape.holes.push(new THREE.Path(hp));
             });
         }
         return newShape;
    });

    if (isTiled) {
        // Use tileShapes to generate actual Shape objects for everything
        const tiled = tileShapes(
            unitShapes,
            size,
            patternScale,
            tileSpacing
        );
        return tiled;
    } else {
        // Standard single/manual pattern (scaled)
         const processed = unitShapes.map(shape => {
            const newShape = new THREE.Shape();
            const points = shape.getPoints();
            points.forEach((p, i) => {
                const x = p.x * patternScale;
                const y = p.y * patternScale;
                if (i === 0) newShape.moveTo(x, y);
                else newShape.lineTo(x, y);
            });
            if (shape.holes) {
                shape.holes.forEach(h => {
                    const newHole = new THREE.Path();
                    h.getPoints().forEach(p => newHole.lineTo(p.x * patternScale, p.y * patternScale));
                    newShape.holes.push(newHole);
                });
            }
            return newShape;
         });
         return processed;
    }
  }, [patternShapes, size, patternScale, tileSpacing, isTiled]);

  // instancedMeshRef removal...

  // Calculate bevel/taper props and final Settings
  const { settings: patternExtrudeSettings, height: activePatternHeight } = React.useMemo(() => {
     if (Math.abs(extrusionAngle) > 0) {
         if (extrusionAngle > 0 && finalPatternShapes && finalPatternShapes.length > 0) {
             // Auto-Point Mode (Pyramid)
             // We use the first shape to estimate height, assuming uniform shapes
             const shape = finalPatternShapes[0];
             let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
             shape.getPoints().forEach(p => {
                 if (p.x < minX) minX = p.x;
                 if (p.y < minY) minY = p.y;
                 if (p.x > maxX) maxX = p.x;
                 if (p.y > maxY) maxY = p.y;
             });
             const width = maxX - minX;
             const height = maxY - minY;
             const radius = Math.min(width, height) / 2;
             
             const angleRad = (extrusionAngle * Math.PI) / 180;
             let autoHeight = radius / Math.tan(angleRad);
             
             // Cap height if user provided a max height
             if (patternHeight !== '' && patternHeight > 0) {
                 autoHeight = Math.min(autoHeight, patternHeight);
             }

             return {
                 settings: {
                    depth: 0.05, 
                    bevelEnabled: true,
                    bevelThickness: autoHeight,
                    bevelSize: radius, 
                    bevelSegments: 1,
                    bevelOffset: 0
                 },
                 height: autoHeight
             };
         } else {
             // Negative or Manual
             const angleRad = (extrusionAngle * Math.PI) / 180;
             const pHeight = patternHeight === '' ? 1 : patternHeight; // Fallback for manual
             const bevelSize = -1 * pHeight * Math.tan(angleRad);
             return {
                 settings: {
                    depth: 0.1, 
                    bevelEnabled: true,
                    bevelThickness: pHeight,
                    bevelSize: bevelSize,
                    bevelSegments: 1
                 },
                 height: pHeight
             };
         }
     } else {
         const pHeight = patternHeight === '' ? 1 : patternHeight; // Fallback
         return {
             settings: {
                depth: pHeight,
                bevelEnabled: false
             },
             height: pHeight
         };
     }
  }, [extrusionAngle, patternHeight, finalPatternShapes]);

  return (
    <div className="w-full h-full bg-gray-900 rounded-lg overflow-hidden border border-gray-800 relative group">
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-row gap-2 p-2 bg-gray-800/80 backdrop-blur rounded-lg border border-gray-700">
        <button
          onClick={() => setView('iso')}
          className={`p-2 rounded hover:bg-gray-700 transition-colors ${view === 'iso' ? 'bg-blue-500/20 text-blue-400' : 'text-gray-400'}`}
          title="Reset View"
        >
          <RotateCcw size={20} />
        </button>
        <button
          onClick={() => setView('top')}
          className={`p-2 rounded hover:bg-gray-700 transition-colors ${view === 'top' ? 'bg-blue-500/20 text-blue-400' : 'text-gray-400'}`}
          title="Top View"
        >
          <Layers size={20} />
        </button>
        <button
          onClick={() => setView('front')}
          className={`p-2 rounded hover:bg-gray-700 transition-colors ${view === 'front' ? 'bg-blue-500/20 text-blue-400' : 'text-gray-400'}`}
          title="Front View"
        >
          <Box size={20} />
        </button>
        {cutoutShapes && cutoutShapes.length > 0 && (
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
        {finalPatternShapes && finalPatternShapes.length > 0 && (
          <button
            onClick={() => setShowPatternOutline(!showPatternOutline)}
            className={`p-2 rounded hover:bg-gray-700 transition-colors ${showPatternOutline ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400'}`}
            title="Toggle Pattern Outline"
          >
            <ScanLine size={20} className="stroke-[1.5]" />
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
            onClick={() => setShowWireframe(!showWireframe)}
            className={`p-2 rounded hover:bg-gray-700 transition-colors ${showWireframe ? 'bg-yellow-500/20 text-yellow-400' : 'text-gray-400'}`}
            title="Toggle Wireframe"
          >
            <Box size={20} className="stroke-[1.5]" />
        </button>
      </div>

      {/* Bottom Right FPS Counter */}
      {showFps && (
        <div 
          ref={fpsRef}
          className="absolute bottom-4 right-4 z-10 p-2 bg-gray-800/80 backdrop-blur rounded-lg border border-gray-700 text-purple-400 font-mono text-sm font-bold pointer-events-none select-none"
        >
          0 FPS
        </div>
      )}

      <Canvas camera={{ position: [500, 500, 500], fov: 50, far: 20000, near: 0.1 }}>
        <CameraRig view={view} />
        <OrbitControls makeDefault />
        <ambientLight intensity={0.5} />
        <directionalLight position={[100, 100, 50]} intensity={1} />
        
        <group ref={meshRef}>
            {/* Base Mesh */}
            <mesh name="Base" position={[0, thickness / 2, 0]}>
                <Geometry>
                    <Base>
                        {/* Base Box */}
                        <boxGeometry args={[size, thickness, size]} />
                    </Base>
                    
                    {/* Cutout Logic (Intersection) */}
                    {cutoutShapes && cutoutShapes.length > 0 && (
                        <Intersection position={[0, -thickness, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1, 1]}>
                        <extrudeGeometry args={[cutoutShapes, { depth: thickness * 10, bevelEnabled: false }]} />
                        </Intersection>
                    )}
                </Geometry>
                <meshStandardMaterial color={color} wireframe={showWireframe} />
            </mesh>
            
            {/* Pattern Mesh - Consolidated */}
            {finalPatternShapes && finalPatternShapes.length > 0 && (
                 <mesh 
                    name="Pattern"
                    position={[0, patternDirection === 'up' ? thickness : thickness + activePatternHeight, 0]} 
                    rotation={[patternDirection === 'up' ? -Math.PI / 2 : Math.PI / 2, 0, 0]}
                >    
                    <Geometry>
                        <Base>
                            <extrudeGeometry args={[finalPatternShapes, patternExtrudeSettings]} />
                        </Base>
                         {/* Cut off the bottom (back-bevel) to ensure single-sided pyramid */}
                        <Subtraction position={[0, 0, -500]}>
                            <boxGeometry args={[2000, 2000, 1000]} />
                        </Subtraction>
                    </Geometry>
                    <meshStandardMaterial color={patternColor} wireframe={showWireframe} />
                 </mesh>
            )}

            {showFps && <FpsTracker fpsRef={fpsRef} />}
        </group>
        
        {showOutline && cutoutShapes && cutoutShapes.length > 0 && (
            <Line
            points={cutoutShapes[0].getPoints()} // Assuming the first shape is the main outline
            color="#4ade80"
            lineWidth={2}
            position={[0, thickness + 0.1, 0]} // On base surface
            rotation={[-Math.PI / 2, 0, 0]} 
            scale={[1, 1, 1]}
            />
        )}

        {showPatternOutline && finalPatternShapes && finalPatternShapes.map((shape, i) => (
             <Line
             key={i}
             points={shape.getPoints()}
             color="#06b6d4" // Cyan
             lineWidth={1}
             position={[0, thickness + 0.1, 0]} // On base surface
             rotation={[-Math.PI / 2, 0, 0]}
             />
        ))}

        <gridHelper args={[2000, 20]} position={[0, 0, 0]} />
      </Canvas>
    </div>
  );
};

export default ModelViewer;
