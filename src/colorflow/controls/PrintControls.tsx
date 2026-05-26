import React from 'react';
import NumberStepper from '../../components/ui/NumberStepper';
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
    <div className="grid grid-cols-1 gap-2">
      <label className="block text-xs font-medium text-gray-300">
        <span className="flex items-baseline justify-between mb-1">
          <span>layer height</span>
          <span className="text-[10px] text-gray-500 font-normal">per colour, above the base</span>
        </span>
        <NumberStepper
          value={settings.colorLayerMm}
          onChange={(v) => setSettings((s) => ({ ...s, colorLayerMm: v }))}
          step={0.05}
          min={0.05}
          max={2}
          unit="mm"
          precision={2}
          aria-label="Layer height per colour in millimetres"
        />
      </label>
    </div>
    {paletteSize > 0 && (
      <p className="text-[10px] text-gray-500 mt-2 font-mono">
        total <span className="text-signal-ready font-semibold">{(baseMm + paletteSize * settings.colorLayerMm).toFixed(2)}mm</span>
        <span className="text-gray-600"> = </span>
        {baseMm.toFixed(2)} base + {paletteSize} × {settings.colorLayerMm.toFixed(2)}
      </p>
    )}
  </section>
);
