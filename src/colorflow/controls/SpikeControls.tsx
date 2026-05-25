import React from 'react';
import { effectiveSpikeMaxMm } from '../spikes';
import type { GeometrySettings } from '../../types/schemas';
import type { ColorFlowSettings } from '../schema';

interface Props {
  paletteSize: number;
  geometrySettings: GeometrySettings;
  baseMm: number;
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
  spikeDiag?: string;
  canGenerate: boolean;
  isStale: boolean;
  hasSpikes: boolean;
  onGenerate?: () => void;
}

export const SpikeControls: React.FC<Props> = ({
  paletteSize, geometrySettings, baseMm, settings, setSettings, spikeDiag,
  canGenerate, isStale, hasSpikes, onGenerate,
}) => {
  if (paletteSize === 0) return null;

  const hasPattern = !!geometrySettings.patternShapes?.[0];

  // Button label / style varies with state.
  // - canGenerate=false: hidden (handled below)
  // - !hasSpikes: "Generate preview" (primary)
  // - hasSpikes + isStale: "Regenerate (changes pending)" (primary)
  // - hasSpikes + !isStale: "Up to date" (secondary, disabled-feel)
  const buttonLabel = !hasSpikes
    ? 'Generate preview'
    : isStale
      ? 'Regenerate spikes'
      : 'Up to date';
  const buttonPrimary = !hasSpikes || isStale;

  return (
    <section>
      <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Spike overlay</h3>
      {hasPattern ? (
        <>
          <p className="text-[10px] text-gray-500 mb-2">
            Pattern tile + spacing come from the Geometry tab. Each spike rises from its
            color region's top to a unified spike-max height. Tweak settings then click
            <span className="text-blue-400"> Generate preview</span> to render.
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
            resolved spike top: {effectiveSpikeMaxMm(settings.spikeMaxMm, baseMm, paletteSize, settings.colorLayerMm).toFixed(2)}mm
          </p>

          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate || (!isStale && hasSpikes)}
            className={`w-full mt-3 px-3 py-2 rounded text-xs font-medium transition-colors ${
              buttonPrimary
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                : 'bg-gray-700 text-gray-400 cursor-default'
            } disabled:opacity-60 disabled:cursor-not-allowed`}
            title={!canGenerate ? 'Need an image + pattern to generate spikes' : isStale ? 'Inputs changed since last generation' : 'Spikes match current inputs'}
          >
            {buttonLabel}
            {isStale && hasSpikes && <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 align-middle" />}
          </button>

          {spikeDiag && (
            <p className="text-[10px] text-blue-400 mt-2 font-mono">{spikeDiag}</p>
          )}
        </>
      ) : (
        <p className="text-[10px] text-gray-500">
          No pattern tile configured — pick one above to add a grip spike layer on top.
        </p>
      )}
    </section>
  );
};
