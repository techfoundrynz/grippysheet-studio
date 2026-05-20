import React from 'react';
import { effectiveSpikeMaxMm } from '../spikes';
import type { GeometrySettings } from '../../types/schemas';
import type { ColorFlowSettings } from '../schema';

interface Props {
  palette: { length: number };
  geometrySettings: GeometrySettings;
  baseMm: number;
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
  spikeDiag?: string;
}

export const SpikeControls: React.FC<Props> = ({
  palette, geometrySettings, baseMm, settings, setSettings, spikeDiag,
}) => {
  if (palette.length === 0) return null;

  const hasPattern = !!geometrySettings.patternShapes?.[0];

  return (
    <section>
      <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Spike pattern</h3>
      {hasPattern ? (
        <>
          <p className="text-[10px] text-gray-500 mb-2">
            Pattern tile + spacing come from the Geometry tab. Each spike rises from its
            color region's top to a unified spike-max height.
          </p>
          <div className="grid grid-cols-1 gap-2 text-xs text-gray-400">
            <label>spike max mm (0 = auto: max color + 0.4mm)
              <input
                type="number" step={0.1} min={0} max={20}
                value={settings.spikeMaxMm}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(20, +e.target.value || 0));
                  setSettings((s) => ({ ...s, spikeMaxMm: v }));
                }}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.spikeColorMatch}
                onChange={(e) => setSettings((s) => ({ ...s, spikeColorMatch: e.target.checked }))}
              />
              color-match spikes to the region below
            </label>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            resolved spike top: {effectiveSpikeMaxMm(settings.spikeMaxMm, baseMm, palette.length, settings.colorLayerMm).toFixed(2)}mm
          </p>
          {spikeDiag && (
            <p className="text-[10px] text-blue-400 mt-1 font-mono">{spikeDiag}</p>
          )}
        </>
      ) : (
        <p className="text-[10px] text-gray-500">
          No pattern tile configured — pick one in the Geometry tab to add a grip spike layer on top.
        </p>
      )}
    </section>
  );
};
