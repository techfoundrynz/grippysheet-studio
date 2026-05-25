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

  // Button has three visual states:
  //   - first run (no spikes yet) → blue primary CTA "Generate spike preview"
  //   - stale (inputs changed since last gen) → amber + pulse "Update spike preview"
  //   - up to date → muted "Spike preview up to date" with check
  // The disabled state keeps "up to date" non-clickable so users don't waste
  // a regen click on identical inputs.
  const buttonState: 'first' | 'stale' | 'fresh' = !hasSpikes ? 'first' : isStale ? 'stale' : 'fresh';
  const buttonLabel = buttonState === 'first'
    ? '↻  Generate spike preview'
    : buttonState === 'stale'
      ? '↻  Update spike preview — changes pending'
      : '✓  Spike preview up to date';
  const buttonClasses = buttonState === 'first'
    ? 'bg-gradient-to-br from-brand-500 to-accent-500 hover:from-brand-400 hover:to-accent-500 text-white shadow-glow-brand ring-1 ring-white/15 font-display'
    : buttonState === 'stale'
      ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-md ring-2 ring-amber-300/40 animate-pulse'
      : 'bg-gray-800 border border-gray-700 text-gray-400 cursor-default';

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100">
          <span className="text-xs font-mono text-gray-500">06</span>
          <span>Spike overlay</span>
        </h3>
        {hasPattern && buttonState === 'stale' && (
          <span className="text-[10px] text-signal-pending font-medium">changes pending</span>
        )}
      </div>

      {!hasPattern && (
        <p className="text-[11px] text-gray-500 leading-relaxed">
          No pattern tile configured — pick one in the <span className="text-gray-400">Geometry</span> tab to add a grip spike layer on top.
        </p>
      )}

      {hasPattern && (
        <>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate || buttonState === 'fresh'}
            className={`w-full px-4 py-3 rounded-md text-sm font-semibold transition-all ${buttonClasses} disabled:opacity-60 disabled:cursor-not-allowed`}
            title={!canGenerate
              ? 'Need an image + pattern to generate spikes'
              : buttonState === 'stale'
                ? 'Settings changed — click to regenerate the spike preview'
                : buttonState === 'fresh'
                  ? 'Preview matches the current settings'
                  : 'Generate the spike preview'}
          >
            {buttonLabel}
          </button>

          {spikeDiag && (
            <p className="text-[10px] text-gray-500 mt-2 font-mono">{spikeDiag}</p>
          )}

          <div className="grid grid-cols-1 gap-3 mt-4">
            <label className="block text-xs font-medium text-gray-300">
              <span className="flex items-baseline justify-between mb-1">
                <span>spike max</span>
                <span className="text-[10px] text-gray-500 font-normal">
                  {settings.spikeMaxMm === 0 ? 'auto: top color + 1.5mm' : 'mm above base'}
                </span>
              </span>
              <input
                type="number" step={0.1} min={0} max={20}
                value={settings.spikeMaxMm}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(20, +e.target.value || 0));
                  setSettings((s) => ({ ...s, spikeMaxMm: v }));
                }}
                className="w-full bg-gray-900 border border-gray-700 rounded-md px-2 py-1.5 text-xs font-mono text-gray-100 focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/20"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-300 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={settings.spikeColorMatch}
                onChange={(e) => setSettings((s) => ({ ...s, spikeColorMatch: e.target.checked }))}
                className="accent-brand-500"
              />
              color-match spikes to the region below
            </label>
          </div>
          <p className="text-[10px] text-gray-500 mt-2 font-mono">
            resolved top: <span className="text-signal-ready font-semibold">{effectiveSpikeMaxMm(settings.spikeMaxMm, baseMm, paletteSize, settings.colorLayerMm).toFixed(2)}mm</span>
          </p>
        </>
      )}
    </section>
  );
};
