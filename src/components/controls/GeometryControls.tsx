import React, { useState } from "react";
import { GeometrySettings, PatternLayer, PatternLayerSchema } from "../../types/schemas";
import {
  BookOpen,
  Grid3x3,
  MousePointer2,
  Maximize,
  ChevronDown,
  Scissors,
  Layers as LayersIcon,
  Plus,
  Trash2,
  ChevronRight,
  RotateCcw,
  Eraser,
} from "lucide-react";
import { COLORS } from "../../constants/colors";
import ShapeUploader from "../ShapeUploader";
import ControlField from "../ui/ControlField";
import DebouncedInput from "../DebouncedInput";
import NumberStepper from "../ui/NumberStepper";
import SegmentedControl from "../ui/SegmentedControl";
import { emitProcessing } from "../../utils/eventBus";
import ToggleButton from "../ui/ToggleButton";
import PatternLibraryModal from "../PatternLibraryModal";
import { useAlert } from "../../context/AlertContext";
import { STLLoader } from "three-stdlib";
import { getShapesBounds } from "../../utils/patternUtils";
import { parseShapeFile } from "../../utils/shapeLoader";

interface GeometryControlsProps {
  settings: GeometrySettings;
  updateSettings: (updates: Partial<GeometrySettings>) => void;
  baseSize: number;
  onPatternAssetChanged?: (asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' | 'stl' } | null) => void;
  /** Same shape as onPatternAssetChanged but keyed by extra-layer id, so
   *  per-layer DXF/STL source bytes flow into ProjectAssets.extraLayers
   *  and survive 3MF / .zip roundtrips. */
  onExtraLayerAssetChanged?: (id: string, asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' | 'stl' } | null) => void;
  /** Lifted tile-removal toggle — when true, the viewer is in tile-pick
   *  mode (click to remove). Surfaced inline in the Geometry tab so users
   *  configuring a pattern don't have to hunt for the toolbar Eraser. */
  tileRemovalMode?: boolean;
  setTileRemovalMode?: React.Dispatch<React.SetStateAction<boolean>>;
}

const GeometryControls: React.FC<GeometryControlsProps> = ({
  settings,
  updateSettings,
  baseSize,
  onPatternAssetChanged,
  onExtraLayerAssetChanged,
  tileRemovalMode,
  setTileRemovalMode,
}) => {
  const { showAlert } = useAlert();
  const {
    patternShapes,
    patternType,
    patternScale,
    patternScaleZ,
    isTiled,
    tileSpacing,
    patternMargin,
    holeMode,
    clipToOutline,
    tilingDistribution,
    tilingDirection,
    tilingOrientation,
    baseRotation,
    rotationClamp,
    patternColor,
  } = settings;

  const [showPatternLibrary, setShowPatternLibrary] = useState(false);
  const [libraryPatternName, setLibraryPatternName] = useState<string | null>(
    null
  );

  React.useEffect(() => {
    if (!patternShapes || patternShapes.length === 0) {
      setLibraryPatternName(null);
    }
  }, [patternShapes]);

  // Re-implement calculation logic locally or import if available
  const calculateAutoPatternScale = (
    shapes: any[],
    type: string | null,
    tiled: boolean,
    bSize: number,
    margin: number
  ): number | null => {
    if (!shapes || shapes.length === 0) return null;

    let width = 0;
    let height = 0;

    if (type === "stl") {
      const geometry = shapes[0];
      if (geometry.boundingBox === null) geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      width = bounds.max.x - bounds.min.x;
      height = bounds.max.y - bounds.min.y;
    } else {
      const bounds = getShapesBounds(shapes);
      width = bounds.size.x;
      height = bounds.size.y;
    }

    if (width <= 0 || height <= 0) return null;

    if (tiled) {
      // Tiled: Target ~xmm width
      const targetWidth = 10;
      const rawScale = targetWidth / width;
      const scale = Math.round(rawScale * 100) / 100;
      return scale > 0 ? scale : 1;
    } else {
      // Place: Target 50% of base size minus margin
      // DXF was previously hardcoded to 1, but we now allow auto-scale for better UX
      const maxSize = Math.max(width, height);
      if (maxSize > 0) {
        const availableSize = Math.max(0, bSize - margin * 2);
        // Target 50% coverage of the available area
        const scale = (availableSize * 0.5) / maxSize;
        const roundedScale = Math.round(scale * 100) / 100;
        return roundedScale > 0 ? roundedScale : 1;
      }
    }
    return 1;
  };

  const handlePatternLoaded = (shapes: any[], type?: "dxf" | "svg" | "stl", name?: string, content?: string | ArrayBuffer) => {
    const pType = type || null;
    const newScale = calculateAutoPatternScale(
      shapes,
      pType,
      isTiled,
      baseSize,
      patternMargin
    );

    if (import.meta.env.DEV) {
      console.log("[GeometryControls] Pattern Loaded:", { type, isTiled, newScale, shapeCount: shapes.length, name });
    }

    updateSettings({
      patternShapes: shapes,
      patternType: pType,
      ...(newScale !== null ? { patternScale: newScale } : {}),
    });

    if (onPatternAssetChanged && name && content && type) {
        onPatternAssetChanged({ name, content, type });
    }
  };

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100">
        <span className="text-xs font-mono text-gray-500">01</span>
        <span>Tile shape</span>
        <span className="text-[10px] font-mono text-gray-500 ml-auto">STL · SVG · DXF</span>
      </h3>
      <ShapeUploader
        label="Grip Geometry"
        shapes={
          patternShapes && patternShapes.length > 0 ? patternShapes : null
        }
        fileName={libraryPatternName}
        onUpload={(shapes, name, type, content) => {
          handlePatternLoaded(shapes, type, name, content);
          setLibraryPatternName(name);
        }}
        onClear={() => {
          updateSettings({
            patternShapes: [],
            patternType: null,
          });
          setLibraryPatternName(null);
          if (onPatternAssetChanged) onPatternAssetChanged(null);
        }}
        allowedTypes={["stl"]}
        adornment={
          <button
            onClick={() => setShowPatternLibrary(true)}
            className={
              "p-1 rounded-lg transition-colors border bg-gray-700/50 hover:bg-gray-700 text-gray-400 hover:text-white border-gray-600 hover:border-gray-500"
            }
            title="Open Pattern Library"
          >
            <BookOpen size={12} />
          </button>
        }
      />

      <PatternLibraryModal
        isOpen={showPatternLibrary}
        onClose={() => setShowPatternLibrary(false)}
        onSelect={async (preset) => {
          setShowPatternLibrary(false);
          emitProcessing({ key: 'geometry:pattern-fetch', busy: true, label: 'loading pattern' });
          try {
            if (preset.type === "stl") {
               const response = await fetch(`/${preset.category}/${preset.file}`);
               const buffer = await response.arrayBuffer();

              const loader = new STLLoader();
              const geometry = loader.parse(buffer);
              geometry.center(); // Auto-center STLs
              handlePatternLoaded([geometry], preset.type, preset.name, buffer);

            } else {
               // For DXF/SVG, we need text content
               const response = await fetch(`/${preset.category}/${preset.file}`);
               const text = await response.text();

               const result = parseShapeFile(text, preset.type as 'dxf' | 'svg');
               if (result.success) {
                   handlePatternLoaded(result.shapes, preset.type, preset.name, text);
               } else {
                   console.error("Failed to parse library pattern:", result.error);
               }
            }

            setLibraryPatternName(preset.name);
          } catch (error) {
            console.error("Failed to load pattern:", error);
            showAlert({
              title: "Error Loading Pattern",
              message: "Failed to load the selected pattern preset.",
              type: "error",
            });
          } finally {
            emitProcessing({ key: 'geometry:pattern-fetch', busy: false });
          }
        }}
      />

      {patternShapes && patternShapes.length > 0 && setTileRemovalMode && (
        <div className={`mt-2 rounded-lg border transition-all ${tileRemovalMode
            ? 'bg-signal-error/[0.06] border-signal-error/40 shadow-[0_0_18px_rgba(255,56,96,0.18)]'
            : 'bg-gray-900/40 border-gray-800'}`}>
          <button
            type="button"
            onClick={() => setTileRemovalMode((v) => !v)}
            className="w-full flex items-center justify-between gap-2 p-3 text-left"
            aria-pressed={tileRemovalMode}
          >
            <span className="flex items-center gap-2.5">
              <span className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${tileRemovalMode ? 'bg-signal-error/25 text-signal-error' : 'bg-gray-800 text-gray-400'}`}>
                <Eraser size={15} />
              </span>
              <span className="flex flex-col">
                <span className={`text-xs font-display font-semibold tracking-wide ${tileRemovalMode ? 'text-signal-error' : 'text-gray-200'}`}>
                  {tileRemovalMode ? 'Tile selection · ON' : 'Tile selection'}
                </span>
                <span className="text-[10px] font-mono text-gray-500">
                  {tileRemovalMode ? 'Click tiles in 2D or 3D to remove' : 'Thin out the pattern by clicking tiles'}
                </span>
              </span>
            </span>
            <span className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${tileRemovalMode ? 'bg-signal-error/70 justify-end' : 'bg-gray-700 justify-start'}`}>
              <span className="h-4 w-4 rounded-full bg-white shadow" />
            </span>
          </button>
        </div>
      )}

      {patternShapes && patternShapes.length > 0 && (
        <>
          <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100 mt-2">
            <span className="text-xs font-mono text-gray-500">02</span>
            <span>Layout</span>
            {/* "Restore N tiles" — only renders when the user has thinned
                out the pattern via the viewer's removal mode. Inline + red
                so it reads as a destructive-action reversal, not part of
                the layout chrome. Extra-layer cards have their own restore
                link (see the LayerCard render below). */}
            {(settings.removedTiles?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => updateSettings({ removedTiles: [] })}
                className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono text-signal-error hover:text-white hover:bg-signal-error/20 border border-signal-error/40 transition-colors"
                title="Restore all removed tiles in this layer"
              >
                <RotateCcw size={11} />
                Restore {settings.removedTiles!.length} tile{settings.removedTiles!.length === 1 ? '' : 's'}
              </button>
            )}
          </h3>
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-300">
              Mode
            </label>
            <SegmentedControl
              value={isTiled ? "tile" : "place"}
              onChange={(val) => {
                const newIsTiled = val === "tile";
                const newScale = calculateAutoPatternScale(
                  patternShapes,
                  patternType,
                  newIsTiled,
                  baseSize,
                  patternMargin
                );

                updateSettings({
                  isTiled: newIsTiled,
                  ...(newScale !== null ? { patternScale: newScale } : {}),
                });
              }}
              options={[
                { value: "tile", label: "Tile", icon: <Grid3x3 size={16} /> },
                {
                  value: "place",
                  label: "Place",
                  icon: <MousePointer2 size={16} />,
                },
              ]}
            />
          </div>

          <div className="flex gap-4">
            <div className="space-y-2 flex-1 min-w-0">
              <ControlField
                label="Scale X/Y"
                action={
                  patternShapes &&
                  patternShapes.length > 0 && (
                    <button
                      onClick={() => {
                        const newScale = calculateAutoPatternScale(
                          patternShapes,
                          patternType,
                          isTiled,
                          baseSize,
                          patternMargin
                        );
                        if (newScale !== null) {
                          updateSettings({ patternScale: newScale });
                        }
                      }}
                      className="text-gray-400 hover:text-brand-400 transition-colors"
                      title={
                        isTiled
                          ? "Auto Scale Tile Pattern"
                          : "Auto Scale to Fit"
                      }
                    >
                      <Maximize size={14} />
                    </button>
                  )
                }
              >
                <NumberStepper
                  value={patternScale}
                  onChange={(val) => {
                    const newScale = val;
                    // Proportional Z Scaling
                    let updateObject: Partial<GeometrySettings> = {
                      patternScale: newScale,
                    };
                    if (patternScaleZ !== "" && patternScale > 0) {
                      const ratio = newScale / patternScale;
                      const newZ = Number(patternScaleZ) * ratio;
                      updateObject.patternScaleZ =
                        Math.round(newZ * 1000) / 1000;
                    }
                    updateSettings(updateObject);
                  }}
                  step={0.1}
                  precision={2}
                  min={0.01}
                  aria-label="Scale X/Y"
                />
              </ControlField>
            </div>

            <div className="space-y-2 flex-1 min-w-0">
              <ControlField
                label="Scale Z"
                tooltip="Leave empty to match X/Y scale"
              >
                <DebouncedInput
                  type="number"
                  value={patternScaleZ}
                  onChange={(val) =>
                    updateSettings({
                      patternScaleZ: val === "" ? "" : Number(val),
                    })
                  }
                  placeholder="Auto"
                  min={0.1}
                  step={0.05}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none"
                />
              </ControlField>
            </div>

            <div className="space-y-2 flex-1 min-w-0">
              <ControlField label="Rotate" tooltip="Base rotation in degrees">
                <NumberStepper
                  value={baseRotation ?? 0}
                  onChange={(val) => updateSettings({ baseRotation: val })}
                  step={15}
                  unit="°"
                  aria-label="Rotate"
                />
              </ControlField>
            </div>
          </div>

          <div className="flex gap-4 pt-2 border-t border-gray-800">
            <div className="space-y-2 flex-1 min-w-0">
              <ControlField
                label="Max Height"
                tooltip="Cut pattern above this height (mm)"
              >
                <DebouncedInput
                  type="number"
                  value={settings.patternMaxHeight ?? ""}
                  onChange={(val) =>
                    updateSettings({
                      patternMaxHeight: val === "" ? undefined : Number(val),
                    })
                  }
                  placeholder="Auto"
                  min={0}
                  step={0.1}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none"
                />
              </ControlField>
            </div>
          </div>

          {isTiled && (
            <div className="flex-1 min-w-0 pt-2 border-t border-gray-800">
              <ControlField
                label="Spacing"
                tooltip="Distance between tiled patterns"
              >
                <NumberStepper
                  value={tileSpacing ?? 10}
                  onChange={(val) => updateSettings({ tileSpacing: val })}
                  step={1}
                  min={0}
                  unit="mm"
                  aria-label="Spacing"
                />
              </ControlField>
            </div>
          )}

          {isTiled && (
            <>
              <div className="flex gap-4">
                <div className="flex-1 min-w-0">
                  <ControlField label="Distribution">
                    <div className="relative">
                      <select
                        value={tilingDistribution}
                        onChange={(e) =>
                          updateSettings({
                            tilingDistribution: e.target.value as any,
                          })
                        }
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none appearance-none truncate"
                      >
                        <option value="grid">Grid</option>
                        <option value="offset">Offset</option>
                        <option value="hex">Hex</option>
                        <option value="radial">Radial</option>
                        <option value="wave">Wave</option>
                        <option value="zigzag">Zigzag</option>
                        <option value="warped-grid">Warped Grid</option>
                        <option value="random">Random</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                        <ChevronDown size={16} />
                      </div>
                    </div>
                  </ControlField>
                </div>

                {(tilingDistribution === "wave" ||
                  tilingDistribution === "zigzag") && (
                  <div className="flex-1 min-w-0">
                    <ControlField label="Direction">
                      <div className="relative">
                        <select
                          value={tilingDirection}
                          onChange={(e) =>
                            updateSettings({
                              tilingDirection: e.target.value as any,
                            })
                          }
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none appearance-none truncate"
                        >
                          <option value="horizontal">Horizontal</option>
                          <option value="vertical">Vertical</option>
                        </select>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                          <ChevronDown size={16} />
                        </div>
                      </div>
                    </ControlField>
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                <div className="flex-1 min-w-0">
                  <ControlField label="Orientation">
                    <div className="relative">
                      <select
                        value={tilingOrientation}
                        onChange={(e) =>
                          updateSettings({
                            tilingOrientation: e.target.value as any,
                          })
                        }
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none appearance-none truncate"
                      >
                        <option value="none">None</option>
                        <option value="alternate">Alternate</option>
                        <option value="aligned">Aligned</option>
                        <option value="random">Random</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                        <ChevronDown size={16} />
                      </div>
                    </div>
                  </ControlField>
                </div>

                <div className="flex-1 min-w-0">
                  <ControlField
                    label="Clamp"
                    tooltip="Snap rotation increments"
                  >
                    <DebouncedInput
                      type="number"
                      value={rotationClamp ?? ""}
                      onChange={(val) =>
                        updateSettings({
                          rotationClamp: val === "" ? undefined : Number(val),
                        })
                      }
                      placeholder="None"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none"
                    />
                  </ControlField>
                </div>
              </div>
            </>
          )}

          {/* Margin & Clip Toggles */}
          {/* Margin */}
          <div className="pt-2 border-t border-gray-800">
            <ControlField label="Margin" tooltip="Safety margin from edge">
              <NumberStepper
                value={patternMargin}
                onChange={(val) => updateSettings({ patternMargin: val })}
                step={0.5}
                min={0}
                unit="mm"
                aria-label="Margin"
              />
            </ControlField>
          </div>

          {/* Toggles Row */}
          <div className="flex gap-4 pt-2">
            <div className="flex-1 min-w-0">
              <ControlField
                label="Clip to Edge"
                tooltip="Trim patterns that cross the outline boundary"
              >
                <ToggleButton
                  label={clipToOutline ? "Enabled" : "Disabled"}
                  isToggled={!!clipToOutline}
                  onToggle={() =>
                    updateSettings({ clipToOutline: !clipToOutline })
                  }
                  icon={<Scissors size={16} />}
                />
              </ControlField>
            </div>

            <div className="flex-1 min-w-0">
              <ControlField
                label="Holes"
                tooltip="Interaction with holes"
              >
                  <div className="relative">
                    <select
                      value={holeMode || 'default'}
                      onChange={(e) =>
                        updateSettings({
                          holeMode: e.target.value as any,
                        })
                      }
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none appearance-none truncate"
                    >
                      <option value="default">Default</option>
                      <option value="margin">Margin</option>
                      <option value="avoid">Avoid</option>
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                      <ChevronDown size={16} />
                    </div>
                  </div>
              </ControlField>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-gray-800">
            <label className="text-sm font-medium text-gray-300">Color</label>
            <div className="grid grid-cols-7 gap-y-2 p-1.5 bg-gray-800 rounded-lg border border-gray-700 w-full justify-items-center">
              {Object.entries(COLORS).map(([name, value]) => (
                <button
                  key={value}
                  onClick={() => updateSettings({ patternColor: value })}
                  className={`w-6 h-6 rounded-md transition-all hover:scale-110 active:scale-95 ${
                    patternColor === value
                      ? "ring-2 ring-white"
                      : "hover:ring-1 hover:ring-white/50"
                  }`}
                  style={{ backgroundColor: value }}
                  title={name}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <ExtraLayersSection
        settings={settings}
        updateSettings={updateSettings}
        baseSize={baseSize}
        onExtraLayerAssetChanged={onExtraLayerAssetChanged}
      />
    </section>
  );
};

// ---------------------------------------------------------------------------
// Extra layers — opt-in compound pattern layers that stack on top of the
// primary one. The primary layer is still edited by the flat fields above;
// these cards drive `geometrySettings.extraLayers[]` one entry at a time.
// ---------------------------------------------------------------------------

interface ExtraLayersSectionProps {
  settings: GeometrySettings;
  updateSettings: (updates: Partial<GeometrySettings>) => void;
  baseSize: number;
  onExtraLayerAssetChanged?: (id: string, asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' | 'stl' } | null) => void;
}

const ExtraLayersSection: React.FC<ExtraLayersSectionProps> = ({
  settings,
  updateSettings,
  baseSize,
  onExtraLayerAssetChanged,
}) => {
  const extras = settings.extraLayers ?? [];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Pull schema defaults so a freshly-added layer matches the canonical
  // shape. `id` defaults to a fresh `crypto.randomUUID()` via the schema,
  // so the parse on its own is enough.
  const makeBlankLayer = (): PatternLayer =>
    PatternLayerSchema.parse({}) as PatternLayer;

  const handleAdd = () => {
    const newLayer = makeBlankLayer();
    updateSettings({ extraLayers: [...extras, newLayer] });
    setExpanded((prev) => ({ ...prev, [newLayer.id]: true }));
  };

  const handleDelete = (id: string) => {
    updateSettings({ extraLayers: extras.filter((l) => l.id !== id) });
    setExpanded((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const updateLayer = (id: string, patch: Partial<PatternLayer>) => {
    updateSettings({
      extraLayers: extras.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="pt-3 border-t border-gray-800 space-y-3">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100">
        <span className="text-xs font-mono text-gray-500">03</span>
        <span>Extra layers</span>
        {extras.length > 0 && (
          <span className="text-[10px] font-mono text-gray-500 ml-auto">
            <span className="text-signal-ready">{extras.length}</span>{" "}
            {extras.length === 1 ? "layer" : "layers"}
          </span>
        )}
      </h3>

      {extras.length === 0 ? (
        <button
          type="button"
          onClick={handleAdd}
          className="group w-full flex items-center gap-3 px-4 py-4 rounded-lg border-2 border-dashed border-brand-500/40 hover:border-brand-500 bg-gradient-to-br from-brand-500/10 to-accent-500/10 hover:from-brand-500/15 hover:to-accent-500/15 shadow-glow-brand transition-all"
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-brand-500/20 group-hover:bg-brand-500/30 text-brand-400 group-hover:text-brand-300 transition-colors">
            <LayersIcon size={20} />
          </div>
          <div className="flex-1 text-left">
            <div className="font-display font-semibold text-sm tracking-wide text-gray-100">
              Add another pattern
            </div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              Stack a second pattern on top of the primary one
            </div>
          </div>
          <span className="text-brand-400 font-mono text-xs opacity-0 group-hover:opacity-100 transition-opacity">
            new +
          </span>
        </button>
      ) : (
        <>
          <div className="space-y-2">
            {extras.map((layer, index) => (
              <ExtraLayerCard
                key={layer.id}
                layer={layer}
                index={index}
                isExpanded={!!expanded[layer.id]}
                onToggle={() => toggleExpanded(layer.id)}
                onDelete={() => {
                  handleDelete(layer.id);
                  onExtraLayerAssetChanged?.(layer.id, null);
                }}
                onUpdate={(patch) => updateLayer(layer.id, patch)}
                onAssetChanged={(asset) => onExtraLayerAssetChanged?.(layer.id, asset)}
                baseSize={baseSize}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleAdd}
            className="w-full py-1.5 flex items-center justify-center gap-2 text-xs font-medium text-gray-300 bg-gray-900/60 border border-gray-800 hover:border-brand-500/40 hover:bg-brand-500/[0.06] hover:text-brand-300 rounded-md transition-colors"
          >
            <Plus size={14} /> Add another pattern
          </button>
        </>
      )}
    </div>
  );
};

interface ExtraLayerCardProps {
  layer: PatternLayer;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<PatternLayer>) => void;
  onAssetChanged?: (asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' | 'stl' } | null) => void;
  baseSize: number;
}

const ExtraLayerCard: React.FC<ExtraLayerCardProps> = ({
  layer,
  index,
  isExpanded,
  onToggle,
  onDelete,
  onUpdate,
  onAssetChanged,
  baseSize,
}) => {
  const layerName = `Layer ${index + 2}`; // Primary is layer 1
  const tileCount = layer.shapes ? layer.shapes.length : 0;

  const calculateAutoScale = (
    shapes: any[],
    type: string | null,
    tiled: boolean,
    bSize: number,
    margin: number
  ): number | null => {
    if (!shapes || shapes.length === 0) return null;
    let width = 0;
    let height = 0;
    if (type === "stl") {
      const geometry = shapes[0];
      if (geometry.boundingBox === null) geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      width = bounds.max.x - bounds.min.x;
      height = bounds.max.y - bounds.min.y;
    } else {
      const bounds = getShapesBounds(shapes);
      width = bounds.size.x;
      height = bounds.size.y;
    }
    if (width <= 0 || height <= 0) return null;
    if (tiled) {
      const targetWidth = 10;
      const rawScale = targetWidth / width;
      const scale = Math.round(rawScale * 100) / 100;
      return scale > 0 ? scale : 1;
    } else {
      const maxSize = Math.max(width, height);
      if (maxSize > 0) {
        const availableSize = Math.max(0, bSize - margin * 2);
        const scale = (availableSize * 0.5) / maxSize;
        const roundedScale = Math.round(scale * 100) / 100;
        return roundedScale > 0 ? roundedScale : 1;
      }
    }
    return 1;
  };

  const handleShapeUpload = (
    shapes: any[],
    name?: string | null,
    type?: "dxf" | "svg" | "stl",
    content?: string | ArrayBuffer
  ) => {
    const pType = type ?? null;
    const newScale = calculateAutoScale(
      shapes,
      pType,
      layer.isTiled,
      baseSize,
      layer.margin
    );
    onUpdate({
      shapes,
      type: pType,
      assetName: name ?? layer.assetName,
      ...(newScale !== null ? { scale: newScale } : {}),
    });
    // Capture the source bytes so the layer round-trips through 3MF /
    // .zip export. Without this, exported projects load with the
    // settings but no live shapes for the layer.
    if (onAssetChanged && name && content && type) {
      onAssetChanged({ name, content, type });
    }
  };

  return (
    <div
      className={`rounded-lg border transition-all ${
        isExpanded
          ? "bg-gray-900/60 border-gray-700"
          : "bg-gray-900/40 border-gray-800 hover:border-gray-700"
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={onToggle}
          className="text-gray-500 hover:text-gray-300 transition-colors"
          aria-label={isExpanded ? "Collapse layer" : "Expand layer"}
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>

        <span className="text-[10px] font-mono text-gray-500 w-5">
          {String(index + 2).padStart(2, "0")}
        </span>

        <span
          className="w-3 h-3 rounded-sm flex-shrink-0 ring-1 ring-black/40"
          style={{ backgroundColor: layer.color }}
          aria-hidden
        />

        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left truncate text-sm font-display tracking-wide text-gray-200 hover:text-brand-200 transition-colors"
        >
          {layerName}
        </button>

        <span className="text-[10px] font-mono text-gray-500">
          {tileCount > 0 ? `${tileCount} item${tileCount === 1 ? "" : "s"}` : "empty"}
        </span>

        <button
          type="button"
          onClick={onDelete}
          className="p-1 rounded text-gray-500 hover:bg-signal-error/15 hover:text-signal-error transition-colors"
          title="Delete layer"
          aria-label={`Delete ${layerName}`}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-800 space-y-3">
          <ShapeUploader
            label="Pattern Geometry"
            shapes={layer.shapes && layer.shapes.length > 0 ? layer.shapes : null}
            fileName={layer.assetName ?? null}
            onUpload={(shapes, name, type, content) =>
              handleShapeUpload(shapes, name, type, content)
            }
            onClear={() => {
              onUpdate({ shapes: [], type: null, assetName: undefined });
              onAssetChanged?.(null);
            }}
            allowedTypes={["stl"]}
          />

          {layer.shapes && layer.shapes.length > 0 && (
            <>
              {/* Tile / Place toggle */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-300">Mode</label>
                <SegmentedControl
                  value={layer.isTiled ? "tile" : "place"}
                  onChange={(val) => {
                    const newIsTiled = val === "tile";
                    const newScale = calculateAutoScale(
                      layer.shapes ?? [],
                      layer.type,
                      newIsTiled,
                      baseSize,
                      layer.margin
                    );
                    onUpdate({
                      isTiled: newIsTiled,
                      ...(newScale !== null ? { scale: newScale } : {}),
                    });
                  }}
                  options={[
                    { value: "tile", label: "Tile", icon: <Grid3x3 size={16} /> },
                    {
                      value: "place",
                      label: "Place",
                      icon: <MousePointer2 size={16} />,
                    },
                  ]}
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1 min-w-0">
                  <ControlField
                    label="Scale X/Y"
                    action={
                      <button
                        type="button"
                        onClick={() => {
                          const newScale = calculateAutoScale(
                            layer.shapes ?? [],
                            layer.type,
                            layer.isTiled,
                            baseSize,
                            layer.margin
                          );
                          if (newScale !== null) onUpdate({ scale: newScale });
                        }}
                        className="text-gray-400 hover:text-brand-400 transition-colors"
                        title={
                          layer.isTiled
                            ? "Auto Scale Tile Pattern"
                            : "Auto Scale to Fit"
                        }
                      >
                        <Maximize size={14} />
                      </button>
                    }
                  >
                    <NumberStepper
                      value={layer.scale}
                      onChange={(val) => {
                        let patch: Partial<PatternLayer> = { scale: val };
                        if (layer.scaleZ !== "" && layer.scale > 0) {
                          const ratio = val / layer.scale;
                          const newZ = Number(layer.scaleZ) * ratio;
                          patch.scaleZ = Math.round(newZ * 1000) / 1000;
                        }
                        onUpdate(patch);
                      }}
                      step={0.1}
                      precision={2}
                      min={0.01}
                      aria-label={`${layerName} scale X/Y`}
                    />
                  </ControlField>
                </div>

                <div className="flex-1 min-w-0">
                  <ControlField
                    label="Scale Z"
                    tooltip="Leave empty to match X/Y scale"
                  >
                    <DebouncedInput
                      type="number"
                      value={layer.scaleZ}
                      onChange={(val) =>
                        onUpdate({ scaleZ: val === "" ? "" : Number(val) })
                      }
                      placeholder="Auto"
                      min={0.1}
                      step={0.05}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none"
                    />
                  </ControlField>
                </div>

                <div className="flex-1 min-w-0">
                  <ControlField label="Rotate" tooltip="Base rotation in degrees">
                    <NumberStepper
                      value={layer.rotation ?? 0}
                      onChange={(val) => onUpdate({ rotation: val })}
                      step={15}
                      unit="°"
                      aria-label={`${layerName} rotation`}
                    />
                  </ControlField>
                </div>
              </div>

              <div className="flex gap-4 pt-2 border-t border-gray-800">
                <div className="flex-1 min-w-0">
                  <ControlField
                    label="Max Height"
                    tooltip="Cut pattern above this height (mm)"
                  >
                    <DebouncedInput
                      type="number"
                      value={layer.maxHeight ?? ""}
                      onChange={(val) =>
                        onUpdate({
                          maxHeight: val === "" ? undefined : Number(val),
                        })
                      }
                      placeholder="Auto"
                      min={0}
                      step={0.1}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none"
                    />
                  </ControlField>
                </div>
                <div className="flex-1 min-w-0">
                  <ControlField
                    label="Margin"
                    tooltip="Safety margin from edge"
                  >
                    <NumberStepper
                      value={layer.margin}
                      onChange={(val) => onUpdate({ margin: val })}
                      step={0.5}
                      min={0}
                      unit="mm"
                      aria-label={`${layerName} margin`}
                    />
                  </ControlField>
                </div>
              </div>

              {layer.isTiled && (
                <>
                  <div className="pt-2 border-t border-gray-800">
                    <ControlField
                      label="Spacing"
                      tooltip="Distance between tiled patterns"
                    >
                      <NumberStepper
                        value={layer.tileSpacing ?? 10}
                        onChange={(val) => onUpdate({ tileSpacing: val })}
                        step={1}
                        min={0}
                        unit="mm"
                        aria-label={`${layerName} spacing`}
                      />
                    </ControlField>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex-1 min-w-0">
                      <ControlField label="Distribution">
                        <div className="relative">
                          <select
                            value={layer.distribution}
                            onChange={(e) =>
                              onUpdate({ distribution: e.target.value as any })
                            }
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none appearance-none truncate"
                          >
                            <option value="grid">Grid</option>
                            <option value="offset">Offset</option>
                            <option value="hex">Hex</option>
                            <option value="radial">Radial</option>
                            <option value="wave">Wave</option>
                            <option value="zigzag">Zigzag</option>
                            <option value="warped-grid">Warped Grid</option>
                            <option value="random">Random</option>
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                            <ChevronDown size={16} />
                          </div>
                        </div>
                      </ControlField>
                    </div>

                    {(layer.distribution === "wave" ||
                      layer.distribution === "zigzag") && (
                      <div className="flex-1 min-w-0">
                        <ControlField label="Direction">
                          <div className="relative">
                            <select
                              value={layer.direction}
                              onChange={(e) =>
                                onUpdate({ direction: e.target.value as any })
                              }
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none appearance-none truncate"
                            >
                              <option value="horizontal">Horizontal</option>
                              <option value="vertical">Vertical</option>
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                              <ChevronDown size={16} />
                            </div>
                          </div>
                        </ControlField>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-4">
                    <div className="flex-1 min-w-0">
                      <ControlField label="Orientation">
                        <div className="relative">
                          <select
                            value={layer.orientation}
                            onChange={(e) =>
                              onUpdate({ orientation: e.target.value as any })
                            }
                            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none appearance-none truncate"
                          >
                            <option value="none">None</option>
                            <option value="alternate">Alternate</option>
                            <option value="aligned">Aligned</option>
                            <option value="random">Random</option>
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                            <ChevronDown size={16} />
                          </div>
                        </div>
                      </ControlField>
                    </div>

                    <div className="flex-1 min-w-0">
                      <ControlField
                        label="Clamp"
                        tooltip="Snap rotation increments"
                      >
                        <DebouncedInput
                          type="number"
                          value={layer.rotationClamp ?? ""}
                          onChange={(val) =>
                            onUpdate({
                              rotationClamp:
                                val === "" ? undefined : Number(val),
                            })
                          }
                          placeholder="None"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none"
                        />
                      </ControlField>
                    </div>
                  </div>
                </>
              )}

              {/* Color */}
              <div className="space-y-2 pt-2 border-t border-gray-800">
                <label className="text-sm font-medium text-gray-300">
                  Color
                </label>
                <div className="grid grid-cols-7 gap-y-2 p-1.5 bg-gray-800 rounded-lg border border-gray-700 w-full justify-items-center">
                  {Object.entries(COLORS).map(([name, value]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onUpdate({ color: value })}
                      className={`w-6 h-6 rounded-md transition-all hover:scale-110 active:scale-95 ${
                        layer.color === value
                          ? "ring-2 ring-white"
                          : "hover:ring-1 hover:ring-white/50"
                      }`}
                      style={{ backgroundColor: value }}
                      title={name}
                    />
                  ))}
                </div>
              </div>

              {layer.removedTiles && layer.removedTiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => onUpdate({ removedTiles: [] })}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-mono text-gray-400 hover:text-brand-300 transition-colors"
                >
                  <RotateCcw size={12} />
                  Restore {layer.removedTiles.length}{" "}
                  {layer.removedTiles.length === 1 ? "tile" : "tiles"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default GeometryControls;
