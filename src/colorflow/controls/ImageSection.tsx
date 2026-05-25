import React, { useRef } from 'react';
import { ImageTransformPreview } from '../ImageTransformPreview';
import type { OutlinePolygon } from '../outlineToPolygon';
import type { ColorFlowSettings } from '../schema';

interface Props {
  hasOutline: boolean;
  hasImage: boolean;
  imageBitmap: ImageBitmap | null;
  imageName: string;
  imageDims: { w: number; h: number } | null;
  outlinePolygon: OutlinePolygon | null;
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
  onImageFile: (file: File) => void;
}

export const ImageSection: React.FC<Props> = ({
  hasOutline, hasImage, imageBitmap, imageName, imageDims, outlinePolygon, settings, setSettings, onImageFile,
}) => {
  const dropRef = useRef<HTMLDivElement>(null);

  return (
    <section className={hasOutline ? '' : 'opacity-40 pointer-events-none'}>
      <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100 mb-3">
        <span className="text-xs font-mono text-gray-500">02</span>
        <span>Image</span>
      </h3>
      <div
        ref={dropRef}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = (e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) onImageFile(f);
          };
          input.click();
        }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onImageFile(f); }}
        className={`group border-2 border-dashed rounded-xl p-5 text-center text-sm cursor-pointer transition-all ${
          hasImage
            ? 'border-signal-ready/40 bg-signal-ready/[0.05] text-signal-ready hover:border-signal-ready/60 hover:bg-signal-ready/[0.08]'
            : 'border-gray-700 text-gray-400 hover:border-brand-500/60 hover:bg-brand-500/[0.04] hover:text-gray-200 hover:shadow-glow-brand'
        }`}
      >
        {hasImage
          ? <span className="font-medium">✓ {imageName} <span className="text-gray-500 font-normal">· {imageDims?.w}×{imageDims?.h}</span></span>
          : (
            <div className="flex flex-col items-center gap-1.5 py-2">
              <div className="text-2xl leading-none opacity-60 group-hover:opacity-100 transition-opacity">📥</div>
              <div className="font-display font-semibold text-sm text-gray-200">Drop your logo or art</div>
              <div className="text-[11px] text-gray-500 font-mono">PNG · JPG · SVG · up to ~10 megapixels</div>
            </div>
          )}
      </div>
      <ImageTransformPreview
        imageBitmap={imageBitmap}
        outline={outlinePolygon}
        offsetMm={settings.imageOffsetMm}
        scale={settings.imageScale}
        onCommit={(offsetMm, scale) => setSettings((s) => ({ ...s, imageOffsetMm: offsetMm, imageScale: scale }))}
      />
      {hasImage && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wide">
              x · mm
              <input
                type="number" step={1} min={-200} max={200}
                value={settings.imageOffsetMm.x}
                onChange={(e) => {
                  const v = Math.max(-200, Math.min(200, +e.target.value || 0));
                  setSettings((s) => ({ ...s, imageOffsetMm: { ...s.imageOffsetMm, x: v } }));
                }}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-xs font-mono text-gray-100 normal-case tracking-normal focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/20"
              />
            </label>
            <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wide">
              y · mm
              <input
                type="number" step={1} min={-200} max={200}
                value={settings.imageOffsetMm.y}
                onChange={(e) => {
                  const v = Math.max(-200, Math.min(200, +e.target.value || 0));
                  setSettings((s) => ({ ...s, imageOffsetMm: { ...s.imageOffsetMm, y: v } }));
                }}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-xs font-mono text-gray-100 normal-case tracking-normal focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/20"
              />
            </label>
            <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wide">
              scale
              <input
                type="number" step={0.05} min={0.2} max={3}
                value={settings.imageScale}
                onChange={(e) => {
                  const v = Math.max(0.2, Math.min(3, +e.target.value || 1));
                  setSettings((s) => ({ ...s, imageScale: v }));
                }}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-xs font-mono text-gray-100 normal-case tracking-normal focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/20"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, imageOffsetMm: { x: 0, y: 0 }, imageScale: 1.0 }))}
            className="text-[10px] text-brand-400 hover:text-brand-300 hover:underline font-medium"
          >
            ↺ Reset to fit-centered
          </button>
        </div>
      )}
    </section>
  );
};
