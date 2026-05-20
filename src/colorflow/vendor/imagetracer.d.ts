export interface TracerOptions {
  ltres?: number;
  qtres?: number;
  pathomit?: number;
  rightangleenhance?: boolean;
  colorquantcycles?: number;
  colorsampling?: 0 | 1 | 2;
  mincolorratio?: number;
  blurradius?: number;
  blurdelta?: number;
  strokewidth?: number;
  linefilter?: boolean;
  scale?: number;
  roundcoords?: number;
  viewbox?: boolean;
  desc?: boolean;
  numberofcolors?: number;
  pal?: Array<{ r: number; g: number; b: number; a: number }>;
  layering?: 0 | 1;
}

export interface TracedSegmentL {
  type: 'L';
  x1: number; y1: number;
  x2: number; y2: number;
}
export interface TracedSegmentQ {
  type: 'Q';
  x1: number; y1: number;
  x2: number; y2: number;
  x3: number; y3: number;
}
export type TracedSegment = TracedSegmentL | TracedSegmentQ;

export interface TracedSubPath {
  segments: TracedSegment[];
  boundingbox: [number, number, number, number];
  holechildren: number[];
  isholepath: boolean;
}

export type TracedLayer = TracedSubPath[];

export interface Tracedata {
  layers: TracedLayer[];
  palette: Array<{ r: number; g: number; b: number; a: number }>;
  width: number;
  height: number;
}

declare const imagetracer: {
  imagedataToSVG(imgd: ImageData, options?: TracerOptions): string;
  imagedataToTracedata(imgd: ImageData, options?: TracerOptions): Tracedata;
  checkoptions(options?: TracerOptions | string): TracerOptions;
};
export default imagetracer;
