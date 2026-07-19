declare module 'imagetracerjs' {
  export interface TraceOptions {
    // Tracing
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    rightangleenhance?: boolean;
    // Colour quantization
    colorsampling?: 0 | 1 | 2;
    numberofcolors?: number;
    mincolorratio?: number;
    colorquantcycles?: number;
    pal?: { r: number; g: number; b: number; a: number }[];
    // Blur
    blurradius?: number;
    blurdelta?: number;
    // SVG rendering (unused for tracedata, kept for completeness)
    scale?: number;
    strokewidth?: number;
    linefilter?: boolean;
    roundcoords?: number;
    viewbox?: boolean;
    desc?: boolean;
  }

  /** One path in a traced layer: a polyline/curve segment list plus its bounding box + holes flag. */
  export interface TraceSegment {
    type: 'L' | 'Q' | 'Z' | 'M';
    x1: number; y1: number;
    x2?: number; y2?: number;
    x3?: number; y3?: number;
  }
  export interface TracePath {
    segments: TraceSegment[];
    isholepath: boolean;
    boundingbox: [number, number, number, number];
    holechildren: number[];
  }
  export interface TraceData {
    layers: TracePath[][];
    palette: { r: number; g: number; b: number; a: number }[];
    width: number;
    height: number;
  }

  const ImageTracer: {
    imagedataToTracedata(imgd: ImageData, options?: TraceOptions): TraceData;
    imagedataToSVG(imgd: ImageData, options?: TraceOptions): string;
    getsvgstring?(td: TraceData, options?: TraceOptions): string;
  };
  export default ImageTracer;
}
