import React, { useEffect, useRef, useMemo } from 'react';
import { eventBus } from "../utils/eventBus";
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { generateTilePositions, getShapesBounds, TileInstance } from '../utils/patternUtils';
import { offsetShape, unionShapes } from '../utils/offsetUtils';

import { InlayItem } from '../types/schemas';

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
  holeMode?: 'default' | 'margin' | 'avoid';
  tilingDistribution?: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave' | 'zigzag' | 'warped-grid';
  tilingDirection?: 'horizontal' | 'vertical';
  tilingOrientation?: 'none' | 'alternate' | 'random' | 'aligned';
  baseRotation?: number; // Rotates the PATTERN units
  rotationClamp?: number;
  patternMaxHeight?: number;
  clipToOutline?: boolean;
  baseOutlineRotation?: number; // Rotates the BASE shape
  baseOutlineMirror?: boolean; // Mirrors the BASE shape
  
  inlayItems?: InlayItem[];
  
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
  isDragging?: boolean;
  previewInlay?: InlayItem | null;
}




const ImperativeModel = React.forwardRef((props: ImperativeModelProps, ref: React.Ref<THREE.Group>) => {
  const {
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
  holeMode = 'default',
  tilingDistribution = 'hex',
  tilingDirection = 'horizontal',
  tilingOrientation = 'aligned',
  baseRotation = 0,
  rotationClamp,
  patternMaxHeight,
  clipToOutline = false,
  baseOutlineRotation = 0,
  baseOutlineMirror = false,
  inlayItems = [],
  wireframeBase = false,
  wireframeInlay = false,
  wireframePattern = false,
  displayMode = 'normal',
  onProcessingChange,
  debugShowPatternCutter = false,
  debugShowHoleCutter = false,
  debugShowInlayCutter = false,
  isDragging = false,
  previewInlay = null,
  } = props;
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

    // Shared Helper for Inlay Positioning (Single & Tiled)
    const calculateItemPositions = (item: InlayItem): TileInstance[] => {
        if (item.mode === 'tile') {
             const rawShapes = (item.shapes || []).map((s: any) => s.shape || s);
             const tileBounds = getShapesBounds(rawShapes);
             const tW = tileBounds.size.x * item.scale;
             const tH = tileBounds.size.y * item.scale;

             // Force centered container bounds (Base Size)
             const halfSize = size / 2;
             const containerBounds = new THREE.Box2(
                 new THREE.Vector2(-halfSize, -halfSize),
                 new THREE.Vector2(halfSize, halfSize)
             );

             return generateTilePositions(
                 containerBounds,
                 tW,
                 tH,
                 item.tileSpacing || 10,
                 null, 
                 0, 
                 true, 
                 item.tilingDistribution || 'grid',
                 'none', 
                 'horizontal',
                 null, 
                 null
             );
        } else {
             return [{ 
                 position: new THREE.Vector2(0, 0),
                 rotation: 0, 
                 scale: 1 
             }];
        }
    };    const getTransformedShapes = (mode: 'include' | 'exclude' | 'mask' | 'avoid') => {
        const resultShapes: THREE.Shape[] = [];

        inlayItems.forEach(item => {
            const itemShapes = item.shapes || [];
            
            const relevantShapes = itemShapes.filter(() => {
                 const modifier = item.modifier;
                 if (modifier === 'cut') return mode === 'exclude';
                 if (modifier === 'mask') return mode === 'mask';
                 if (modifier === 'avoid') return mode === 'avoid';
                 return false;
            });
            
            if (relevantShapes.length === 0) return;

            // Get Positions (Single or Tiled)
            const positions = calculateItemPositions(item);

            positions.forEach(pos => {
                const tileDx = pos.position.x;
                const tileDy = pos.position.y; // Ensure consistent naming if refactoring
                const tileRot = pos.rotation;

                relevantShapes.forEach((original: any) => {
                    const shape = original.shape || original;
                    const scale = item.scale || 1;
                    const mirror = item.mirror || false;
                    
                    // Total Position = Item Offset + Tile Offset
                    const dx = (item.x || 0) + tileDx;
                    const dy = (item.y || 0) + tileDy;
                    
                    // Total Rotation = Item Rot + Tile Rot (Convert Tile Rad to Deg)
                    const rotation = (item.rotation || 0) + (tileRot * (180/Math.PI)); 

                    const newShape = new THREE.Shape();
                    
                    const rad = rotation * (Math.PI / 180);
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);

                    const transform = (p: THREE.Vector2) => {
                        const sx = p.x * (mirror ? -scale : scale);
                        const sy = p.y * scale;
                        let rx = sx * cos - sy * sin;
                        let ry = sx * sin + sy * cos;
                        rx += dx;
                        ry += dy;
                        return new THREE.Vector2(rx, ry);
                    };
                    
                    const pts = shape.getPoints().map(transform);
                    if (mirror) pts.reverse();

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
                    resultShapes.push(newShape);
                });
            });
        });
        return resultShapes;
    };

    // Helper for Colored Masks
    const getMaskShapesWithColor = () => {
        const result: { shape: THREE.Shape, color: string }[] = [];
        inlayItems.forEach(item => {
            const itemShapes = item.shapes || [];
            
            const relevantShapes = itemShapes.filter(() => {
                 const modifier = item.modifier;
                 if (modifier === 'mask') return true;
                 return false;
            });

            if (relevantShapes.length === 0) return;

            // Get Positions (Single or Tiled)
            const positions = calculateItemPositions(item);

            positions.forEach(pos => {
                const tileDx = pos.position.x;
                const tileDy = pos.position.y;
                const tileRot = pos.rotation;

                relevantShapes.forEach((original: any) => {
                    const shape = original.shape || original;
                    const color = original.color || 'white';
                    
                    const scale = item.scale || 1;
                    const mirror = item.mirror || false;
                    
                    // Total Position
                    const dx = (item.x || 0) + tileDx;
                    const dy = (item.y || 0) + tileDy;
                    
                    // Total Rotation
                    const rotation = (item.rotation || 0) + (tileRot * (180/Math.PI));

                    const newShape = new THREE.Shape();
                    const rad = rotation * (Math.PI / 180);
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);

                    const transform = (p: THREE.Vector2) => {
                        const sx = p.x * (mirror ? -scale : scale);
                        const sy = p.y * scale;
                        let rx = sx * cos - sy * sin;
                        let ry = sx * sin + sy * cos;
                        rx += dx;
                        ry += dy;
                        return new THREE.Vector2(rx, ry);
                    };
                    
                    const pts = shape.getPoints().map(transform);
                    if (mirror) pts.reverse();

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
                    result.push({ shape: newShape, color });
                });
            });
        });
        return result;
    }

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

    // Clear existing InlayGroup completely
    const existingInlayGroup = group.getObjectByName('InlayGroup');
    if (existingInlayGroup) {
        // Dispose all meshes in the group
        existingInlayGroup.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (obj.material instanceof THREE.Material) {
                    obj.material.dispose();
                } else if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                }
            }
        });
        group.remove(existingInlayGroup);
    }

    // Clear any orphaned Inlay meshes (safety cleanup)
    const toRemove: THREE.Object3D[] = [];
    group.traverse((obj) => {
        if (obj.name.startsWith('Inlay_')) toRemove.push(obj);
    });
    toRemove.forEach(obj => {
        if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            if (obj.material instanceof THREE.Material) {
                obj.material.dispose();
            }
        }
        group.remove(obj);
    });

    if (!inlayItems || inlayItems.length === 0) return;
    
    // Cleanup existing Inlay Debug Meshes
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

    // --- Inlay Group Management ---
    let inlayGroup = group.getObjectByName('InlayGroup') as THREE.Group;
    if (!inlayGroup) {
        inlayGroup = new THREE.Group();
        inlayGroup.name = 'InlayGroup';
        group.add(inlayGroup);
    } else {
        inlayGroup.clear();
    }
    
    // Since we have multiple independent items, the "Group" position concept is less relevant
    // UNLESS we want to group them all relative to 0,0.
    // Let's keep InlayGroup at (0,0,0) and position meshes inside it.
    inlayGroup.position.set(0, 0, 0);
    inlayGroup.scale.set(1, 1, 1);
    inlayGroup.rotation.set(0, 0, 0); 

    // Merge previewInlay with inlayItems for rendering
    const itemsToRender = previewInlay 
        ? inlayItems.map(item => item.id === previewInlay.id ? previewInlay : item)
        : inlayItems;

    itemsToRender.forEach((item, i) => {
        // Check if this is the preview item (skip CSG for it)
        const isPreviewItem = previewInlay && item.id === previewInlay.id;
        
        // Calculate offset for THIS specific item
        // We use the "manual" position logic for all items now, as x/y are stored on the item.
        // If the user wants "center" or "top-left", the UI calculates those coords and saves them to x/y.
        // Wait, the schema still had specific x/y. 
        // But previously `calculateInlayOffset` handled alignment logic.
        // Since we removed alignment props from Item schema (only x/y/scale/rotation), 
        // we assume the UI handles "Snap to Top Left" by setting X/Y.
        // However, `calculateInlayOffset` logic relies on bbox. 
        // For now, let's treat item.x/item.y as absolute offsets from center (0,0).
        
        
        // Determine positions (Single or Tiled)
        const points = calculateItemPositions(item);

        const shapeList = item.shapes || [];

        // Iterate over Tiled Points
        points.forEach((point, tileIdx) => {
            const dx = point.position.x;
            const dy = point.position.y;
            const tileRot = point.rotation; // Additional rotation from tiling

            shapeList.forEach((shapeParams: any, shapeIdx: number) => {


                const rawShape = shapeParams.shape || shapeParams;
                const shapeColor = shapeParams.color || 'white';
                
                if (shapeColor === 'transparent') return;
    
                const totalDepth = (item.depth || 0.6) + Number(item.extend || 0) + ((i + 1) * 0.001);
                const mat = createMaterial(
                    shapeColor === 'base' ? color : shapeColor, 
                    (inlayOpacity || 1.0) < 1.0, 
                    inlayOpacity || 1.0, 
                    wireframeInlay
                );
                
                // Fix Z-fighting with base
                mat.polygonOffset = true;
                mat.polygonOffsetFactor = -1;
                mat.polygonOffsetUnits = -1;
    
                 // Transform Shape if Mirror is required
                let shapeToExtrude = rawShape;
                if (item.mirror) {
                     const pts = rawShape.getPoints().map((p: THREE.Vector2) => new THREE.Vector2(-p.x, p.y));
                     pts.reverse(); // Fix winding
                     
                     const newShape = new THREE.Shape(pts);
                     if (rawShape.holes && rawShape.holes.length > 0) {
                         rawShape.holes.forEach((h: THREE.Path) => {
                              let hPts = h.getPoints().map((p: THREE.Vector2) => new THREE.Vector2(-p.x, p.y));
                              hPts.reverse(); // Fix winding
                              newShape.holes.push(new THREE.Path(hPts));
                     });
                 }
                 shapeToExtrude = newShape;
            }
    
            const geo = new THREE.ExtrudeGeometry(shapeToExtrude, { depth: totalDepth, bevelEnabled: false });
            
            // 1. Bake transforms (Scale/Rotate)
            // LIFT slightly primarily to avoid Z-fighting
            // Add slight Z-offset based on shape index to prevent z-fighting between stacked inlay shapes
            const shapeZOffset = shapeIdx * 0.002;
            geo.translate(0, 0, thickness - (item.depth || 0.6)  + shapeZOffset);
            
            geo.applyMatrix4(new THREE.Matrix4().makeScale(item.scale, item.scale, 1));
            
            // Combine Item Rotation + Tile Rotation
            const totalRotation = (item.rotation * (Math.PI / 180)) + tileRot;
            if (totalRotation !== 0) {
                geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(totalRotation));
            }
    
                // 2. Apply Position (Translate to item location OR tiled location PLUS manual offset)
                // This allows 'panning' the tiled pattern using x/y
                geo.translate(dx + (item.x || 0), dy + (item.y || 0), 0);

            // VALIDATION
            if (!geo.attributes.position || geo.attributes.position.count === 0) {
                 geo.dispose();
                 return;
            }

            // Check CSG - Skip CSG for preview items
            const needsClipping = filledCutoutShapes && filledCutoutShapes.length > 0;
            const hasHoles = holeShapes && holeShapes.length > 0;

             if ((!needsClipping && !hasHoles) || isPreviewItem) {
                  // Fast Path
                  const mesh = new THREE.Mesh(geo, mat);
                  mesh.name = `Inlay_${item.id}_${tileIdx}_${shapeIdx}`;
                  mesh.castShadow = true;
                 mesh.receiveShadow = true;

                 inlayGroup.add(mesh);
            } else {
                try {
                    const evaluator = new Evaluator();
                    evaluator.attributes = ['position', 'normal'];
                    let resultBrush = new Brush(geo);
                    resultBrush.updateMatrixWorld();

                     // 3. Subtract Holes
                    if (hasHoles) {
                        const maxExtend = Math.max(...itemsToRender.map(it => it.extend || 0), 0);
                        const holeDepth = thickness + Math.max(Number(patternScaleZ || 0), maxExtend) + 20;
                        const holeGeo = new THREE.ExtrudeGeometry(holeShapes, { depth: holeDepth, bevelEnabled: false });
                        
                        if (holeGeo.attributes.position && holeGeo.attributes.position.count > 0) {
                            const holeBrush = new Brush(holeGeo);
                            holeBrush.position.z = -10;
                            holeBrush.updateMatrixWorld();
                            
                            try {
                                 // Only generate debug waste for the FIRST shape of the FIRST item to avoid clutter?
                                 // Or maybe valid debug per item.
                                 if (debugShowHoleCutter && i === 0 && shapeIdx === 0) {
                                     const wasteBrush = evaluator.evaluate(resultBrush, holeBrush, INTERSECTION);
                                     if (wasteBrush && wasteBrush.geometry && wasteBrush.geometry.attributes.position && wasteBrush.geometry.attributes.position.count > 0) {
                                        // Since we already baked translation into resultBrush geometry, 
                                        // wasteBrush geometry is in World Space (correct).
                                        // We add to inlayGroup (which is at 0,0,0). Correct.
                                        const wasteMat = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.5, transparent: true, side: THREE.DoubleSide, depthWrite: false });
                                        const wasteMesh = new THREE.Mesh(wasteBrush.geometry, wasteMat);
                                        wasteMesh.name = `Debug_Hole_Waste_Inlay_${i}`;
                                        inlayGroup.add(wasteMesh);
                                     }
                                 }
                                resultBrush = evaluator.evaluate(resultBrush, holeBrush, SUBTRACTION);
                            } catch (err) { }
                        }
                        holeGeo.dispose();
                    }

                    // 4. Clip to Outline
                    if (needsClipping) {
                        const maxExtend = Math.max(...itemsToRender.map(it => it.extend || 0), 0);
                        const cutterDepth = thickness + Math.max(Number(patternScaleZ || 0), maxExtend) + 5;
                        const cutterGeo = new THREE.ExtrudeGeometry(filledCutoutShapes, { depth: cutterDepth, bevelEnabled: false });
                        
                        if (cutterGeo.attributes.position && cutterGeo.attributes.position.count > 0) {
                            const cutterBrush = new Brush(cutterGeo);
                            cutterBrush.updateMatrixWorld();
                            try {
                                if (debugShowInlayCutter && i === 0 && shapeIdx === 0) {
                                     const wasteBrush = evaluator.evaluate(resultBrush, cutterBrush, SUBTRACTION);
                                     if (wasteBrush && wasteBrush.geometry && wasteBrush.geometry.attributes.position && wasteBrush.geometry.attributes.position.count > 0) {
                                        const wasteMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, opacity: 0.5, transparent: true, side: THREE.DoubleSide, depthWrite: false });
                                        const wasteMesh = new THREE.Mesh(wasteBrush.geometry, wasteMat);
                                        wasteMesh.name = `Debug_Inlay_Waste_${i}`;
                                        inlayGroup.add(wasteMesh);
                                     }
                                }
                                resultBrush = evaluator.evaluate(resultBrush, cutterBrush, INTERSECTION);
                                
                                if (debugShowInlayCutter && i === 0 && shapeIdx === 0) {
                                    const debugMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, opacity: 0.01, transparent: true, side: THREE.DoubleSide, depthWrite: false });
                                    const debugMesh = new THREE.Mesh(cutterGeo.clone(), debugMat);
                                    debugMesh.name = `Debug_Inlay_Cutter_${i}`;
                                    group.add(debugMesh); 
                                }

                            } catch (err) { }
                        }
                        cutterGeo.dispose();
                    }

                    if (resultBrush && resultBrush.geometry && resultBrush.geometry.attributes.position && resultBrush.geometry.attributes.position.count > 0) {
                        const mesh = new THREE.Mesh(resultBrush.geometry, mat);
                        mesh.name = `Inlay_${item.id}_${tileIdx}_${shapeIdx}`;
                        mesh.castShadow = true;
                        mesh.receiveShadow = true;

                        inlayGroup.add(mesh);
                    }
                } catch (error) {
                    geo.dispose();
                }
            }
        });
    });
    });

  }, [inlayItems, thickness, color, wireframeInlay, clipToOutline, filledCutoutShapes, holeShapes, displayMode, isDragging, debugShowHoleCutter, debugShowInlayCutter, previewInlay, inlayOpacity]);

    // Subscribe to Event Bus for high-performance live preview updates
    // This allows us to move meshes during drag without React re-renders or regenerating geometry
    useEffect(() => {
        const handleInlayTransform = (newItem: any) => {
            if (!newItem || !newItem.id) return;
            
            // Need to find inlayGroup dynamically because it's managed by another effect
            const group = localGroupRef.current;
            if (!group) return;
            const inlayGroup = group.getObjectByName('InlayGroup');
            if (!inlayGroup) return;

            // Find the committed item (source of truth for baked geometry)
            // We use the item from props, not the event, to know what the geometry *currently* is
            const originalItem = inlayItems.find(i => i.id === newItem.id);
            if (!originalItem) return;

            // Find all meshes for this inlay
            inlayGroup.children.forEach(child => {
                if (child.name.startsWith(`Inlay_${newItem.id}_`)) {
                    // Calculate Delta Transform: Target * Inverse(Original)
                    const origScale = originalItem.scale;
                    const origRot = originalItem.rotation * (Math.PI / 180);
                    const origX = originalItem.x || 0;
                    const origY = originalItem.y || 0;
                    
                    const mBaked = new THREE.Matrix4();
                    mBaked.compose(
                        new THREE.Vector3(origX, origY, 0),
                        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), origRot),
                        new THREE.Vector3(origScale, origScale, 1)
                    );

                    const targetScale = newItem.scale;
                    const targetRot = (newItem.rotation || 0) * (Math.PI / 180);
                    const targetX = newItem.x || 0;
                    const targetY = newItem.y || 0;

                    const mTarget = new THREE.Matrix4();
                    mTarget.compose(
                        new THREE.Vector3(targetX, targetY, 0),
                        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), targetRot),
                        new THREE.Vector3(targetScale, targetScale, 1)
                    );

                    // M_mesh = M_target * Inverse(M_baked)
                    const mDelta = mTarget.multiply(mBaked.invert());
                    
                    child.matrix.copy(mDelta);
                    child.matrixAutoUpdate = false;
                    child.matrixWorldNeedsUpdate = true;
                }
            });
        }

        const cleanup = eventBus.on('INLAY_TRANSFORM', handleInlayTransform);
        return () => cleanup();
    }, [inlayItems]); // Re-subscribe if items change


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
            
             // Cleanup Pattern/Hole Debug Meshes AND Masked Patterns
            const objectsToRemove: THREE.Object3D[] = [];
            group.traverse((obj) => {
                 if (
                     obj.name === 'Debug_Pattern_Cutter' ||
                     obj.name === 'Debug_Hole_Cutter' || 
                     obj.name === 'Debug_Pattern_Waste' || 
                     obj.name === 'Debug_Pattern_Waste_Exclusion' || 
                     obj.name === 'Debug_Hole_Waste_Pattern' ||
                     obj.name.startsWith('Pattern_Masked_')
                 ) {
                     objectsToRemove.push(obj);
                 }
            });
            
            objectsToRemove.forEach(obj => {
                if (obj instanceof THREE.Mesh) {
                   obj.geometry.dispose();
                   if (obj.material instanceof THREE.Material) obj.material.dispose();
                }
                group.remove(obj);
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

    // Determine Inlay Offsets for Cutouts
    // Determine Inlay Offsets for Cutouts - NOW PER ITEM
    
    // Helper to scale and rotate shapes based on item properties


    const finalExclusionShapes = getTransformedShapes('exclude');
    const finalInclusionShapes = getTransformedShapes('include');
    let finalAvoidShapes = getTransformedShapes('avoid');
    // Inject Holes into Avoid list if mode is 'avoid'
    if (holeMode === 'avoid' && holeShapes && holeShapes.length > 0) {
        finalAvoidShapes = [...finalAvoidShapes, ...holeShapes];
    }
    const finalMaskShapesWithColor = getMaskShapesWithColor();

    const positions = isTiled ? generateTilePositions(
        bounds, pWidth, pHeight, tileSpacing, 
        filledCutoutShapes || null, patternMargin, 
        clipToOutline, // Allow Partial?
        tilingDistribution, tilingOrientation,
        tilingDirection,
        finalExclusionShapes,
        finalInclusionShapes,
        finalAvoidShapes
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
    const hasMasks = finalMaskShapesWithColor && finalMaskShapesWithColor.length > 0; // NEW
    const hasClipping = clipToOutline && filledCutoutShapes && filledCutoutShapes.length > 0;
    const hasHoles = holeShapes && holeShapes.length > 0;
    const hasHeightCut = patternMaxHeight !== undefined && patternMaxHeight > 0;
    const useCSG = hasClipping || hasExclusions || hasMasks || hasHoles || hasHeightCut;

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
        // 3a. Subtraction (Exclusions)
        if (hasExclusions) {
            // FIX: Union Exclusion Shapes for clean CSG
            const unifiedExclusions = unionShapes(finalExclusionShapes);
            const exclusionGeo = new THREE.ExtrudeGeometry(unifiedExclusions, { depth: 1000, bevelEnabled: false });
            
            if (exclusionGeo.attributes.position && exclusionGeo.attributes.position.count > 0) {
                let effectiveExclusionBrush = new Brush(exclusionGeo);
                effectiveExclusionBrush.position.z = -500;
                effectiveExclusionBrush.scale.z = 2.0;
                effectiveExclusionBrush.updateMatrixWorld();

                try {
                    if (finalInclusionShapes && finalInclusionShapes.length > 0) {
                         const inclusionGeo = new THREE.ExtrudeGeometry(finalInclusionShapes, { depth: 1000, bevelEnabled: false });
                         if (inclusionGeo.attributes.position && inclusionGeo.attributes.position.count > 0) {
                            const inclusionBrush = new Brush(inclusionGeo);
                            inclusionBrush.position.z = -100; 
                            inclusionBrush.updateMatrixWorld();
                            effectiveExclusionBrush = evaluator.evaluate(effectiveExclusionBrush, inclusionBrush, SUBTRACTION);
                         }
                         inclusionGeo.dispose();
                    }

                    // Calculate Exclusion Waste (Intersection of Result and Exclusion)
                    const exclusionWasteBrush = evaluator.evaluate(resultBrush, effectiveExclusionBrush, INTERSECTION);
                     // Render Waste Material (Highlighted Green to match inlay tool, 0.5 opacity)
                     if (exclusionWasteBrush && exclusionWasteBrush.geometry && exclusionWasteBrush.geometry.attributes.position && exclusionWasteBrush.geometry.attributes.position.count > 0) {
                        const wasteMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, opacity: 0.5, transparent: true, side: THREE.DoubleSide, depthWrite: false });
                        const wasteMesh = new THREE.Mesh(exclusionWasteBrush.geometry, wasteMat);
                        wasteMesh.name = 'Debug_Pattern_Waste_Exclusion';
                        wasteMesh.visible = !!debugShowPatternCutter;
                        group.add(wasteMesh);
                     }

                    resultBrush = evaluator.evaluate(resultBrush, effectiveExclusionBrush, SUBTRACTION);
                } catch (err) {
                    console.warn("Error during Pattern Exclusion CSG:", err);
                }
            }
            exclusionGeo.dispose();
        }

        // 3b. Intersection (Outline) - MOVED BEFORE MASKS
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
            const maxInlayExtend = inlayItems.length > 0 ? Math.max(...inlayItems.map(it => it.extend || 0), 0) : 0;
            const cutterDepth = thickness + Math.max(maxPatternHeight, maxInlayExtend) + 5;

            // Create simplified cutter geometry without bevels
            const cutterGeo = new THREE.ExtrudeGeometry(finalCutoutShapes, {
                depth: cutterDepth, 
                bevelEnabled: false 
            });
            
            if (cutterGeo.attributes.position && cutterGeo.attributes.position.count > 0) {
                const cutterBrush = new Brush(cutterGeo);
                cutterBrush.updateMatrixWorld();
                
                try {
                    // Calculate Waste (The part being removed by the margin/clip)
                    const wasteBrush = evaluator.evaluate(resultBrush, cutterBrush, SUBTRACTION);
                    
                    // Render Waste Material (Highlighted Blue to match tool, 0.5 opacity)
                     if (wasteBrush && wasteBrush.geometry && wasteBrush.geometry.attributes.position && wasteBrush.geometry.attributes.position.count > 0) {
                        const wasteMat = new THREE.MeshBasicMaterial({ color: 0x0000ff, opacity: 0.5, transparent: true, side: THREE.DoubleSide, depthWrite: false });
                        const wasteMesh = new THREE.Mesh(wasteBrush.geometry, wasteMat);
                        wasteMesh.name = 'Debug_Pattern_Waste';
                        // Match Transforms
                        wasteMesh.scale.copy(wasteBrush.scale);
                        wasteMesh.position.copy(wasteBrush.position);
                        wasteMesh.visible = !!debugShowPatternCutter;
                        group.add(wasteMesh);
                     }

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
                } catch (err) {
                    console.warn("Error during Pattern Clipping:", err);
                }
            }
            // Clean up cutter geometry
            cutterGeo.dispose();
        }

        // 3c. Masked Inlays (Color Match) - Renamed from 3b
        if (hasMasks) {
            // Processing Strategy: Boolean Subtraction for Clean Geometry (Slicer Friendly)
            // To prevent overlapping volumes (which slicers hate), we must physically cut the 
            // geometry of lower masks where they are overlapped by higher masks.
            // Algorithm: For each mask `i`, subtract Union(Masks `i+1`...`n`) from it.
            // Simplified: Iterate j > i, subtract Mask `j` from Mask `i`.

            // 1. Prepare Geometries for all masks (Reuse usually cheap)
            const maskGeometries = finalMaskShapesWithColor.map(m => 
                new THREE.ExtrudeGeometry([m.shape], { depth: 1000, bevelEnabled: false })
            );

            // 2. Iterate Bottom-to-Top
            finalMaskShapesWithColor.forEach((m, idx) => {
                const myGeo = maskGeometries[idx];
                if (!myGeo || !myGeo.attributes.position || myGeo.attributes.position.count === 0) return;

                // Start with My Full Shape
                let effectiveMaskBrush = new Brush(myGeo);
                effectiveMaskBrush.position.z = -100;
                effectiveMaskBrush.updateMatrixWorld();

                try {
                    // SUBTRACT all Masks that are ON TOP of me (Higher Index)
                    for (let j = idx + 1; j < finalMaskShapesWithColor.length; j++) {
                         const upperGeo = maskGeometries[j];
                         if (upperGeo && upperGeo.attributes.position && upperGeo.attributes.position.count > 0) {
                             const upperBrush = new Brush(upperGeo);
                             
                             // FIX: Expand Z range of the "Cutter" to avoid coplanar face issues with the "Base"
                             // CSG operations can fail if faces are exact duplicates. 
                             // By making the cutter strictly larger in Z, we ensure a clean boolean cut.
                             upperBrush.position.z = -500; // Start well below base (-100)
                             upperBrush.scale.z = 2.0;     // Make it much taller
                             upperBrush.updateMatrixWorld();
                             
                             // Cut away the part covered by the upper mask
                             effectiveMaskBrush = evaluator.evaluate(effectiveMaskBrush, upperBrush, SUBTRACTION);
                         }
                    }

                    // INTERSECT with Pattern to get the texturable geometry
                    // Now `effectiveMaskBrush` represents "My Shape MINUS All Upper Shapes"
                    const maskedPartBrush = evaluator.evaluate(resultBrush, effectiveMaskBrush, INTERSECTION);
                    
                    if (maskedPartBrush && maskedPartBrush.geometry && maskedPartBrush.geometry.attributes.position && maskedPartBrush.geometry.attributes.position.count > 0) {
                        const displayColor = m.color === 'base' ? color : m.color;
                        const partMat = createMaterial(displayColor, patternOpacity < 1.0, patternOpacity, wireframePattern);
                        
                        const partMesh = new THREE.Mesh(maskedPartBrush.geometry, partMat);
                        partMesh.name = `Pattern_Masked_${idx}_${m.color}`; 
                        partMesh.castShadow = true;
                        partMesh.receiveShadow = true;
                        
                        // Small physical offset just to be safe, but geometry should be clean now
                        partMesh.translateZ(idx * 0.0001);

                        partMesh.visible = !isDragging;
                        group.add(partMesh);
                    }
                } catch (err) {
                   console.warn("Error processing Mask Layering:", err);
                }
            });
            
            // Dispose Geometries
            maskGeometries.forEach(g => g.dispose());
            
            // SUBTRACT all masks from the main result (Hole for specific color parts)
            // (Re-creating Union Geo for final subtract - could optimize but safe/clear this way)
             let allMasksGeo: THREE.ExtrudeGeometry | null = null;
            if (hasMasks) {
                 // FIX: Union shapes to ensure clean CSG brush
                 // Overlapping extruded shapes can cause CSG failures. 
                 // Unioning the 2D shapes first ensures a single cleaner geometry.
                 const unifiedMaskShapes = unionShapes(finalMaskShapesWithColor.map(m => m.shape));
                 allMasksGeo = new THREE.ExtrudeGeometry(unifiedMaskShapes, { depth: 1000, bevelEnabled: false });
            }

            if (allMasksGeo && allMasksGeo.attributes.position && allMasksGeo.attributes.position.count > 0) {
                const allMasksBrush = new Brush(allMasksGeo);
                // FIX: Expand Z range to ensure complete subtraction of the mask union from the pattern
                allMasksBrush.position.z = -500;
                allMasksBrush.scale.z = 2.0;
                allMasksBrush.updateMatrixWorld();
                
                try {
                     resultBrush = evaluator.evaluate(resultBrush, allMasksBrush, SUBTRACTION);
                } catch (err) {
                    console.warn("Error subtracting Mask from Pattern:", err);
                }
                allMasksGeo.dispose();
            }
        }


            
            // 3b. Subtract Holes (Always if present)
            // 3b. Subtract Holes (Always if present)
            if (hasHoles) {
                let finalHoleShapes = holeShapes;
                
                // Apply Margin (Expand Holes) - Only if enabled
                if (holeMode === 'margin' && patternMargin && Math.abs(patternMargin) > 0.001) {
                     const offsetShapes: THREE.Shape[] = [];
                     holeShapes.forEach(s => {
                         const res = offsetShape(s, patternMargin); 
                         offsetShapes.push(...res);
                     });
                     if (offsetShapes.length > 0) {
                         finalHoleShapes = offsetShapes;
                     }
                }
                
                // CRITICAL FIX: Union all hole shapes to prevent self-intersection artifacts
                // This clean geometry ensures CSG subtraction works correctly even if holes overlap
                finalHoleShapes = unionShapes(finalHoleShapes);
            
                // Calculate required cutter height: Base + Max Features + Margin
                const maxInlayExtend = inlayItems.length > 0 ? Math.max(...inlayItems.map(it => it.extend || 0), 0) : 0;
                const holeDepth = thickness + Math.max(maxPatternHeight, maxInlayExtend) + 20;
    
                const holeGeo = new THREE.ExtrudeGeometry(finalHoleShapes, { depth: holeDepth, bevelEnabled: false });
                
                if (holeGeo.attributes.position && holeGeo.attributes.position.count > 0) {
                    const holeBrush = new Brush(holeGeo);
                    holeBrush.position.z = -10;
                    holeBrush.updateMatrixWorld();
                    
                    try {
                        // Calculate Waste (The holes being removed)
                        const wasteBrush = evaluator.evaluate(resultBrush, holeBrush, INTERSECTION);
                        
                        // Render Waste Material (Highlighted Red to match tool, 0.5 opacity)
                         if (wasteBrush && wasteBrush.geometry && wasteBrush.geometry.attributes.position && wasteBrush.geometry.attributes.position.count > 0) {
                            const wasteMat = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.5, transparent: true, side: THREE.DoubleSide, depthWrite: false });
                            const wasteMesh = new THREE.Mesh(wasteBrush.geometry, wasteMat);
                            wasteMesh.name = 'Debug_Hole_Waste_Pattern';
                            wasteMesh.visible = !!debugShowHoleCutter;
                            group.add(wasteMesh);
                         }

                        resultBrush = evaluator.evaluate(resultBrush, holeBrush, SUBTRACTION);
                        
                        // Always create debug mesh for holes
                        const debugMat = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.3, transparent: true, side: THREE.DoubleSide, depthWrite: false });
                        const debugMesh = new THREE.Mesh(holeGeo.clone(), debugMat);
                        debugMesh.name = 'Debug_Hole_Cutter';
                        debugMesh.position.z = -10;
                        debugMesh.visible = !!debugShowHoleCutter;
                        group.add(debugMesh);
                    } catch (err) {
                        console.warn("Error during Pattern Hole subtract:", err);
                    }
                }
                holeGeo.dispose();
            }

        // 3c. Intersection (Outline) - MOVED TO 3b

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

             try {
                // Subtract from result
                resultBrush = evaluator.evaluate(resultBrush, cutterBrush, SUBTRACTION);
             } catch (err) {
                 console.warn("Error during Pattern Height Cut:", err);
             }
             cutterGeo.dispose();
        }
        
        // 4. Result Mesh
        if (resultBrush && resultBrush.geometry && resultBrush.geometry.attributes.position && resultBrush.geometry.attributes.position.count > 0) {
            resultBrush.name = 'Pattern';
            resultBrush.material = mat;
            resultBrush.castShadow = true;
            resultBrush.receiveShadow = true;
            group.add(resultBrush);
        } else {
            console.warn("Pattern Generation resulted in empty geometry.");
        }
        
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
      clipToOutline, displayMode, inlayItems, baseRotation, rotationClamp,
      thickness, filledCutoutShapes, holeShapes, patternShapes, size, patternMaxHeight,
      holeMode
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
