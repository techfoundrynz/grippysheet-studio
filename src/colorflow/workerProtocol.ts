import type { Centroid } from './pipeline/quantize';
import type { LayerPolygon } from './pipeline/polygonize';
import type { ExtrudedGeometry } from './pipeline/extrude';

export interface RGBA { r: number; g: number; b: number; a: number }

export interface QuantizeOpts {
  colorCount: number;
  simplify: number;     // 0..4
  seed: number;
}

export interface TraceOptsWire {
  detail: number;       // 0..2
  smooth: boolean;
}

/** Same shape as ExtrudedGeometry; aliased here so the worker protocol stays
 *  decoupled from the pipeline implementation. */
export type TransferredGeom = ExtrudedGeometry;

export type Request =
  | { id: number; kind: 'quantize'; image: ImageBitmap; mask: Uint8Array | null;
      width: number; height: number; opts: QuantizeOpts }
  | { id: number; kind: 'trace'; assignments: Uint16Array; palette: Centroid[];
      width: number; height: number; opts: TraceOptsWire }
  | { id: number; kind: 'extrude'; layers: LayerPolygon[]; outline: LayerPolygon;
      baseMm: number; totalMm: number };

export type Response =
  | { id: number; kind: 'progress'; phase: string }
  | { id: number; kind: 'quantized'; palette: Centroid[]; assignments: Uint16Array;
      previewSvg: string }
  | { id: number; kind: 'traced'; layers: LayerPolygon[]; layerSvgs: Record<number, string>;
      combinedSvg: string }
  | { id: number; kind: 'extruded'; baseGeom: TransferredGeom; layerGeoms: TransferredGeom[] }
  | { id: number; kind: 'error'; phase: string; message: string };
