import { RGBAImage } from './image/traceImage';

/**
 * Load a data-URL image and downsample it to a working resolution (canvas, main thread).
 * The small RGBA buffer feeds the vector tracer — capping the long edge keeps the traced
 * path count clean and fast.
 */
export function loadDownsampledImage(dataUrl: string, maxDim = 200): Promise<RGBAImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return reject(new Error('2D canvas context unavailable'));
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        // Copy into a standalone buffer so it can be transferred to the worker.
        resolve({ data: new Uint8ClampedArray(data), width: w, height: h });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/** Read a File into a data URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
