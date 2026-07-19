import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyPatternResult, ApplyContext } from './applyPatternResult';
import { PatternResult } from './patternPipeline';
import { serializeGeometry } from './serialize';

function ctx(overrides: Partial<ApplyContext> = {}): ApplyContext {
  return {
    makeMaterial: (c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c) }),
    resolveColor: (c) => (c === 'base' ? '#123456' : c),
    patternColor: '#00ff00',
    patternOpacity: 1,
    wireframePattern: false,
    isDragging: false,
    debugShowPatternCutter: false,
    debugShowHoleCutter: false,
    debugShowInlayCutter: false,
    ...overrides,
  };
}

function maskedResult(color: string): PatternResult {
  return {
    jobId: 1,
    empty: false,
    parts: [{
      name: `Pattern_Masked_0_${color}`,
      geometry: serializeGeometry(new THREE.BoxGeometry(1, 1, 1)),
      material: { type: 'masked', color },
    }],
  };
}

describe('applyPatternResult masked colouring', () => {
  it('renders a masked part in its own colour when not dragging', () => {
    const group = new THREE.Group();
    applyPatternResult(group, maskedResult('#ff0000'), ctx({ isDragging: false }));
    const mesh = group.getObjectByName('Pattern_Masked_0_#ff0000') as THREE.Mesh;
    expect(mesh).toBeDefined();
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
  });

  it('resolves the "base" colour token', () => {
    const group = new THREE.Group();
    applyPatternResult(group, maskedResult('base'), ctx());
    const mesh = group.getObjectByName('Pattern_Masked_0_base') as THREE.Mesh;
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('123456');
  });

  it('flattens to the standard colour while dragging', () => {
    const group = new THREE.Group();
    applyPatternResult(group, maskedResult('#ff0000'), ctx({ isDragging: true }));
    const mesh = group.getObjectByName('Pattern_Masked_0_#ff0000') as THREE.Mesh;
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('00ff00');
  });
});
