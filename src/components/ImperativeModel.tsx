import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { generateTilePositions, getShapesBounds } from '../utils/patternUtils';

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
  baseRotation?: number;
  clipToOutline?: boolean;
  inlayShapes?: any[] | null | undefined;
  inlayDepth?: number;
  inlayScale?: number;
  inlayRotation?: number;
  inlayExtend?: number;
  wireframeBase?: boolean;
  wireframeInlay?: boolean;
  wireframePattern?: boolean;
  patternOpacity?: number;
  displayMode?: 'normal' | 'toon';
  onProcessingChange?: (isProcessing: boolean) => void;
}

const ImperativeModel = React.forwardRef<THREE.Group, ImperativeModelProps>(({
  size,
  thickness,
  color,
  patternColor,
  cutoutShapes,
  patternShapes,
  patternType,
  patternScale,
  patternScaleZ,
  isTiled,
  tileSpacing,
  patternMargin,
  tilingDistribution = 'hex',
  tilingDirection = 'horizontal',
  tilingOrientation = 'aligned',
  baseRotation = 0,
  clipToOutline = false,
  inlayShapes,
  inlayDepth = 0.6,
  inlayScale = 1,
  inlayRotation = 0,
  inlayExtend = 0,
  wireframeBase = false,
  wireframeInlay = false,
  wireframePattern = false,
  patternOpacity = 1.0,
  displayMode = 'normal',
  onProcessingChange,
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

    const material = createMaterial(color, false, 1.0, wireframeBase);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Base';
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);

  }, [size, thickness, color, cutoutShapes, wireframeBase, displayMode]);


  // --- 2. Inlays Construction ---
  useEffect(() => {
    const group = localGroupRef.current;
    if (!group) return;

    // Cleanup old inlays
    const toRemove: THREE.Object3D[] = [];
    group.traverse((child) => {
        if (child.name.startsWith('Inlay_')) toRemove.push(child);
    });
    toRemove.forEach(child => {
        if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
        }
        group.remove(child);
    });

    if (!inlayShapes || inlayShapes.length === 0) return;

    inlayShapes.forEach((item, i) => {
        if (item.color === 'transparent') return;

        const totalDepth = inlayDepth + Number(inlayExtend || 0) + ((i + 1) * 0.001);
        const geo = new THREE.ExtrudeGeometry(item.shape, { depth: totalDepth, bevelEnabled: false });
        
        const mat = createMaterial(item.color === 'base' ? color : item.color, false, 1.0, wireframeInlay);

        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `Inlay_${i}`;
        mesh.position.set(0, 0, thickness - inlayDepth);
        mesh.scale.set(inlayScale, inlayScale, 1);
        mesh.rotation.z = inlayRotation * (Math.PI / 180);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
    });

  }, [inlayShapes, inlayDepth, inlayScale, inlayRotation, inlayExtend, thickness, color, wireframeInlay, displayMode]);


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

    if (!patternShapes || patternShapes.length === 0) return;

    // ---------------------------------------------------------
    // A. Prepare Unit Geometry
    // ---------------------------------------------------------

    // We now assume patternShapes[0] is always a BufferGeometry (STL)
    // as we've removed SVG/DXF support for patterns.
    let unitGeo: THREE.BufferGeometry | null = null;
    
    if (patternShapes[0] instanceof THREE.BufferGeometry) {
        unitGeo = patternShapes[0].clone();
    } else {
        // Fallback or error if somehow non-STL passed (though Controls restricts it)
        console.warn("Non-STL pattern shape received in STL-only mode");
        return; 
    }

    if (!unitGeo) return;



    // Center the Geometry locally
    unitGeo.computeBoundingBox();
    const center = new THREE.Vector3(); 
    if (unitGeo.boundingBox) unitGeo.boundingBox.getCenter(center);
    unitGeo.translate(-center.x, -center.y, -center.z);

    // Apply Base Rotation
    if (baseRotation !== 0) {
        unitGeo.rotateZ(baseRotation * (Math.PI / 180));
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
    if (cutoutShapes && cutoutShapes.length > 0) {
        const sb = getShapesBounds(cutoutShapes);
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
            // 1. Scale
            const sx = p.x * inlayScale;
            const sy = p.y * inlayScale;
            // 2. Rotate
            const rx = sx * cos - sy * sin;
            const ry = sx * sin + sy * cos;
            return new THREE.Vector2(rx, ry);
        };
        
        shape.getPoints().forEach((p: THREE.Vector2, i: number) => {
            const tp = transform(p);
            if (i === 0) newShape.moveTo(tp.x, tp.y);
            else newShape.lineTo(tp.x, tp.y);
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
        cutoutShapes, patternMargin, 
        clipToOutline, // Allow Partial?
        tilingDistribution, tilingOrientation,
        tilingDirection,
        finalExclusionShapes,
        finalInclusionShapes
    ) : [{ position: new THREE.Vector2(0,0), rotation: 0, scale: 1 }];


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
    
    // Scale Unit Geometry if needed (Merged Path only - Instanced path scales the instance)
    // InstancedMesh handles scale via matrix, so we don't modify unitGeo there.
    // However, for Merged Path, we modify the dummy object.
    
    
    // Position/Scale Handling
    const hasExclusions = finalExclusionShapes && finalExclusionShapes.length > 0;
    const hasClipping = clipToOutline && cutoutShapes && cutoutShapes.length > 0;
    const useCSG = hasClipping || hasExclusions;

    if (!useCSG) {
        // --- INSTANCED MESH PATH ---
        const iMesh = new THREE.InstancedMesh(unitGeo, mat, positions.length);
        iMesh.name = 'Pattern';
        iMesh.castShadow = true;
        iMesh.receiveShadow = true;
        
        const dummy = new THREE.Object3D();
        
        positions.forEach((p, i) => {
            // Apply scale first to determine height

            // Apply scale (XY = patternScale, Z = actualScaleZ)
            dummy.scale.set(patternScale * p.scale, patternScale * p.scale, actualScaleZ * p.scale);

            // Calculate exact height of the instance
            const instH = (unitGeo!.boundingBox!.max.z - unitGeo!.boundingBox!.min.z) * Math.abs(dummy.scale.z);
            
            // Position on top of surface (Thickness)
            // Geometry is centered at (0,0,0), so we lift it by half its height
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
        // 1. Create Merged Geometry
        const geometries: THREE.BufferGeometry[] = [];
        const dummy = new THREE.Object3D();

        positions.forEach(p => {
             // Scale
             
             // Apply scale (XY = patternScale, Z = actualScaleZ)
             dummy.scale.set(patternScale * p.scale, patternScale * p.scale, actualScaleZ * p.scale);

             // Position
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
        // Optimize and ensure index
        const mergedGeo = mergeVertices(rawMergedGeo);
        rawMergedGeo.dispose();
        
        // 3. Perform CSG
        const evaluator = new Evaluator();
        // Avoid attribute mismatch errors (e.g. missing UVs on STL)
        evaluator.attributes = ['position', 'normal'];

        let resultBrush = new Brush(mergedGeo);
        resultBrush.updateMatrixWorld();

        // 3a. Subtraction (Exclusions)
        if (hasExclusions) {
            const exclusionGeo = new THREE.ExtrudeGeometry(finalExclusionShapes, {
                depth: 1000, 
                bevelEnabled: false
            });
            
            let effectiveExclusionBrush = new Brush(exclusionGeo);
            // Move it down so it starts below pattern and goes way up
            effectiveExclusionBrush.position.z = -100;
            effectiveExclusionBrush.updateMatrixWorld();

            // Handle Inclusions (Islands inside Exclusion)
            if (finalInclusionShapes && finalInclusionShapes.length > 0) {
                 const inclusionGeo = new THREE.ExtrudeGeometry(finalInclusionShapes, {
                    depth: 1000, 
                    bevelEnabled: false
                });
                const inclusionBrush = new Brush(inclusionGeo);
                inclusionBrush.position.z = -100; // Same space as exclusion
                inclusionBrush.updateMatrixWorld();

                // Subtract Inclusions FROM Exclusion
                // Result = Exclusion - Inclusion (The "Donut")
                // When we Subtract "Donut" from "Pattern", the "Hole" (Inclusion) remains as Pattern.
                effectiveExclusionBrush = evaluator.evaluate(effectiveExclusionBrush, inclusionBrush, SUBTRACTION);
                
                inclusionGeo.dispose();
            }
            
            resultBrush = evaluator.evaluate(resultBrush, effectiveExclusionBrush, SUBTRACTION);
            
            // Clean up exclusion geometry
            exclusionGeo.dispose();
        }

        // 3b. Intersection (Outline)
        if (hasClipping) {
            const cutterGeo = new THREE.ExtrudeGeometry(cutoutShapes, {
                depth: 1000, 
                bevelEnabled: true, 
                bevelThickness: 0.1, 
                bevelSize: -patternMargin,
                bevelSegments: 1, 
                bevelOffset: 0
            });
            
            const cutterBrush = new Brush(cutterGeo);
            cutterBrush.updateMatrixWorld();

            resultBrush = evaluator.evaluate(resultBrush, cutterBrush, INTERSECTION);
            
            // Clean up cutter geometry
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
      patternColor, wireframePattern, patternOpacity, 
      patternScale, patternScaleZ, 
      isTiled, tileSpacing, patternMargin, tilingDistribution, tilingOrientation, tilingDirection,
      clipToOutline, displayMode, inlayShapes, inlayScale, inlayRotation, baseRotation,
      thickness, cutoutShapes, patternShapes, size
  ]);

  return <group ref={localGroupRef} />;
});

export default ImperativeModel;
