import React, { useState } from "react";
import { InlaySettings } from "../../types/schemas";
import { Palette, BookOpen, Maximize, FlipHorizontal } from "lucide-react";
import ShapeUploader from "../ShapeUploader";
import ControlField from "../ui/ControlField";
import DebouncedInput from "../DebouncedInput";
import ToggleButton from "../ui/ToggleButton";
import PatternLibraryModal from "../PatternLibraryModal";
import SVGPaintModal from "../SVGPaintModal";
import { useAlert } from "../../context/AlertContext";
import { SVGLoader } from "three-stdlib"; // Ensure three-stdlib is installed or available
import { centerShapes, calculateInlayScale } from "../../utils/patternUtils"; // Adjust path
import { parseDxfToShapes } from "../../utils/dxfUtils";

interface InlayControlsProps {
  settings: InlaySettings;
  updateSettings: (updates: Partial<InlaySettings>) => void;
  cutoutShapes: any[] | null | undefined;
  baseSize: number;
  baseColor: string;
}

const InlayControls: React.FC<InlayControlsProps> = ({
  settings,
  updateSettings,
  cutoutShapes,
  baseSize,
  baseColor,
}) => {
  const { showAlert } = useAlert();
  const {
    inlayShapes,
    inlayDepth,
    inlayScale,
    inlayRotation,
    inlayExtend,
    inlayMirror,
  } = settings;

  const [showPaintModal, setShowPaintModal] = useState(false);
  const [showInlayLibrary, setShowInlayLibrary] = useState(false);
  const [libraryInlayName, setLibraryInlayName] = useState<string | null>(null);
  const [originalInlayShapes, setOriginalInlayShapes] = useState<any[]>([]);

  // Local helper to bundle logic that was previously in Controls.tsx
  const handleInlayLoaded = (shapes: any[], name: string | null = null) => {
    // 1. Calculate Scale
    const scale = calculateInlayScale(shapes, cutoutShapes || null, baseSize);

    // 2. Set State
    setOriginalInlayShapes(shapes);
    setLibraryInlayName(name);

    updateSettings({
      inlayScale: scale,
      inlayShapes: shapes,
    });
  };

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <ShapeUploader
        label="Upload Inlay Pattern"
        shapes={inlayShapes && inlayShapes.length > 0 ? inlayShapes : null}
        fileName={libraryInlayName}
        onUpload={(shapes, name) => handleInlayLoaded(shapes, name)}
        onClear={() => {
          setOriginalInlayShapes([]);
          updateSettings({ inlayShapes: [] });
          setLibraryInlayName(null);
        }}
        allowedTypes={["svg", "dxf"]}
        extractColors={true}
        adornment={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowPaintModal(true)}
              className={
                "p-1 rounded-lg transition-colors border bg-gray-700/50 hover:bg-gray-700 text-gray-400 hover:text-white border-gray-600 hover:border-gray-500"
              }
              title="Paint/Draw Inlay"
            >
              <Palette size={12} />
            </button>
            <button
              onClick={() => setShowInlayLibrary(true)}
              className={
                "p-1 rounded-lg transition-colors border bg-gray-700/50 hover:bg-gray-700 text-gray-400 hover:text-white border-gray-600 hover:border-gray-500"
              }
              title="Open Inlay Library"
            >
              <BookOpen size={12} />
            </button>
          </div>
        }
      />

      <PatternLibraryModal
        isOpen={showInlayLibrary}
        onClose={() => setShowInlayLibrary(false)}
        category="inlays"
        onSelect={async (preset) => {
          setShowInlayLibrary(false);
          try {
            const response = await fetch(`/${preset.category}/${preset.file}`);
            const text = await response.text();

            let shapes: any[] = [];

            if (preset.type === "svg") {
              const loader = new SVGLoader();
              const data = loader.parse(text);

              data.paths.forEach((path) => {
                const fillColor = path.userData?.style?.fill;
                const color =
                  fillColor && fillColor !== "none"
                    ? fillColor
                    : path.color && path.color.getStyle(); // fallback to path color

                const subShapes = path.toShapes(true); // isCCW

                subShapes.forEach((s) => {
                  shapes.push({ shape: s, color: color || "#000000" });
                });
              });

              // Center shapes logic needs to handle objects or shapes
              const rawShapes = shapes.map((item) => item.shape);
              const centered = centerShapes(rawShapes, true);
              shapes = shapes.map((item, i) => ({
                ...item,
                shape: centered[i],
              }));
            } else if (preset.type === "dxf") {
              const rawShapes = parseDxfToShapes(text);
              const centered = centerShapes(rawShapes, true);
              shapes = centered.map((s) => ({ shape: s, color: "#000000" }));
            }

            handleInlayLoaded(shapes, preset.name);
          } catch (error) {
            console.error("Failed to load pattern:", error);
            showAlert({
              title: "Error Loading Inlay",
              message: "Failed to load the selected inlay preset.",
              type: "error",
            });
          }
        }}
      />

      <SVGPaintModal
        isOpen={showPaintModal}
        onClose={() => setShowPaintModal(false)}
        shapes={inlayShapes || []}
        baseColor={baseColor}
        onSave={(newShapes) => {
          // If standalone mode (no original shapes), center the drawing
          let finalShapes = newShapes;
          if (!originalInlayShapes || originalInlayShapes.length === 0) {
            // newShapes is array of objects { shape, color }
            const rawShapes = newShapes.map((s: any) => s.shape || s);
            const centered = centerShapes(rawShapes, false); // FlipY false to prevent mirroring on reload
            finalShapes = newShapes.map((s: any, i: number) => ({
              ...s,
              shape: centered[i],
            }));
          }

          handleInlayLoaded(finalShapes);
        }}
      />

      {inlayShapes && inlayShapes.length > 0 && (
        <>
          <ControlField
            label="Scale"
            tooltip="Resize the inlay pattern relative to original"
            action={
              <button
                onClick={() => {
                  const scale = calculateInlayScale(
                    inlayShapes || [],
                    cutoutShapes || null,
                    baseSize
                  );
                  updateSettings({ inlayScale: scale });
                }}
                className="text-gray-400 hover:text-purple-400 transition-colors"
                title="Auto Scale to Fit"
              >
                <Maximize size={14} />
              </button>
            }
          >
            <DebouncedInput
              type="number"
              value={inlayScale}
              onChange={(val) => {
                const num = Number(val);
                if (!isNaN(num) && num !== 0) {
                  updateSettings({ inlayScale: num });
                }
              }}
              step="0.1"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
            />
          </ControlField>

          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <ControlField
                label="Rotation (deg)"
                tooltip="Rotate the inlay pattern"
              >
                <DebouncedInput
                  type="number"
                  value={inlayRotation}
                  onChange={(val) =>
                    updateSettings({ inlayRotation: Number(val) })
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </ControlField>
            </div>
            <div className="flex-1 min-w-0">
              <ControlField
                label="Mirror"
                tooltip="Flip the inlay horizontally"
              >
                <ToggleButton
                  label={inlayMirror ? "Enabled" : "Disabled"}
                  isToggled={!!inlayMirror}
                  onToggle={() => updateSettings({ inlayMirror: !inlayMirror })}
                  icon={<FlipHorizontal size={16} />}
                />
              </ControlField>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <ControlField
                label="Inlay Depth (mm)"
                tooltip="How deep the inlay cuts into the base"
              >
                <DebouncedInput
                  type="number"
                  value={inlayDepth}
                  onChange={(val) =>
                    updateSettings({ inlayDepth: Number(val) })
                  }
                  step="0.1"
                  min="0.1"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </ControlField>
            </div>
            <div className="flex-1 min-w-0">
              <ControlField
                label="Inlay Extend (mm)"
                tooltip="Extra width added to the cut for tighter/looser fit"
              >
                <DebouncedInput
                  type="number"
                  value={inlayExtend}
                  onChange={(val) =>
                    updateSettings({ inlayExtend: Number(val) })
                  }
                  step="0.1"
                  min="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </ControlField>
            </div>
          </div>
        </>
      )}
    </section>
  );
};

export default InlayControls;
