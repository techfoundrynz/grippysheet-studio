import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import { loadDownsampledImage } from '../utils/imageUtils';
import { traceImage, traceLayers, shapesFromLayers, TraceLayers, RGBAImage } from '../utils/image/traceImage';
import { ditherLayers, ditherSVG, DITHER_METHODS, MAX_DITHER_DETAIL, type DitherMethod } from '../utils/image/ditherImage';
import { centerShapes } from '../utils/patternUtils';

/**
 * Converts an image to a colour or monochrome dither inlay with a live geometry preview.
 * Colour mode traces the full image; dither mode commits the exact preview pixel grid.
 */
interface ImageConversionModalProps {
  isOpen: boolean;
  imageUrl: string | null;
  fileName?: string | null;
  onClose: () => void;
  onConfirm: (shapes: { shape: any; color: string }[], name: string, svg?: string) => void;
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
  const [mode, setMode] = useState<'colour' | 'dither'>('colour');
  const [detail, setDetail] = useState(64);
  const [ditherMethod, setDitherMethod] = useState<DitherMethod>('floyd-steinberg');
  const [ditherColor, setDitherColor] = useState('#000000');
  const [error, setError] = useState<string | null>(null);
  const [previewImg, setPreviewImg] = useState<RGBAImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [tracing, setTracing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ditherCache = useRef<{ image: RGBAImage; detail: number; method: DitherMethod; layers: TraceLayers } | null>(null);

  const getDither = useCallback(() => {
    if (!previewImg) throw new Error('Image is not loaded');
    let cached = ditherCache.current;
    if (!cached || cached.image !== previewImg || cached.detail !== detail || cached.method !== ditherMethod) {
      cached = { image: previewImg, detail, method: ditherMethod, layers: ditherLayers(previewImg, detail, ditherMethod) };
      ditherCache.current = cached;
    }
    // Changing ink colour reuses the pixel geometry, including for the final commit.
    return { ...cached.layers, palette: [ditherColor] };
  }, [previewImg, detail, ditherMethod, ditherColor]);

  // Load a small preview image when the modal opens (kept for live tracing).
  useEffect(() => {
    ditherCache.current = null;
    if (!isOpen || !imageUrl) { setPreviewImg(null); return; }
    let cancelled = false;
    setPreviewImg(null);
    setError(null);
    setLoading(true);
    loadDownsampledImage(imageUrl, mode === 'dither' ? MAX_DITHER_DETAIL : PREVIEW_TRACE)
      .then((r) => { if (!cancelled) setPreviewImg(r); })
      .catch(() => { if (!cancelled) setError('Could not load this image. Please try another file.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, imageUrl, mode]);

  // Re-trace the live preview (debounced) as the sliders change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewImg) return;
    setComputing(true);
    const handle = setTimeout(() => {
      try {
        renderLayers(canvas, mode === 'dither' ? getDither() : traceLayers(previewImg, colors, { hueShift, quality }));
      } catch (e) {
        console.error('[ImageConversion] preview trace failed:', e);
      } finally {
        setComputing(false);
      }
    }, 180);
    return () => clearTimeout(handle);
  }, [previewImg, colors, hueShift, quality, mode, getDither, loading]);

  const handleConfirm = useCallback(() => {
    if (!imageUrl || !previewImg) return;
    setTracing(true);
    setError(null);
    // Dithering uses the same input and grid as the preview, so dots never change on commit.
    (mode === 'dither' ? Promise.resolve(previewImg) : loadDownsampledImage(imageUrl, COMMIT_TRACE))
      .then((full) => {
        const dither = mode === 'dither' ? getDither() : null;
        const { shapes } = dither ? shapesFromLayers(dither) : traceImage(full, colors, { hueShift, quality, widthMM: 50 });
        if (!shapes.length) throw new Error('No visible shapes');
        if (dither) {
          // SVG imports centre their visible bounds; match that placement for bundle reloads.
          const centered = centerShapes(shapes.map(s => s.shape), false);
          shapes.forEach((s, i) => { s.shape = centered[i]; });
        }
        onConfirm(shapes.map((s) => ({ shape: s.shape, color: s.color })), fileName || 'Image Inlay', dither ? ditherSVG(dither) : undefined);
        onClose();
      })
      .catch(() => setError(mode === 'dither' ? 'No filled pixels could be added. Try another method or an image with darker areas.' : 'Could not convert this image. Check that it contains visible pixels and try again.'))
      .finally(() => setTracing(false));
  }, [imageUrl, previewImg, colors, hueShift, quality, mode, getDither, fileName, onConfirm, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-white font-semibold">Convert Image to Inlay</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Preview */}
        <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center bg-gray-950 p-4 relative">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-400"><Loader2 className="animate-spin" size={18} /> Loading…</div>
          ) : (
            <canvas ref={canvasRef} className="rounded-lg shadow-lg max-w-full h-auto" style={mode === 'dither' ? { backgroundColor: '#d1d5db', backgroundImage: 'conic-gradient(#9ca3af 25%, transparent 0 50%, #9ca3af 0 75%, transparent 0)', backgroundSize: '16px 16px' } : undefined} />
          )}
          {computing && !loading && (
            <div className="absolute top-3 right-3 text-gray-400"><Loader2 className="animate-spin" size={16} /></div>
          )}
        </div>

        {/* Controls */}
        <div className="px-5 py-4 border-t border-gray-700 space-y-4">
          <label className="block text-sm text-gray-300">
            Conversion
            <select aria-label="Image conversion mode" value={mode} onChange={(e) => setMode(e.target.value as 'colour' | 'dither')} className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 p-2 text-white" disabled={tracing}>
              <option value="colour">Colour inlay</option>
              <option value="dither">Monochrome dither</option>
            </select>
          </label>
          {mode === 'dither' ? (
            <div className="space-y-3">
              <label className="block text-sm text-gray-300">
                Dithering method
                <select aria-label="Dithering method" value={ditherMethod} onChange={(e) => setDitherMethod(e.target.value as DitherMethod)} disabled={tracing} className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-800 p-2 text-white">
                  {DITHER_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}
                </select>
                <span className="block mt-1 text-xs text-gray-400">{DITHER_METHODS.find(method => method.value === ditherMethod)?.description}</span>
              </label>
              <label className="flex items-center justify-between text-sm text-gray-300">
                Fill colour
                <input aria-label="Dither fill colour" type="color" value={ditherColor} onChange={(e) => setDitherColor(e.target.value)} disabled={tracing} className="h-8 w-12 cursor-pointer rounded border border-gray-600 bg-gray-800" />
              </label>
              <div>
              <label htmlFor="dither-detail" className="flex justify-between text-sm text-gray-300 mb-1">
                <span>Pixel detail</span><span>{detail} pixels on longest edge</span>
              </label>
              <input id="dither-detail" type="range" min={16} max={MAX_DITHER_DETAIL} step={8} value={detail} onChange={(e) => setDetail(Number(e.target.value))} disabled={tracing} className="w-full accent-purple-500" />
              </div>
              <p className="text-xs text-gray-400">Dark pixels use the fill colour; light pixels and the background are transparent (shown as checks). Resolution is limited to the source image size.</p>
              <p className="text-xs text-gray-400">Higher detail creates smaller dots and more geometry, which can take longer to generate and export. Check dot size after scaling for your printer.</p>
            </div>
          ) : (<>
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
          </>)}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-700">
          <button onClick={onClose} className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !previewImg || tracing}
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
