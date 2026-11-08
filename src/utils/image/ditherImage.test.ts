import { describe, expect, it } from 'vitest';
import { ditherLayers, ditherSVG, DITHER_METHODS, MAX_DITHER_DETAIL } from './ditherImage';
import { shapesFromLayers, type RGBAImage } from './traceImage';
import { parseShapeFile } from '../shapeLoader';

function image(width: number, height: number, value: number, alpha = 255): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([value, value, value, alpha], i);
  return { width, height, data };
}

function area(data: ReturnType<typeof ditherLayers>, layer: number) {
  return data.layers[layer].reduce((sum, path) => {
    const [x1, y1, x2, y2] = path.boundingbox;
    return sum + (x2 - x1) * (y2 - y1);
  }, 0);
}

describe('monochrome inlay dithering', () => {
  it.each(DITHER_METHODS)('$label fills black, merges uniform pixels, and leaves white empty', ({ value }) => {
    const result = ditherLayers(image(32, 16, 0), 64, value);
    expect(result.layers[1]).toHaveLength(1);
    expect(area(result, 1)).toBe(512);
    expect(ditherLayers(image(32, 16, 255), 64, value).layers[1]).toHaveLength(0);
    expect(result.layers).toHaveLength(2);
  });

  it('represents mid-gray with approximately half ink and half transparent coverage', () => {
    const result = ditherLayers(image(64, 32, 128));
    expect(area(result, 1) / (64 * 32)).toBeCloseTo(0.5, 1);
    expect(result.palette).toEqual(['#000000']);
  });

  it('leaves transparent pixels empty and excludes their hidden colour', () => {
    const input = image(3, 1, 0);
    input.data[7] = 0;
    const result = ditherLayers(input);
    expect(area(result, 1)).toBe(2);
    expect(result.layers[1]).toHaveLength(2);
    expect(shapesFromLayers(ditherLayers(image(8, 8, 0, 0))).shapes).toHaveLength(0);
  });

  it('bounds detail, preserves aspect, centres geometry and flips image Y', () => {
    const result = ditherLayers(image(1200, 600, 0), 2000);
    expect([result.width, result.height]).toEqual([MAX_DITHER_DETAIL, MAX_DITHER_DETAIL / 2]);
    const points = shapesFromLayers(result).shapes[0].shape.getPoints();
    expect(Math.min(...points.map(p => p.x))).toBe(-25);
    expect(Math.max(...points.map(p => p.x))).toBe(25);
    expect(points[0].y).toBe(12.5);
    expect(Math.min(...points.map(p => p.y))).toBe(-12.5);
  });

  it('round-trips the generated SVG asset with the selected ink colour and no background', () => {
    const result = ditherLayers(image(16, 8, 128), 64, 'floyd-steinberg', '#e03090');
    const restored = parseShapeFile(ditherSVG(result), 'svg', true);
    expect(restored.success).toBe(true);
    expect(restored.shapes.length).toBeGreaterThan(0);
    expect(new Set(restored.shapes.map((s: { color: string }) => s.color.toLowerCase()))).toEqual(new Set(['#e03090']));
    const points = restored.shapes.flatMap(s => s.shape.getPoints());
    expect(Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x))).toBeCloseTo(50);
    expect(Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))).toBeCloseTo(25);
  });

  it.each(DITHER_METHODS)('$label keeps transparent inputs empty and uses only the selected colour', ({ value }) => {
    expect(ditherLayers(image(16, 8, 0, 0), 64, value).layers[1]).toHaveLength(0);
    const result = shapesFromLayers(ditherLayers(image(16, 8, 0), 64, value, '#123456'));
    expect(result.shapes.map(s => s.color)).toEqual(['#123456']);
  });

  it.each(['bayer4', 'bayer8'] as const)('%s has evenly spaced, repeating dots', method => {
    const result = ditherLayers(image(16, 16, 128), 64, method);
    expect(area(result, 1)).toBe(128);
    expect(result).toEqual(ditherLayers(image(16, 16, 128), 64, method));
  });

  it('produces distinct patterns for the different strategies', () => {
    const input = image(32, 16, 96);
    for (let i = 0; i < input.width * input.height; i++) {
      const value = Math.round((i % input.width) * 255 / (input.width - 1));
      input.data.set([value, value, value], i * 4);
    }
    const results = DITHER_METHODS.map(({ value }) => JSON.stringify(ditherLayers(input, 64, value).layers));
    expect(new Set(results).size).toBe(DITHER_METHODS.length);
  });

  it('uses the source resolution without upscaling small images', () => {
    const result = ditherLayers(image(40, 20, 0), MAX_DITHER_DETAIL);
    expect([result.width, result.height]).toEqual([40, 20]);
  });
});
