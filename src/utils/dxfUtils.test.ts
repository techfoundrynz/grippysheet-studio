import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { parseDxfToShapes, generateSVGPath } from './dxfUtils';
import DxfParser from 'dxf-parser';

// Mock dxf-parser
vi.mock('dxf-parser', () => {
  const mockParseSync = vi.fn();
  const mockParser = vi.fn().mockImplementation(() => {
    return {
      parseSync: mockParseSync,
    };
  });
  return {
    default: mockParser,
    mockParseSync, // export to control in tests
  };
});

describe('dxfUtils utility', () => {
  let mockParserInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockParserInstance = new DxfParser();
  });

  describe('parseDxfToShapes', () => {
    it('returns empty array if parser throws an error', () => {
      mockParserInstance.parseSync.mockImplementationOnce(() => {
        throw new Error('Parse failed');
      });

      const shapes = parseDxfToShapes('invalid-dxf-content');
      expect(shapes).toEqual([]);
    });

    it('returns empty array if no entities are found', () => {
      mockParserInstance.parseSync.mockReturnValueOnce({
        header: {},
        entities: [],
      });

      const shapes = parseDxfToShapes('empty-dxf');
      expect(shapes).toEqual([]);
    });

    it('parses LINE entities and stitches them into a closed shape', () => {
      // 4 lines forming a closed 10x10 square
      mockParserInstance.parseSync.mockReturnValueOnce({
        header: { '$INSUNITS': 4 }, // mm (scale = 1)
        entities: [
          { type: 'LINE', vertices: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] },
          { type: 'LINE', vertices: [{ x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }] },
          { type: 'LINE', vertices: [{ x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }] },
          { type: 'LINE', vertices: [{ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }] },
        ],
      });

      const shapes = parseDxfToShapes('dxf-content');
      expect(shapes).toHaveLength(1);
      expect(shapes[0]).toBeInstanceOf(THREE.Shape);

      // Verify shape bounding box area
      const points = shapes[0].getPoints();
      const area = Math.abs(THREE.ShapeUtils.area(points));
      expect(area).toBeCloseTo(100, 1);
    });

    it('handles $INSUNITS scaling correctly', () => {
      // 4 lines forming a 10x10 square in Inches ($INSUNITS = 1 -> scale by 25.4)
      mockParserInstance.parseSync.mockReturnValueOnce({
        header: { '$INSUNITS': 1 },
        entities: [
          { type: 'LINE', vertices: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }] },
          { type: 'LINE', vertices: [{ x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }] },
          { type: 'LINE', vertices: [{ x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }] },
          { type: 'LINE', vertices: [{ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }] },
        ],
      });

      const shapes = parseDxfToShapes('dxf-content');
      expect(shapes).toHaveLength(1);
      const points = shapes[0].getPoints();
      const area = Math.abs(THREE.ShapeUtils.area(points));
      // Expected area: (10 * 25.4) * (10 * 25.4) = 254 * 254 = 64516
      expect(area).toBeCloseTo(64516, 0);
    });

    it('parses CIRCLE entities', () => {
      mockParserInstance.parseSync.mockReturnValueOnce({
        header: { '$INSUNITS': 4 },
        entities: [
          {
            type: 'CIRCLE',
            center: { x: 0, y: 0, z: 0 },
            radius: 5,
          },
        ],
      });

      const shapes = parseDxfToShapes('dxf-content');
      expect(shapes).toHaveLength(1);
      
      const points = shapes[0].getPoints();
      // Circle is generated using absarc, let's verify it has points
      expect(points.length).toBeGreaterThan(3);
    });

    it('parses ARC entities', () => {
      mockParserInstance.parseSync.mockReturnValueOnce({
        header: { '$INSUNITS': 4 },
        entities: [
          {
            type: 'ARC',
            center: { x: 0, y: 0, z: 0 },
            radius: 5,
            startAngle: 0,
            endAngle: Math.PI / 2, // 90 degrees
          },
        ],
      });

      const shapes = parseDxfToShapes('dxf-content');
      expect(shapes).toHaveLength(1);
      const points = shapes[0].getPoints();
      const area = Math.abs(THREE.ShapeUtils.area(points));
      expect(area).toBeGreaterThan(1.0);
    });

    it('parses LWPOLYLINE and POLYLINE entities', () => {
      mockParserInstance.parseSync.mockReturnValueOnce({
        header: { '$INSUNITS': 4 },
        entities: [
          {
            type: 'LWPOLYLINE',
            closed: true,
            vertices: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      });

      const shapes = parseDxfToShapes('dxf-content');
      expect(shapes).toHaveLength(1);
      const points = shapes[0].getPoints();
      const area = Math.abs(THREE.ShapeUtils.area(points));
      expect(area).toBeCloseTo(100, 1);
    });

    it('parses ELLIPSE entities', () => {
      mockParserInstance.parseSync.mockReturnValueOnce({
        header: { '$INSUNITS': 4 },
        entities: [
          {
            type: 'ELLIPSE',
            center: { x: 0, y: 0, z: 0 },
            majorAxisEndPoint: { x: 5, y: 0, z: 0 },
            axisRatio: 0.5,
            startAngle: 0,
            endAngle: 2 * Math.PI,
          },
        ],
      });

      const shapes = parseDxfToShapes('dxf-content');
      expect(shapes).toHaveLength(1);
    });

    it('parses SPLINE entities', () => {
      mockParserInstance.parseSync.mockReturnValueOnce({
        header: { '$INSUNITS': 4 },
        entities: [
          {
            type: 'SPLINE',
            degreeOfSplineCurve: 3,
            controlPoints: [
              { x: 0, y: 0, z: 0 },
              { x: 5, y: 5, z: 0 },
              { x: 10, y: 5, z: 0 },
              { x: 15, y: 0, z: 0 },
            ],
            knotValues: [0, 0, 0, 0, 1, 1, 1, 1],
          },
        ],
      });

      const shapes = parseDxfToShapes('dxf-content');
      expect(shapes).toBeDefined();
    });

    it('properly identifies nested holes', () => {
      // 10x10 outer square and a 4x4 inner hole square (CW winding for hole in DXF)
      // Note: in dxfUtils, nested shapes are assigned as holes.
      mockParserInstance.parseSync.mockReturnValueOnce({
        header: { '$INSUNITS': 4 },
        entities: [
          // Outer square
          {
            type: 'LWPOLYLINE',
            closed: true,
            vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
          },
          // Inner square
          {
            type: 'LWPOLYLINE',
            closed: true,
            vertices: [{ x: 3, y: 3 }, { x: 3, y: 7 }, { x: 7, y: 7 }, { x: 7, y: 3 }], // Wound differently or inside
          },
        ],
      });

      const shapes = parseDxfToShapes('dxf-content');
      expect(shapes).toHaveLength(1);
      expect(shapes[0].holes).toHaveLength(1);
    });
  });

  describe('generateSVGPath', () => {
    it('generates path data for simple shape', () => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(10, 0);
      shape.lineTo(10, 10);
      shape.lineTo(0, 10);
      shape.closePath();

      const pathData = generateSVGPath([shape]);
      expect(pathData).toContain('M 0 0');
      expect(pathData).toContain('L 10 0');
      expect(pathData).toContain('Z');
    });

    it('generates path data with holes', () => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(10, 0);
      shape.lineTo(10, 10);
      shape.lineTo(0, 10);
      shape.closePath();

      const hole = new THREE.Path();
      hole.moveTo(3, 3);
      hole.lineTo(7, 3);
      hole.lineTo(7, 7);
      hole.lineTo(3, 7);
      hole.closePath();

      shape.holes.push(hole);

      const pathData = generateSVGPath([shape]);
      expect(pathData).toContain('M 3 3');
      expect(pathData).toContain('L 3 7');
      expect(pathData).toContain('L 7 3');
      expect(pathData).toContain('L 3 3');
    });
  });
});
