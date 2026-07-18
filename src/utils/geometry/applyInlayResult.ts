import * as THREE from 'three';
import { InlayResult } from './inlayPipeline';
import { deserializeGeometry } from './serialize';

/**
 * Main-thread application of an InlayResult: replace the fast unclipped placeholders
 * for the processed items with the worker's clipped geometry.
 *
 * We remove EVERY mesh belonging to a processed item first (not just the ones that came
 * back as parts). A shape/tile that clips to empty produces no part, so a per-name swap
 * would leave its unclipped placeholder floating outside the base; and a name that drifts
 * (e.g. a 'transparent' shape shifting the shape index) would leave a duplicate coplanar
 * mesh that z-fights and looks dimmed. Removing by item id avoids both.
 */
export interface InlayApplyContext {
  makeMaterial: (color: string, transparent: boolean, opacity: number, wireframe: boolean) => THREE.Material;
  resolveColor: (color: string) => string; // 'base' -> base color
  inlayOpacity: number;
  wireframeInlay: boolean;
}

export function applyInlayResult(
  inlayGroup: THREE.Group,
  result: InlayResult,
  ctx: InlayApplyContext,
  processedIds: string[],
) {
  // Remove all existing meshes for the processed items (placeholders + prior clipped).
  const prefixes = processedIds.map((id) => `Inlay_${id}_`);
  const stale = inlayGroup.children.filter((c) => prefixes.some((p) => c.name.startsWith(p)));
  stale.forEach((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (obj.material instanceof THREE.Material) obj.material.dispose();
    }
    inlayGroup.remove(obj);
  });

  // Add the clipped meshes.
  for (const part of result.parts) {
    const geo = deserializeGeometry(part.geometry);
    const mat = ctx.makeMaterial(
      ctx.resolveColor(part.color),
      ctx.inlayOpacity < 1.0,
      ctx.inlayOpacity,
      ctx.wireframeInlay,
    ) as THREE.MeshStandardMaterial;
    // Match the legacy inlay material: nudge against the base to avoid Z-fighting.
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = part.name;
    if (part.castShadow) mesh.castShadow = true;
    if (part.receiveShadow) mesh.receiveShadow = true;
    inlayGroup.add(mesh);
  }
}
