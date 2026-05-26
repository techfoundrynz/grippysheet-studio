import React from 'react';
import { Freeze } from 'react-freeze';
import { importProjectBundle, ProjectAssets } from '../utils/projectUtils';
import { emitToast } from '../utils/eventBus';
import { BaseSettings, InlaySettings, GeometrySettings, ProjectSchemaV1 } from '../types/schemas';
import type { ProjectDataV2 } from '../types/schemas';
import { parseShapeFile } from '../utils/shapeLoader';
import { getOutlineBySlug } from '../colorflow/outlineLibrary';
import { RotateCcw, HelpCircle, ChevronDown, Download } from 'lucide-react';
import { useAlert } from '../context/AlertContext';
import SegmentedControl from './ui/SegmentedControl';
import Button from './ui/Button';
import { ColorFlowControls, type ColorFlowGeomData } from '../colorflow/ColorFlowControls';
import { SpikeControls } from '../colorflow/controls/SpikeControls';
import type { ColorFlowSettings } from '../colorflow/schema';

// Sub-components
import BaseControls from './controls/BaseControls';
import InlayControls from './controls/InlayControls';
import GeometryControls from './controls/GeometryControls';

interface ControlsProps {
  baseSettings: BaseSettings;
  setBaseSettings: React.Dispatch<React.SetStateAction<BaseSettings>>;
  inlaySettings: InlaySettings;
  setInlaySettings: React.Dispatch<React.SetStateAction<InlaySettings>>;
  geometrySettings: GeometrySettings;
  setGeometrySettings: React.Dispatch<React.SetStateAction<GeometrySettings>>;
  onReset?: () => void;
  onOpenWelcome?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  exportControls?: React.ReactNode;
  activeTab: 'base' | 'inlay' | 'colorflow' | 'geometry';
  setActiveTab: (tab: 'base' | 'inlay' | 'colorflow' | 'geometry') => void;
  selectedInlayId: string | null;
  setSelectedInlayId: (id: string | null) => void;
  // ColorFlow props
  colorFlowSettings: ColorFlowSettings;
  setColorFlowSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
  colorFlowActive: boolean;
  /** Live palette size from the most recent ColorFlow extrude (0 if none yet).
   *  Drives whether the Geometry tab shows the Spike-overlay controls. */
  colorFlowPaletteSize: number;
  onColorFlowGeomReady?: (data: ColorFlowGeomData) => void;
  /** Latest spike-generation diagnostic line (for display in ColorFlow panel). */
  colorFlowSpikeDiag?: string;
  /** Whether a spike preview can be generated (source + pattern both present). */
  colorFlowCanGenerateSpikes?: boolean;
  /** Whether spikes are stale relative to current inputs. */
  colorFlowSpikesStale?: boolean;
  /** Whether spikes have been generated at least once for the current source. */
  colorFlowHasSpikes?: boolean;
  /** Trigger spike generation. */
  onGenerateSpikes?: () => void;
  onColorFlowImageAssetChanged?: (a: { name: string; bytes: ArrayBuffer } | null) => void;
  initialColorFlowImageAsset?: { name: string; bytes: ArrayBuffer } | null;
  onProjectImported?: (data: ProjectDataV2, assets: ProjectAssets) => void;
  /** Pattern-mode asset captures (DXF outline, STL pattern, inlay files)
   *  bubble up via this callback so the App-level sidecar payload that
   *  feeds the 3MF round-trip has everything it needs. */
  onProjectAssetsChanged?: (mutate: (prev: ProjectAssets) => ProjectAssets) => void;
}

const Controls: React.FC<ControlsProps> = ({
  baseSettings,
  setBaseSettings,
  inlaySettings,
  setInlaySettings,
  geometrySettings,
  setGeometrySettings,
  onReset,
  onOpenWelcome,
  isCollapsed = false,
  onToggleCollapse,
  exportControls,
  activeTab,
  setActiveTab,
  selectedInlayId,
  setSelectedInlayId,
  colorFlowSettings,
  setColorFlowSettings,
  colorFlowActive,
  colorFlowPaletteSize,
  colorFlowSpikeDiag,
  colorFlowCanGenerateSpikes,
  colorFlowSpikesStale,
  colorFlowHasSpikes,
  onGenerateSpikes,
  onColorFlowGeomReady,
  onColorFlowImageAssetChanged,
  initialColorFlowImageAsset,
  onProjectImported,
  onProjectAssetsChanged,
}) => {
  const { showAlert } = useAlert();
  // Lifted state
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (isCollapsed && containerRef.current) {
        containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [isCollapsed]);

  // Helper Setters
  const updateBase = (updates: Partial<BaseSettings>) => setBaseSettings(prev => ({ ...prev, ...updates }));
  const updateGeom = (updates: Partial<GeometrySettings>) => setGeometrySettings(prev => ({ ...prev, ...updates }));
  const updateInlay = (updates: Partial<InlaySettings>) => setInlaySettings(prev => ({ ...prev, ...updates }));

  const handleResetClick = () => {
      // When colorflow is active, Reset is also the *only* path back to
      // Pattern mode (see CLAUDE.md "Mode detection"). Surface that so a
      // user looking to switch modes knows where the door is.
      const message = colorFlowActive
        ? "Reset clears your ColorFlow image, color palette, and all design settings. This is also the only way to switch back to Pattern mode."
        : "Are you sure you want to reset all settings to their defaults? This action cannot be undone and your current design will be lost.";
      showAlert({
          title: "Reset Settings?",
          message,
          type: "warning",
          confirmText: colorFlowActive ? "Reset · switch to Pattern" : "Confirm Reset",
          cancelText: "Cancel",
          onConfirm: () => {
              if (onReset) onReset();
              emitToast({ message: 'Reset', detail: 'all settings restored', tone: 'info' });
          }
      });
  };

  // Local mirror kept for the legacy `.zip` import-validation flow + the
  // `setProjectAssets(importedAssets)` reset on project import. Every
  // mutation also bubbles to App via `onProjectAssetsChanged` so the
  // 3MF-export sidecar payload sees the full asset picture.
  const [projectAssets, setProjectAssets] = React.useState<ProjectAssets>({ inlays: {} });
  const updateProjectAssets = React.useCallback((mutate: (prev: ProjectAssets) => ProjectAssets) => {
    setProjectAssets((prev) => {
      const next = mutate(prev);
      onProjectAssetsChanged?.(() => next);
      return next;
    });
  }, [onProjectAssetsChanged]);
  // `projectAssets` is referenced by the legacy validation logic for
  // .zip exports, which is currently gone — keep the binding alive via
  // this no-op read so future re-introductions don't need to thread it
  // back through the import path.
  void projectAssets;

  // Logic to handle Outline Loading at the top level
  const handleOutlineLoaded = (shapes: any[]) => {
      // 1. Set Outline
      updateBase({ cutoutShapes: shapes });

      // 2. Check if we need to resize existing inlay (if it exists in inlaySettings)
      if (inlaySettings.items && inlaySettings.items.length > 0) {
           // We might want to auto-scale ALL items or just the first one?
           // For now, let's just leave it manual or auto-scale active item logic in InlayControls.
           // The old logic was global inlayScale.
           // Maybe we skip auto-scaling here for now as items are independent.
      }
  };

  const handleOutlineAssetChanged = (asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' } | null) => {
      updateProjectAssets((prev) => ({ ...prev, baseOutline: asset || undefined }));
  };

  const handlePatternAssetChanged = (asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' | 'stl' } | null) => {
      updateProjectAssets((prev) => ({ ...prev, pattern: asset || undefined }));
  };

  const handleInlayAssetChanged = (id: string, asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' | 'stl' } | null) => {
      updateProjectAssets((prev) => {
          const newInlays = { ...(prev.inlays || {}) };
          if (asset) {
              newInlays[id] = asset;
          } else {
              delete newInlays[id];
          }
          return { ...prev, inlays: newInlays };
      });
  };

  // `handleExportClick` (the old .zip Save Project flow) was removed
  // when the .3mf round-trip landed — the Export 3MF CTA below now
  // produces a file that prints AND reloads as a project. The asset-
  // completeness validation it performed moved into `OutputPanel`'s
  // 3MF export so the same "missing original DXF/SVG" warning still
  // fires before the round-trip file is written.

  const handleImportClick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      // .3mf is the new project format (sidecar embedded in the print
      // file); .zip is kept for back-compat with old saves.
      input.accept = '.3mf,.zip';
      input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;

          try {
              const { data, versionMismatch, importedVersion, importedAssets } = await importProjectBundle(file);

              // Delegate colorflow project imports to the colorflow handler
              if (data.mode === 'colorflow' && onProjectImported) {
                  onProjectImported(data, importedAssets ?? {});
                  return;
              }

              const applyImport = () => {
                   let newBase = data.base;
                   let newInlay = data.inlay;
                   let newGeometry = data.geometry;

                   // Re-hydrate Shapes from Assets if available. Image-type
                   // assets (ColorFlow raster) can't be reparsed as shapes,
                   // so they're skipped here — they're handled separately
                   // via the ColorFlow image-import path.
                   const isShapeAsset = (t: 'dxf' | 'svg' | 'stl' | 'image'): t is 'dxf' | 'svg' | 'stl' => t !== 'image';
                   if (importedAssets) {
                       // 1. Base Outline
                       if (importedAssets.baseOutline && isShapeAsset(importedAssets.baseOutline.type)) {
                           const res = parseShapeFile(importedAssets.baseOutline.content, importedAssets.baseOutline.type);
                           if (res.success) {
                               newBase = { ...newBase, cutoutShapes: res.shapes };
                           }
                       }

                       // 2. Pattern
                       if (importedAssets.pattern && isShapeAsset(importedAssets.pattern.type)) {
                           console.log("[Import] Rehydrating Pattern:", importedAssets.pattern.name);
                           const res = parseShapeFile(importedAssets.pattern.content, importedAssets.pattern.type);
                           if (res.success) {
                               // Ensure we update all relevant fields
                               newGeometry = { 
                                   ...newGeometry, 
                                   patternShapes: res.shapes, 
                                   patternType: importedAssets.pattern.type as any 
                               };
                           } else {
                               console.error("[Import] Failed to parse pattern:", res.error);
                           }
                       } else if (newGeometry.patternShapes) {
                            console.warn("[Import] Pattern shapes present in settings but missing from assets bundle.");
                       }

                       // 3. Inlays
                       if (importedAssets.inlays && newInlay.items) {
                           newInlay.items = newInlay.items.map(item => {
                               const asset = importedAssets.inlays?.[item.id];
                               if (asset && isShapeAsset(asset.type)) {
                                   const res = parseShapeFile(asset.content, asset.type, true); // Extract colors often true for inlays?
                                   // Note: extractColors=true logic in ShapeUploader usually depends on props.
                                   // In InlayControls, ShapeUploader has extractColors={true} passed?
                                   // Let's check. Yes, usually for Inlays we want to preserve color if SVG.
                                   // Default to true for Inlays to be safe, or check item settings?
                                   // Actually, InlayControls uses `extractColors` prop on ShapeUploader which defaults to false?
                                   // Let's check InlayControls source if possible.
                                   // Assuming true/false based on common usage. If we lost that info, defaults are safer.
                                   // But let's assume `true` for SVGs in inlays is common desired behavior.
                                   // Actually, the `item.shapes` structure is { shape: s, color: c }.
                                   // If we parse without extractColors, we get [s].
                                   // If original item had colors, shape structure differs.
                                   // We should check if item.shapes in JSON has color data? No, JSON shapes are garbage.
                                   // But we are REPLACING shapes with parsed ones.
                                   // Let's use `true` for Inlays as they often use multi-color SVGs.
                                   if (res.success) {
                                       return { ...item, shapes: res.shapes };
                                   }
                               }
                               return item;
                           });
                       }
                       
                       updateProjectAssets(() => importedAssets);
                   }

                   setBaseSettings(newBase);
                   setInlaySettings(newInlay);
                   setGeometrySettings(newGeometry);
                   emitToast({ message: 'Project loaded', detail: 'settings + assets restored', tone: 'ready' });
              };

              if (versionMismatch) {
                  showAlert({
                      title: "Version Mismatch",
                      message: `The imported project version (${importedVersion}) does not match the current version (${ProjectSchemaV1.shape.version.value}). Some settings may be missing or incorrect.`,
                      type: "warning",
                      confirmText: "Continue Anyway",
                      cancelText: "Cancel",
                      onConfirm: applyImport
                  });
              } else {
                   applyImport();
              }
          } catch (err: any) {
              showAlert({
                  title: "Import Failed",
                  message: err.message || "Failed to import project file.",
                  type: "error"
              });
          }
      };
      input.click();
  };

  const renderFooter = (className = "p-4 bg-gray-800 space-y-3") => (
      <div className={className}>
            {/* Project actions row. With 3MF round-trip wired in, the prominent
                "Export 3MF" CTA below is BOTH the print export AND the project
                save — one file does both. The separate "Save" button is gone
                because it would just produce the same .3mf with no benefit. */}
            <div className="grid grid-cols-2 gap-2">
                {onReset && (
                    <button
                        type="button"
                        onClick={handleResetClick}
                        className="group flex flex-col items-center gap-1 px-2 py-2 rounded-lg border border-gray-700/60 bg-gray-900/40 hover:border-signal-error/40 hover:bg-signal-error/[0.06] text-gray-400 hover:text-signal-error transition-all"
                        title="Reset all settings to defaults"
                    >
                        <RotateCcw size={15} strokeWidth={2.25} />
                        <span className="text-[10px] font-medium tracking-wide uppercase">Reset</span>
                    </button>
                )}
                <button
                    type="button"
                    onClick={handleImportClick}
                    className="group flex flex-col items-center gap-1 px-2 py-2 rounded-lg border border-gray-700/60 bg-gray-900/40 hover:border-brand-500/50 hover:bg-brand-500/[0.04] text-gray-400 hover:text-brand-300 transition-all"
                    title="Open a previously exported .3mf or legacy .zip"
                >
                    <Download size={15} strokeWidth={2.25} />
                    <span className="text-[10px] font-medium tracking-wide uppercase">Open</span>
                </button>
            </div>

            {/* Primary export — kept prominent. */}
            {exportControls && (
                <div className="w-full">
                    {exportControls}
                </div>
            )}
      </div>
  );

  return (
    <div 
        ref={containerRef}
        className={`bg-gray-800 md:rounded-lg md:border border-gray-700 shadow-lg flex-1 min-h-0 flex flex-col transition-all relative rounded-t-xl border-t ${isCollapsed ? 'overflow-hidden' : 'overflow-y-auto md:overflow-hidden'}`}
    >
      <div className="md:sticky md:top-0 z-10 bg-gray-800 p-6 pb-2 border-b border-gray-700/50 mb-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
             {onToggleCollapse && (
                  <Button
                      onClick={onToggleCollapse}
                      variant="ghost"
                      size="icon"
                      className="md:hidden -ml-1 text-gray-400 hover:text-white"
                  >
                      <ChevronDown size={20} className={`transition-transform duration-300 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`} />
                  </Button>
             )}
             <h2 className="font-display text-xl font-bold tracking-tight">
                <span className="bg-gradient-to-r from-brand-400 via-brand-500 to-accent-500 bg-clip-text text-transparent">GRIPPY</span>
                <span className="text-gray-200">SHEET</span>
                <span className="text-signal-ready text-[10px] font-mono font-semibold ml-1.5 align-top tracking-widest">STUDIO</span>
             </h2>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={onOpenWelcome}
              variant="ghost"
              size="icon"
              className="text-gray-400 hover:text-white hover:bg-gray-700/50"
              title="Help & Info"
            >
              <HelpCircle size={20} />
            </Button>
          </div>
        </div>
          
        <div className="flex flex-col -mt-1 mb-4 gap-0.25">
             <p className="text-[12px] text-gray-300 font-mono font-bold">
               Built by Siwoz
             </p>
             <p className="text-[10px] text-gray-500 font-mono">
               Build: {import.meta.env.DEV ? 'DEV' : __BUILD_TIMESTAMP__}
             </p>
        </div>

        {/* Live project-state chip — anchors the brand bar with what the
            user is currently working on (deck name · color count · mode).
            Suppressed entirely when nothing's loaded so the header doesn't
            read as "broken default state". */}
        {(() => {
          const outlineEntry = baseSettings.outlineSlug ? getOutlineBySlug(baseSettings.outlineSlug) : null;
          const hasCustomOutline = !outlineEntry && (baseSettings.cutoutShapes?.length ?? 0) > 0;
          const outlineLabel = outlineEntry?.name ?? (hasCustomOutline ? 'Custom outline' : null);
          if (!outlineLabel) return null;
          const mode = colorFlowActive ? 'ColorFlow' : 'Pattern';
          return (
            <div className="flex items-center gap-2 mb-3 px-2.5 py-1.5 rounded-md bg-gray-900/50 border border-gray-800 text-[10px] font-mono">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-signal-ready shadow-[0_0_6px_rgba(0,255,136,0.7)]" aria-hidden="true" />
              <span className="text-gray-200 truncate">{outlineLabel}</span>
              {colorFlowActive && colorFlowPaletteSize > 0 && (
                <>
                  <span className="text-gray-700">·</span>
                  <span className="text-signal-ready">{colorFlowPaletteSize}</span>
                  <span className="text-gray-500">{colorFlowPaletteSize === 1 ? 'color' : 'colors'}</span>
                </>
              )}
              <span className="text-gray-700">·</span>
              <span className={colorFlowActive ? 'text-accent-500' : 'text-brand-400'}>{mode}</span>
            </div>
          );
        })()}

        <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isCollapsed ? 'max-h-0 opacity-0 md:max-h-[500px] md:opacity-100 m-0' : 'max-h-[500px] opacity-100'}`}>
          {(() => {
            // Compute small "filled" badges per tab so the strip narrates
            // state at a glance — a Base tab with no outline reads as
            // "you haven't done this yet", a ColorFlow tab with 5 colors
            // shows "5" in its chip.
            const baseFilled = !!(baseSettings.cutoutShapes && baseSettings.cutoutShapes.length > 0);
            const inlayCount = inlaySettings.items?.length ?? 0;
            const colorFlowCount = colorFlowPaletteSize;
            const geometryFilled = !!(geometrySettings.patternShapes && geometrySettings.patternShapes.length > 0);
            const dot = (active: boolean) => (
              <span className={`ml-1.5 inline-block w-1.5 h-1.5 rounded-full ${active ? 'bg-signal-ready shadow-[0_0_6px_rgba(0,255,136,0.7)]' : 'bg-gray-700'}`} />
            );
            const count = (n: number) => (
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded text-[9px] font-mono font-semibold ${n > 0 ? 'bg-signal-ready/15 text-signal-ready' : 'bg-gray-800 text-gray-600'}`}>
                {n}
              </span>
            );
            return (
              <SegmentedControl
                semantics="tab"
                aria-label="Right panel section"
                value={activeTab}
                onChange={(val) => setActiveTab(val as any)}
                options={[
                  { value: 'base', label: <span className="inline-flex items-center">Base{dot(baseFilled)}</span> },
                  { value: 'inlay', label: <span className="inline-flex items-center">Inlay{inlayCount > 0 ? count(inlayCount) : dot(false)}</span>, disabled: colorFlowActive },
                  { value: 'colorflow', label: <span className="inline-flex items-center">ColorFlow{colorFlowCount > 0 ? count(colorFlowCount) : dot(false)}</span> },
                  { value: 'geometry', label: <span className="inline-flex items-center">Geometry{dot(geometryFilled)}</span> },
                ]}
              />
            );
          })()}
        </div>
      </div>

      <div className={`flex-1 min-h-0 flex flex-col transition-all duration-300 ease-in-out ${isCollapsed ? 'max-h-0 opacity-0 md:max-h-[2000px] md:opacity-100' : 'max-h-[2000px] opacity-100'}`}>
        <div className="flex-1 md:overflow-y-auto overflow-visible custom-scrollbar p-6 flex flex-col gap-6">
            
            <Freeze freeze={activeTab !== 'base'}>
                <div
                    role="tabpanel"
                    id="tabpanel-base"
                    aria-labelledby="tab-base"
                    tabIndex={0}
                    className={activeTab === 'base' ? 'block' : 'hidden'}
                >
                    <BaseControls
                        settings={baseSettings}
                        updateSettings={updateBase}
                        onOutlineLoaded={handleOutlineLoaded}
                        onOutlineAssetChanged={handleOutlineAssetChanged}
                    />
                </div>
            </Freeze>

            <Freeze freeze={activeTab !== 'inlay'}>
                <div
                    role="tabpanel"
                    id="tabpanel-inlay"
                    aria-labelledby="tab-inlay"
                    tabIndex={0}
                    className={activeTab === 'inlay' ? 'block' : 'hidden'}
                >
                    <InlayControls
                        settings={inlaySettings}
                        updateSettings={updateInlay}
                        cutoutShapes={baseSettings.cutoutShapes}
                        baseSize={baseSettings.size}
                        baseThickness={baseSettings.thickness}
                        baseColor={baseSettings.color}
                        selectedInlayId={selectedInlayId}
                        setSelectedInlayId={setSelectedInlayId}
                        onInlayAssetChanged={handleInlayAssetChanged}
                    />
                </div>
            </Freeze>

            <Freeze freeze={activeTab !== 'geometry'}>
                <div
                    role="tabpanel"
                    id="tabpanel-geometry"
                    aria-labelledby="tab-geometry"
                    tabIndex={0}
                    className={activeTab === 'geometry' ? 'block space-y-6' : 'hidden'}
                >
                    <GeometryControls
                        settings={geometrySettings}
                        updateSettings={updateGeom}
                        baseSize={baseSettings.size}
                        onPatternAssetChanged={handlePatternAssetChanged}
                    />
                    {colorFlowActive && colorFlowPaletteSize > 0 && (
                        <SpikeControls
                            paletteSize={colorFlowPaletteSize}
                            geometrySettings={geometrySettings}
                            baseMm={baseSettings.thickness}
                            settings={colorFlowSettings}
                            setSettings={setColorFlowSettings}
                            spikeDiag={colorFlowSpikeDiag}
                            canGenerate={!!colorFlowCanGenerateSpikes}
                            isStale={!!colorFlowSpikesStale}
                            hasSpikes={!!colorFlowHasSpikes}
                            onGenerate={onGenerateSpikes}
                        />
                    )}
                </div>
            </Freeze>

            <Freeze freeze={activeTab !== 'colorflow'}>
                <div
                    role="tabpanel"
                    id="tabpanel-colorflow"
                    aria-labelledby="tab-colorflow"
                    tabIndex={0}
                    className={activeTab === 'colorflow' ? 'block' : 'hidden'}
                >
                    <ColorFlowControls
                        baseSettings={baseSettings}
                        settings={colorFlowSettings}
                        setSettings={setColorFlowSettings}
                        onGeometryReady={onColorFlowGeomReady}
                        onImageAssetChanged={onColorFlowImageAssetChanged}
                        initialImageAsset={initialColorFlowImageAsset}
                        onSwitchToBase={() => setActiveTab('base')}
                    />
                </div>
            </Freeze>

            {renderFooter("md:hidden pt-6 border-t border-gray-700/50 space-y-4")}
            </div>

            {renderFooter("hidden md:block p-6 border-t border-gray-700/50 space-y-4 bg-gray-800 z-10")}
      </div>
    </div>
  );
};

export default Controls;
