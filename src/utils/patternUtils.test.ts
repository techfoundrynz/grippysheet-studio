import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  getShapesBounds,
  getGeometryBounds,
  getDistanceToShape,
  centerShapes,
  calculateInlayScale,
  calculateInlayOffset,
  generateTilePositions,
  tileShapes
} from './patternUtils';

const createSquare = (size: number, x = 0, y = 0): THREE.Shape => {
  const shape = new THREE.Shape();
  shape.moveTo(x, y);
  shape.lineTo(x + size, y);
  shape.lineTo(x + size, y + size);
  shape.lineTo(x, y + size);
  shape.closePath();
  return shape;
};

describe('patternUtils utility', () => {
  describe('getShapesBounds', () => {
    it('returns zero bounds for empty shapes array', () => {
      const bounds = getShapesBounds([]);
      expect(bounds.size.x).toBe(0);
      expect(bounds.size.y).toBe(0);
      expect(bounds.center.x).toBe(0);
      expect(bounds.center.y).toBe(0);
    });

    it('calculates bounding box of shapes correctly', () => {
      const sq1 = createSquare(10, 0, 0);
      const sq2 = createSquare(5, 10, 10);
      const bounds = getShapesBounds([sq1, sq2]);

      expect(bounds.min.x).toBe(0);
      expect(bounds.min.y).toBe(0);
      expect(bounds.max.x).toBe(15);
      expect(bounds.max.y).toBe(15);
      expect(bounds.size.x).toBe(15);
      expect(bounds.size.y).toBe(15);
      expect(bounds.center.x).toBe(7.5);
      expect(bounds.center.y).toBe(7.5);
    });
  });

  describe('getGeometryBounds', () => {
    it('returns zero bounds for null boundingBox', () => {
      const geom = new THREE.BufferGeometry();
      geom.computeBoundingBox = vi.fn(); // Mock to keep boundingBox null
      const bounds = getGeometryBounds(geom);
      expect(bounds.size.x).toBe(0);
      expect(bounds.size.y).toBe(0);
    });

    it('calculates bounds of BufferGeometry correctly', () => {
      const geom = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        -5, -5, 0,
        5, -5, 0,
        5, 5, 0,
      ]);
      geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      
      const bounds = getGeometryBounds(geom);
      expect(bounds.min.x).toBe(-5);
      expect(bounds.min.y).toBe(-5);
      expect(bounds.max.x).toBe(5);
      expect(bounds.max.y).toBe(5);
      expect(bounds.size.x).toBe(10);
      expect(bounds.size.y).toBe(10);
      expect(bounds.center.x).toBe(0);
      expect(bounds.center.y).toBe(0);
    });
  });

  describe('getDistanceToShape', () => {
    it('calculates distance to a square edge correctly', () => {
      const sq = createSquare(10, 0, 0);
      // Point at (5, -2) should be 2 units from the bottom edge (which lies on y = 0, between x=0 and x=10)
      const dist1 = getDistanceToShape(new THREE.Vector2(5, -2), sq);
      expect(dist1).toBeCloseTo(2, 4);

      // Point at (12, 5) should be 2 units from the right edge (x = 10)
      const dist2 = getDistanceToShape(new THREE.Vector2(12, 5), sq);
      expect(dist2).toBeCloseTo(2, 4);
    });
  });

  describe('centerShapes', () => {
    it('returns empty array if empty shapes array is passed', () => {
      expect(centerShapes([])).toEqual([]);
    });

    it('centers shape around (0,0) and optionally flips Y', () => {
      // Square from (10, 10) to (20, 20) -> Center is (15, 15)
      const sq = createSquare(10, 10, 10);
      const centered = centerShapes([sq], false);

      const bounds = getShapesBounds(centered);
      expect(bounds.center.x).toBeCloseTo(0, 4);
      expect(bounds.center.y).toBeCloseTo(0, 4);
      expect(bounds.size.x).toBe(10);

      // Verify flipY
      const flipped = centerShapes([sq], true);
      const boundsFlipped = getShapesBounds(flipped);
      expect(boundsFlipped.center.x).toBeCloseTo(0, 4);
      expect(boundsFlipped.center.y).toBeCloseTo(0, 4);
    });
  });

  describe('calculateInlayScale', () => {
    it('calculates optimal scale based on defaultSize when cutoutShapes is empty', () => {
      const shapes = [createSquare(10)]; // Size is 10x10, maxSize = 10
      // defaultSize = 100, coverage = 0.8
      // Expected scale = (100 * 0.8) / 10 = 8
      const scale = calculateInlayScale(shapes, null, 100, 0.8);
      expect(scale).toBe(8);
    });

    it('calculates optimal scale based on cutoutShapes bounds when provided', () => {
      const shapes = [createSquare(10)];
      const cutout = [createSquare(50)]; // Cutout size 50x50
      // scale = (50 * 0.8) / 10 = 4
      const scale = calculateInlayScale(shapes, cutout, 100, 0.8);
      expect(scale).toBe(4);
    });
  });

  describe('calculateInlayOffset', () => {
    it('returns 0,0 for center preset', () => {
      const shapes = [{ shape: createSquare(10) }];
      const offset = calculateInlayOffset(shapes, null, 100, {
        inlayScale: 1,
        inlayRotation: 0,
        inlayMirror: false,
        inlayPosition: 'center',
      });
      expect(offset).toEqual({ x: 0, y: 0 });
    });

    it('returns preset coordinates for manual position', () => {
      const shapes = [{ shape: createSquare(10) }];
      const offset = calculateInlayOffset(shapes, null, 100, {
        inlayScale: 1,
        inlayRotation: 0,
        inlayMirror: false,
        inlayPosition: 'manual',
        inlayPositionX: 15,
        inlayPositionY: -20,
      });
      expect(offset).toEqual({ x: 15, y: -20 });
    });

    it('calculates alignment offset (e.g. top-left)', () => {
      // Inlay: 10x10 square centered at (0,0) -> local bounds: [-5, 5] x [-5, 5]
      // Base Size: 100 -> bounds: [-50, 50] x [-50, 50]
      // Alignment 'top-left' means:
      // inlay's minX (-5) should align to base's minX (-50) -> offset.x = -50 - (-5) = -45
      // inlay's maxY (5) should align to base's maxY (50) -> offset.y = 50 - 5 = 45
      const shapes = [createSquare(10, -5, -5)];
      const offset = calculateInlayOffset(shapes, null, 100, {
        inlayScale: 1,
        inlayRotation: 0,
        inlayMirror: false,
        inlayPosition: 'top-left',
      });
      expect(offset.x).toBeCloseTo(-45, 4);
      expect(offset.y).toBeCloseTo(45, 4);
    });

    it('calculates alignment offset for top-right, bottom-left, etc.', () => {
      const shapes = [createSquare(10, -5, -5)];
      
      const offsetTR = calculateInlayOffset(shapes, null, 100, {
        inlayScale: 1,
        inlayRotation: 0,
        inlayMirror: false,
        inlayPosition: 'top-right',
      });
      expect(offsetTR.x).toBeCloseTo(45, 4);
      expect(offsetTR.y).toBeCloseTo(45, 4);

      const offsetBL = calculateInlayOffset(shapes, null, 100, {
        inlayScale: 1,
        inlayRotation: 0,
        inlayMirror: false,
        inlayPosition: 'bottom-left',
      });
      expect(offsetBL.x).toBeCloseTo(-45, 4);
      expect(offsetBL.y).toBeCloseTo(-45, 4);
    });
  });

  describe('generateTilePositions', () => {
    it('generates tile positions in a grid', () => {
      const bounds = new THREE.Box2(new THREE.Vector2(-50, -50), new THREE.Vector2(50, 50));
      // Grid distribution
      const positions = generateTilePositions(
        bounds,
        10, // width
        10, // height
        5,  // spacing (fullWidth = 15)
        null, // boundaryShapes
        0, // margin
        false, // allowPartial
        'grid'
      );

      expect(positions.length).toBeGreaterThan(0);
      positions.forEach(pos => {
        expect(pos.position.x).toBeGreaterThanOrEqual(-50);
        expect(pos.position.x).toBeLessThanOrEqual(50);
        expect(pos.position.y).toBeGreaterThanOrEqual(-50);
        expect(pos.position.y).toBeLessThanOrEqual(50);
        expect(pos.rotation).toBe(0);
        expect(pos.scale).toBe(1);
      });
    });

    it('generates tile positions in offset mode', () => {
      const bounds = new THREE.Box2(new THREE.Vector2(-50, -50), new THREE.Vector2(50, 50));
      const positions = generateTilePositions(
        bounds,
        10,
        10,
        5,
        null,
        0,
        false,
        'offset'
      );
      expect(positions.length).toBeGreaterThan(0);
    });

    it('generates tile positions in radial mode', () => {
      const bounds = new THREE.Box2(new THREE.Vector2(-50, -50), new THREE.Vector2(50, 50));
      const positions = generateTilePositions(
        bounds,
        10,
        10,
        5,
        null,
        0,
        false,
        'radial'
      );
      expect(positions.length).toBeGreaterThan(0);
    });

    it('generates tile positions in random mode', () => {
      const bounds = new THREE.Box2(new THREE.Vector2(-50, -50), new THREE.Vector2(50, 50));
      const positions = generateTilePositions(
        bounds,
        10,
        10,
        5,
        null,
        0,
        false,
        'random'
      );
      expect(positions.length).toBeGreaterThan(0);
    });



    it('generates tile positions in hex, wave, zigzag, and warped-grid modes', () => {
      const bounds = new THREE.Box2(new THREE.Vector2(-50, -50), new THREE.Vector2(50, 50));
      
      const hexPositions = generateTilePositions(bounds, 10, 10, 5, null, 0, false, 'hex');
      expect(hexPositions.length).toBeGreaterThan(0);

      const wavePositions = generateTilePositions(bounds, 10, 10, 5, null, 0, false, 'wave', 'none', 'horizontal');
      expect(wavePositions.length).toBeGreaterThan(0);

      const waveVPositions = generateTilePositions(bounds, 10, 10, 5, null, 0, false, 'wave', 'none', 'vertical');
      expect(waveVPositions.length).toBeGreaterThan(0);

      const zigzagPositions = generateTilePositions(bounds, 10, 10, 5, null, 0, false, 'zigzag', 'none', 'horizontal');
      expect(zigzagPositions.length).toBeGreaterThan(0);

      const zigzagVPositions = generateTilePositions(bounds, 10, 10, 5, null, 0, false, 'zigzag', 'none', 'vertical');
      expect(zigzagVPositions.length).toBeGreaterThan(0);

      const warpedPositions = generateTilePositions(bounds, 10, 10, 5, null, 0, false, 'warped-grid');
      expect(warpedPositions.length).toBeGreaterThan(0);
    });

    it('generates tile positions with alternate and aligned orientations', () => {
      const bounds = new THREE.Box2(new THREE.Vector2(-50, -50), new THREE.Vector2(50, 50));
      const altPositions = generateTilePositions(bounds, 10, 10, 5, null, 0, false, 'grid', 'alternate');
      expect(altPositions.length).toBeGreaterThan(0);

      const alignedPositions = generateTilePositions(bounds, 10, 10, 5, null, 0, false, 'grid', 'aligned');
      expect(alignedPositions.length).toBeGreaterThan(0);
    });
  });

  describe('tileShapes', () => {
    it('tiles input shapes across the bounds', () => {
      const bounds = new THREE.Box2(new THREE.Vector2(-30, -30), new THREE.Vector2(30, 30));
      const shapes = [createSquare(10, -5, -5)];
      
      const tiled = tileShapes(
        shapes,
        bounds,
        1.0, // scale
        5, // spacing
        null, // boundaryShapes
        0, // margin
        null // patternType
      );

      expect(tiled.length).toBeGreaterThan(1);
      tiled.forEach(item => {
        expect(item).toBeInstanceOf(THREE.Shape);
      });
    });

    it('tiles BufferGeometry shapes', () => {
      const bounds = new THREE.Box2(new THREE.Vector2(-30, -30), new THREE.Vector2(30, 30));
      const geom = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        -1, -1, 0,
        1, -1, 0,
        1, 1, 0,
      ]);
      geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      
      const tiled = tileShapes(
        [geom],
        bounds,
        1.0,
        5,
        null,
        0,
        'stl'
      );

      expect(tiled.length).toBeGreaterThan(1);
      expect(tiled[0]).toBeInstanceOf(THREE.BufferGeometry);
    });
  });
});
