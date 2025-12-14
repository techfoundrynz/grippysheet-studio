import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Brush, Evaluator, INTERSECTION } from 'three-bvh-csg';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import GeometryWorker from '../workers/geometry.worker?worker';

// Define Prop Interface with new callback
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
  onProcessingChange?: (isProcessing: boolean) => void;
}

// Helper to serialize shapes for worker
const serializeShapes = (shapes: THREE.Shape[] | null) => {
    if (!shapes) return null;
    return shapes.map(s => ({
        points: s.getPoints(),
        holes: s.holes.map(h => ({ points: h.getPoints() }))
    }));
};

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
  onProcessingChange,
}, ref) => {
  const localGroupRef = useRef<THREE.Group>(null);
  const workerRef = useRef<Worker | null>(null);
  const currentJobId = useRef<string>('');

  // Expose ref
  React.useImperativeHandle(ref, () => localGroupRef.current!, []);

  // Initialize Worker
  useEffect(() => {
      workerRef.current = new GeometryWorker();
      workerRef.current.onmessage = handleWorkerMessage;
      return () => {
          workerRef.current?.terminate();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWorkerMessage = (e: MessageEvent) => {
      const { id, success, data, error } = e.data;
      if (id !== currentJobId.current) return; // Stale job

      if (onProcessingChange) onProcessingChange(false);

      if (!success) {
          console.error("Worker Error:", error);
          return;
      }

      updatePatternScene(data);
  };

  const updatePatternScene = (data: any) => {
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

      if (!data) return;

      const { instanceMatrices, geometry } = data; // geometry data is Float32Arrays
      // instanceMatrices is Float32Array

      // Reconstruct Geometry
      let unitGeo: THREE.BufferGeometry | null = null;
      if (geometry) {
           unitGeo = new THREE.BufferGeometry();
           unitGeo.setAttribute('position', new THREE.BufferAttribute(geometry.position, 3));
           if (geometry.normal) unitGeo.setAttribute('normal', new THREE.BufferAttribute(geometry.normal, 3));
           if (geometry.uv) unitGeo.setAttribute('uv', new THREE.BufferAttribute(geometry.uv, 2));
           if (geometry.index) unitGeo.setIndex(new THREE.BufferAttribute(geometry.index, 1));
           // Groups unsupported for now or not needed? ExtrudeGeometry has groups?
      } else if (patternType === 'stl' && patternShapes && patternShapes[0] instanceof THREE.BufferGeometry) {
           // Provide STL geometry directly from Main Thread prop
           unitGeo = patternShapes[0].clone();
           // We need to apply the centering/scaling logic that worker *would* have done?
           // Worker calculated Tiling Matrices assuming geometry is centered.
           // So we must CENTER this geo here to match.
            unitGeo.computeBoundingBox();
            const center = new THREE.Vector3(); 
            if (unitGeo.boundingBox) unitGeo.boundingBox.getCenter(center);
            unitGeo.translate(-center.x, -center.y, -center.z);
      }

      if (!unitGeo) return;

      // Material
      const mat = new THREE.MeshStandardMaterial({
        color: patternColor,
        wireframe: wireframe,
        transparent: isPatternTransparent,
        opacity: isPatternTransparent ? 0.3 : 1.0
      });

      // Construct InstancedMesh
      const count = instanceMatrices.length / 16;
      
      if (!clipToOutline || !cutoutShapes || cutoutShapes.length === 0) {
          // --- Instanced Mesh ---
          const iMesh = new THREE.InstancedMesh(unitGeo, mat, count);
          iMesh.name = 'Pattern';
          iMesh.castShadow = true;
          iMesh.receiveShadow = true;
          iMesh.instanceMatrix.array.set(instanceMatrices);
          iMesh.instanceMatrix.needsUpdate = true;
          group.add(iMesh);
      } else {
          // --- CSG Path ---
          // We must merge manually using the matrices
          const geometries: THREE.BufferGeometry[] = [];
          const dummy = new THREE.Object3D();
          
          for (let i = 0; i < count; i++) {
               dummy.matrix.fromArray(instanceMatrices, i * 16);
               const clone = unitGeo.clone();
               clone.applyMatrix4(dummy.matrix);
               geometries.push(clone);
          }
          
           if (geometries.length === 0) return;
           const rawMergedGeo = BufferGeometryUtils.mergeGeometries(geometries);
           const mergedGeo = BufferGeometryUtils.mergeVertices(rawMergedGeo);
           rawMergedGeo.dispose();
           geometries.forEach(g => g.dispose());

           // Prepare Cutter
           const cutterGeo = new THREE.ExtrudeGeometry(cutoutShapes, {
               depth: 1000, bevelEnabled: true, bevelThickness: 0.1, bevelSize: -patternMargin, bevelSegments: 1, bevelOffset: 0
           });

           if (!mergedGeo.attributes.position || mergedGeo.attributes.position.count === 0 || 
               !cutterGeo.attributes.position || cutterGeo.attributes.position.count === 0) {
               console.warn("Skipping CSG: Invalid geometry");
               return;
           }

            const patternBrush = new Brush(mergedGeo);
            const cutterBrush = new Brush(cutterGeo);
            patternBrush.updateMatrixWorld();
            cutterBrush.updateMatrixWorld();
            
            const evaluator = new Evaluator();
            evaluator.attributes = ['position', 'normal'];
            const result = evaluator.evaluate(patternBrush, cutterBrush, INTERSECTION);
            
            result.name = 'Pattern';
            result.material = mat;
            result.castShadow = true;
            result.receiveShadow = true;
            group.add(result);
            
            mergedGeo.dispose();
            cutterGeo.dispose();
      }
  };


  // --- 1. Base Mesh Construction (Sync) ---
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


  // --- 2. Inlays Construction (Sync) ---
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


  // --- 3. Pattern Construction (ASYNC WORKER) ---
  useEffect(() => {
    if (!patternShapes || patternShapes.length === 0) {
        // Clear pattern
        const group = localGroupRef.current;
        const existingPattern = group?.getObjectByName('Pattern');
        if (existingPattern && group) group.remove(existingPattern);
        return;
    }

    const isStl = patternType === 'stl' || (patternShapes[0] instanceof THREE.BufferGeometry);

    // Serialize
    const sPatternShapes = !isStl ? serializeShapes(patternShapes) : [];
    const sCutoutShapes = serializeShapes(cutoutShapes);

    let geometryBounds = undefined;
    if (isStl && patternShapes[0] instanceof THREE.BufferGeometry) {
         const geo = patternShapes[0];
         if (!geo.boundingBox) geo.computeBoundingBox();
         if (geo.boundingBox) {
            geometryBounds = {
                min: geo.boundingBox.min,
                max: geo.boundingBox.max,
                size: new THREE.Vector3().subVectors(geo.boundingBox.max, geo.boundingBox.min)
            };
         }
    }

    const jobId = Math.random().toString(36).substring(7);
    currentJobId.current = jobId;

    if (onProcessingChange) onProcessingChange(true);

    workerRef.current?.postMessage({
        id: jobId,
        type: 'compute',
        payload: {
            patternShapes: sPatternShapes,
            cutoutShapes: sCutoutShapes,
            patternType,
            extrusionAngle,
            patternHeight,
            patternScale,
            isTiled,
            tileSpacing,
            patternMargin,
            tilingDistribution,
            tilingRotation,
            clipToOutline,
            size,
            thickness,
            isStl,
            geometryBounds
        }
    });

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
