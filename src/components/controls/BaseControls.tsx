import React from 'react';
import { BaseSettings } from '../../types/schemas';
import { COLORS } from '../../constants/colors';
import { FlipHorizontal, BookOpen } from 'lucide-react';
import ShapeUploader from '../ShapeUploader';
import ControlField from '../ui/ControlField';
import DebouncedInput from '../DebouncedInput';
import NumberStepper from '../ui/NumberStepper';
import ToggleButton from '../ui/ToggleButton';
import PatternLibraryModal, { PatternPreset } from '../PatternLibraryModal';
import { useAlert } from '../../context/AlertContext';
import { parseShapeFile } from '../../utils/shapeLoader';
import { OUTLINE_LIBRARY, getOutlineBySlug } from '../../colorflow/outlineLibrary';
import { emitProcessing, eventBus, emitToast, consumePendingFileDrop } from '../../utils/eventBus';

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
  const [hoverColorName, setHoverColorName] = React.useState<string | null>(null);
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

  // Viewer context-menu bridge. The right-click "Open Library" item in
  // ModelViewer emits this event so we can pop the outline-library modal
  // without prop-drilling a controller down through Controls → BaseControls.
  React.useEffect(() => {
    return eventBus.on('open-outline-library', () => {
      setShowLibrary(true);
    });
  }, []);

  // Canvas drag-drop bridge. When a user drops a DXF/SVG anywhere on the
  // viewer, ModelViewer emits `file-drop` and we treat it the same as if
  // they used the ShapeUploader directly. The entire async pipeline is
  // wrapped in try/catch because `file.text()` and `parseShapeFile()` can
  // both throw on bad/binary input — without this guard, a bad drop would
  // surface only as an unhandled rejection in devtools.
  React.useEffect(() => {
    const handleDrop = async (e: { file: File; kind: string }) => {
      if (e.kind !== 'shape:base') return;
      const name = e.file.name;
      const lower = name.toLowerCase();
      const ext: 'dxf' | 'svg' | null = lower.endsWith('.svg')
        ? 'svg'
        : lower.endsWith('.dxf') ? 'dxf' : null;
      if (!ext) {
        showAlert({ title: 'Unsupported outline file', message: `${name} — supported: .dxf, .svg`, type: 'error' });
        emitToast({ message: 'Unsupported outline', detail: name, tone: 'error' });
        return;
      }
      try {
        const content = await e.file.text();
        const parsed = parseShapeFile(content, ext);
        if (parsed.success) {
          handleOutlineLoaded(parsed.shapes, name, ext, content);
          emitToast({ message: 'Outline loaded', detail: name, tone: 'ready' });
        } else {
          showAlert({ title: 'Could not load outline', message: parsed.error ?? 'unknown error', type: 'error' });
          emitToast({ message: 'Outline failed', detail: parsed.error ?? name, tone: 'error' });
        }
      } catch (err: any) {
        showAlert({ title: 'Could not load outline', message: err?.message ?? String(err), type: 'error' });
        emitToast({ message: 'Outline failed', detail: name, tone: 'error' });
      }
    };
    // Replay any drop that fired before this subscriber mounted (first drop
    // after page load, while the Base tab was Frozen).
    const pending = consumePendingFileDrop('shape:base');
    if (pending) void handleDrop(pending);
    return eventBus.on('file-drop', handleDrop);
  }, []);

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
              <span className="text-signal-ready font-mono ml-1.5 text-[10px]">
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
            fileName={currentLibraryEntry ? currentLibraryEntry.name : fileName}
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

      <ControlField label="Thickness" tooltip="Total thickness (height) of the base sheet (min 0.5mm)">
        <NumberStepper
          value={thickness}
          onChange={(val) => updateSettings({ thickness: val })}
          step={0.1}
          min={0.5}
          unit="mm"
          aria-label="Thickness in millimetres"
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
         <div className="flex items-baseline justify-between">
           <label className="text-sm font-medium text-gray-300">Color</label>
           {(() => {
             const activeName = Object.entries(COLORS).find(([, v]) => v === color)?.[0];
             const displayName = hoverColorName ?? activeName;
             const isPreview = hoverColorName && hoverColorName !== activeName;
             return displayName && (
               <span className={`text-[10px] font-mono tracking-wide transition-colors ${isPreview ? 'text-brand-300' : 'text-signal-ready'}`}>
                 {isPreview && <span className="text-gray-500 mr-1">preview:</span>}
                 {displayName}
               </span>
             );
           })()}
         </div>
         {(() => {
           // Roving-tabindex radiogroup for the color swatches. We pre-compute
           // the entries array so the keyboard handler can index into it
           // identically to how the visual grid renders.
           const entries = Object.entries(COLORS);
           const COLS = 7;
           const activeIndex = Math.max(0, entries.findIndex(([, v]) => v === color));
           const focusAt = (idx: number) => {
             // Wrap around at both ends — clamping would feel like a dead
             // arrow key once the active swatch is at an edge.
             const n = entries.length;
             const wrapped = ((idx % n) + n) % n;
             const [name, value] = entries[wrapped];
             setHoverColorName(name);
             updateSettings({ color: value });
             // Defer focus to next tick so the re-render lands first and the
             // tabIndex=0 swatch exists before we ask it to focus.
             requestAnimationFrame(() => {
               const el = document.querySelector<HTMLButtonElement>(
                 `[data-color-swatch="${wrapped}"]`
               );
               el?.focus();
             });
           };
           const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
             switch (e.key) {
               case 'ArrowRight':
                 e.preventDefault();
                 focusAt(activeIndex + 1);
                 break;
               case 'ArrowLeft':
                 e.preventDefault();
                 focusAt(activeIndex - 1);
                 break;
               case 'ArrowDown':
                 e.preventDefault();
                 // +7 with wrap. When the last row isn't full (21 entries =
                 // exactly 3 full rows here, but if the palette ever grows
                 // past a multiple of 7, ArrowDown from the bottom row will
                 // wrap into the top row's same column via the modulo above).
                 focusAt(activeIndex + COLS);
                 break;
               case 'ArrowUp':
                 e.preventDefault();
                 focusAt(activeIndex - COLS);
                 break;
               case 'Home':
                 e.preventDefault();
                 focusAt(0);
                 break;
               case 'End':
                 e.preventDefault();
                 focusAt(entries.length - 1);
                 break;
             }
           };
           return (
             <div
               role="radiogroup"
               aria-label="Base color"
               onKeyDown={onKeyDown}
               className="grid grid-cols-7 gap-1.5 p-2.5 bg-gray-900/60 rounded-lg border border-gray-800 w-full justify-items-center"
             >
               {entries.map(([name, value], idx) => {
                 const isActive = color === value;
                 return (
                   <button
                     key={value}
                     type="button"
                     role="radio"
                     aria-checked={isActive}
                     aria-label={name}
                     tabIndex={isActive ? 0 : -1}
                     data-color-swatch={idx}
                     onClick={() => updateSettings({ color: value })}
                     onMouseEnter={() => setHoverColorName(name)}
                     onMouseLeave={() => setHoverColorName(null)}
                     onFocus={() => setHoverColorName(name)}
                     onBlur={() => setHoverColorName(null)}
                     className={`relative w-7 h-7 rounded-md transition-all hover:scale-110 active:scale-95 ${
                       isActive
                         ? 'ring-2 ring-signal-ready ring-offset-2 ring-offset-gray-900 shadow-glow-ready'
                         : 'ring-1 ring-white/10 hover:ring-2 hover:ring-white/40'
                     }`}
                     style={{ backgroundColor: value }}
                   >
                     {isActive && (
                       <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white mix-blend-difference">✓</span>
                     )}
                   </button>
                 );
               })}
             </div>
           );
         })()}
         {/* Mini pad preview — silhouette tinted with the swatch the user
             is hovering. Lets them audition a colour without committing. */}
         <div className="flex items-center justify-center h-16 mt-1 bg-gray-950/40 rounded-md border border-gray-800/60">
           <svg viewBox="0 0 100 78" className="h-12 w-auto" aria-hidden="true">
             <path
               d="M8 4 H92 Q96 4 96 8 V62 Q96 66 92 66 H80 L78 74 H72 L70 66 H30 L28 74 H22 L20 66 H8 Q4 66 4 62 V8 Q4 4 8 4 Z"
               fill={(hoverColorName && COLORS[hoverColorName]) || color}
               stroke="rgba(255,255,255,0.55)"
               strokeWidth="1"
               style={{ transition: 'fill 120ms ease' }}
             />
           </svg>
         </div>
      </div>
    </section>
  );
};

export default BaseControls;
