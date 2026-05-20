import { describe, it, expect } from 'vitest';
import { extrudePolygon } from '../pipeline/extrude';

describe('extrudePolygon', () => {
  it('returns null for a degenerate polygon (collinear)', () => {
    const result = extrudePolygon(
      [[0, 0], [1, 0], [2, 0]],
      [],
      0,
      1,
    );
    expect(result).toBeNull();
  });

  it('extrudes a unit square into a manifold mesh', () => {
    const result = extrudePolygon(
      [[0, 0], [1, 0], [1, 1], [0, 1]],
      [],
      0,
      1,
    );
    expect(result).not.toBeNull();
    // 2 top + 2 bottom + 8 side triangles = 12 triangles
    expect(result!.indices.length).toBe(36);
    expect(result!.positions.length).toBe(24); // 8 vertices × 3 coords
  });

  it('extrudes a square with a square hole', () => {
    const result = extrudePolygon(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[[3, 3], [7, 3], [7, 7], [3, 7]]],
      0,
      1,
    );
    expect(result).not.toBeNull();
    // 8 top + 8 bottom + 16 side triangles = 32 triangles
    expect(result!.indices.length).toBe(96);
  });

  it('places top vertices at zTop and bottom at zBottom', () => {
    const result = extrudePolygon([[0, 0], [1, 0], [1, 1], [0, 1]], [], 2, 5);
    const zs = new Set<number>();
    for (let i = 2; i < result!.positions.length; i += 3) zs.add(result!.positions[i]);
    expect(zs.has(2)).toBe(true);
    expect(zs.has(5)).toBe(true);
  });

  it('outer and hole side walls have opposite winding orientation', () => {
    const result = extrudePolygon(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[[3, 3], [7, 3], [7, 7], [3, 7]]],
      0, 1,
    );
    expect(result).not.toBeNull();
    // Side-wall triangles are vertical, so their XY signed area is always 0.
    // Instead we check the sign of (normal · outward-direction) for each wall
    // quad to verify winding orientation.
    //
    // Outer ring centroid: (5, 5).  Outward normal must point AWAY from center.
    // Hole ring centroid: (5, 5).   Outward normal (from solid) must point
    //   TOWARD hole center — i.e., inward toward the cavity.
    //
    // Strategy: compute the 3D normal of each wall triangle, then take the XY
    // dot product with the vector from the triangle's edge midpoint to the
    // relevant centroid.  For outer walls the normal should oppose that vector
    // (dot < 0); for hole walls it should align (dot > 0).
    const positions = result!.positions;
    const indices = result!.indices;
    // Top + bottom faces = 8 triangles each = 48 indices total. Walls start at 48.
    const wallStart = 48;
    let outerDots: number[] = [];
    let holeDots: number[] = [];
    const cx_poly = 5, cy_poly = 5; // both centroids are (5,5)
    for (let i = wallStart; i < indices.length; i += 3) {
      const ax = positions[indices[i] * 3],     ay = positions[indices[i] * 3 + 1];
      const bx = positions[indices[i + 1] * 3], by = positions[indices[i + 1] * 3 + 1];
      const cx = positions[indices[i + 2] * 3], cy = positions[indices[i + 2] * 3 + 1];
      const az = positions[indices[i] * 3 + 2];
      const bz = positions[indices[i + 1] * 3 + 2];
      const cz = positions[indices[i + 2] * 3 + 2];
      // 3D cross product: (B-A) × (C-A) gives the face normal
      const dx1 = bx - ax, dy1 = by - ay, dz1 = bz - az;
      const dx2 = cx - ax, dy2 = cy - ay, dz2 = cz - az;
      const nx = dy1 * dz2 - dz1 * dy2;
      const ny = dz1 * dx2 - dx1 * dz2;
      // Edge midpoint in XY (average of the two unique XY positions on the wall)
      const mx = (ax + bx + cx) / 3;
      const my = (ay + by + cy) / 3;
      // Vector from edge midpoint toward polygon/hole centroid
      const tx = cx_poly - mx, ty = cy_poly - my;
      // Dot of XY normal with centroid direction
      const dot = nx * tx + ny * ty;
      if (Math.abs(dot) < 1e-9) continue; // skip degenerate (shouldn't happen)
      // Outer triangles touch the bounding box corners ([0,0]/[10,10]),
      // hole triangles lie entirely on the inner box ([3,3]/[7,7]).
      const inOuter = ax === 0 || ax === 10 || ay === 0 || ay === 10
                   || bx === 0 || bx === 10 || by === 0 || by === 10
                   || cx === 0 || cx === 10 || cy === 0 || cy === 10;
      if (inOuter) outerDots.push(dot);
      else holeDots.push(dot);
    }
    expect(outerDots.length).toBeGreaterThan(0);
    expect(holeDots.length).toBeGreaterThan(0);
    // Outer walls face AWAY from center → dot(normal, toward-center) < 0
    for (const d of outerDots) expect(d).toBeLessThan(0);
    // Hole walls face TOWARD center (into the cavity) → dot(normal, toward-center) > 0
    for (const d of holeDots) expect(d).toBeGreaterThan(0);
  });
});
