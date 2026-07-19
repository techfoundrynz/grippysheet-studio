import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import { loadDownsampledImage } from '../utils/imageUtils';
import { traceImage, traceLayers, TraceLayers, RGBAImage } from '../utils/image/traceImage';

/**
 * Converts an uploaded image into a flat, multi-colour shape inlay. The user picks a colour
 * count, hue shift and quality (detail vs. simplification) and previews the *vectorized* result
 * live on a 2D canvas; on confirm the full-resolution image is traced into per-band
 * THREE.Shapes (with colour) and committed like an SVG upload.
 */
interface ImageConversionModalProps {
  isOpen: boolean;
  imageUrl: string | null;
  fileName?: string | null;
  onClose: () => void;
  onConfirm: (shapes: { shape: any; color: string }[], name: string) => void;
}

const PREVIEW_DISPLAY = 460; // max on-screen canvas edge
const PREVIEW_TRACE = 700;   // resolution the live preview is traced at (fast)
const COMMIT_TRACE = 1400;   // native-ish resolution for the committed shapes

/** Render traced per-band layers onto a canvas (holes via even-odd fill). */
function renderLayers(canvas: HTMLCanvasElement, data: TraceLayers) {
  const { layers, palette, width, height } = data;
  const scale = Math.min(PREVIEW_DISPLAY / width, PREVIEW_DISPLAY / height);
  const dw = Math.max(1, Math.round(width * scale));
  const dh = Math.max(1, Math.round(height * scale));
  canvas.width = dw;
  canvas.height = dh;
  const sx = dw / width, sy = dh / height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, dw, dh);
  for (let li = 1; li < layers.length; li++) {
    const band = li - 1;
    const p = new Path2D();
    for (const path of layers[li]) {
      const segs = path.segments;
      if (!segs.length) continue;
      p.moveTo(segs[0].x1 * sx, segs[0].y1 * sy);
      for (const s of segs) {
        if (s.type === 'L') p.lineTo(s.x2! * sx, s.y2! * sy);
        else if (s.type === 'Q') p.quadraticCurveTo(s.x2! * sx, s.y2! * sy, s.x3! * sx, s.y3! * sy);
      }
      p.closePath();
    }
    ctx.fillStyle = palette[band] || '#000';
    ctx.fill(p, 'evenodd');
  }
}

const ImageConversionModal: React.FC<ImageConversionModalProps> = ({ isOpen, imageUrl, fileName, onClose, onConfirm }) => {
  const [colors, setColors] = useState(4);
  const [hueShift, setHueShift] = useState(0);
  const [quality, setQuality] = useState(6);
  const [previewImg, setPreviewImg] = useState<RGBAImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [tracing, setTracing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load a small preview image when the modal opens (kept for live tracing).
  useEffect(() => {
    if (!isOpen || !imageUrl) { setPreviewImg(null); return; }
    let cancelled = false;
    setLoading(true);
    loadDownsampledImage(imageUrl, PREVIEW_TRACE)
      .then((r) => { if (!cancelled) setPreviewImg(r); })
      .catch((e) => console.error('[ImageConversion] load failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, imageUrl]);

  // Re-trace the live preview (debounced) as the sliders change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewImg) return;
    setComputing(true);
    const handle = setTimeout(() => {
      try {
        renderLayers(canvas, traceLayers(previewImg, colors, { hueShift, quality }));
      } catch (e) {
        console.error('[ImageConversion] preview trace failed:', e);
      } finally {
        setComputing(false);
      }
    }, 180);
    return () => clearTimeout(handle);
  }, [previewImg, colors, hueShift, quality]);

  const handleConfirm = useCallback(() => {
    if (!imageUrl) return;
    setTracing(true);
    // Trace the full-resolution image (not the small preview) for the committed shapes.
    loadDownsampledImage(imageUrl, COMMIT_TRACE)
      .then((full) => {
        const { shapes } = traceImage(full, colors, { hueShift, quality, widthMM: 50 });
        onConfirm(shapes.map((s) => ({ shape: s.shape, color: s.color })), fileName || 'Image Inlay');
        onClose();
      })
      .catch((e) => console.error('[ImageConversion] trace failed:', e))
      .finally(() => setTracing(false));
  }, [imageUrl, colors, hueShift, quality, fileName, onConfirm, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-white font-semibold">Convert Image to Colour Inlay</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Preview */}
        <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center bg-gray-950 p-4 relative">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-400"><Loader2 className="animate-spin" size={18} /> Loading…</div>
          ) : (
            <canvas ref={canvasRef} className="rounded-lg shadow-lg max-w-full h-auto" />
          )}
          {computing && !loading && (
            <div className="absolute top-3 right-3 text-gray-400"><Loader2 className="animate-spin" size={16} /></div>
          )}
        </div>

        {/* Controls */}
        <div className="px-5 py-4 border-t border-gray-700 space-y-4">
          <div>
            <div className="flex justify-between text-sm text-gray-300 mb-1">
              <span>Colours</span><span className="text-gray-400">{colors}</span>
            </div>
            <input
              type="range" min={1} max={12} step={1} value={colors}
              onChange={(e) => setColors(Number(e.target.value))}
              className="w-full accent-purple-500 bg-gray-700 rounded-lg appearance-none h-2 cursor-pointer"
            />
          </div>
          <div>
            <div className="flex justify-between text-sm text-gray-300 mb-1">
              <span>Quality</span><span className="text-gray-400">{quality <= 3 ? 'Simplified' : quality >= 8 ? 'Detailed' : 'Balanced'} ({quality})</span>
            </div>
            <input
              type="range" min={1} max={10} step={1} value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full accent-purple-500 bg-gray-700 rounded-lg appearance-none h-2 cursor-pointer"
            />
          </div>
          <div>
            <div className="flex justify-between text-sm text-gray-300 mb-1">
              <span>Hue Shift</span><span className="text-gray-400">{hueShift}°</span>
            </div>
            <input
              type="range" min={0} max={360} step={1} value={hueShift}
              onChange={(e) => setHueShift(Number(e.target.value))}
              className="w-full accent-purple-500 bg-gray-700 rounded-lg appearance-none h-2 cursor-pointer"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-700">
          <button onClick={onClose} className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!previewImg || tracing}
            className="flex items-center gap-2 px-5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-purple-900/20"
          >
            {tracing ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
            {tracing ? 'Converting…' : 'Add Inlay'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageConversionModal;
