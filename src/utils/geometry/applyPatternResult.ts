import * as THREE from 'three';
import { PatternResult } from './patternPipeline';
import { deserializeGeometry } from './serialize';

/**
 * Main-thread application of a PatternResult onto the scene group. This is the only
 * DOM/GL-bound step: it turns geometry buffers + MaterialSpec into real Meshes.
 *
 * Mirrors the cleanup + mesh-building the legacy pattern effect did inline, so the
 * visible outcome is identical regardless of whether generation ran sync or in a worker.
 */
export interface ApplyContext {
  /** Build the standard/toon material (respects displayMode + gradientMap in the component). */
  makeMaterial: (color: string, transparent: boolean, opacity: number, wireframe: boolean) => THREE.Material;
  /** Resolve a mask color token ('base' -> the base color). */
  resolveColor: (color: string) => string;
  patternColor: string;
  patternOpacity: number;
  wireframePattern: boolean;
  isDragging: boolean;
  debugShowPatternCutter: boolean;
  debugShowHoleCutter: boolean;
  debugShowInlayCutter: boolean;
}

/** Remove the pattern-owned objects the previous run created. */
export function cleanupPatternObjects(group: THREE.Group) {
  const existingPattern = group.getObjectByName('Pattern');
  if (existingPattern) {
    if (existingPattern instanceof THREE.Mesh || existingPattern instanceof THREE.InstancedMesh) {
      existingPattern.geometry.dispose();
      if (Array.isArray(existingPattern.material)) existingPattern.material.forEach((m) => m.dispose());
      else (existingPattern.material as THREE.Material).dispose();
    }
    group.remove(existingPattern);
  }

  const toRemove: THREE.Object3D[] = [];
  group.traverse((obj) => {
    if (
      obj.name === 'Debug_Pattern_Cutter' ||
      obj.name === 'Debug_Hole_Cutter' ||
      obj.name === 'Debug_Pattern_Waste' ||
      obj.name === 'Debug_Pattern_Waste_Exclusion' ||
      obj.name === 'Debug_Hole_Waste_Pattern' ||
      obj.name.startsWith('Pattern_Masked_')
    ) {
      toRemove.push(obj);
    }
  });
  toRemove.forEach((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (obj.material instanceof THREE.Material) obj.material.dispose();
    }
    group.remove(obj);
  });
}

function debugVisible(name: string, ctx: ApplyContext): boolean {
  if (name === 'Debug_Pattern_Waste_Exclusion') return ctx.debugShowInlayCutter;
  if (name.startsWith('Debug_Hole')) return ctx.debugShowHoleCutter;
  if (name.startsWith('Debug_Pattern')) return ctx.debugShowPatternCutter;
  return true;
}

export function applyPatternResult(group: THREE.Group, result: PatternResult, ctx: ApplyContext) {
  cleanupPatternObjects(group);

  // Instanced fast path
  if (result.instanced) {
    const { unit, matrices, count } = result.instanced;
    const unitGeo = deserializeGeometry(unit);
    const mat = ctx.makeMaterial(ctx.patternColor, ctx.patternOpacity < 1.0, ctx.patternOpacity, ctx.wireframePattern);
    const iMesh = new THREE.InstancedMesh(unitGeo, mat, count);
    iMesh.name = 'Pattern';
    iMesh.castShadow = true;
    iMesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      m.fromArray(matrices, i * 16);
      iMesh.setMatrixAt(i, m);
    }
    iMesh.instanceMatrix.needsUpdate = true;
    group.add(iMesh);
    return;
  }

  // CSG parts
  for (const part of result.parts) {
    const geo = deserializeGeometry(part.geometry);
    let material: THREE.Material;
    let visible = part.visible ?? true;

    switch (part.material.type) {
      case 'pattern':
        material = ctx.makeMaterial(ctx.patternColor, ctx.patternOpacity < 1.0, ctx.patternOpacity, ctx.wireframePattern);
        break;
      case 'masked':
        // While an inlay is being dragged, show masked regions in the standard pattern
        // colour so the grip reads as one uniform colour (the material effect toggles
        // this live too). The real mask colour is stashed on userData for restore.
        material = ctx.makeMaterial(
          ctx.isDragging ? ctx.patternColor : ctx.resolveColor(part.material.color),
          ctx.patternOpacity < 1.0, ctx.patternOpacity, ctx.wireframePattern,
        );
        break;
      case 'basic':
      default: {
        const spec = part.material as { colorHex: number; opacity: number; transparent: boolean; depthWrite: boolean };
        material = new THREE.MeshBasicMaterial({
          color: spec.colorHex,
          opacity: spec.opacity,
          transparent: spec.transparent,
          side: THREE.DoubleSide,
          depthWrite: spec.depthWrite,
        });
        visible = debugVisible(part.name, ctx);
        break;
      }
    }

    const mesh = new THREE.Mesh(geo, material);
    mesh.name = part.name;
    if (part.castShadow) mesh.castShadow = true;
    if (part.receiveShadow) mesh.receiveShadow = true;
    if (part.translateZ) mesh.translateZ(part.translateZ);
    mesh.visible = visible;
    group.add(mesh);
  }
}
