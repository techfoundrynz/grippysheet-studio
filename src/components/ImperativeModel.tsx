import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { generateTilePositions, getShapesBounds } from '../utils/patternUtils';
import { offsetShape } from '../utils/offsetUtils';

interface ImperativeModelProps {
  size: number;
  thickness: number;
  color: string;
  patternColor: string;
  cutoutShapes: THREE.Shape[] | null | undefined;
  patternShapes: any[] | null | undefined;
  patternType: 'dxf' | 'svg' | 'stl' | null;
  patternScale: number;
  patternScaleZ?: number;
  isTiled: boolean;
  tileSpacing: number;
  patternMargin: number;
  tilingDistribution?: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave' | 'zigzag' | 'warped-grid';
  tilingDirection?: 'horizontal' | 'vertical';
  tilingOrientation?: 'none' | 'alternate' | 'random' | 'aligned';
  baseRotation?: number; // Rotates the PATTERN units
  rotationClamp?: number;
  patternMaxHeight?: number;
  clipToOutline?: boolean;
  baseOutlineRotation?: number; // Rotates the BASE shape
  baseOutlineMirror?: boolean; // Mirrors the BASE shape
  inlayShapes?: any[] | null | undefined;
  inlayDepth?: number;
  inlayScale?: number;
  inlayRotation?: number;
  inlayExtend?: number;
  inlayMirror?: boolean;
  wireframeBase?: boolean;
  wireframeInlay?: boolean;
  wireframePattern?: boolean;
  baseOpacity?: number;
  inlayOpacity?: number;
  patternOpacity?: number;
  displayMode?: 'normal' | 'toon';
  onProcessingChange?: (isProcessing: boolean) => void;
  debugShowPatternCutter?: boolean;
  debugShowHoleCutter?: boolean;
  debugShowInlayCutter?: boolean;
}

const ImperativeModel = React.forwardRef<THREE.Group, ImperativeModelProps>(({
  size,
  thickness,
  color,
  patternColor,
  baseOpacity,
  inlayOpacity,
  patternOpacity = 1.0,
  cutoutShapes,
  patternShapes,
  patternScale,
  patternScaleZ,
  isTiled,
  tileSpacing,
  patternMargin,
  tilingDistribution = 'hex',
  tilingDirection = 'horizontal',
  tilingOrientation = 'aligned',
  baseRotation = 0,
  rotationClamp,
  patternMaxHeight,
  clipToOutline = false,
  baseOutlineRotation = 0,
  baseOutlineMirror = false,
  inlayShapes,
  inlayDepth = 0.6,
  inlayScale = 1,
  inlayRotation = 0,
  inlayExtend = 0,
  inlayMirror = false,
  wireframeBase = false,
  wireframeInlay = false,
  wireframePattern = false,
  displayMode = 'normal',
  onProcessingChange,
  debugShowPatternCutter = false,
  debugShowHoleCutter = false,
  debugShowInlayCutter = false,
}, ref) => {
  const localGroupRef = useRef<THREE.Group>(null);
  
  // Expose ref
  React.useImperativeHandle(ref, () => localGroupRef.current!, []);

  // --- Gradient Map for Toon Shading ---
  const gradientMap = useMemo(() => {
    // 3-step grayscale gradient for toon effect
    const colors = new Uint8Array([
      50, 50, 50, 255,
      150, 150, 150, 255,
      255, 255, 255, 255
    ]);
    const texture = new THREE.DataTexture(colors, 3, 1, THREE.RGBAFormat);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }, []);

  // Helper to create material based on mode
  const createMaterial = (color: string | number | THREE.Color, transparent: boolean = false, opacity: number = 1.0, isWireframe: boolean = false) => {
      if (displayMode === 'toon') {
          return new THREE.MeshToonMaterial({
              color: color,
              gradientMap: gradientMap,
              wireframe: isWireframe,
              transparent: transparent,
              opacity: opacity,
          });
      } else {
          return new THREE.MeshStandardMaterial({
              color: color,
              wireframe: isWireframe,
              transparent: transparent,
              opacity: opacity,
          });
      }
  };

  // --- 0. Prepare Base Shapes (Transformations) ---
  // --- 0. Prepare Base Shapes (Transformations) ---
  const { filledCutoutShapes, holeShapes } = useMemo(() => {
      let sources: THREE.Shape[] = [];
      
      if (cutoutShapes && cutoutShapes.length > 0) {
        sources = cutoutShapes;
      } else {
        // Fallback: Create default square centered at 0,0
        // This ensures Inlays and Patterns clipped to "base" still work even without a custom outline
        const half = size / 2;
        const sh = new THREE.Shape();
        sh.moveTo(-half, -half);
        sh.lineTo(half, -half);
        sh.lineTo(half, half);
        sh.lineTo(-half, half);
        sh.lineTo(-half, -half);
        sources = [sh];
      }
      
      const filled: THREE.Shape[] = [];
      const holes: THREE.Shape[] = [];

      sources.forEach(shape => {
          let pts = shape.getPoints();

          // 1. Mirror
          if (baseOutlineMirror) {
              pts = pts.map(p => new THREE.Vector2(-p.x, p.y));
          }

          // 2. Rotate
          if (baseOutlineRotation !== 0) {
              const rad = baseOutlineRotation * (Math.PI / 180);
              const cos = Math.cos(rad);
              const sin = Math.sin(rad);
              pts = pts.map(p => new THREE.Vector2(
                  p.x * cos - p.y * sin,
                  p.x * sin + p.y * cos
              ));
          }

          // 3. Enforce Winding
          // Mirror flips winding. Explicit reverse if mirrored.
          if (baseOutlineMirror) {
              pts.reverse();
          }

          const newShape = new THREE.Shape(pts);
          filled.push(newShape);
          
          if (shape.holes && shape.holes.length > 0) {
              shape.holes.forEach((h: THREE.Path) => {
                    let hPts = h.getPoints();
                    
                    if (baseOutlineMirror) {
                        hPts = hPts.map(p => new THREE.Vector2(-p.x, p.y));
                    }
                    
                    if (baseOutlineRotation !== 0) {
                        const rad = baseOutlineRotation * (Math.PI / 180);
                        const cos = Math.cos(rad);
                        const sin = Math.sin(rad);
                        hPts = hPts.map(p => new THREE.Vector2(
                            p.x * cos - p.y * sin,
                            p.x * sin + p.y * cos
                        ));
                    }

                    // 4. Enforce Winding for Holes
                    if (baseOutlineMirror) {
                         hPts.reverse();
                    }

                    // Convert Path to Shape for CSG extraction
                    const holeShape = new THREE.Shape(hPts);
                    holes.push(holeShape);
              });
          }
      });
      return { filledCutoutShapes: filled, holeShapes: holes };
  }, [cutoutShapes, baseOutlineRotation, baseOutlineMirror, size]);


  // --- 1. Base Mesh Construction ---
  useEffect(() => {
    const group = localGroupRef.current;
    if (!group) return;

    // Clear existing Base
    const existingBase = group.getObjectByName('Base');
    if (existingBase) {
        if (existingBase instanceof THREE.Mesh) {
            existingBase.geometry.dispose();
            (existingBase.material as THREE.Material).dispose();
        }
        group.remove(existingBase);
    }

    // Geometry Generation
    let geometry: THREE.BufferGeometry;
    const extrudeSettings = { depth: thickness, bevelEnabled: false };

    // Use ORIGINAL shapes for visual fidelity (preserves curves)
    if (cutoutShapes && cutoutShapes.length > 0) {
        geometry = new THREE.ExtrudeGeometry(cutoutShapes, extrudeSettings);
    } else {
        const shape = new THREE.Shape()
            .moveTo(-size / 2, -size / 2)
            .lineTo(size / 2, -size / 2)
            .lineTo(size / 2, size / 2)
            .lineTo(-size / 2, size / 2)
            .lineTo(-size / 2, -size / 2);
        geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    }

    const mat = createMaterial(color, false, 1.0, wireframeBase);
    // Ensure DoubleSide if mirroring (negative scale) creates lighting artifacts
    mat.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = 'Base';
    
    // Position/Scale/Rotation
    // Apply Mirror as Scale X
    const sX = baseOutlineMirror ? -1 : 1;
    mesh.scale.set(sX, 1, 1);
    
    // Apply Rotation
    mesh.rotation.z = baseOutlineRotation * (Math.PI / 180);
    
    // Centering Logic
    // If we rotate/mirror, the center of rotation is (0,0).
    // cutoutShapes are centered by 'centerShapes' in uploader, so (0,0) is centroid.
    // This is correct.
    mesh.position.set(0, 0, 0);

    mesh.castShadow = true;
    group.add(mesh);

  }, [size, thickness, color, cutoutShapes, baseOutlineRotation, baseOutlineMirror, wireframeBase, displayMode]);


  // --- 2. Inlays Construction ---
  useEffect(() => {
    const group = localGroupRef.current;
    if (!group) return;

    // Clear existing Inlays
    const toRemove: THREE.Object3D[] = [];
    group.traverse((obj) => {
        if (obj.name.startsWith('Inlay_')) toRemove.push(obj);
    });
    toRemove.forEach(obj => {
        if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            (obj.material as THREE.Material).dispose();
        }
        group.remove(obj);
    });

    if (!inlayShapes || inlayShapes.length === 0) return;
    
    // Cleanup existing Inlay Debug Meshes
    // We must find any object starting with "Debug_Inlay_Cutter_", "Debug_Inlay_Waste_", or "Debug_Hole_Waste_Inlay_"
    const objectsToRemove: THREE.Object3D[] = [];
    group.children.forEach(child => {
        if (
            child.name.startsWith('Debug_Inlay_Cutter_') || 
            child.name.startsWith('Debug_Inlay_Waste_') ||
            child.name.startsWith('Debug_Hole_Waste_Inlay_')
        ) {
            objectsToRemove.push(child);
        }
    });
    objectsToRemove.forEach(obj => {
        if (obj instanceof THREE.Mesh) {
             obj.geometry.dispose();
             if (obj.material instanceof THREE.Material) obj.material.dispose();
        }
        group.remove(obj);
    });

    inlayShapes.forEach((item, i) => {
        if (item.color === 'transparent') return;

        // Generate Inlays
        const totalDepth = inlayDepth + Number(inlayExtend || 0) + ((i + 1) * 0.001);
        const mat = createMaterial(item.color === 'base' ? color : item.color, false, 1.0, wireframeInlay);

        // Transform Shape if Mirror is required (to avoid negative scale on Geometry causing CSG issues)
        let shapeToExtrude = item.shape;
        if (inlayMirror) {
             const pts = item.shape.getPoints().map(p => new THREE.Vector2(-p.x, p.y));
             // Mirror flips winding (CCW -> CW). Restore CCW by key reversal.
             pts.reverse();
             
             const newShape = new THREE.Shape(pts);
             if (item.shape.holes && item.shape.holes.length > 0) {
                 item.shape.holes.forEach(h => {
                      let hPts = h.getPoints().map(p => new THREE.Vector2(-p.x, p.y));
                      // Mirror flips winding (CW -> CCW). Restore CW by key reversal.
                      hPts.reverse();
                      newShape.holes.push(new THREE.Path(hPts));
                 });
             }
             shapeToExtrude = newShape;
        }

        const geo = new THREE.ExtrudeGeometry(shapeToExtrude, { depth: totalDepth, bevelEnabled: false });
        
        // 1. Bake transforms
        geo.translate(0, 0, thickness - inlayDepth);
        
        // Apply Transforms (Scale/Rotate)
        // Use POSITIVE scale always, as Mirror is handled by shape transform
        geo.applyMatrix4(new THREE.Matrix4().makeScale(inlayScale, inlayScale, 1));
        geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(inlayRotation * (Math.PI / 180)));

        // Check if we need CSG
        // Always clip Inlays to the Base Outline if it exists
        const needsClipping = filledCutoutShapes && filledCutoutShapes.length > 0;
        const hasHoles = holeShapes && holeShapes.length > 0;

        if (!needsClipping && !hasHoles) {
             // Fast Path
             const mesh = new THREE.Mesh(geo, mat);
             mesh.name = `Inlay_${i}`;
             mesh.castShadow = true;
             mesh.receiveShadow = true;
             group.add(mesh);
        } else {
            // CSG Path
            // 2. Setup Evaluator
            const evaluator = new Evaluator();
            evaluator.attributes = ['position', 'normal'];

            let resultBrush = new Brush(geo);
            resultBrush.updateMatrixWorld();

            // 3. Subtract Holes
            if (hasHoles) {
                // Calculate required cutter height: Base + Max Features + Margin
                const holeDepth = thickness + Math.max(Number(patternScaleZ || 0), Number(inlayExtend || 0)) + 20;
                
                const holeGeo = new THREE.ExtrudeGeometry(holeShapes, { depth: holeDepth, bevelEnabled: false });
                const holeBrush = new Brush(holeGeo);
                holeBrush.position.z = -10;
                holeBrush.updateMatrixWorld();
                
                // Calculate Waste (The holes being removed)
                const wasteBrush = evaluator.evaluate(resultBrush, holeBrush, INTERSECTION);
                
                // Render Waste Material (Highlighted Red to match tool, 0.5 opacity)
                const wasteMat = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.5, transparent: true, side: THREE.DoubleSide, depthWrite: false });
                const wasteMesh = new THREE.Mesh(wasteBrush.geometry, wasteMat);
                wasteMesh.name = `Debug_Hole_Waste_Inlay_${i}`;
                wasteMesh.visible = !!debugShowHoleCutter;
                group.add(wasteMesh);

                resultBrush = evaluator.evaluate(resultBrush, holeBrush, SUBTRACTION);
                holeGeo.dispose();
            }

            // 4. Clip to Outline (Intersection)
            if (needsClipping) {
                // Calculate required cutter height: Base + Max Features + Margin
                const cutterDepth = thickness + Math.max(Number(patternScaleZ || 0), Number(inlayExtend || 0)) + 5;

                const cutterGeo = new THREE.ExtrudeGeometry(filledCutoutShapes, { 
                    depth: cutterDepth, 
                    bevelEnabled: false,
                });
                const cutterBrush = new Brush(cutterGeo);
                cutterBrush.updateMatrixWorld();
                
                // Calculate Waste (The part being removed)
                const wasteBrush = evaluator.evaluate(resultBrush, cutterBrush, SUBTRACTION);
                
                // Render Waste Material (Highlighted Green to match tool, 0.5 opacity)
                const wasteMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, opacity: 0.5, transparent: true, side: THREE.DoubleSide, depthWrite: false });
                const wasteMesh = new THREE.Mesh(wasteBrush.geometry, wasteMat);
                wasteMesh.name = `Debug_Inlay_Waste_${i}`;
                wasteMesh.visible = !!debugShowInlayCutter;
                group.add(wasteMesh);

                // Calculate Result (The part being kept)
                resultBrush = evaluator.evaluate(resultBrush, cutterBrush, INTERSECTION);
                
                // Always create debug mesh (visibility controlled by effect)
                const debugMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, opacity: 0.01, transparent: true, side: THREE.DoubleSide, depthWrite: false });
                const debugMesh = new THREE.Mesh(cutterGeo.clone(), debugMat);
                debugMesh.name = `Debug_Inlay_Cutter_${i}`;
                debugMesh.visible = !!debugShowInlayCutter;
                group.add(debugMesh);

                cutterGeo.dispose();
            }

            const mesh = new THREE.Mesh(resultBrush.geometry, mat);
            mesh.name = `Inlay_${i}`;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
        }
    });

  }, [inlayShapes, inlayDepth, inlayScale, inlayRotation, inlayExtend, inlayMirror, thickness, color, wireframeInlay, clipToOutline, filledCutoutShapes, holeShapes, displayMode]);


  // --- 3. Pattern Construction (The Heavy Lifter) ---
  useEffect(() => {
    const group = localGroupRef.current;
// ... (rest of function implicit)
    if (!group) return;

    // Signal start of processing
    onProcessingChange?.(true);

    // Use setTimeout to allow the UI to render the loading state (spinner)
    // before locking the main thread with heavy geometry generation.
    const timer = setTimeout(() => {
        try {
            // Cleanup old Pattern
            const existingPattern = group.getObjectByName('Pattern');
            if (existingPattern) {
                 if (existingPattern instanceof THREE.Mesh || existingPattern instanceof THREE.InstancedMesh) {
                    existingPattern.geometry.dispose();
                    if (Array.isArray(existingPattern.material)) {
                        existingPattern.material.forEach(m => m.dispose());
                    } else {
                        (existingPattern.material as THREE.Material).dispose();
                    }
                 }
                 group.remove(existingPattern);
            }
            
            // Cleanup Pattern/Hole Debug Meshes
            ['Debug_Pattern_Cutter', 'Debug_Hole_Cutter', 'Debug_Pattern_Waste', 'Debug_Pattern_Waste_Exclusion', 'Debug_Hole_Waste_Pattern'].forEach(name => {
                const obj = group.getObjectByName(name);
                if (obj) {
                     if (obj instanceof THREE.Mesh) {
                        obj.geometry.dispose();
                        if (obj.material instanceof THREE.Material) obj.material.dispose();
                     }
                     group.remove(obj);
                 }
            });

    if (!patternShapes || patternShapes.length === 0) return;

    // ---------------------------------------------------------
    // A. Prepare Unit Geometry
    // ---------------------------------------------------------

    // We now assume patternShapes[0] is always a BufferGeometry (STL)
    // OR an array of Shapes (SVG/DXF) which we convert to ExtrudeGeometry
    let unitGeo: THREE.BufferGeometry | null = null;
    
    if (patternShapes[0] instanceof THREE.BufferGeometry) {
        unitGeo = patternShapes[0].clone();
    } else {
        // Assume THREE.Shape[] or objects with .shape
        try {
            const shapes = patternShapes.map((s: any) => s.shape || s).filter((s: any) => s instanceof THREE.Shape);
            if (shapes.length > 0) {
                 // Use depth 1 for unit geometry, scaling handles the rest
                 unitGeo = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
                 
                 // Center logic: ExtrudeGeometry is usually roughly centered if shapes are centered?
                 // But we center unitGeo later anyway (lines 414+).
                 // However, Extrusion starts at Z=0 and goes to Z=depth.
                 // Centering later handles X/Y/Z.
            }
        } catch (e) {
            console.error("Error converting shapes to geometry", e);
        }
        
        if (!unitGeo) {
             console.warn("Invalid pattern shapes received");
             return;
        }
    }

    if (!unitGeo) return;



    // Center the Geometry locally
    unitGeo.computeBoundingBox();
    const center = new THREE.Vector3(); 
    if (unitGeo.boundingBox) unitGeo.boundingBox.getCenter(center);
    unitGeo.translate(-center.x, -center.y, -center.z);

    // Apply Base Rotation
    if (baseRotation !== 0) {
        let rotationToApply = baseRotation;
        if (rotationClamp && rotationClamp > 0) {
             const steps = Math.round(baseRotation / rotationClamp);
             rotationToApply = steps * rotationClamp;
        }

        unitGeo.rotateZ(rotationToApply * (Math.PI / 180));
        unitGeo.computeBoundingBox(); // Recompute bounds after rotation
    }

    // Apply scaling to geometry if it's instanced, usually we scale via Matrix, 
    // but for Merge fallback, we need it. 
    // Ideally, for InstancedMesh, we set scale in the instance matrix.
    // However, the `generateTilePositions` logic assumes "patternWidth" is pre-scaled.
    

    // ---------------------------------------------------------
    // B. Calculate Positions
    // ---------------------------------------------------------
    let bounds = new THREE.Box2(new THREE.Vector2(-size/2, -size/2), new THREE.Vector2(size/2, size/2));
    if (filledCutoutShapes && filledCutoutShapes.length > 0) {
        const sb = getShapesBounds(filledCutoutShapes);
        bounds = new THREE.Box2(sb.min, sb.max);
    }

    let pWidth = 0, pHeight = 0;
    if (unitGeo.boundingBox) {
        // Dimensions * Scale
        pWidth = (unitGeo.boundingBox.max.x - unitGeo.boundingBox.min.x) * patternScale;
        pHeight = (unitGeo.boundingBox.max.y - unitGeo.boundingBox.min.y) * patternScale;
    }

    // Helper to scale and rotate shapes
    const scaleShape = (original: any) => {
        const shape = original.shape || original;
        if (inlayScale === 1 && inlayRotation === 0) return shape;
        
        const newShape = new THREE.Shape();
        
        // Pre-calc rotation
        const rad = inlayRotation * (Math.PI / 180);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const transform = (p: THREE.Vector2) => {
            // 1. Scale (Mirror X if needed)
            const sx = p.x * (inlayMirror ? -inlayScale : inlayScale);
            const sy = p.y * inlayScale;
            // 2. Rotate
            const rx = sx * cos - sy * sin;
            const ry = sx * sin + sy * cos;
            return new THREE.Vector2(rx, ry);
        };
        
        // If mirroring, we might need to reverse winding order?
        // ThreeJS standard: CCW = solid.
        // If we flip X, CCW becomes CW.
        // So if mirrored, we should reverse the point order to maintain CCW winding.
        
        const pts = shape.getPoints().map(transform);
        if (inlayMirror) pts.reverse();

        pts.forEach((p: THREE.Vector2, i: number) => {
            if (i === 0) newShape.moveTo(p.x, p.y);
            else newShape.lineTo(p.x, p.y);
        });
        
        if (shape.holes && shape.holes.length > 0) {
            shape.holes.forEach((h: THREE.Path) => {
                const newHole = new THREE.Path();
                h.getPoints().forEach((p: THREE.Vector2, i: number) => {
                    const tp = transform(p);
                    if (i === 0) newHole.moveTo(tp.x, tp.y);
                    else newHole.lineTo(tp.x, tp.y);
                });
                newShape.holes.push(newHole);
            });
        }
        return newShape;
    };

    const finalExclusionShapes = inlayShapes 
        ? inlayShapes.filter(s => (s.gripMode === 'exclude' || (!s.gripMode && s.excludePattern))).map(scaleShape)
        : [];

    const finalInclusionShapes = inlayShapes
        ? inlayShapes.filter(s => s.gripMode === 'include').map(scaleShape)
        : [];

    const positions = isTiled ? generateTilePositions(
        bounds, pWidth, pHeight, tileSpacing, 
        filledCutoutShapes || null, patternMargin, 
        clipToOutline, // Allow Partial?
        tilingDistribution, tilingOrientation,
        tilingDirection,
        finalExclusionShapes,
        finalInclusionShapes
    ) : [{ position: new THREE.Vector2(0,0), rotation: 0, scale: 1 }];

    // Apply Rotation Clamp to Instances (e.g. Random Orientation)
    if (rotationClamp && rotationClamp > 0) {
        const radClamp = rotationClamp * (Math.PI / 180);
        positions.forEach(p => {
             const steps = Math.round(p.rotation / radClamp);
             p.rotation = steps * radClamp;
        });
    }

    if (positions.length === 0) return;

    // ---------------------------------------------------------
    // C. Render Selection (Instanced vs Merged CSG)
    // ---------------------------------------------------------
    
    // Material
    const mat = createMaterial(patternColor, patternOpacity < 1.0, patternOpacity, wireframePattern);

    // STRATEGY: 
    // If NOT cutting to outline -> InstancedMesh (Fastest)
    // If cutting to outline -> Merged Geometry -> CSG Intersection (Accurate)

    // Determine Z Scale (default to XY scale if auto/undefined)
    const actualScaleZ = (patternScaleZ !== undefined && patternScaleZ > 0) ? patternScaleZ : patternScale;
    
    // Calculate actual pattern height for cutter sizing
    let maxPatternHeight = 0;
    if (unitGeo && unitGeo.boundingBox) {
         const h = unitGeo.boundingBox.max.z - unitGeo.boundingBox.min.z;
         maxPatternHeight = h * actualScaleZ;
    }
    
    // Fallback if bounds missing (though unitGeo should have them)
    if (maxPatternHeight === 0) maxPatternHeight = actualScaleZ * 10; // Safer fallback? Or just use scale.

    // Scale Unit Geometry if needed (Merged Path only - Instanced path scales the instance)
    // InstancedMesh handles scale via matrix, so we don't modify unitGeo there.
    // However, for Merged Path, we modify the dummy object.
    
    
    // Position/Scale Handling
    const hasExclusions = finalExclusionShapes && finalExclusionShapes.length > 0;
    const hasClipping = clipToOutline && filledCutoutShapes && filledCutoutShapes.length > 0;
    const hasHoles = holeShapes && holeShapes.length > 0;
    const hasHeightCut = patternMaxHeight !== undefined && patternMaxHeight > 0;
    const useCSG = hasClipping || hasExclusions || hasHoles || hasHeightCut;

    if (!useCSG) {
        // --- INSTANCED MESH PATH --- (No changes, logic same)
        const iMesh = new THREE.InstancedMesh(unitGeo, mat, positions.length);
        iMesh.name = 'Pattern';
        iMesh.castShadow = true;
        iMesh.receiveShadow = true;
        
        const dummy = new THREE.Object3D();
        
        positions.forEach((p, i) => {
            dummy.scale.set(patternScale * p.scale, patternScale * p.scale, actualScaleZ * p.scale);
            const instH = (unitGeo!.boundingBox!.max.z - unitGeo!.boundingBox!.min.z) * Math.abs(dummy.scale.z);
            const zCenter = thickness - 0.01 + (instH / 2);
            
            dummy.position.set(p.position.x, p.position.y, zCenter);
            dummy.rotation.set(0, 0, p.rotation);
            dummy.updateMatrix();
            iMesh.setMatrixAt(i, dummy.matrix);
        });

        iMesh.instanceMatrix.needsUpdate = true;
        group.add(iMesh);

    } else {
        // --- CSG PATH (Merged) ---
        const geometries: THREE.BufferGeometry[] = [];
        const dummy = new THREE.Object3D();

        positions.forEach(p => {
             dummy.scale.set(patternScale * p.scale, patternScale * p.scale, actualScaleZ * p.scale);
             const instH = (unitGeo!.boundingBox!.max.z - unitGeo!.boundingBox!.min.z) * Math.abs(dummy.scale.z);
             const zCenter = thickness - 0.01 + (instH / 2);
             
             dummy.position.set(p.position.x, p.position.y, zCenter);
             dummy.rotation.set(0, 0, p.rotation);
             dummy.updateMatrix();
             
             const clone = unitGeo!.clone();
             clone.applyMatrix4(dummy.matrix);
             geometries.push(clone);
        });

        if (geometries.length === 0) return;
        const rawMergedGeo = mergeGeometries(geometries);
        const mergedGeo = mergeVertices(rawMergedGeo);
        rawMergedGeo.dispose();
        
        const evaluator = new Evaluator();
        evaluator.attributes = ['position', 'normal'];

        let resultBrush = new Brush(mergedGeo);
        resultBrush.updateMatrixWorld();

        // 3a. Subtraction (Exclusions)
        if (hasExclusions) {
            const exclusionGeo = new THREE.ExtrudeGeometry(finalExclusionShapes, { depth: 1000, bevelEnabled: false });
            let effectiveExclusionBrush = new Brush(exclusionGeo);
            effectiveExclusionBrush.position.z = -100;
            effectiveExclusionBrush.updateMatrixWorld();

            if (finalInclusionShapes && finalInclusionShapes.length > 0) {
                 const inclusionGeo = new THREE.ExtrudeGeometry(finalInclusionShapes, { depth: 1000, bevelEnabled: false });
                const inclusionBrush = new Brush(inclusionGeo);
                inclusionBrush.position.z = -100; 
                inclusionBrush.updateMatrixWorld();
                effectiveExclusionBrush = evaluator.evaluate(effectiveExclusionBrush, inclusionBrush, SUBTRACTION);
                inclusionGeo.dispose();
            }

            // Calculate Exclusion Waste (Intersection of Result and Exclusion)
            const exclusionWasteBrush = evaluator.evaluate(resultBrush, effectiveExclusionBrush, INTERSECTION);
             // Render Waste Material (Highlighted Green to match inlay tool, 0.5 opacity)
            const wasteMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, opacity: 0.5, transparent: true, side: THREE.DoubleSide, depthWrite: false });
            const wasteMesh = new THREE.Mesh(exclusionWasteBrush.geometry, wasteMat);
            wasteMesh.name = 'Debug_Pattern_Waste_Exclusion';
            // Match Transforms? Brush is likely world-space already if evaluated? 
            // Evaluator results are usually new meshes. 
            // Wait, evaluate returns a Brush. We need to respect its transform if it has one, 
            // but usually result of evaluate is baked or needs update?
            // Actually, evaluate returns a Brush with geometry. 
            // We should check if we need to set position/scale.
            // Usually result is in local space of the operation.
            // Let's assume standard behavior:
            wasteMesh.visible = !!debugShowPatternCutter;
            group.add(wasteMesh);


            resultBrush = evaluator.evaluate(resultBrush, effectiveExclusionBrush, SUBTRACTION);
            exclusionGeo.dispose();
        }

        // 3a. Subtraction (Exclusions)
        // ... (Exclusion logic unchanged for now, but usually exclusions are part of valid shape)


            
            // 3b. Subtract Holes (Always if present)
            if (hasHoles) {
                let finalHoleShapes = holeShapes;
                
                // Apply Margin (Expand Holes)
                if (patternMargin && Math.abs(patternMargin) > 0.001) {
                     // Expand the hole shape (Positive Offset) -> Note: Holes are treated as positive polys in offsetUtils
                     // CLIPPER OFFSET: +patternMargin
                     const offsetShapes: THREE.Shape[] = [];
                     holeShapes.forEach(s => {
                         const res = offsetShape(s, patternMargin); 
                         offsetShapes.push(...res);
                     });
                     if (offsetShapes.length > 0) {
                         finalHoleShapes = offsetShapes;
                     }
                }
            
                // Calculate required cutter height: Base + Max Features + Margin
                const holeDepth = thickness + Math.max(maxPatternHeight, Number(inlayExtend || 0)) + 20;
    
                const holeGeo = new THREE.ExtrudeGeometry(finalHoleShapes, { depth: holeDepth, bevelEnabled: false });
            const holeBrush = new Brush(holeGeo);
            holeBrush.position.z = -10;
            holeBrush.updateMatrixWorld();
            
            // Calculate Waste (The holes being removed)
            const wasteBrush = evaluator.evaluate(resultBrush, holeBrush, INTERSECTION);
            
            // Render Waste Material (Highlighted Red to match tool, 0.5 opacity)
            const wasteMat = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.5, transparent: true, side: THREE.DoubleSide, depthWrite: false });
            const wasteMesh = new THREE.Mesh(wasteBrush.geometry, wasteMat);
            wasteMesh.name = 'Debug_Hole_Waste_Pattern';
            wasteMesh.visible = !!debugShowHoleCutter;
            group.add(wasteMesh);

            resultBrush = evaluator.evaluate(resultBrush, holeBrush, SUBTRACTION);
            
            // Always create debug mesh for holes
            const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.3, transparent: true, side: THREE.DoubleSide, depthWrite: false });
            const debugMesh = new THREE.Mesh(holeGeo.clone(), debugMat);
            debugMesh.name = 'Debug_Hole_Cutter';
            debugMesh.position.z = -10;
            debugMesh.visible = !!debugShowHoleCutter;
            group.add(debugMesh);

            holeGeo.dispose();
        }

        // 3c. Intersection (Outline)
        if (hasClipping && filledCutoutShapes) {
            // Apply Margin via Offset to the SHAPES, not the Brush
            let finalCutoutShapes = filledCutoutShapes;
            
            if (patternMargin && Math.abs(patternMargin) > 0.001) {
                // Erode the outer shape (Negative Offset)
                // CLIPPER OFFSET: -margin
                 const offsetShapes: THREE.Shape[] = [];
                 filledCutoutShapes.forEach(s => {
                     const res = offsetShape(s, -patternMargin);
                     offsetShapes.push(...res);
                 });
                 if (offsetShapes.length > 0) {
                     finalCutoutShapes = offsetShapes;
                 }
            }

            // Calculate required cutter height: Base + Max Features + Margin
            const cutterDepth = thickness + Math.max(maxPatternHeight, Number(inlayExtend || 0)) + 5;

            // Create simplified cutter geometry without bevels
            const cutterGeo = new THREE.ExtrudeGeometry(finalCutoutShapes, {
                depth: cutterDepth, 
                bevelEnabled: false 
            });
            
            // Center the geometry? No, keep it in place.
            // Previous code centered it for scaling. But now we offset in place.
            // So we just create the brush.
            const cutterBrush = new Brush(cutterGeo);
            cutterBrush.updateMatrixWorld();
            
            // Calculate Waste (The part being removed by the margin/clip)
            const wasteBrush = evaluator.evaluate(resultBrush, cutterBrush, SUBTRACTION);
            
            // Render Waste Material (Highlighted Blue to match tool, 0.5 opacity)
            const wasteMat = new THREE.MeshBasicMaterial({ color: 0x0000ff, opacity: 0.5, transparent: true, side: THREE.DoubleSide, depthWrite: false });
            const wasteMesh = new THREE.Mesh(wasteBrush.geometry, wasteMat);
            wasteMesh.name = 'Debug_Pattern_Waste';
            // Match Transforms
            wasteMesh.scale.copy(wasteBrush.scale);
            wasteMesh.position.copy(wasteBrush.position);
            wasteMesh.visible = !!debugShowPatternCutter;
            group.add(wasteMesh);

            resultBrush = evaluator.evaluate(resultBrush, cutterBrush, INTERSECTION);
            
            // Always create debug mesh for pattern cutter
            const debugMat = new THREE.MeshBasicMaterial({ color: 0x0000ff, opacity: 0.3, transparent: true, side: THREE.DoubleSide, depthWrite: false });
            const debugMesh = new THREE.Mesh(cutterGeo.clone(), debugMat);
            debugMesh.name = 'Debug_Pattern_Cutter';
            // Match Transforms
            debugMesh.scale.copy(cutterBrush.scale);
            debugMesh.position.copy(cutterBrush.position);
            debugMesh.visible = !!debugShowPatternCutter;
            group.add(debugMesh);

            // Clean up cutter geometry
            cutterGeo.dispose();
        }

        // 3d. Max Height Cut (Top Plane Cut)
        if (hasHeightCut) {
             // Create a large box that sits above the max height
             // Size: Huge (covers everything)
             // Size: Huge (covers everything)
             const boxSize = 10000;
             const cutStart = thickness + patternMaxHeight!;
             // Use calculated geometry height + safe margin to ensure we cut everything
             const cutHeight = (maxPatternHeight || 1000) + 1000;

             const cutterGeo = new THREE.BoxGeometry(boxSize, boxSize, cutHeight);
             // Box origin is center. We want bottom face at cutStart.
             // Center Z = cutStart + (cutHeight / 2)
             const zPos = cutStart + (cutHeight / 2);

             const cutterBrush = new Brush(cutterGeo);
             cutterBrush.position.set(0, 0, zPos);
             cutterBrush.updateMatrixWorld();

             // Subtract from result
             resultBrush = evaluator.evaluate(resultBrush, cutterBrush, SUBTRACTION);
             cutterGeo.dispose();
        }
        
        // 4. Result Mesh
        resultBrush.name = 'Pattern';
        resultBrush.material = mat;
        resultBrush.castShadow = true;
        resultBrush.receiveShadow = true;
        group.add(resultBrush);
        
        // Cleanup intermediates?
        geometries.forEach(g => g.dispose());
        mergedGeo.dispose();
    }
    
    } finally {
        // Signal end of processing
        onProcessingChange?.(false);
    }
    }, 10);

    return () => {
        clearTimeout(timer);
    };

  }, [
      patternColor, wireframePattern, 
      patternScale, patternScaleZ, 
      isTiled, tileSpacing, patternMargin, tilingDistribution, tilingOrientation, tilingDirection,
      clipToOutline, displayMode, inlayShapes, inlayScale, inlayRotation, inlayMirror, baseRotation, rotationClamp,
      thickness, filledCutoutShapes, holeShapes, patternShapes, size, patternMaxHeight,
      filledCutoutShapes, holeShapes, patternShapes, size // Removed redundant checks, kept keys
  ]);

  // --- 4. Debug Visibility & Material Effect ---
  // This lightweight effect handles toggling visibility and material props without rebuilding geometry
  useEffect(() => {
     const group = localGroupRef.current;
     if (!group) return;

     // Fast Update Pattern Opacity
     const patternMesh = group.getObjectByName('Pattern');
     if (patternMesh && patternMesh instanceof THREE.Mesh) {
         const mat = patternMesh.material as THREE.Material;
         if (mat && typeof patternOpacity === 'number') {
             mat.opacity = patternOpacity;
             mat.transparent = patternOpacity < 1.0;
             mat.needsUpdate = true;
         }
     }

     // Fast Update Base Opacity
     const baseMesh = group.getObjectByName('Base');
     if (baseMesh && baseMesh instanceof THREE.Mesh) {
         const mat = baseMesh.material as THREE.Material;
         if (mat && typeof baseOpacity === 'number') {
             mat.opacity = baseOpacity;
             mat.transparent = baseOpacity < 1.0;
             mat.needsUpdate = true;
         }
     }

     // Fast Update Inlay Opacity (Iterate children)
     // Inlays are named "Inlay_0", "Inlay_1", etc.
     group.children.forEach(child => {
         if (child.name.startsWith('Inlay_')) {
             if (child instanceof THREE.Mesh) {
                const mat = child.material as THREE.Material;
                if (mat && typeof inlayOpacity === 'number') {
                    mat.opacity = inlayOpacity;
                    mat.transparent = inlayOpacity < 1.0;
                    mat.needsUpdate = true;
                }
             }
         }
     });

     const patternCutter = group.getObjectByName('Debug_Pattern_Cutter');
     if (patternCutter) patternCutter.visible = !!debugShowPatternCutter;
     
     const patternWaste = group.getObjectByName('Debug_Pattern_Waste');
     if (patternWaste) patternWaste.visible = !!debugShowPatternCutter;

     // Exclusion Waste is tied to Inlay Cutter (as it shows Inlay effect on Pattern)
     const patternWasteEx = group.getObjectByName('Debug_Pattern_Waste_Exclusion');
     if (patternWasteEx) patternWasteEx.visible = !!debugShowInlayCutter;

     const holeCutter = group.getObjectByName('Debug_Hole_Cutter');
     if (holeCutter) holeCutter.visible = !!debugShowHoleCutter;

     const holeWasteInlay = group.getObjectByName('Debug_Hole_Waste_Inlay');
     if (holeWasteInlay) holeWasteInlay.visible = !!debugShowHoleCutter;
     
     const holeWastePattern = group.getObjectByName('Debug_Hole_Waste_Pattern');
     if (holeWastePattern) holeWastePattern.visible = !!debugShowHoleCutter;

     // Handle Inlay Cutters (multiple)
     group.children.forEach(child => {
         if (child.name.startsWith('Debug_Inlay_Cutter_')) {
             child.visible = !!debugShowInlayCutter;
         }
         if (child.name.startsWith('Debug_Inlay_Waste_')) {
             child.visible = !!debugShowInlayCutter;
         }
         // Inlay loop might generate hole waste too if per-inlay (currently generated once per loop? No, inInlay loop)
         // Actually, if we generate 'Debug_Hole_Waste_Inlay' inside the loop, it should be unique if multiple inlays.
         // But logic is inside loop, so yes.
         // Wait, the Inlay Loop generates inlays individually.
         // 'Debug_Hole_Waste_Inlay' needs unique name like 'Debug_Hole_Waste_Inlay_0'.
         if (child.name.startsWith('Debug_Hole_Waste_Inlay')) {
             child.visible = !!debugShowHoleCutter;
         }
     });

  }, [debugShowPatternCutter, debugShowHoleCutter, debugShowInlayCutter, patternOpacity, baseOpacity, inlayOpacity]);

  return <group ref={localGroupRef} />;
});

export default ImperativeModel;
