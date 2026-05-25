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
        className={`border-2 border-dashed rounded-lg p-5 text-center text-sm cursor-pointer transition-colors ${
          hasImage
            ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300 hover:border-emerald-400 hover:bg-emerald-950/30'
            : 'border-gray-700 text-gray-400 hover:border-purple-500/60 hover:bg-gray-900/40 hover:text-gray-200'
        }`}
      >
        {hasImage
          ? <span className="font-medium">✓ {imageName} <span className="text-gray-500 font-normal">· {imageDims?.w}×{imageDims?.h}</span></span>
          : <span>drag an image here, or click to browse</span>}
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
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-xs font-mono text-gray-100 normal-case tracking-normal focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20"
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
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-xs font-mono text-gray-100 normal-case tracking-normal focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20"
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
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-xs font-mono text-gray-100 normal-case tracking-normal focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, imageOffsetMm: { x: 0, y: 0 }, imageScale: 1.0 }))}
            className="text-[10px] text-purple-300 hover:text-purple-200 hover:underline"
          >
            ↺ Reset to fit-centered
          </button>
        </div>
      )}
    </section>
  );
};
