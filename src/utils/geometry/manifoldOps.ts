import type {
  ManifoldToplevel,
  Manifold as ManifoldObj,
  CrossSection as CrossSectionObj,
  Vec2,
  FillRule,
} from 'manifold-3d';
import { SerializedShape, SerializedGeometry } from './serialize';

/**
 * Shared Manifold helpers used by the pattern and inlay pipelines. Manifold objects
 * are wasm-backed and must be freed explicitly; a ManifoldOps instance tracks every
 * object it creates so a single `flush()` releases them all.
 */

export type M = ManifoldObj;
export type CS = CrossSectionObj;

/** Preserve hard edges (>60°) as facets while smoothing genuinely curved surfaces. */
export const SHARP_ANGLE = 60;
const NORMAL_IDX = 3;

export class ManifoldOps {
  readonly Manifold: ManifoldToplevel['Manifold'];
  readonly CrossSection: ManifoldToplevel['CrossSection'];
  readonly Mesh: ManifoldToplevel['Mesh'];
  private items: { delete(): void }[] = [];

  constructor(wasm: ManifoldToplevel) {
    this.Manifold = wasm.Manifold;
    this.CrossSection = wasm.CrossSection;
    this.Mesh = wasm.Mesh;
  }

  /** Track a wasm object for disposal; returns it for chaining. */
  track = <T extends { delete(): void }>(x: T): T => {
    this.items.push(x);
    return x;
  };

  flush() {
    for (const it of this.items) {
      try { it.delete(); } catch { /* already freed */ }
    }
    this.items = [];
  }

  private contoursOf(s: SerializedShape, mirror = false): Vec2[][] {
    const sx = mirror ? -1 : 1;
    const toPairs = (flat: number[]): Vec2[] => {
      const o: Vec2[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) o.push([flat[i] * sx, flat[i + 1]]);
      return o;
    };
    return [toPairs(s.points), ...s.holes.map(toPairs)];
  }

  /** One shape (outer + holes) as a CrossSection; optional X mirror. */
  csFromShape(s: SerializedShape, mirror = false, fill: FillRule = 'EvenOdd'): CS | null {
    if (s.points.length < 6) return null;
    return this.track(new this.CrossSection(this.contoursOf(s, mirror), fill));
  }

  /** Union of several shapes into one CrossSection (overlap-safe). */
  csFromShapes(shapes: SerializedShape[], fill: FillRule = 'EvenOdd'): CS | null {
    const sections = shapes
      .filter((s) => s.points.length >= 6)
      .map((s) => this.track(new this.CrossSection(this.contoursOf(s), fill)));
    if (sections.length === 0) return null;
    if (sections.length === 1) return sections[0];
    return this.track(this.CrossSection.union(sections));
  }

  /** Build a Manifold from raw geometry buffers (welds coincident verts first). */
  manifoldFromGeometry(geo: SerializedGeometry): M {
    const numVert = geo.position.length / 3;
    const triVerts = geo.index
      ? new Uint32Array(geo.index)
      : Uint32Array.from({ length: numVert }, (_v, i) => i);
    const mesh = new this.Mesh({ numProp: 3, vertProperties: new Float32Array(geo.position), triVerts });
    mesh.merge(); // weld coincident vertices so an STL triangle-soup becomes a manifold
    return this.track(this.Manifold.ofMesh(mesh));
  }

  /** Extract position (+optional sharp-edge normals) and index buffers. */
  serializeMesh(m: M, withNormals: boolean): SerializedGeometry {
    const src = withNormals ? this.track(m.calculateNormals(NORMAL_IDX, SHARP_ANGLE)) : m;
    const mesh = src.getMesh();
    const np = mesh.numProp;
    const vp = mesh.vertProperties;
    const nv = vp.length / np;
    const position = new Float32Array(nv * 3);
    let normal: Float32Array | undefined;
    if (withNormals && np >= 6) normal = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      position[i * 3] = vp[i * np];
      position[i * 3 + 1] = vp[i * np + 1];
      position[i * 3 + 2] = vp[i * np + 2];
      if (normal) {
        normal[i * 3] = vp[i * np + 3];
        normal[i * 3 + 1] = vp[i * np + 4];
        normal[i * 3 + 2] = vp[i * np + 5];
      }
    }
    return { position, normal, index: new Uint32Array(mesh.triVerts) };
  }
}
