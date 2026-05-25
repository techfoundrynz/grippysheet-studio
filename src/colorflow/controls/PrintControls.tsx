import React from 'react';
import type { ColorFlowSettings } from '../schema';

interface Props {
  hasLayers: boolean;
  paletteSize: number;
  baseMm: number;
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
}

export const PrintControls: React.FC<Props> = ({ hasLayers, paletteSize, baseMm, settings, setSettings }) => (
  <section className={hasLayers ? '' : 'opacity-40 pointer-events-none'}>
    <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100 mb-3">
      <span className="text-xs font-mono text-gray-500">04</span>
      <span>Print</span>
    </h3>
    <div className="grid grid-cols-1 gap-2 text-xs text-gray-400">
      <label>layer mm (each color rises this much above the base)
        <input
          type="number" step={0.05} min={0.05} max={2}
          value={settings.colorLayerMm}
          onChange={(e) => {
            const v = Math.max(0.05, Math.min(2, +e.target.value || 0.4));
            setSettings((s) => ({ ...s, colorLayerMm: v }));
          }}
          className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1"
        />
      </label>
    </div>
    {paletteSize > 0 && (
      <p className="text-[10px] text-gray-500 mt-2">
        total {(baseMm + paletteSize * settings.colorLayerMm).toFixed(2)}mm
        ({baseMm.toFixed(2)} base + {paletteSize} × {settings.colorLayerMm.toFixed(2)}mm) · base thickness set in Base tab
      </p>
    )}
  </section>
);
