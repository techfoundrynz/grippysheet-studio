import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { offsetShape, unionShapes } from './offsetUtils';

// Helper to create a square THREE.Shape
const createSquare = (size: number, x = 0, y = 0): THREE.Shape => {
  const shape = new THREE.Shape();
  shape.moveTo(x, y);
  shape.lineTo(x + size, y);
  shape.lineTo(x + size, y + size);
  shape.lineTo(x, y + size);
  shape.closePath();
  return shape;
};

// Helper to get simple bounding area or points count
const getArea = (shape: THREE.Shape): number => {
  const points = shape.getPoints();
  return Math.abs(THREE.ShapeUtils.area(points));
};

describe('offsetUtils utility', () => {
  describe('offsetShape', () => {
    it('returns the same shape if offset is 0', () => {
      const square = createSquare(10);
      const result = offsetShape(square, 0);
      expect(result).toHaveLength(1);
      expect(getArea(result[0])).toBe(100);
    });

    it('expands a shape with a positive offset', () => {
      // 10x10 square -> positive offset of 1 should make it 12x12
      const square = createSquare(10);
      const result = offsetShape(square, 1);
      expect(result).toHaveLength(1);
      
      const newArea = getArea(result[0]);
      // A 10x10 square offset by 1 has area (10 + 2*1)^2 = 144
      // Note: Clipper rounding might make it slightly different depending on JoinType (miter/round)
      // Since it's JoinType.jtMiter, the outer boundary of a square remains a square of 12x12 = 144 area.
      expect(newArea).toBeCloseTo(144, 0);
    });

    it('shrinks a shape with a negative offset', () => {
      // 10x10 square -> negative offset of -1 should make it 8x8 = 64 area
      const square = createSquare(10);
      const result = offsetShape(square, -1);
      expect(result).toHaveLength(1);
      
      const newArea = getArea(result[0]);
      expect(newArea).toBeCloseTo(64, 0);
    });

    it('handles shape with holes', () => {
      const outer = createSquare(10);
      
      // CW wound square for hole (6x6 size, so it doesn't collapse to 0 when offset by 1.0)
      const hole = new THREE.Shape();
      hole.moveTo(2, 2);
      hole.lineTo(2, 8);
      hole.lineTo(8, 8);
      hole.lineTo(8, 2);
      hole.closePath();
      
      outer.holes.push(hole);

      // Offset by 1
      const result = offsetShape(outer, 1);
      expect(result).toHaveLength(1);
      
      const resShape = result[0];
      expect(resShape.holes).toHaveLength(1);
      
      // Outer is expanded (10 -> 12), hole is shrunk (6 -> 4)
      // Let's verify that the outer area is roughly correct.
      expect(getArea(resShape)).toBeCloseTo(144, 0);
    });
  });

  describe('unionShapes', () => {
    it('returns empty array if empty shapes are passed', () => {
      expect(unionShapes([])).toEqual([]);
    });

    it('unions two overlapping shapes into one', () => {
      // Two overlapping 10x10 squares
      // Square 1: x: [0, 10], y: [0, 10]
      // Square 2: x: [5, 15], y: [0, 10]
      // Overlap: x: [5, 10], y: [0, 10] (Area of overlap = 50)
      // Total area should be 100 + 100 - 50 = 150
      const sq1 = createSquare(10, 0, 0);
      const sq2 = createSquare(10, 5, 0);

      const result = unionShapes([sq1, sq2]);
      expect(result).toHaveLength(1);
      expect(getArea(result[0])).toBeCloseTo(150, 0);
    });

    it('returns separate shapes if they do not overlap', () => {
      const sq1 = createSquare(5, 0, 0);
      const sq2 = createSquare(5, 10, 0);

      const result = unionShapes([sq1, sq2]);
      expect(result).toHaveLength(2);
      expect(getArea(result[0]) + getArea(result[1])).toBeCloseTo(50, 0);
    });
  });
});
