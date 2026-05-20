import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Centroid } from './pipeline/quantize';
import type { ExtrudedGeometry } from './pipeline/extrude';

interface Props {
  baseGeom: ExtrudedGeometry | null;
  layers: Array<{ centroid: Centroid; position: number; geom: ExtrudedGeometry }>;
  displayMode?: 'normal' | 'toon';
}

function makeBufferGeom(g: ExtrudedGeometry): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(g.indices, 1));
  geom.computeVertexNormals();
  return geom;
}

export const ColorFlowModel = React.forwardRef<THREE.Group, Props>(({ baseGeom, layers, displayMode = 'normal' }, ref) => {
  const localGroupRef = useRef<THREE.Group>(null);

  React.useImperativeHandle(ref, () => localGroupRef.current!, []);

  useEffect(() => {
    const group = localGroupRef.current;
    if (!group) return;
    // Dispose & clear
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      }
    });
    while (group.children.length) group.remove(group.children[0]);
    group.name = 'ColorFlowAssembly';

    if (baseGeom) {
      const mesh = new THREE.Mesh(
        makeBufferGeom(baseGeom),
        displayMode === 'toon'
          ? new THREE.MeshToonMaterial({ color: 0xdddddd })
          : new THREE.MeshStandardMaterial({ color: 0xdddddd }),
      );
      mesh.name = 'Base';
      group.add(mesh);
    }
    for (let i = 0; i < layers.length; i++) {
      const { centroid: c, position, geom } = layers[i];
      const hex = `${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
      const mat = displayMode === 'toon'
        ? new THREE.MeshToonMaterial({ color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255) })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255) });
      const mesh = new THREE.Mesh(makeBufferGeom(geom), mat);
      mesh.name = `Color_${position + 1}_${hex}`;
      group.add(mesh);
    }

    return () => {
      // Dispose on unmount to release GPU memory.
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (obj.material instanceof THREE.Material) obj.material.dispose();
        }
      });
    };
  }, [baseGeom, layers, displayMode]);

  return <group ref={localGroupRef} />;
});

ColorFlowModel.displayName = 'ColorFlowModel';
