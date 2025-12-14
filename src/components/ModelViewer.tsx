import React, { useState, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Instances, Instance, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Box, Layers, ScanLine, Activity, Ghost, RotateCcw, Camera as CameraIcon } from 'lucide-react';
import * as THREE from 'three';
import { ScreenshotModal } from './ScreenshotModal';
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
  inlayShapes?: any[] | null;
  inlayDepth?: number;
  inlayScale?: number;
  inlayExtend?: number;
}

type ViewState = {
  type: 'iso' | 'ortho';
  timestamp: number;
};

const CameraRig: React.FC<{ 
  viewState: ViewState; 
  size: number; 
  setCameraType: (type: 'perspective' | 'orthographic') => void 
}> = ({ viewState, size, setCameraType }) => {
  const { camera, controls, size: canvasSize } = useThree();
  const targetPos = React.useRef(new THREE.Vector3(500, -500, 500));
  const targetZoom = React.useRef(1);
  const targetLookAt = React.useRef(new THREE.Vector3(0, 0, 0));
  const animationPhase = React.useRef<'idle' | 'rotate' | 'zoom'>('idle');
  const lastTimestamp = React.useRef(0);
  const animationStart = React.useRef(0);
  const pendingOrthoZoom = React.useRef<number | null>(null);

  useEffect(() => {
    // Only trigger if timestamp changed (user action)
    if (viewState.timestamp === lastTimestamp.current) return;
    lastTimestamp.current = viewState.timestamp;

    // 1. Setup based on View Type
    if (viewState.type === 'ortho') {
      // Transition to Ortho:
      // Keep Perspective (don't switch yet)
      targetPos.current.set(0, -1, 1000); // Top view position
      
      // Calculate target zoom for Fit (to apply later)
      const minDim = Math.min(canvasSize.width, canvasSize.height);
      const fitZoom = (minDim * 0.7) / size;
      targetZoom.current = fitZoom;
      
    } else {
      // Transition to Iso:
      // Switch to Perspective immediately
      setCameraType('perspective');
      targetPos.current.set(500, -500, 500); 
      targetZoom.current = 1; // Perspective zoom usually 1
    }
    
    // 2. Reset Controls Target
    targetLookAt.current.set(0, 0, 0);
    
    // 3. Start Animation
    animationPhase.current = 'rotate';
    animationStart.current = Date.now();
    pendingOrthoZoom.current = null; // Reset

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewState]);

  // Handle Camera Switch (Apply matched zoom)
  useEffect(() => {
     if (camera instanceof THREE.OrthographicCamera && pendingOrthoZoom.current !== null) {
         camera.zoom = pendingOrthoZoom.current;
         camera.updateProjectionMatrix();
         // Reset pending
         pendingOrthoZoom.current = null;
     }
  }, [camera]);

  // Stop animation when user interacts
  useEffect(() => {
    if (!controls) return;
    const ctrl = controls as any;
    const callback = () => {
        // Grace period: ignore events shortly after animation starts
        if (Date.now() - animationStart.current < 200) return;
        animationPhase.current = 'idle';
    };
    ctrl.addEventListener('start', callback);
    return () => ctrl.removeEventListener('start', callback);
  }, [controls]);

  useFrame((_, delta) => {
      if (animationPhase.current === 'idle') return;

      const damp = Math.min(15 * delta, 0.8); 
      const epsilon = 0.001;
      const zoomEpsilon = 0.001;

      // PHASE 1: ROTATE & PAN
      if (animationPhase.current === 'rotate') {
          // Lerp Position with Slerp-like behavior (Nlerp)
          const distCurrent = camera.position.distanceTo(JSON.stringify(targetLookAt.current) === JSON.stringify(new THREE.Vector3(0,0,0)) ? new THREE.Vector3(0,0,0) : targetLookAt.current);
          const distTarget = targetPos.current.distanceTo(new THREE.Vector3(0,0,0));
          
          camera.position.lerp(targetPos.current, damp);
          const interpolatedDist = THREE.MathUtils.lerp(distCurrent, distTarget, damp);
          camera.position.normalize().multiplyScalar(interpolatedDist);
          
          // Lerp Controls Target
          if (controls) {
             const orbit = controls as any;
             orbit.target.lerp(targetLookAt.current, damp);
             orbit.update();
          }

          // Check if Rotation Finished
          const distPos = camera.position.distanceTo(targetPos.current);
          if (distPos < 5) { 
               // If going to Ortho, switch NOW
               if (viewState.type === 'ortho' && !(camera instanceof THREE.OrthographicCamera)) {
                   
                   // Calculate Matched Zoom for smooth transition
                   const dist = camera.position.distanceTo(targetLookAt.current); // Should be ~1000
                   // Perspective visible height at distance d = 2 * d * tan(fov/2)
                   // We assume default FOV 45
                   const fovRad = (45 * Math.PI) / 180;
                   const visibleHeight = 2 * dist * Math.tan(fovRad / 2); // ~828 at 1000
                   const matchedZoom = canvasSize.height / visibleHeight;
                   
                   pendingOrthoZoom.current = matchedZoom;
                   setCameraType('orthographic');
               }
               animationPhase.current = 'zoom';
          }
      }

      // PHASE 2: ZOOM (Sequential)
      if (animationPhase.current === 'zoom') {
          // Continue positional lerp
          camera.position.lerp(targetPos.current, damp);
          if (controls) {
             const orbit = controls as any;
             orbit.target.lerp(targetLookAt.current, damp);
             orbit.update();
          }

          // Lerp Zoom
          let currentZoom = camera.zoom;
          
          if (camera instanceof THREE.OrthographicCamera) {
              camera.zoom = THREE.MathUtils.lerp(camera.zoom, targetZoom.current, damp);
              camera.updateProjectionMatrix();
              currentZoom = camera.zoom;
          } else {
              // Perspective Zoom (FOV scaling? or just 1?)
              // Generally keep at 1. If we used zoom for effect, we'd lerp it.
              camera.zoom = THREE.MathUtils.lerp(camera.zoom, 1, damp);
              camera.updateProjectionMatrix();
              currentZoom = camera.zoom;
          }

          // Check Completion
          const distPos = camera.position.distanceTo(targetPos.current);
          const distZoom = Math.abs(currentZoom - targetZoom.current);

          if (distPos < epsilon && distZoom < zoomEpsilon) {
              animationPhase.current = 'idle';
          }
      }
  });

  return null;
};

const FpsTracker: React.FC<{ fpsRef: React.RefObject<HTMLDivElement> }> = ({ fpsRef }) => {
  const lastTimeRef = React.useRef(performance.now());
  const updateInterval = 1000 / 15;

  useFrame((_, delta) => {
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

const STLTiles = React.memo(({ instances, geometry, color, wireframe, thickness, opacity }: { instances: any[], geometry: THREE.BufferGeometry, color: string, wireframe: boolean, thickness: number, transparent?: boolean, opacity?: number }) => {
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
            // Overlap base by 0.01mm for manifold export
            position={[0, 0, thickness - 0.01]} 
        >
            <meshStandardMaterial color={color} wireframe={wireframe} transparent opacity={opacity} />
            {instances.map((data, i) => (
                <Instance
                    key={i}
                    position={[data.position.x, data.position.y, offset * data.scale]} 
                    rotation={[0, 0, data.rotation]}
                    scale={[data.scale, data.scale, data.scale]}
                />
            ))}
        </Instances>
    );
});

// Screenshot Manager Component using useThree hook
const ScreenshotManager: React.FC<{ 
    triggerRef: React.MutableRefObject<((bgColor: string | null) => void) | null>,
    size: number
}> = ({ triggerRef, size }) => {
    const { gl, scene, camera: activeCamera } = useThree();
    
    useEffect(() => {
        triggerRef.current = (bgColor: string | null) => {
            const originalSize = new THREE.Vector2();
            gl.getSize(originalSize);
            const originalPixelRatio = gl.getPixelRatio();
            const originalBackground = scene.background;
            
            try {
                // 1. Configure High-Res Render
                const targetRes = 1600;
                gl.setPixelRatio(1);
                gl.setSize(targetRes, targetRes, false); // false = don't update CSS style
                
                // 2. Setup Background
                if (bgColor) {
                    scene.background = new THREE.Color(bgColor);
                } else {
                    scene.background = null;
                }
                
                // 3. Setup Temporary Orthographic Camera (Top Down)
                // Calculate Frustum to fit object with padding
                const padding = 1.2;
                const frustumSize = size * padding;
                const halfSize = frustumSize / 2;
                
                const shotCamera = new THREE.OrthographicCamera(
                    -halfSize, halfSize, 
                    halfSize, -halfSize, 
                    -2000, 2000
                );
                shotCamera.position.set(0, 0, 1000);
                shotCamera.lookAt(0, 0, 0);
                shotCamera.updateProjectionMatrix();

                // 4. Hide Helpers (Grid, Gizmos if any)
                const hiddenObjects: THREE.Object3D[] = [];
                scene.traverse((obj) => {
                    if (obj instanceof THREE.GridHelper || obj.type === 'GridHelper' || obj.type === 'AxesHelper') {
                        if (obj.visible) {
                            obj.visible = false;
                            hiddenObjects.push(obj);
                        }
                    }
                });

                // 5. Render & Capture
                gl.render(scene, shotCamera);
                
                // Composite Watermark (2D Canvas)
                const canvas = document.createElement('canvas');
                canvas.width = targetRes;
                canvas.height = targetRes;
                const ctx = canvas.getContext('2d');
                
                let dataUrl = '';

                if (ctx) {
                    // Draw 3D Scale
                    ctx.drawImage(gl.domElement, 0, 0);

                    // Watermark Settings
                    const fontSize = 32;
                    const lineHeight = 1.4;
                    const padding = 40;
                    
                    ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'bottom';
                    
                    // Shadow for visibility
                    ctx.shadowColor = 'rgba(0,0,0,0.8)';
                    ctx.shadowBlur = 4;
                    ctx.shadowOffsetX = 1;
                    ctx.shadowOffsetY = 1;
                    ctx.fillStyle = '#ffffff';

                    const text1 = "Made with GrippySheet Studio";
                    const text2 = "https://studio.grippysheet.com";

                    // Bottom line (URL)
                    ctx.fillText(text2, targetRes - padding, targetRes - padding);
                    // Top line (Title)
                    ctx.fillText(text1, targetRes - padding, targetRes - padding - (fontSize * lineHeight));
                    
                    dataUrl = canvas.toDataURL('image/png');
                } else {
                     // Fallback if context fails
                     dataUrl = gl.domElement.toDataURL('image/png');
                }
                
                // 6. Download
                const link = document.createElement('a');
                link.download = `grippysheet-ortho-${Date.now()}.png`;
                link.href = dataUrl;
                link.click();

                // Restore Helper Visibility
                hiddenObjects.forEach(obj => obj.visible = true);

            } catch (e) {
                console.error("Screenshot failed:", e);
            } finally {
                // Restore State
                scene.background = originalBackground;
                gl.setPixelRatio(originalPixelRatio);
                gl.setSize(originalSize.x, originalSize.y, false);
                
                // Re-render current view to prevent flicker of old buffer
                gl.render(scene, activeCamera); 
            }
        };
    }, [gl, scene, activeCamera, size, triggerRef]);

    return null;
};


// Screenshot Manager Component using useThree hook


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
  const [showPatternOutline, setShowPatternOutline] = useState(false);
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



  useEffect(() => {
    if (cutoutShapes && cutoutShapes.length > 0) {
    //   console.log('Rendering cutout with shapes:', cutoutShapes.length);
    }
  }, [cutoutShapes]);

  // Standardize Unit Source Shapes
  const unitShapes = React.useMemo(() => {
    if (!patternShapes || patternShapes.length === 0) return null;
    if (patternType === 'stl' || (patternShapes.length > 0 && patternShapes[0] instanceof THREE.BufferGeometry)) return null; // Handle separately

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
    if (patternType === 'stl' || (patternShapes.length > 0 && patternShapes[0] instanceof THREE.BufferGeometry)) return null; // Handle separately

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
      const isStl = patternType === 'stl' || (patternShapes && patternShapes.length > 0 && patternShapes[0] instanceof THREE.BufferGeometry);
      if (!isStl || !patternShapes || patternShapes.length === 0) return null;
      
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
               false, // Force strict containment for STLs since we can't clip them
               tilingDistribution,
               tilingRotation
           ).map(p => ({ ...p, scale: patternScale }));
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
        
        <group ref={meshRef}>
            {/* Base Mesh */}
            <mesh 
                name="Base" 
                position={[0, 0, 0]} 
                receiveShadow
                castShadow
            >
                <Geometry>
                    <Base>
                        {cutoutShapes && cutoutShapes.length > 0 ? (
                             // Extrudes along Z automaticall. No rotation needed for Z-up.
                             <extrudeGeometry args={[cutoutShapes, { depth: thickness, bevelEnabled: false }]} />
                        ) : (
                             // Use ExtrudeGeometry for default square too, to match Z-coordinate system (0 to thickness)
                             <extrudeGeometry args={[
                                [new THREE.Shape()
                                    .moveTo(-size/2, -size/2)
                                    .lineTo(size/2, -size/2)
                                    .lineTo(size/2, size/2)
                                    .lineTo(-size/2, size/2)
                                    .lineTo(-size/2, -size/2)], 
                                { depth: thickness, bevelEnabled: false }
                             ]} />
                        )}
                    </Base>
                </Geometry>
                <meshStandardMaterial color={color} wireframe={showWireframe} />
            </mesh>

            {/* Base Pattern Inlays (Colored Meshes) */}
            {inlayShapes && inlayShapes.length > 0 && inlayShapes.map((item: any, i: number) => {
                if (item.color === 'transparent') return null;
                // Calculate extended depth with small offset for Z-fighting
                // The base starts at 'thickness - inlayDepth'
                // It should go up by 'inlayDepth' (to flush) + 'inlayExtend' (pop out)
                const totalDepth = inlayDepth + Number(inlayExtend || 0) + ((i + 1) * 0.001);

                return (
                <mesh
                    key={`inlay-${i}`}
                    // Position at the bottom of the cutout
                    position={[0, 0, thickness - inlayDepth]}
                    scale={[inlayScale, inlayScale, 1]}
                    castShadow
                    receiveShadow
                >
                    <extrudeGeometry args={[
                        [item.shape], 
                        { depth: totalDepth, bevelEnabled: false }
                    ]} />
                    <meshStandardMaterial color={item.color === 'base' ? color : item.color} wireframe={showWireframe} />
                </mesh>
                );
            })}
            
            {/* Pattern Mesh - Consolidated */}
            {finalPatternShapes && (finalPatternShapes instanceof THREE.BufferGeometry || (Array.isArray(finalPatternShapes) && finalPatternShapes.length > 0)) && (
                <mesh 
                    name="Pattern"
                    // Overlap base by 0.01mm for manifold export
                    position={[0, 0, thickness + Number(activePatternHeight) - 0.01]} 
                    // Standard Z-up extrusion
                    scale={[1, 1, -1]}
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
                        <Subtraction position={[0, 0, -500.1]}>
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
                    <meshStandardMaterial 
                        color={patternColor} 
                        wireframe={showWireframe} 
                        transparent
                        opacity={isPatternTransparent ? 0.3 : 1.0}
                    />
                 </mesh>
            )}

            {/* STL Rendering */}
            {(patternType === 'stl' || (patternShapes && patternShapes.length > 0 && patternShapes[0] instanceof THREE.BufferGeometry)) && stlInstances && patternShapes && patternShapes.length > 0 && typeof patternShapes[0] === 'object' && (
                <STLTiles 
                    instances={stlInstances} 
                    geometry={patternShapes[0] as unknown as THREE.BufferGeometry} 
                    color={patternColor} 
                    wireframe={showWireframe} 
                    transparent
                    opacity={isPatternTransparent ? 0.3 : 1.0}
                    thickness={thickness}
                />
            )}
        </group>
        
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

        {showPatternOutline && finalPatternShapes && Array.isArray(finalPatternShapes) && finalPatternShapes.map((shape, i) => (
             <Line
             key={i}
             points={shape.getPoints()}
             color="#06b6d4" // Cyan
             lineWidth={1}
             position={[0, 0, thickness + 0.1]}
             />
        ))}

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
