import imagetracer, { type Tracedata, type TracerOptions } from '../vendor/imagetracer';

export interface TraceOpts {
  /** 0 = sharp, 1 = balanced, 2 = smooth. */
  detail: number;
  smooth: boolean;
}

const DETAIL_PRESETS = [
  { ltres: 0.5, qtres: 0.5, pathomit: 4 },
  { ltres: 1.0, qtres: 1.0, pathomit: 8 },
  { ltres: 2.0, qtres: 2.0, pathomit: 16 },
];

/**
 * Trace an ImageData (representing a single color binary mask, OR a multi-color
 * quantized image) into ImageTracer tracedata.
 *
 * `pal` is the palette to feed ImageTracer. Pass [{r,g,b,a:255}] palette to get
 * one layer per color. Prepend a transparent entry (a:0) to route out-of-mask
 * pixels into a skip layer.
 */
export function trace(
  imageData: ImageData,
  pal: Array<{ r: number; g: number; b: number; a: number }>,
  opts: TraceOpts,
): Tracedata {
  const preset = DETAIL_PRESETS[Math.max(0, Math.min(2, opts.detail))];
  const tracerOpts: TracerOptions = {
    ...preset,
    rightangleenhance: true,
    colorquantcycles: 1,
    colorsampling: 0,
    mincolorratio: 0,
    strokewidth: 0,
    linefilter: opts.smooth,
    scale: 1,
    roundcoords: 1,
    viewbox: true,
    desc: false,
    pal,
  };
  return imagetracer.imagedataToTracedata(imageData, tracerOpts);
}
