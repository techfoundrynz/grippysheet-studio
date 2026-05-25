import React from 'react';
import { BaseSettings } from '../../types/schemas';
import { COLORS } from '../../constants/colors';
import { FlipHorizontal, BookOpen } from 'lucide-react';
import ShapeUploader from '../ShapeUploader';
import ControlField from '../ui/ControlField';
import DebouncedInput from '../DebouncedInput';
import ToggleButton from '../ui/ToggleButton';
import PatternLibraryModal, { PatternPreset } from '../PatternLibraryModal';
import { useAlert } from '../../context/AlertContext';
import { parseShapeFile } from '../../utils/shapeLoader';
import { OUTLINE_LIBRARY, getOutlineBySlug } from '../../colorflow/outlineLibrary';
import { emitProcessing } from '../../utils/eventBus';

interface BaseControlsProps {
  settings: BaseSettings;
  updateSettings: (updates: Partial<BaseSettings>) => void;
  onOutlineLoaded: (shapes: any[]) => void;
  onOutlineAssetChanged?: (asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' } | null) => void;
}

const BaseControls: React.FC<BaseControlsProps> = ({
  settings,
  updateSettings,
  onOutlineLoaded,
  onOutlineAssetChanged
}) => {
  const { size, thickness, color, cutoutShapes } = settings;
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [showLibrary, setShowLibrary] = React.useState(false);
  const { showAlert } = useAlert();

  const handlePickPreset = async (slug: string) => {
    if (!slug) return;
    const entry = getOutlineBySlug(slug);
    if (!entry) return;
    emitProcessing({ key: 'base:outline-fetch', busy: true, label: 'loading outline' });
    try {
      const res = await fetch(entry.file);
      const text = await res.text();
      const parsed = parseShapeFile(text, 'dxf');
      if (parsed.success) {
        updateSettings({ cutoutShapes: parsed.shapes, outlineSlug: slug });
        setFileName(entry.name);
        onOutlineLoaded(parsed.shapes);
      }
    } finally {
      emitProcessing({ key: 'base:outline-fetch', busy: false });
    }
  };

  const handleOutlineLoaded = (shapes: any[], name: string | null, type?: 'dxf'|'svg'|'stl', content?: string | ArrayBuffer) => {
      // Custom upload clears the library slug.
      updateSettings({ cutoutShapes: shapes, outlineSlug: null });
      setFileName(name);
      onOutlineLoaded(shapes);
      if (name && content && type && onOutlineAssetChanged) {
          onOutlineAssetChanged({ name, content, type: type as 'dxf' | 'svg' });
      }
  };

  const currentLibraryEntry = settings.outlineSlug ? getOutlineBySlug(settings.outlineSlug) : null;

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="space-y-3">
        {/* Current selection pill — shown above the picker when a library
            outline is active so users see what's loaded without opening
            the gallery again. Uses the brand 'ready' signal-green styling. */}
        {currentLibraryEntry && (
          <div className="flex items-center justify-between gap-2 bg-signal-ready/[0.06] border border-signal-ready/30 rounded-md px-3 py-2 text-xs">
            <span className="text-signal-ready font-medium">
              ✓ {currentLibraryEntry.name}
              <span className="text-signal-ready/70 font-mono ml-1.5 text-[10px]">
                {currentLibraryEntry.widthMm}×{currentLibraryEntry.heightMm}mm
              </span>
            </span>
            <button
              type="button"
              onClick={() => setShowLibrary(true)}
              className="text-brand-400 hover:text-brand-300 hover:underline text-[10px] font-medium whitespace-nowrap"
            >
              change ↗
            </button>
          </div>
        )}

        {/* Primary outline-picker CTA. The visual gallery is the recommended
            path for 95% of users; the old dropdown buried the same content
            in OS-styled chrome. Custom DXF upload stays below as a secondary
            "or your own file" path. */}
        <button
          type="button"
          onClick={() => setShowLibrary(true)}
          className={`group w-full flex items-center gap-3 px-4 py-4 rounded-lg border-2 border-dashed transition-all ${
            currentLibraryEntry
              ? 'border-gray-700 hover:border-brand-500/60 bg-gray-900/40 hover:bg-brand-500/[0.04]'
              : 'border-brand-500/40 hover:border-brand-500 bg-gradient-to-br from-brand-500/10 to-accent-500/10 hover:from-brand-500/15 hover:to-accent-500/15 shadow-glow-brand'
          }`}
        >
          <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
            currentLibraryEntry
              ? 'bg-gray-800 group-hover:bg-brand-500/20 text-gray-400 group-hover:text-brand-400'
              : 'bg-brand-500/20 group-hover:bg-brand-500/30 text-brand-400 group-hover:text-brand-300'
          }`}>
            <BookOpen size={20} />
          </div>
          <div className="flex-1 text-left">
            <div className="font-display font-semibold text-sm tracking-wide text-gray-100">
              {currentLibraryEntry ? 'Browse outline library' : 'Pick an outline'}
            </div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              {OUTLINE_LIBRARY.length} stock decks · XR · GT · Pint · Floatwheel
            </div>
          </div>
          <span className="text-brand-400 font-mono text-xs opacity-0 group-hover:opacity-100 transition-opacity">
            open ↗
          </span>
        </button>

        <ShapeUploader
            label="Or upload your own DXF"
            shapes={cutoutShapes || null}
            fileName={currentLibraryEntry ? null : fileName}
            onUpload={(loadedShapes, name, type, content) => handleOutlineLoaded(loadedShapes, name, type, content)}
            onClear={() => {
                updateSettings({ cutoutShapes: [] });
                setFileName(null);
                if (onOutlineAssetChanged) onOutlineAssetChanged(null);
            }}
            allowedTypes={['dxf']}
        />
        
        <PatternLibraryModal
            isOpen={showLibrary}
            onClose={() => setShowLibrary(false)}
            category="outlines"
            onSelect={async (preset: PatternPreset) => {
                setShowLibrary(false);
                // Recover the library slug so the "current selection" pill
                // and project export both know this is a stock outline,
                // not a one-off DXF upload.
                const libraryEntry = OUTLINE_LIBRARY.find((o) => o.file.endsWith(`/${preset.file}`));
                try {
                    if (libraryEntry) {
                        await handlePickPreset(libraryEntry.slug);
                        return;
                    }
                    const response = await fetch(`/${preset.category}/${preset.file}`);
                    if (!response.ok) throw new Error('Failed to fetch');
                    const text = await response.text();
                    if (preset.type === 'dxf' || preset.type === 'svg') {
                        const result = parseShapeFile(text, preset.type as 'dxf'|'svg');
                        if (result.success) {
                            handleOutlineLoaded(result.shapes, preset.name, preset.type, text);
                        } else {
                            throw new Error(result.error);
                        }
                    }
                } catch (error) {
                    console.error("Failed to load outline:", error);
                    showAlert({
                        title: "Error Loading Outline",
                        message: "Failed to load the selected outline preset.",
                        type: "error"
                    });
                }
            }}
        />
      </div>
      
      {(!cutoutShapes || cutoutShapes.length === 0) && (
        <ControlField label="Size (mm)" tooltip="Width/Height of the base sheet square" helperText="Unused when outline is uploaded">
          <DebouncedInput
            type="number"
            value={size}
            onChange={(val) => updateSettings({ size: Number(val) })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none"
          />
        </ControlField>
      )}

      <ControlField label="Thickness (mm)" tooltip="Total thickness (height) of the base sheet (min 0.5mm)">
        <DebouncedInput
          type="number"
          value={thickness}
          onChange={(val) => updateSettings({ thickness: Math.max(0.5, Number(val)) })}
          step="0.1"
          min="0.5"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none"
        />
      </ControlField>

      {cutoutShapes && cutoutShapes.length > 0 && (
          <div className="flex gap-4">
              <div className="flex-1 min-w-0">
                <ControlField label="Rotation (deg)" tooltip="Rotate the base outline">
                    <DebouncedInput
                    type="number"
                    value={settings.baseOutlineRotation || 0}
                    onChange={(val) => updateSettings({ baseOutlineRotation: Number(val) })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none"
                    />
                </ControlField>
              </div>
              <div className="flex-1 min-w-0">
                <ControlField label="Mirror" tooltip="Flip the base outline horizontally">
                     <ToggleButton
                        label={settings.baseOutlineMirror ? "Enabled" : "Disabled"}
                        isToggled={!!settings.baseOutlineMirror}
                        onToggle={() => updateSettings({ baseOutlineMirror: !settings.baseOutlineMirror })}
                        icon={<FlipHorizontal size={16} />}
                    />
                </ControlField>
              </div>
          </div>
      )}

      <div className="space-y-2">
         <label className="text-sm font-medium text-gray-300">Color</label>
         <div className="grid grid-cols-7 gap-y-2 p-1.5 bg-gray-800 rounded-lg border border-gray-700 w-full justify-items-center">
            {Object.entries(COLORS).map(([name, value]) => (
              <button
                key={value}
                onClick={() => updateSettings({ color: value })}
                className={`w-6 h-6 rounded-md transition-all hover:scale-110 active:scale-95 ${color === value ? 'ring-2 ring-white' : 'hover:ring-1 hover:ring-white/50'}`}
                style={{ backgroundColor: value }}
                title={name}
              />
            ))}
         </div>
      </div>
    </section>
  );
};

export default BaseControls;
