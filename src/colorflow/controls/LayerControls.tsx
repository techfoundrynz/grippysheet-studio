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
      <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100 mb-3">
        <span className="text-xs font-mono text-gray-500">05</span>
        <span>Layers</span>
      </h3>
      <div className="flex items-center gap-2 mb-3 text-[10px]">
        <span className="text-gray-500 font-medium uppercase tracking-wide">Sort</span>
        <div className="inline-flex rounded-md border border-gray-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, sort: 'luma', layerOrder: null }))}
            className={`px-2 py-1 font-medium transition-colors ${!sortIsManual && settings.sort === 'luma' ? 'bg-brand-500 text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)]' : 'bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800'}`}
          >luminance</button>
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, sort: 'coverage', layerOrder: null }))}
            className={`px-2 py-1 font-medium transition-colors ${!sortIsManual && settings.sort === 'coverage' ? 'bg-brand-500 text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)]' : 'bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800'}`}
          >coverage</button>
          <button
            type="button"
            disabled={!sortIsManual}
            className={`px-2 py-1 font-medium ${sortIsManual ? 'bg-brand-500 text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)]' : 'bg-gray-900 text-gray-500'}`}
          >manual</button>
        </div>
        {sortIsManual && (
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, layerOrder: null }))}
            className="text-brand-400 hover:text-brand-300 hover:underline font-medium"
          >reset</button>
        )}
      </div>

      <div className="space-y-1">
        {order.map((paletteIdx, displayIdx) => {
          const c = palette[paletteIdx];
          const hex = `#${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
          const pct = ((coverage[paletteIdx] ?? 0) / total) * 100;
          return (
            <div key={paletteIdx} className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-md p-2 text-xs hover:border-gray-700 transition-colors">
              <div className="w-6 h-6 rounded flex-shrink-0 ring-1 ring-gray-700 shadow-sm" style={{ background: hex }} />
              <div className="font-mono text-gray-200 w-16 text-[11px]">{hex.toUpperCase()}</div>
              <div className="text-gray-500 text-[10px] flex-1">
                <span className="text-gray-400">L{displayIdx + 1}</span>
                <span className="text-gray-600"> · </span>
                <span className="font-mono">{pct.toFixed(1)}%</span>
              </div>
              <button
                type="button"
                disabled={displayIdx === 0}
                onClick={() => swapTowardBase(displayIdx)}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                title="Move toward base (shorter layer)"
              >↑</button>
              <button
                type="button"
                disabled={displayIdx === order.length - 1}
                onClick={() => swapTowardTop(displayIdx)}
                className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                title="Move toward top (taller layer)"
              >↓</button>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
        L1 sits closest to the base; higher numbers stack taller. Each adds <span className="font-mono text-gray-400">{settings.colorLayerMm.toFixed(2)}mm</span>.
      </p>
    </section>
  );
};
