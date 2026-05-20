export interface ImageDrawInput {
  imageW: number;
  imageH: number;
  canvasW: number;
  canvasH: number;
  offsetMm: { x: number; y: number };
  scale: number;
  pxPerMm: number;
}

export interface ImageDrawCoords {
  /** Top-left x to pass to ctx.drawImage. */
  dx: number;
  /** Top-left y to pass to ctx.drawImage. */
  dy: number;
  /** Render width in px. */
  w: number;
  /** Render height in px. */
  h: number;
}

/**
 * Pure math: where to draw a source image on an outline-anchored canvas,
 * applying a fit-then-scale-then-offset transform that matches colorflow.html.
 */
export function computeImageDrawCoords(input: ImageDrawInput): ImageDrawCoords {
  const { imageW, imageH, canvasW, canvasH, offsetMm, scale, pxPerMm } = input;
  const fitScale = Math.min(canvasW / imageW, canvasH / imageH);
  const finalScale = fitScale * scale;
  const w = imageW * finalScale;
  const h = imageH * finalScale;
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  return {
    w,
    h,
    dx: cx - w / 2 + offsetMm.x * pxPerMm,
    dy: cy - h / 2 + offsetMm.y * pxPerMm,
  };
}
