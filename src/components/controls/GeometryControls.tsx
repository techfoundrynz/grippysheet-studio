import React, { useState } from "react";
import { GeometrySettings } from "../../types/schemas";
import {
  BookOpen,
  Grid3x3,
  MousePointer2,
  Maximize,
  ChevronDown,
  Scissors,
} from "lucide-react";
import { COLORS } from "../../constants/colors";
import ShapeUploader from "../ShapeUploader";
import ControlField from "../ui/ControlField";
import DebouncedInput from "../DebouncedInput";
import SegmentedControl from "../ui/SegmentedControl";
import ToggleButton from "../ui/ToggleButton";
import PatternLibraryModal from "../PatternLibraryModal";
import { useAlert } from "../../context/AlertContext";
import { STLLoader } from "three-stdlib";
import { getShapesBounds } from "../../utils/patternUtils";

interface GeometryControlsProps {
  settings: GeometrySettings;
  updateSettings: (updates: Partial<GeometrySettings>) => void;
  baseSize: number;
}

const GeometryControls: React.FC<GeometryControlsProps> = ({
  settings,
  updateSettings,
  baseSize,
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
        return scale > 0 ? scale : 1;
      }
    }
    return 1;
  };

  const handlePatternLoaded = (shapes: any[], type?: "dxf" | "svg" | "stl") => {
    const pType = type || null;
    const newScale = calculateAutoPatternScale(
      shapes,
      pType,
      isTiled,
      baseSize,
      patternMargin
    );

    console.log("[GeometryControls] Pattern Loaded:", {
      type,
      isTiled,
      newScale,
      shapeCount: shapes.length,
    });

    updateSettings({
      patternShapes: shapes,
      patternType: pType,
      ...(newScale !== null ? { patternScale: newScale } : {}),
    });
  };

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <ShapeUploader
        label="Upload Grip Geometry"
        shapes={
          patternShapes && patternShapes.length > 0 ? patternShapes : null
        }
        fileName={libraryPatternName}
        onUpload={(shapes, name, type) => {
          handlePatternLoaded(shapes, type);
          setLibraryPatternName(name);
        }}
        onClear={() => {
          updateSettings({
            patternShapes: [],
            patternType: null,
          });
          setLibraryPatternName(null);
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
          try {
            const response = await fetch(`/${preset.category}/${preset.file}`);
            const buffer = await response.arrayBuffer();

            let shapes: any[] = [];

            if (preset.type === "stl") {
              const loader = new STLLoader();
              const geometry = loader.parse(buffer);
              geometry.center(); // Auto-center STLs
              shapes = [geometry];
            }

            handlePatternLoaded(shapes, preset.type);
            setLibraryPatternName(preset.name);
          } catch (error) {
            console.error("Failed to load pattern:", error);
            showAlert({
              title: "Error Loading Pattern",
              message: "Failed to load the selected pattern preset.",
              type: "error",
            });
          }
        }}
      />

      {patternShapes && patternShapes.length > 0 && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
              Layout Mode
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
                      className="text-gray-400 hover:text-purple-400 transition-colors"
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
                <DebouncedInput
                  type="number"
                  value={patternScale}
                  onChange={(val) => {
                    const newScale = Number(val);
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
                  step="0.1"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
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
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </ControlField>
            </div>

            <div className="space-y-2 flex-1 min-w-0">
              <ControlField label="Rotate" tooltip="Base rotation in degrees">
                <DebouncedInput
                  type="number"
                  value={baseRotation ?? 0}
                  onChange={(val) =>
                    updateSettings({ baseRotation: Number(val) })
                  }
                  step="15"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
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
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
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
                <DebouncedInput
                  type="number"
                  value={tileSpacing}
                  onChange={(val) =>
                    updateSettings({ tileSpacing: Number(val) })
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
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
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none truncate"
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
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none truncate"
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
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none truncate"
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
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                    />
                  </ControlField>
                </div>
              </div>
            </>
          )}

          {/* Margin & Clip Toggles */}
          <div className="flex gap-4 pt-2 border-t border-gray-800">
            <div className="flex-1 min-w-0">
              <ControlField label="Margin" tooltip="Safety margin from edge">
                <DebouncedInput
                  type="number"
                  value={patternMargin}
                  onChange={(val) =>
                    updateSettings({ patternMargin: Number(val) })
                  }
                  step="0.5"
                  min="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </ControlField>
            </div>

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
    </section>
  );
};

export default GeometryControls;
