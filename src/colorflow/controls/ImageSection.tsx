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
        className="border-2 border-dashed border-gray-700 rounded p-6 text-center text-gray-400 text-sm cursor-pointer hover:border-blue-500 hover:bg-gray-900/50"
      >
        {hasImage
          ? <span className="text-green-400">✓ {imageName} · {imageDims?.w}×{imageDims?.h}</span>
          : <span>drag image / click to browse</span>}
      </div>
      <ImageTransformPreview
        imageBitmap={imageBitmap}
        outline={outlinePolygon}
        offsetMm={settings.imageOffsetMm}
        scale={settings.imageScale}
        onCommit={(offsetMm, scale) => setSettings((s) => ({ ...s, imageOffsetMm: offsetMm, imageScale: scale }))}
      />
      {hasImage && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-400">
          <label>x mm
            <input
              type="number" step={1} min={-200} max={200}
              value={settings.imageOffsetMm.x}
              onChange={(e) => {
                const v = Math.max(-200, Math.min(200, +e.target.value || 0));
                setSettings((s) => ({ ...s, imageOffsetMm: { ...s.imageOffsetMm, x: v } }));
              }}
              className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1"
            />
          </label>
          <label>y mm
            <input
              type="number" step={1} min={-200} max={200}
              value={settings.imageOffsetMm.y}
              onChange={(e) => {
                const v = Math.max(-200, Math.min(200, +e.target.value || 0));
                setSettings((s) => ({ ...s, imageOffsetMm: { ...s.imageOffsetMm, y: v } }));
              }}
              className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1"
            />
          </label>
          <label>scale
            <input
              type="number" step={0.05} min={0.2} max={3}
              value={settings.imageScale}
              onChange={(e) => {
                const v = Math.max(0.2, Math.min(3, +e.target.value || 1));
                setSettings((s) => ({ ...s, imageScale: v }));
              }}
              className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1"
            />
          </label>
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, imageOffsetMm: { x: 0, y: 0 }, imageScale: 1.0 }))}
            className="col-span-3 mt-1 text-[10px] text-blue-400 hover:underline text-left"
          >
            Reset to fit-centered
          </button>
        </div>
      )}
    </section>
  );
};
