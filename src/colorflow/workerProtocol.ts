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

/** A single traced polygon plus the centroid (palette index) it belongs to. */
export interface TracedLayerEntry {
  centroidIndex: number;   // index into the palette[] returned by quantize
  polygon: LayerPolygon;
}

export interface ExtrudedLayerEntry {
  centroidIndex: number;
  /** Position in the stack (0 = nearest to base). */
  position: number;
  geom: TransferredGeom;
}

export type Request =
  | { id: number; kind: 'quantize'; image: ImageBitmap; mask: Uint8Array | null;
      width: number; height: number; opts: QuantizeOpts }
  | { id: number; kind: 'trace'; assignments: Uint16Array; palette: Centroid[];
      width: number; height: number; opts: TraceOptsWire }
  | { id: number; kind: 'extrude'; layers: TracedLayerEntry[]; outline: LayerPolygon;
      baseMm: number; colorLayerMm: number;
      /** Palette indices in stack order. layerGeoms in the response are emitted
       *  in this order; downstream consumers don't need to re-sort. */
      stackOrder: number[] };

export type Response =
  | { id: number; kind: 'progress'; phase: string }
  | { id: number; kind: 'quantized'; palette: Centroid[]; assignments: Uint16Array;
      previewSvg: string }
  | { id: number; kind: 'traced'; layers: TracedLayerEntry[]; layerSvgs: Record<number, string>;
      combinedSvg: string }
  | { id: number; kind: 'extruded'; baseGeom: TransferredGeom; layerGeoms: ExtrudedLayerEntry[] }
  | { id: number; kind: 'error'; phase: string; message: string };
