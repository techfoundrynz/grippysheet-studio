import React, { useState, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Instances, Instance } from '@react-three/drei';
import { Box, Layers, RotateCcw, ScanLine, Activity } from 'lucide-react';
import * as THREE from 'three';
import { Subtraction, Base, Geometry, Intersection } from '@react-three/csg';
import { generateTilePositions, getGeometryBounds, getShapesBounds } from '../utils/patternUtils';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
  tilingDistribution?: 'grid' | 'offset' | 'random';
  tilingRotation?: 'none' | 'alternate' | 'random';
  clipToOutline?: boolean;
  debugMode?: boolean;
}

type ViewType = 'iso' | 'top' | 'front';

const CameraRig: React.FC<{ view: ViewType }> = ({ view }) => {
  const { camera, controls } = useThree();

  useEffect(() => {
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
    
    if (ctrl) ctrl.update();
  }, [view, camera, controls]);

  return null;
};

const FpsTracker: React.FC<{ fpsRef: React.RefObject<HTMLDivElement> }> = ({ fpsRef }) => {
  const lastTimeRef = React.useRef(performance.now());
  const updateInterval = 1000 / 15;

  useFrame((state, delta) => {
      const now = performance.now();
      if (fpsRef.current && now - lastTimeRef.current >= updateInterval) {
          const fps = 1 / Math.max(delta, 0.001);
          const fpsString = String(Math.round(fps)).padStart(3, '\u00A0');
          fpsRef.current.innerText = `${fpsString} FPS`;
          lastTimeRef.current = now;
      }
  });

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
  patternType,
  extrusionAngle,
  patternHeight,
  patternScale,
  isTiled,
  tileSpacing,
  patternMargin,
  tilingDistribution = 'grid',
  tilingRotation = 'none',
  clipToOutline = false,
  debugMode = false
}) => {

  const [view, setView] = useState<ViewType>('top');
  const [showOutline, setShowOutline] = useState(false);
  const [showPatternOutline, setShowPatternOutline] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showFps, setShowFps] = useState(false);
  const fpsRef = React.useRef<HTMLDivElement>(null);

  const STLTiles = React.memo(({ instances, geometry, color, wireframe, thickness }: { instances: any[], geometry: THREE.BufferGeometry, color: string, wireframe: boolean, thickness: number }) => {
        const offset = React.useMemo(() => {
            if (!geometry.boundingBox) geometry.computeBoundingBox();
            const box = geometry.boundingBox!;
            const zHeight = box.max.z - box.min.z;
            return zHeight / 2;
        }, [geometry]);

        return (
            <Instances
                range={instances.length}
                geometry={geometry}
                position={[0, thickness, 0]} 
            >
                <meshStandardMaterial color={color} wireframe={wireframe} />
                {instances.map((data, i) => (
                    <Instance
                        key={i}
                        position={[data.position.x, (offset * data.scale), -data.position.y]} 
                        rotation={[-Math.PI / 2, 0, Math.PI]}
                        scale={[data.scale, data.scale, data.scale]}
                    />
                ))}
            </Instances>
        );
  });

  useEffect(() => {
    if (cutoutShapes && cutoutShapes.length > 0) {
    //   console.log('Rendering cutout with shapes:', cutoutShapes.length);
    }
  }, [cutoutShapes]);

  // Standardize Unit Source Shapes
  const unitShapes = React.useMemo(() => {
    if (!patternShapes || patternShapes.length === 0) return null;
    if (patternType === 'stl') return null; // Handle separately

    return (patternShapes as THREE.Shape[]).map(shape => {
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
  }, [patternShapes, patternType]);

  // Calculate bevel/taper props based on unit shape
  const { settings: patternExtrudeSettings, height: activePatternHeight } = React.useMemo(() => {
     let pHeight = patternHeight === '' ? 1 : patternHeight;
     const angleRad = (Math.abs(extrusionAngle) * Math.PI) / 180;
     
     if (Math.abs(extrusionAngle) > 0) {
         if (unitShapes && unitShapes.length > 0) {
              const shape = unitShapes[0]; // Use the first unit shape for calculation
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
              
              // Height depends on SCALED radius
              const scaledRadius = radius * patternScale;
              let autoHeight = scaledRadius / Math.tan(angleRad);
              
              if (patternHeight !== '' && Number(patternHeight) > 0) {
                  autoHeight = Math.min(autoHeight, Number(patternHeight));
              }
  
              return {
                  settings: {
                     depth: 0.05, 
                     bevelEnabled: true,
                     bevelThickness: autoHeight, // applied to Z (unscaled)
                     bevelSize: -radius + 0.1,   // applied to X/Y (scaled later) so use unscaled radius!
                     bevelSegments: 1,
                     bevelOffset: 0
                  },
                  height: autoHeight
              };
         }
     }
     
     return {
         settings: {
            depth: Number(pHeight),
            bevelEnabled: false
         },
         height: Number(pHeight)
     };
  }, [extrusionAngle, patternHeight, unitShapes, patternScale]);


  // Process pattern shapes (Tiling + Scaling)
  const finalPatternShapes = React.useMemo(() => {
    if (!patternShapes || patternShapes.length === 0) return null;
    if (patternType === 'stl') return null; // Handle separately

      // 1. Get Base Bounds
     let bounds = new THREE.Box2(
        new THREE.Vector2(-size/2, -size/2), 
        new THREE.Vector2(size/2, size/2)
     );
      
     if (cutoutShapes && cutoutShapes.length > 0) {
         const shapeBounds = getShapesBounds(cutoutShapes);
         bounds = new THREE.Box2(shapeBounds.min, shapeBounds.max);
     }

    if (isTiled) {
        // Tiling Logic with "Rotate After Extrude"
        
        // 1. Calculate Pattern Size for Grid
        let patternWidth = 0;
        let patternHeight = 0;

        if (patternType === 'stl' || (patternShapes.length > 0 && patternShapes[0] instanceof THREE.BufferGeometry)) {
             const geoBounds = getGeometryBounds(patternShapes[0]);
             patternWidth = geoBounds.size.x * patternScale;
             patternHeight = geoBounds.size.y * patternScale;
        } else if (unitShapes && unitShapes.length > 0) {
             const shpBounds = getShapesBounds(unitShapes);
             patternWidth = shpBounds.size.x * patternScale;
             patternHeight = shpBounds.size.y * patternScale;
        }
        
        // 2. Generate Positions
        const positions = generateTilePositions(
            bounds,
            patternWidth,
            patternHeight,
            tileSpacing,
            cutoutShapes, 
            patternMargin,
            clipToOutline, // allowPartial logic
            tilingDistribution,
            tilingRotation
        );
        
        // 3. Create Unit Geometry
        let unitGeo: THREE.BufferGeometry;
        
        if (patternType === 'stl' || (patternShapes.length > 0 && patternShapes[0] instanceof THREE.BufferGeometry)) {
            unitGeo = (patternShapes[0] as THREE.BufferGeometry).clone();
            unitGeo.scale(patternScale, patternScale, 1);
        } else {
            // For Shapes, exclude holes logic is inside ExtrudeGeometry usually
            // but we need to pass unitShapes (Shape[]) to ExtrudeGeometry
            unitGeo = new THREE.ExtrudeGeometry(unitShapes!, patternExtrudeSettings);
            // Apply scale to the geometry
            unitGeo.scale(patternScale, patternScale, 1);
        }
        
        // Center the geometry? 
        // patternUtils assumes placement is based on center.
        // We should center the unitGeo.
        unitGeo.computeBoundingBox();
        const center = new THREE.Vector3();
        if (unitGeo.boundingBox) unitGeo.boundingBox.getCenter(center);
        unitGeo.translate(-center.x, -center.y, 0); // Center at 0,0 locally
        
        // 4. Merge
        const geometries: THREE.BufferGeometry[] = [];
        
        positions.forEach(p => {
            const clone = unitGeo.clone();
            
            // Rotate around Z (center) first
            if (p.rotation !== 0) clone.rotateZ(p.rotation);
            
            // Translate to position
            clone.translate(p.position.x, p.position.y, 0);
            
            geometries.push(clone);
        });
        
        if (geometries.length === 0) return null;
        
        const merged = BufferGeometryUtils.mergeGeometries(geometries);
        return merged;

    } else {
        // Standard single/manual pattern (scaled)
         const processed = unitShapes!.map(shape => {
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
  }, [patternShapes, size, cutoutShapes, isTiled, tileSpacing, patternMargin, patternScale, patternType, clipToOutline, tilingDistribution, tilingRotation, unitShapes, patternExtrudeSettings]);

  // Calculate STL instances
  const stlInstances = React.useMemo(() => {
      if (patternType !== 'stl' || !patternShapes || patternShapes.length === 0) return null;
      
      const geometry = patternShapes[0] as unknown as THREE.BufferGeometry;
      const geoBounds = getGeometryBounds(geometry);
      
      // Target Scan Area Bounds
      let scanBounds = new THREE.Box2(
          new THREE.Vector2(-size/2, -size/2), 
          new THREE.Vector2(size/2, size/2)
      );
      
      if (cutoutShapes && cutoutShapes.length > 0) {
          const shapeBounds = getShapesBounds(cutoutShapes);
          scanBounds = new THREE.Box2(shapeBounds.min, shapeBounds.max);
      }
      
       if (isTiled) {
           return generateTilePositions(
               scanBounds, 
               geoBounds.size.x * patternScale, 
               geoBounds.size.y * patternScale, 
               tileSpacing,
               cutoutShapes, 
               patternMargin,
               clipToOutline
           );
       } else {
          return [{
              position: new THREE.Vector2(0, 0),
              rotation: 0,
              scale: patternScale
          }];
      }
  }, [patternShapes, patternType, isTiled, size, patternScale, tileSpacing, cutoutShapes, patternMargin, clipToOutline]);



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
        
        {debugMode && finalPatternShapes && (finalPatternShapes instanceof THREE.BufferGeometry || (Array.isArray(finalPatternShapes) && finalPatternShapes.length > 0)) && (
          <button
            onClick={() => setShowPatternOutline(!showPatternOutline)}
            className={`p-2 rounded hover:bg-gray-700 transition-colors ${showPatternOutline ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400'}`}
            title="Toggle Pattern Outline"
          >
            <ScanLine size={20} className="stroke-[1.5]" />
          </button>
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
      </div>

      {showFps && (
        <div 
          ref={fpsRef}
          className="absolute bottom-4 right-4 z-10 p-2 bg-gray-800/80 backdrop-blur rounded-lg border border-gray-700 text-purple-400 tabular-nums text-sm font-bold pointer-events-none select-none w-20 text-center"
        >
          0 FPS
        </div>
      )}

      <Canvas camera={{ position: [500, 500, 500], fov: 50, far: 20000, near: 0.1 }} shadows>
        <CameraRig view={view} />
        <OrbitControls makeDefault />
        <ambientLight intensity={0.5} />
        <directionalLight position={[100, 100, 50]} intensity={1} castShadow />
        
        <group ref={meshRef}>
            {/* Base Mesh */}
            <mesh 
                name="Base" 
                position={cutoutShapes && cutoutShapes.length > 0 ? [0, 0, 0] : [0, thickness / 2, 0]} 
                rotation={cutoutShapes && cutoutShapes.length > 0 ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}
                receiveShadow
                castShadow
            >
                {cutoutShapes && cutoutShapes.length > 0 ? (
                     <extrudeGeometry args={[cutoutShapes, { depth: thickness, bevelEnabled: false }]} />
                ) : (
                     <boxGeometry args={[size, thickness, size]} />
                )}
                <meshStandardMaterial color={color} wireframe={showWireframe} />
            </mesh>
            
            {/* Pattern Mesh - Consolidated */}
            {finalPatternShapes && (finalPatternShapes instanceof THREE.BufferGeometry || (Array.isArray(finalPatternShapes) && finalPatternShapes.length > 0)) && (
                <mesh 
                    name="Pattern"
                    position={[0, thickness + Number(activePatternHeight), 0]} 
                    rotation={[Math.PI/2, 0, Math.PI]}
                    scale={[-1, 1, 1]}
                    castShadow
                    receiveShadow
                >    
                    <Geometry>
                        <Base>
                            {finalPatternShapes instanceof THREE.BufferGeometry ? (
                                <primitive object={finalPatternShapes} attach="geometry" />
                            ) : (
                                <extrudeGeometry args={[finalPatternShapes, patternExtrudeSettings]} />
                            )}
                        </Base>
                        {/* Cut off the bottom (back-bevel) to ensure single-sided pyramid */}
                        <Subtraction position={[0, 0, -500]}>
                            <boxGeometry args={[2000, 2000, 1000]} />
                        </Subtraction>
                        
                        {/* Clip To Outline Logic */}
                        {clipToOutline && cutoutShapes && cutoutShapes.length > 0 && (
                             <Intersection>
                                 <extrudeGeometry args={[
                                     cutoutShapes, 
                                     { 
                                         depth: 1000, 
                                         bevelEnabled: true, 
                                         bevelThickness: 0.1, 
                                         bevelSize: -patternMargin,
                                         bevelOffset: 0,
                                         bevelSegments: 1
                                     }
                                 ]} />
                             </Intersection>
                        )}
                        
                    </Geometry>
                    <meshStandardMaterial color={patternColor} wireframe={showWireframe} />
                 </mesh>
            )}

            {/* STL Rendering */}
            {patternType === 'stl' && stlInstances && patternShapes && patternShapes.length > 0 && typeof patternShapes[0] === 'object' && (
                <STLTiles 
                    instances={stlInstances} 
                    geometry={patternShapes[0] as unknown as THREE.BufferGeometry} 
                    color={patternColor} 
                    wireframe={showWireframe} 
                    thickness={thickness}
                />
            )}
        </group>
        
        {showOutline && cutoutShapes && cutoutShapes.length > 0 && (
            <Line
            points={cutoutShapes[0].getPoints()} 
            color="#4ade80"
            lineWidth={2}
            position={[0, thickness + 0.1, 0]}
            rotation={[-Math.PI / 2, 0, 0]} 
            scale={[1, 1, 1]}
            />
        )}

        {showPatternOutline && finalPatternShapes && Array.isArray(finalPatternShapes) && finalPatternShapes.map((shape, i) => (
             <Line
             key={i}
             points={shape.getPoints()}
             color="#06b6d4" // Cyan
             lineWidth={1}
             position={[0, thickness + 0.1, 0]}
             rotation={[-Math.PI / 2, 0, 0]}
             />
        ))}

        <gridHelper args={[2000, 20]} position={[0, 0, 0]} />
      </Canvas>
    </div>
  );
};

export default ModelViewer;
