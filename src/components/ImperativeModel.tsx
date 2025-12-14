import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { generateTilePositions, getShapesBounds, getGeometryBounds } from '../utils/patternUtils';

interface ImperativeModelProps {
  size: number;
  thickness: number;
  color: string;
  patternColor: string;
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
  inlayShapes?: any[] | null;
  inlayDepth?: number;
  inlayScale?: number;
  inlayExtend?: number;
  wireframe?: boolean;
  isPatternTransparent?: boolean;
}

const ImperativeModel = React.forwardRef<THREE.Group, ImperativeModelProps>(({
  size,
  thickness,
  color,
  patternColor,
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
  inlayShapes,
  inlayDepth = 0.6,
  inlayScale = 1,
  inlayExtend = 0,
  wireframe = false,
  isPatternTransparent = false,
}, ref) => {
  const localGroupRef = useRef<THREE.Group>(null);
  
  // Expose ref
  React.useImperativeHandle(ref, () => localGroupRef.current!, []);

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

    const material = new THREE.MeshStandardMaterial({ 
        color, 
        wireframe: wireframe 
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Base';
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);

  }, [size, thickness, color, cutoutShapes, wireframe]);


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
        
        const mat = new THREE.MeshStandardMaterial({ 
            color: item.color === 'base' ? color : item.color, 
            wireframe: wireframe 
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `Inlay_${i}`;
        mesh.position.set(0, 0, thickness - inlayDepth);
        mesh.scale.set(inlayScale, inlayScale, 1);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
    });

  }, [inlayShapes, inlayDepth, inlayScale, inlayExtend, thickness, color, wireframe]);


  // --- 3. Pattern Construction (The Heavy Lifter) ---
  useEffect(() => {
    const group = localGroupRef.current;
    if (!group) return;

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
    const isStl = patternType === 'stl' || (patternShapes[0] instanceof THREE.BufferGeometry);
    let unitGeo: THREE.BufferGeometry | null = null;
    let unitShapes: THREE.Shape[] | null = null;

    // Extrude Settings Calculation
    let activePatternHeight = Number(patternHeight === '' ? 1 : patternHeight);
    const angleRad = (Math.abs(extrusionAngle) * Math.PI) / 180;
    let extrudeSettings: any = { depth: activePatternHeight, bevelEnabled: false };

    // Standardize shapes and calculate advanced bevels if needed
    if (!isStl) {
        unitShapes = (patternShapes as THREE.Shape[]).map(s => {
            const ns = new THREE.Shape();
            const pts = s.getPoints();
            if (THREE.ShapeUtils.area(pts) < 0) pts.reverse();
            ns.setFromPoints(pts);
            s.holes?.forEach(h => ns.holes.push(new THREE.Path(h.getPoints())));
            return ns;
        });

        // Bevel Logic for "Pyramid" effect
        if (Math.abs(extrusionAngle) > 0 && unitShapes.length > 0) {
            const shpBounds = getShapesBounds(unitShapes);
            const radius = Math.min(shpBounds.size.x, shpBounds.size.y) / 2;
            const scaledRadius = radius * patternScale;
            let autoHeight = scaledRadius / Math.tan(angleRad);
            
            if (patternHeight !== '' && Number(patternHeight) > 0) {
                autoHeight = Math.min(autoHeight, Number(patternHeight));
            }
            activePatternHeight = autoHeight;

            extrudeSettings = {
                depth: 0.05,
                bevelEnabled: true,
                bevelThickness: autoHeight,
                bevelSize: -radius + 0.1, // Approximate convergence
                bevelSegments: 1,
                bevelOffset: 0
            };
        }

        unitGeo = new THREE.ExtrudeGeometry(unitShapes, extrudeSettings);
    } else {
        // STL
        unitGeo = (patternShapes[0] as THREE.BufferGeometry).clone();
        // Compute bounding box to center it?
        // Usually STLs come in "as is". 
    }

    if (!unitGeo) return;

    // Center the Geometry locally
    unitGeo.computeBoundingBox();
    const center = new THREE.Vector3(); 
    if (unitGeo.boundingBox) unitGeo.boundingBox.getCenter(center);
    unitGeo.translate(-center.x, -center.y, -center.z);

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

    const positions = isTiled ? generateTilePositions(
        bounds, pWidth, pHeight, tileSpacing, 
        cutoutShapes, patternMargin, 
        clipToOutline, // Allow Partial?
        tilingDistribution, tilingRotation 
    ) : [{ position: new THREE.Vector2(0,0), rotation: 0, scale: 1 }];


    if (positions.length === 0) return;

    // ---------------------------------------------------------
    // C. Render Selection (Instanced vs Merged CSG)
    // ---------------------------------------------------------
    
    // Material
    const mat = new THREE.MeshStandardMaterial({
        color: patternColor,
        wireframe: wireframe,
        transparent: isPatternTransparent,
        opacity: isPatternTransparent ? 0.3 : 1.0
    });

    const zPos = thickness + Number(activePatternHeight) - 0.01;

    // STRATEGY: 
    // If NOT cutting to outline -> InstancedMesh (Fastest)
    // If cutting to outline -> Merged Geometry -> CSG Intersection (Accurate)

    if (!clipToOutline || !cutoutShapes || cutoutShapes.length === 0) {
        // --- INSTANCED MESH PATH ---
        const iMesh = new THREE.InstancedMesh(unitGeo, mat, positions.length);
        iMesh.name = 'Pattern';
        iMesh.castShadow = true;
        iMesh.receiveShadow = true;
        
        // If STLTiles logic:
        // Position: [x, y, thickness - 0.01]. 
        // Note: In `ModelViewer`, Shapes were inverted scale [1,1,-1] for "down" extrusion logic?
        // Wait, ModelViewer.tsx line 497: `scale={[1, 1, -1]}`
        // This flips the cone "point down" if using the bevel trick?
        // Let's replicate the transform.
        
        const dummy = new THREE.Object3D();
        
        positions.forEach((p, i) => {
            dummy.position.set(p.position.x, p.position.y, zPos);
            dummy.rotation.set(0, 0, p.rotation);
            
            // Apply scale
            // If it's a shape pattern using `scale={[1, 1, -1]}` logic:
            if (!isStl) {
                // The geometry was generated "point up" (bevelThickness positive). 
                // We flip Z to make it point down or up?
                // R3F code: `scale={[1, 1, -1]}`
                dummy.scale.set(patternScale, patternScale, -1); 
            } else {
                // STL logic from STLTiles.tsx
                // position: [x, y, offset * scale]
                // But we centered the geometry at 0,0,0.
                // We need to place it on top.
                // STLTiles used `offset` based on bbox.
                // Here we just place at `thickness`.
                // If STL, usually we don't flip Z.
                dummy.scale.set(patternScale * p.scale, patternScale * p.scale, patternScale * p.scale);
                // Adjust Z for STL?
                // STLTiles placed at `thickness - 0.01`.
                // STLTiles `offset` calculation was `zHeight / 2`.
                // Instance Z position was `offset * data.scale`.
                // This implies local (0,0,0) of geometry was center?
                // Our `unitGeo` is centered. So we need to lift it by half height?
                const instH = (unitGeo!.boundingBox!.max.z - unitGeo!.boundingBox!.min.z) * patternScale * p.scale;
                dummy.position.z = thickness - 0.01 + instH / 2; // Sit on surface?
                // Actually STLTiles: `position={[0, 0, thickness - 0.01]}` for the group, 
                // and instances `position.z` = `offset * scale`.
                // So yes, lift by half height.
            }

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
        let matrix = new THREE.Matrix4();

        positions.forEach(p => {
             dummy.position.set(p.position.x, p.position.y, zPos);
             dummy.rotation.set(0, 0, p.rotation);
             if (!isStl) {
                 dummy.scale.set(patternScale, patternScale, -1);
             } else {
                 const instH = (unitGeo!.boundingBox!.max.z - unitGeo!.boundingBox!.min.z) * patternScale * p.scale;
                 dummy.position.z = thickness - 0.01 + instH / 2;
                 dummy.scale.set(patternScale * p.scale, patternScale * p.scale, patternScale * p.scale);
             }
             dummy.updateMatrix();
             const clone = unitGeo!.clone();
             clone.applyMatrix4(dummy.matrix);
             geometries.push(clone);
        });

        if (geometries.length === 0) return;
        const rawMergedGeo = BufferGeometryUtils.mergeGeometries(geometries);
        // Optimize and ensure index
        const mergedGeo = BufferGeometryUtils.mergeVertices(rawMergedGeo);
        rawMergedGeo.dispose();
        
        // 2. Prepare Cutter (The Outline)
        // We need a big volume that matches the cutout shape
        const cutterGeo = new THREE.ExtrudeGeometry(cutoutShapes, {
            depth: 1000, 
            bevelEnabled: true, 
            bevelThickness: 0.1, 
            bevelSize: -patternMargin,
            bevelSegments: 1, 
            bevelOffset: 0
        });

        // Safety check
        if (!mergedGeo.attributes.position || mergedGeo.attributes.position.count === 0 || 
            !cutterGeo.attributes.position || cutterGeo.attributes.position.count === 0) {
            console.warn("Skipping CSG: Invalid geometry");
            return;
        }

        // 3. Perform CSG
        const patternBrush = new Brush(mergedGeo);
        const cutterBrush = new Brush(cutterGeo);
        
        patternBrush.updateMatrixWorld();
        cutterBrush.updateMatrixWorld();
        
        // We want INTERSECTION
        const evaluator = new Evaluator();
        // Avoid attribute mismatch errors (e.g. missing UVs on STL)
        evaluator.attributes = ['position', 'normal'];
        const result = evaluator.evaluate(patternBrush, cutterBrush, INTERSECTION);
        
        // 4. Result Mesh
        result.name = 'Pattern';
        result.material = mat;
        result.castShadow = true;
        result.receiveShadow = true;
        group.add(result);
        
        // Cleanup intermediates?
        // Geometries in `geometries` are clones, need dispose? 
        // BufferGeometryUtils.merge... creates new one?
        // Yes, good practice to dispose if possible, but JS GC handles transient objects.
        geometries.forEach(g => g.dispose());
        mergedGeo.dispose();
        cutterGeo.dispose();
    }

  }, [
      patternShapes, patternType, cutoutShapes, size, thickness, 
      patternColor, wireframe, isPatternTransparent, 
      extrusionAngle, patternHeight, patternScale, 
      isTiled, tileSpacing, patternMargin, tilingDistribution, tilingRotation, 
      clipToOutline
  ]);

  return <group ref={localGroupRef} />;
});

export default ImperativeModel;
