import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { parseShapeFile } from './shapeLoader';
import { parseDxfToShapes } from './dxfUtils';
import { SVGLoader } from 'three-stdlib';

// Mock three-stdlib SVGLoader and STLLoader
vi.mock('three-stdlib', () => {
  const mockSVGLoader = vi.fn().mockImplementation(() => {
    return {
      parse: vi.fn().mockReturnValue({
        paths: [
          {
            userData: { style: { fill: '#ff0000' } },
            color: { getStyle: () => '#ff0000' },
          }
        ]
      }),
    };
  });
  
  (mockSVGLoader as any).createShapes = vi.fn().mockReturnValue([new THREE.Shape()]);

  const mockSTLLoader = vi.fn().mockImplementation(() => {
    return {
      parse: vi.fn().mockReturnValue({
        center: vi.fn(),
      }),
    };
  });

  return {
    SVGLoader: mockSVGLoader,
    STLLoader: mockSTLLoader,
  };
});

// Mock dxfUtils
vi.mock('./dxfUtils', () => {
  return {
    parseDxfToShapes: vi.fn().mockReturnValue([new THREE.Shape()]),
  };
});

// Mock centerShapes in patternUtils
vi.mock('./patternUtils', () => {
  return {
    centerShapes: vi.fn().mockImplementation((shapes) => shapes),
  };
});

describe('shapeLoader utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails if stl content is not an ArrayBuffer', () => {
    const result = parseShapeFile('string-content', 'stl');
    expect(result.success).toBe(false);
    expect(result.error).toBe('STL content must be ArrayBuffer');
  });

  it('successfully parses stl content from ArrayBuffer', () => {
    const arrayBuffer = new ArrayBuffer(8);
    const result = parseShapeFile(arrayBuffer, 'stl');
    expect(result.success).toBe(true);
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0]).toHaveProperty('center');
  });

  it('fails if svg content is not a string', () => {
    const arrayBuffer = new ArrayBuffer(8);
    const result = parseShapeFile(arrayBuffer, 'svg');
    expect(result.success).toBe(false);
    expect(result.error).toBe('SVG content must be string');
  });

  it('successfully parses svg content and extracts shapes', () => {
    const result = parseShapeFile('<svg></svg>', 'svg', false);
    expect(result.success).toBe(true);
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0]).toBeInstanceOf(THREE.Shape);
  });

  it('successfully parses svg content and extracts shapes with colors', () => {
    const result = parseShapeFile('<svg></svg>', 'svg', true);
    expect(result.success).toBe(true);
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0]).toEqual({
      shape: expect.any(THREE.Shape),
      color: '#ff0000',
    });
  });

  it('fails if dxf content is not a string', () => {
    const arrayBuffer = new ArrayBuffer(8);
    const result = parseShapeFile(arrayBuffer, 'dxf');
    expect(result.success).toBe(false);
    expect(result.error).toBe('DXF content must be string');
  });

  it('successfully parses dxf content', () => {
    const result = parseShapeFile('SECTION\nHEADER', 'dxf', false);
    expect(result.success).toBe(true);
    expect(parseDxfToShapes).toHaveBeenCalledWith('SECTION\nHEADER');
    expect(result.shapes).toHaveLength(1);
  });

  it('successfully parses dxf content with colors', () => {
    const result = parseShapeFile('SECTION\nHEADER', 'dxf', true);
    expect(result.success).toBe(true);
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0]).toEqual({
      shape: expect.any(THREE.Shape),
      color: '#000000',
    });
  });

  it('auto-detects type from string content (SVG)', () => {
    const result = parseShapeFile('<svg xmlns="..."></svg>', 'dxf'); // Passed type is dxf, but content is svg
    expect(result.success).toBe(true);
    // Since it auto-detected as svg, it will use SVGLoader
    expect(result.shapes[0]).toBeInstanceOf(THREE.Shape);
  });

  it('auto-detects type from string content (DXF)', () => {
    const result = parseShapeFile('SECTION\n  0\nHEADER', 'svg'); // Passed type is svg, but content is dxf
    expect(result.success).toBe(true);
    expect(parseDxfToShapes).toHaveBeenCalled();
  });

  it('returns failure on unexpected exceptions', () => {
    // Force SVGLoader to throw an error
    vi.mocked(SVGLoader).mockImplementationOnce(() => {
      throw new Error('Parse error');
    });

    const result = parseShapeFile('<svg></svg>', 'svg');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Parse error');
  });
});
