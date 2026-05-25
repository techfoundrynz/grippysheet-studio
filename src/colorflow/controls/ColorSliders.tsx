import React from 'react';
import type { ColorFlowSettings } from '../schema';

const SIMPLIFY_LABELS = ['off', 'light', 'medium', 'strong', 'max'] as const;
const DETAIL_LABELS = ['sharp', 'balanced', 'smooth'] as const;

interface Props {
  hasImage: boolean;
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
  colorCountDraft: number;
  setColorCountDraft: (v: number) => void;
  simplifyDraft: number;
  setSimplifyDraft: (v: number) => void;
  detailDraft: number;
  setDetailDraft: (v: number) => void;
}

export const ColorSliders: React.FC<Props> = ({
  hasImage, settings, setSettings,
  colorCountDraft, setColorCountDraft,
  simplifyDraft, setSimplifyDraft,
  detailDraft, setDetailDraft,
}) => (
  <section className={hasImage ? '' : 'opacity-40 pointer-events-none'}>
    <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100 mb-3">
      <span className="text-xs font-mono text-gray-500">03</span>
      <span>Colors</span>
    </h3>
    <div className="space-y-3">
      <label className="block text-xs text-gray-400">
        colors <span className="text-purple-400 font-mono">{colorCountDraft}</span>
        <input type="range" min={2} max={10} value={colorCountDraft}
          onChange={(e) => setColorCountDraft(+e.target.value)}
          className="w-full mt-1" />
      </label>
      <label className="block text-xs text-gray-400">
        simplify <span className="text-purple-400 font-mono">{SIMPLIFY_LABELS[simplifyDraft]}</span>
        <input type="range" min={0} max={4} value={simplifyDraft}
          onChange={(e) => setSimplifyDraft(+e.target.value)}
          className="w-full mt-1" />
      </label>
      <label className="block text-xs text-gray-400">
        trace detail <span className="text-purple-400 font-mono">{DETAIL_LABELS[detailDraft]}</span>
        <input type="range" min={0} max={2} value={detailDraft}
          onChange={(e) => setDetailDraft(+e.target.value)}
          className="w-full mt-1" />
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-400">
        <input type="checkbox" checked={settings.smooth}
          onChange={(e) => setSettings((s) => ({ ...s, smooth: e.target.checked }))} />
        smoothing
      </label>
    </div>
  </section>
);
