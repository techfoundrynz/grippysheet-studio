import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Centroid } from './pipeline/quantize';
import type { ExtrudedGeometry } from './pipeline/extrude';

interface Props {
  baseGeom: ExtrudedGeometry | null;
  layers: Array<{ centroid: Centroid; position: number; geom: ExtrudedGeometry }>;
  spikes?: Array<{ centroidIndex: number; geom: ExtrudedGeometry; color: string }>;
  displayMode?: 'normal' | 'toon';
  /** Hex color string (or any THREE.Color-compatible) for the base mesh material. */
  baseColor?: string;
}

function makeBufferGeom(g: ExtrudedGeometry): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(g.indices, 1));
  geom.computeVertexNormals();
  return geom;
}

// TODO(U6 deferred): light ColorFlow colours (e.g. #F1FAEE) wash out in 3D
// because MeshStandardMaterial darkens near-white surfaces under the scene's
// ambient + directional lighting (no environment map, no specular kicker).
// Bounded investigation (2026-05-22) tried bumping ambient intensity and got
// no visible improvement. The right fix is probably either an Environment map
// (drei `<Environment preset="city" />`) or switching colour layers to
// MeshBasicMaterial so they render as flat unlit filament-true colour — both
// are architectural changes beyond this PR's scope.
function makeMaterial(color: THREE.ColorRepresentation, displayMode: 'normal' | 'toon') {
  return displayMode === 'toon'
    ? new THREE.MeshToonMaterial({ color })
    : new THREE.MeshStandardMaterial({ color, flatShading: true });
}

function disposeMeshArray(meshes: THREE.Mesh[]) {
  for (const m of meshes) {
    m.geometry.dispose();
    if (m.material instanceof THREE.Material) m.material.dispose();
    m.parent?.remove(m);
  }
}

/**
 * Per-section mesh management: the base, colors, and spikes each maintain
 * their own refs and re-render independently. So bumping just the spike-related
 * settings doesn't churn the base + color GPU buffers, and changing baseColor
 * doesn't re-upload the color/spike geometries either.
 */
export const ColorFlowModel = React.forwardRef<THREE.Group, Props>(({ baseGeom, layers, spikes = [], displayMode = 'normal', baseColor }, ref) => {
  const localGroupRef = useRef<THREE.Group>(null);
  const baseRef = useRef<THREE.Mesh | null>(null);
  const layerMeshesRef = useRef<THREE.Mesh[]>([]);
  const spikeMeshesRef = useRef<THREE.Mesh[]>([]);

  React.useImperativeHandle(ref, () => localGroupRef.current!, []);

  // Set the group name once on mount.
  useEffect(() => {
    if (localGroupRef.current) localGroupRef.current.name = 'ColorFlowAssembly';
  }, []);

  // Dispose every mesh attached to this group when the component unmounts —
  // R3F frees the wrapping <group> but doesn't walk the children to release
  // GPU buffers, so mode toggles otherwise leak VBOs/textures.
  useEffect(() => {
    const group = localGroupRef.current;
    return () => {
      if (!group) return;
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else if (obj.material) {
            (obj.material as THREE.Material).dispose();
          }
        }
      });
    };
  }, []);

  // Base / layer / spike meshes are rebuilt only when their own geometry
  // input changes — `displayMode` is handled by the material-swap effect
  // below so toggling toon/standard doesn't re-upload any VBOs.

  // Base mesh: depends on baseGeom + baseColor only.
  useEffect(() => {
    const group = localGroupRef.current;
    if (!group) return;
    if (baseRef.current) {
      disposeMeshArray([baseRef.current]);
      baseRef.current = null;
    }
    if (baseGeom) {
      const mesh = new THREE.Mesh(makeBufferGeom(baseGeom), makeMaterial(baseColor ?? '#dddddd', displayMode));
      mesh.name = 'Base';
      group.add(mesh);
      baseRef.current = mesh;
    }
    return () => {
      if (baseRef.current) {
        disposeMeshArray([baseRef.current]);
        baseRef.current = null;
      }
    };
    // displayMode intentionally omitted — see swap effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseGeom, baseColor]);

  // Color layer meshes: depend on layers only.
  useEffect(() => {
    const group = localGroupRef.current;
    if (!group) return;
    disposeMeshArray(layerMeshesRef.current);
    layerMeshesRef.current = [];
    for (const { centroid: c, position, geom } of layers) {
      const hex = `${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
      const mesh = new THREE.Mesh(makeBufferGeom(geom), makeMaterial(new THREE.Color(c.r / 255, c.g / 255, c.b / 255), displayMode));
      mesh.name = `Color_${position + 1}_${hex}`;
      group.add(mesh);
      layerMeshesRef.current.push(mesh);
    }
    return () => {
      disposeMeshArray(layerMeshesRef.current);
      layerMeshesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers]);

  // Spike meshes: depend on spikes only.
  useEffect(() => {
    const group = localGroupRef.current;
    if (!group) return;
    disposeMeshArray(spikeMeshesRef.current);
    spikeMeshesRef.current = [];
    for (const spike of spikes) {
      const mesh = new THREE.Mesh(makeBufferGeom(spike.geom), makeMaterial(spike.color, displayMode));
      mesh.name = `Spikes_${spike.centroidIndex >= 0 ? `c${spike.centroidIndex}` : 'unbound'}`;
      group.add(mesh);
      spikeMeshesRef.current.push(mesh);
    }
    return () => {
      disposeMeshArray(spikeMeshesRef.current);
      spikeMeshesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spikes]);

  // displayMode swap: re-create the material on each existing mesh in
  // place, preserving its colour. The geometry is reused — no VBO churn.
  useEffect(() => {
    const swap = (mesh: THREE.Mesh | null) => {
      if (!mesh) return;
      const old = mesh.material;
      if (Array.isArray(old)) return;
      const wantsToon = displayMode === 'toon';
      const isToon = old instanceof THREE.MeshToonMaterial;
      if (wantsToon === isToon) return;
      const m = old as THREE.Material & { color?: THREE.Color };
      const color = m.color ? m.color.clone() : new THREE.Color(0xffffff);
      mesh.material = makeMaterial(color, displayMode);
      m.dispose();
    };
    swap(baseRef.current);
    layerMeshesRef.current.forEach(swap);
    spikeMeshesRef.current.forEach(swap);
  }, [displayMode]);

  return <group ref={localGroupRef} />;
});

ColorFlowModel.displayName = 'ColorFlowModel';
