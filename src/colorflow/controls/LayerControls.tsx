import React from 'react';
import { resolvedStackOrder } from '../stackOrder';
import type { Centroid } from '../pipeline/quantize';
import type { ColorFlowSettings } from '../schema';

interface Props {
  palette: Centroid[];
  coverage: number[];
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
}

export const LayerControls: React.FC<Props> = ({ palette, coverage, settings, setSettings }) => {
  if (palette.length === 0) return null;

  const order = resolvedStackOrder(palette, coverage, settings);
  const total = coverage.reduce((s, c) => s + c, 0) || 1;
  const sortIsManual = settings.layerOrder !== null;

  const swapTowardBase = (displayIdx: number) => {
    const next = [...order];
    [next[displayIdx - 1], next[displayIdx]] = [next[displayIdx], next[displayIdx - 1]];
    setSettings((s) => ({ ...s, layerOrder: next }));
  };
  const swapTowardTop = (displayIdx: number) => {
    const next = [...order];
    [next[displayIdx + 1], next[displayIdx]] = [next[displayIdx], next[displayIdx + 1]];
    setSettings((s) => ({ ...s, layerOrder: next }));
  };

  return (
    <section>
      <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">⑤ Layers</h3>
      <div className="flex items-center gap-2 mb-2 text-[10px]">
        <span className="text-gray-500">sort:</span>
        <div className="inline-flex rounded border border-gray-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, sort: 'luma', layerOrder: null }))}
            className={`px-2 py-1 ${!sortIsManual && settings.sort === 'luma' ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'}`}
          >luminance</button>
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, sort: 'coverage', layerOrder: null }))}
            className={`px-2 py-1 ${!sortIsManual && settings.sort === 'coverage' ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'}`}
          >coverage</button>
          <button
            type="button"
            disabled={!sortIsManual}
            className={`px-2 py-1 ${sortIsManual ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-500'}`}
          >manual</button>
        </div>
        {sortIsManual && (
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, layerOrder: null }))}
            className="text-blue-400 hover:underline"
          >reset</button>
        )}
      </div>

      <div className="space-y-1">
        {order.map((paletteIdx, displayIdx) => {
          const c = palette[paletteIdx];
          const hex = `#${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
          const pct = ((coverage[paletteIdx] ?? 0) / total) * 100;
          return (
            <div key={paletteIdx} className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded p-2 text-xs">
              <div className="w-5 h-5 rounded flex-shrink-0 border border-gray-700" style={{ background: hex }} />
              <div className="font-mono text-gray-300 w-16">{hex.toUpperCase()}</div>
              <div className="text-gray-500 text-[10px] flex-1">layer {displayIdx + 1} · {pct.toFixed(1)}%</div>
              <button
                type="button"
                disabled={displayIdx === 0}
                onClick={() => swapTowardBase(displayIdx)}
                className="px-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move toward base"
              >↑</button>
              <button
                type="button"
                disabled={displayIdx === order.length - 1}
                onClick={() => swapTowardTop(displayIdx)}
                className="px-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move toward top"
              >↓</button>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-500 mt-2">
        Layer 1 sits closest to the base; higher numbers stack taller. Each adds {settings.colorLayerMm.toFixed(2)}mm.
      </p>
    </section>
  );
};
