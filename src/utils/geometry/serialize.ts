import * as THREE from 'three';

/**
 * Serialization boundary for the geometry pipeline.
 *
 * The React state holds live THREE.Shape / THREE.BufferGeometry objects, which are
 * NOT structured-cloneable (methods, curves, Path instances). To run geometry
 * generation in a Web Worker we reduce shapes to plain flat point arrays inbound and
 * ship geometry back as transferable typed arrays (position/normal/index) outbound.
 *
 * These helpers are pure and worker-safe (THREE math classes only, no DOM/GL).
 */

/** A polygon with optional holes, as flat [x0,y0,x1,y1,...] arrays. */
export interface SerializedShape {
  points: number[];
  holes: number[][];
}

/** Raw geometry buffers. The arrays are Transferable. */
export interface SerializedGeometry {
  position: Float32Array;
  normal?: Float32Array;
  index?: Uint32Array;
}

// ---- Shapes ----------------------------------------------------------------

/**
 * THREE.Shape -> flat point arrays. Curves are sampled via getPoints() (default
 * 12 divisions), matching how the rest of the app already consumes these shapes
 * (bounds, tiling, CSG cutters all operate on getPoints() polylines).
 */
export function serializeShape(shape: THREE.Shape): SerializedShape {
  const points: number[] = [];
  shape.getPoints().forEach((p) => {
    points.push(p.x, p.y);
  });
  const holes: number[][] = (shape.holes || []).map((h) => {
    const flat: number[] = [];
    h.getPoints().forEach((p) => flat.push(p.x, p.y));
    return flat;
  });
  return { points, holes };
}

export function serializeShapes(shapes: THREE.Shape[] | null | undefined): SerializedShape[] {
  if (!shapes) return [];
  return shapes.map(serializeShape);
}

/** Flat point array -> THREE.Vector2[]. */
function toVectors(flat: number[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push(new THREE.Vector2(flat[i], flat[i + 1]));
  }
  return out;
}

export function deserializeShape(s: SerializedShape): THREE.Shape {
  const shape = new THREE.Shape(toVectors(s.points));
  if (s.holes && s.holes.length > 0) {
    shape.holes = s.holes.map((h) => new THREE.Path(toVectors(h)));
  }
  return shape;
}

export function deserializeShapes(shapes: SerializedShape[] | null | undefined): THREE.Shape[] {
  if (!shapes) return [];
  return shapes.map(deserializeShape);
}

// ---- Geometry --------------------------------------------------------------

/**
 * BufferGeometry -> transferable buffers. Copies the position/normal/index arrays
 * so the originals (which may live in the scene graph) are untouched.
 */
export function serializeGeometry(geo: THREE.BufferGeometry): SerializedGeometry {
  const posAttr = geo.getAttribute('position');
  const position = new Float32Array(posAttr.array as ArrayLike<number>);

  let normal: Float32Array | undefined;
  const normAttr = geo.getAttribute('normal');
  if (normAttr) normal = new Float32Array(normAttr.array as ArrayLike<number>);

  let index: Uint32Array | undefined;
  const idx = geo.getIndex();
  if (idx) index = new Uint32Array(idx.array as ArrayLike<number>);

  return { position, normal, index };
}

export function deserializeGeometry(s: SerializedGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(s.position, 3));
  if (s.normal) geo.setAttribute('normal', new THREE.BufferAttribute(s.normal, 3));
  if (s.index) geo.setIndex(new THREE.BufferAttribute(s.index, 1));
  if (!s.normal) geo.computeVertexNormals();
  return geo;
}

/** Collect the Transferable ArrayBuffers from a SerializedGeometry. */
export function geometryTransferables(g: SerializedGeometry): ArrayBuffer[] {
  // Typed arrays created here are backed by ArrayBuffer (never SharedArrayBuffer),
  // so the cast past the ArrayBufferLike union type is safe.
  const out: ArrayBuffer[] = [g.position.buffer as ArrayBuffer];
  if (g.normal) out.push(g.normal.buffer as ArrayBuffer);
  if (g.index) out.push(g.index.buffer as ArrayBuffer);
  return out;
}
