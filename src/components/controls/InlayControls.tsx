import React, { useState, useEffect } from "react";
import { InlaySettings, InlayItem } from "../../types/schemas";
import {
  Palette,
  BookOpen,
  Maximize,
  FlipHorizontal,
  Plus,
  Trash2,
  GripVertical,
  Grid3x3,
  MousePointer2,
  ChevronDown,
  Layers as LayersIcon,
} from "lucide-react";
import ShapeUploader from "../ShapeUploader";
import ControlField from "../ui/ControlField";
import NumberStepper from "../ui/NumberStepper";
import SegmentedControl from "../ui/SegmentedControl";
import ToggleButton from "../ui/ToggleButton";
import PatternLibraryModal from "../PatternLibraryModal";
import SVGPaintModal from "../SVGPaintModal";
import { useAlert } from "../../context/AlertContext";
import { centerShapes, calculateInlayScale, calculateInlayOffset } from "../../utils/patternUtils";
import { parseShapeFile } from "../../utils/shapeLoader";
import { v4 as uuidv4 } from "uuid";

interface InlayControlsProps {
  settings: InlaySettings;
  updateSettings: (updates: Partial<InlaySettings>) => void;
  cutoutShapes: any[] | null | undefined;
  baseSize: number;
  baseThickness: number;
  baseColor: string;
  selectedInlayId: string | null;
  setSelectedInlayId: (id: string | null) => void;
  onInlayAssetChanged?: (id: string, asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' | 'stl' } | null) => void;
}

const InlayControls: React.FC<InlayControlsProps> = ({
  settings,
  updateSettings,
  cutoutShapes,
  baseSize,
  baseThickness,
  baseColor,
  selectedInlayId,
  setSelectedInlayId,
  onInlayAssetChanged,
}) => {
  // Max allowed depth = thickness - 0.1mm (must always leave a floor)
  const maxDepth = Math.max(0.1, parseFloat((baseThickness - 0.1).toFixed(2)));
  const { showAlert } = useAlert();
  const { items } = settings;

  const [showPaintModal, setShowPaintModal] = useState(false);
  const [showInlayLibrary, setShowInlayLibrary] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Auto-select first item if none selected and items exist
  useEffect(() => {
    if (!selectedInlayId && items && items.length > 0) {
      setSelectedInlayId(items[0].id);
    } else if (items.length === 0 && selectedInlayId) {
      setSelectedInlayId(null);
    }
  }, [items && items.length]);

  // When base thickness changes, clamp any items whose depth now exceeds the new max
  useEffect(() => {
    if (!items || items.length === 0) return;
    const newMax = Math.max(0.1, parseFloat((baseThickness - 0.1).toFixed(2)));
    const clamped = items.map(item => {
      const d = item.depth ?? 0.6;
      return d > newMax ? { ...item, depth: newMax } : item;
    });
    const anyChanged = clamped.some((item, i) => item !== items[i]);
    if (anyChanged) updateSettings({ items: clamped });
  }, [baseThickness]);

  const selectedItem = items?.find((i) => i.id === selectedInlayId);

  // Helper to update specific item
  const updateItem = (id: string, updates: Partial<InlayItem>) => {
    const newItems = items.map((item) =>
      item.id === id ? { ...item, ...updates } : item
    );
    updateSettings({ items: newItems });
  };

  // Create a new empty layer
  const handleAddLayer = () => {
    const newItem: InlayItem = {
      id: uuidv4(),
      name: "New Layer",
      shapes: [],
      scale: 1,
      rotation: 0,
      mirror: false,
      x: 0,
      y: 0,
      depth: 0.6,
      extend: 0,
      positionPreset: 'center',
    };

    updateSettings({ items: [...items, newItem] });
    setSelectedInlayId(newItem.id);
  };

  // Update shapes for EXISTING or NEW item
  const handleShapeUpload = (shapes: any[], name: string | null = null, type?: 'dxf'|'svg'|'stl', content?: string | ArrayBuffer) => {
    if (selectedInlayId) {
      // Update currently selected
      const currentItem = items.find(i => i.id === selectedInlayId);

      let scale = currentItem?.scale;
      // Only auto-scale if this is the first time adding shapes to this layer
      // (Preserve scale if user is just editing/updating existing shapes)
      if (!currentItem?.shapes || currentItem.shapes.length === 0) {
           scale = calculateInlayScale(shapes, cutoutShapes || null, baseSize);
      }

      updateItem(selectedInlayId, { shapes, scale, name: name || "Custom Pattern" });
      if (onInlayAssetChanged && name && content && type) {
          onInlayAssetChanged(selectedInlayId, { name, content, type });
      }
    } else {
      // Fallback: Create new
      const scale = calculateInlayScale(shapes, cutoutShapes || null, baseSize);
      const newItem: InlayItem = {
        id: uuidv4(),
        name: name || "Custom Pattern",
        shapes: shapes,
        scale: scale,
        rotation: 0,
        mirror: false,
        x: 0,
        y: 0,
        depth: 0.6,
        extend: 0,
        positionPreset: 'center',
      };
      updateSettings({ items: [...items, newItem] });
      setSelectedInlayId(newItem.id);
      if (onInlayAssetChanged && name && content && type) {
          onInlayAssetChanged(newItem.id, { name, content, type });
      }
    }
  };

  const handleDeleteItem = (id: string) => {
    const newItems = items.filter((i) => i.id !== id);
    updateSettings({ items: newItems });
    if (selectedInlayId === id) setSelectedInlayId(null);
    if (onInlayAssetChanged) onInlayAssetChanged(id, null);
  };

  // Handle layer reordering
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newItems = [...items];
    const [draggedItem] = newItems.splice(draggedIndex, 1);
    newItems.splice(dropIndex, 0, draggedItem);

    updateSettings({ items: newItems });
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Empty-state CTA — mirrors BaseControls' "Pick an outline" gradient + glow
  // when there's nothing to show yet. Once the user adds their first layer,
  // we fall back to the compact list + small "Add Inlay Layer" button.
  const hasItems = items.length > 0;

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100">
            <span className="text-xs font-mono text-gray-500">01</span>
            <span>Layers</span>
          </h3>
          {hasItems && (
            <span className="text-[10px] font-mono text-gray-500">
              <span className="text-signal-ready">{items.length}</span> {items.length === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>

        {!hasItems ? (
          // First-run CTA. Dashed brand-orange border + glow + display-font
          // headline to match BaseControls' "Pick an outline" treatment.
          <button
            type="button"
            onClick={handleAddLayer}
            className="group w-full flex items-center gap-3 px-4 py-4 rounded-lg border-2 border-dashed border-brand-500/40 hover:border-brand-500 bg-gradient-to-br from-brand-500/10 to-accent-500/10 hover:from-brand-500/15 hover:to-accent-500/15 shadow-glow-brand transition-all"
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-brand-500/20 group-hover:bg-brand-500/30 text-brand-400 group-hover:text-brand-300 transition-colors">
              <LayersIcon size={20} />
            </div>
            <div className="flex-1 text-left">
              <div className="font-display font-semibold text-sm tracking-wide text-gray-100">
                Add Inlay Layer
              </div>
              <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                logos · badges · decorative cutouts
              </div>
            </div>
            <span className="text-brand-400 font-mono text-xs opacity-0 group-hover:opacity-100 transition-opacity">
              new +
            </span>
          </button>
        ) : (
          <>
            <div className="space-y-1 max-h-40 overflow-y-auto mb-2">
              {items.map((item, index) => {
                const isActive = selectedInlayId === item.id;
                const isEmpty = !item.shapes || item.shapes.length === 0;
                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                    onClick={() => setSelectedInlayId(item.id)}
                    className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-all ${
                      isActive
                        ? "bg-brand-500/15 ring-1 ring-brand-500/40 shadow-glow-brand"
                        : "bg-gray-900/40 border border-gray-800 hover:border-gray-700 hover:bg-gray-900/60"
                    } ${
                      dragOverIndex === index && draggedIndex !== index
                        ? "border-t-2 border-t-brand-500"
                        : ""
                    } ${
                      draggedIndex === index ? "opacity-50" : ""
                    }`}
                  >
                    <div
                      className="cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <GripVertical size={14} />
                    </div>
                    <span
                      className={`truncate flex-1 text-sm font-display tracking-wide ${
                        isActive ? "text-brand-200" : "text-gray-200"
                      }`}
                    >
                      {item.name || `Inlay ${index + 1}`}
                      {isEmpty && (
                        <span className="ml-1.5 text-[10px] font-mono text-gray-500">
                          empty
                        </span>
                      )}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteItem(item.id);
                      }}
                      className="p-1 rounded text-gray-500 hover:bg-signal-error/15 hover:text-signal-error transition-colors"
                      title="Delete Layer"
                      aria-label={`Delete ${item.name || `Inlay ${index + 1}`}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              onClick={handleAddLayer}
              className="w-full py-1.5 flex items-center justify-center gap-2 text-xs font-medium text-gray-300 bg-gray-900/60 border border-gray-800 hover:border-brand-500/40 hover:bg-brand-500/[0.06] hover:text-brand-300 rounded-md transition-colors"
            >
              <Plus size={14} /> Add Inlay Layer
            </button>
          </>
        )}
      </div>

      <PatternLibraryModal
        isOpen={showInlayLibrary}
        onClose={() => setShowInlayLibrary(false)}
        category="inlays"
        onSelect={async (preset) => {
          setShowInlayLibrary(false);
          try {
            const response = await fetch(`/${preset.category}/${preset.file}`);
            const text = await response.text();

            // Use shared loader logic
            const result = parseShapeFile(text, preset.type as 'dxf'|'svg', true); // Inlays usually want colors? Yes, see previous logic.

            if (result.success) {
                // IMPORTANT: Ensure the type passed to handleShapeUpload matches what was actually parsed.
                // parseShapeFile might detect a different type, but it doesn't return the detected type.
                // Use robust detection here too or rely on the preset type IF it was correct.
                // But the source of error was likely preset type mismatch.
                // Let's implement a quick check or trust parseShapeFile handles the parsing,
                // but we MUST pass the correct type to handleShapeUpload so it saves correctly?

                // If the preset says DXF but content is SVG, parseShapeFile (now updated) handles it and returns correct shapes.
                // But we still pass 'dxf' to handleShapeUpload?
                // Then the asset is saved as 'dxf'.
                // Then on import, parseShapeFile encounters 'dxf' type but SVG content.
                // Thanks to my update to shapeLoader, this will NOW work on import too!
                // So passing preset.type is "fine" for now, even if technically wrong label.

                // However, let's try to pass the real type if we can sniff it here too?
                let realType = preset.type;
                if (text.trim().startsWith('<svg') || text.trim().startsWith('<?xml')) realType = 'svg';

                handleShapeUpload(result.shapes, preset.name, realType as any, text);
            } else {
                 throw new Error(result.error);
            }
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
        shapes={selectedItem?.shapes || []}
        baseColor={baseColor}
        onSave={(newShapes) => {
          // newShapes is array of objects { shape, color }
          const rawShapes = newShapes.map((s: any) => s.shape || s);
          const centered = centerShapes(rawShapes, false);
          const finalShapes = newShapes.map((s: any, i: number) => ({
            ...s,
            shape: centered[i],
          }));
          handleShapeUpload(finalShapes, selectedItem?.name ?? "Painted Inlay");
        }}
      />

      {selectedItem && (
        <>
          <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100 mt-1">
            <span className="text-xs font-mono text-gray-500">02</span>
            <span>Pattern</span>
            <span className="text-[10px] font-mono text-gray-500 ml-auto">SVG · DXF</span>
          </h3>

          <ShapeUploader
            label={"Inlay Pattern"}
            shapes={selectedItem?.shapes || null}
            fileName={selectedItem?.name || null}
            onUpload={(shapes, name, type, content) => handleShapeUpload(shapes, name, type, content)}
            onClear={() => {
                if (selectedInlayId) {
                    updateItem(selectedInlayId, { shapes: [], valid: false });
                    if (onInlayAssetChanged) onInlayAssetChanged(selectedInlayId, null);
                }
            }}
            allowedTypes={["svg", "dxf"]}
            extractColors={true}
            adornment={
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowPaintModal(true)}
                  className="p-1 rounded-lg transition-colors border bg-gray-700/50 hover:bg-gray-700 text-gray-400 hover:text-white border-gray-600 hover:border-gray-500"
                  title="Paint/Draw Inlay"
                >
                  <Palette size={12} />
                </button>
                <button
                  onClick={() => setShowInlayLibrary(true)}
                  className="p-1 rounded-lg transition-colors border bg-gray-700/50 hover:bg-gray-700 text-gray-400 hover:text-white border-gray-600 hover:border-gray-500"
                  title="Open Inlay Library"
                >
                  <BookOpen size={12} />
                </button>
              </div>
            }
          />
          <ControlField
            label="Scale"
            tooltip="Resize the inlay pattern"
            action={
              <button
                onClick={() => {
                  const newScale = calculateInlayScale(
                    selectedItem.shapes,
                    cutoutShapes || null,
                    baseSize
                  );
                  const scale = Math.max(0.01, Math.round(newScale * 20) / 20);
                  updateItem(selectedItem.id, { scale: scale });
                }}
                className="text-gray-400 hover:text-brand-400 transition-colors"
                title="Auto Scale to Fit"
              >
                <Maximize size={14} />
              </button>
            }
          >
            <NumberStepper
              value={selectedItem.scale}
              onChange={(val) => {
                if (val !== 0) {
                  // Recalculate position if using a preset
                  if (selectedItem.positionPreset && selectedItem.positionPreset !== 'manual' && selectedItem.shapes && selectedItem.shapes.length > 0) {
                    const offset = calculateInlayOffset(
                      selectedItem.shapes,
                      cutoutShapes || null,
                      baseSize,
                      {
                        inlayScale: val,
                        inlayRotation: selectedItem.rotation || 0,
                        inlayMirror: selectedItem.mirror || false,
                        inlayPosition: selectedItem.positionPreset,
                      }
                    );
                    updateItem(selectedItem.id, { scale: val, x: offset.x, y: offset.y });
                  } else {
                    updateItem(selectedItem.id, { scale: val });
                  }
                }
              }}
              step={0.05}
              min={0.01}
              max={5}
              precision={2}
              aria-label="Inlay scale"
            />
          </ControlField>

          {/* Modifier — 4 fixed options, swap the dropdown for a SegmentedControl
              so it sits in the same design language as Layout Mode below. */}
          <div className="space-y-2 pt-2 border-t border-gray-800">
            <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100">
              <span className="text-xs font-mono text-gray-500">03</span>
              <span>Modifier</span>
              <span className="text-[10px] font-mono text-gray-500 ml-auto">how it interacts with the grip</span>
            </h3>
            <SegmentedControl
              value={selectedItem.modifier || 'none'}
              onChange={(val) => updateItem(selectedItem.id, { modifier: val as any })}
              options={[
                { value: 'none', label: 'None' },
                { value: 'cut', label: 'Cut' },
                { value: 'mask', label: 'Recolor' },
                { value: 'avoid', label: 'Avoid' },
              ]}
              aria-label="Inlay modifier"
            />
          </div>

          {/* Layout — place vs tile, position presets, manual X/Y. */}
          <div className="space-y-3 pt-2 border-t border-gray-800">
            <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100">
              <span className="text-xs font-mono text-gray-500">04</span>
              <span>Layout</span>
            </h3>

            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-300">
                Mode
              </label>
              <SegmentedControl
                value={selectedItem.mode || 'single'}
                onChange={(val) => {
                    updateItem(selectedItem.id, { mode: val as 'single' | 'tile' });
                }}
                options={[
                  { value: 'single', label: 'Place', icon: <MousePointer2 size={16} /> },
                  { value: 'tile', label: 'Tile', icon: <Grid3x3 size={16} /> },
                ]}
                aria-label="Layout mode"
              />
            </div>

            {/* Place Mode Controls */}
            {selectedItem.mode !== 'tile' && (
            <ControlField label="Position" tooltip="Choose a preset position or manual for custom X/Y">
              <div className="relative">
                <select
                  value={selectedItem.positionPreset || 'manual'}
                  onChange={(e) => {
                    const preset = e.target.value as any;

                    if (preset !== 'manual' && selectedItem.shapes && selectedItem.shapes.length > 0) {
                      const offset = calculateInlayOffset(
                        selectedItem.shapes,
                        cutoutShapes || null,
                        baseSize,
                        {
                          inlayScale: selectedItem.scale || 1,
                          inlayRotation: selectedItem.rotation || 0,
                          inlayMirror: selectedItem.mirror || false,
                          inlayPosition: preset,
                        }
                      );
                      updateItem(selectedItem.id, {
                        positionPreset: preset,
                        x: offset.x,
                        y: offset.y
                      });
                    } else {
                      updateItem(selectedItem.id, { positionPreset: preset });
                    }
                  }}
                  className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none appearance-none truncate"
                >
                  <option value="center">Center</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="top-left">Top Left</option>
                  <option value="top-right">Top Right</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="bottom-right">Bottom Right</option>
                  <option value="manual">Manual</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                  <ChevronDown size={16} />
                </div>
              </div>
            </ControlField>
            )}

            {/* Tiling Controls */}
            {selectedItem.mode === 'tile' && (
              <div className="flex gap-4">
                <div className="flex-1 min-w-0">
                  <ControlField label="Spacing" tooltip="Distance between tiled shapes">
                    <NumberStepper
                      value={selectedItem.tileSpacing ?? 0}
                      onChange={(val) =>
                        updateItem(selectedItem.id, { tileSpacing: val })
                      }
                      step={0.5}
                      min={0}
                      unit="mm"
                      aria-label="Tile spacing in millimetres"
                    />
                  </ControlField>
                </div>
                <div className="flex-1 min-w-0">
                  <ControlField label="Distribution" tooltip="Pattern layout style">
                    <div className="relative">
                      <select
                        value={selectedItem.tilingDistribution || 'grid'}
                        onChange={(e) => updateItem(selectedItem.id, { tilingDistribution: e.target.value as any })}
                        className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-brand-500/40 focus:border-transparent transition-all outline-none appearance-none truncate"
                      >
                        <option value="grid">Grid</option>
                        <option value="offset">Offset</option>
                        <option value="hex">Hexagonal</option>
                        <option value="radial">Radial</option>
                        <option value="random">Random</option>
                        <option value="wave">Wave</option>
                        <option value="zigzag">Zigzag</option>
                        <option value="warped-grid">Warped</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                        <ChevronDown size={16} />
                      </div>
                    </div>
                  </ControlField>
                </div>
              </div>
            )}

            {(selectedItem.positionPreset === 'manual') && (
              <div className="flex gap-4">
                <div className="flex-1 min-w-0">
                  <ControlField label="X">
                    <NumberStepper
                      value={selectedItem.x ?? 0}
                      onChange={(val) =>
                        updateItem(selectedItem.id, { x: val, positionPreset: 'manual' })
                      }
                      step={0.5}
                      unit="mm"
                      aria-label="X position in millimetres"
                    />
                  </ControlField>
                </div>
                <div className="flex-1 min-w-0">
                  <ControlField label="Y">
                    <NumberStepper
                      value={selectedItem.y ?? 0}
                      onChange={(val) =>
                        updateItem(selectedItem.id, { y: val, positionPreset: 'manual' })
                      }
                      step={0.5}
                      unit="mm"
                      aria-label="Y position in millimetres"
                    />
                  </ControlField>
                </div>
              </div>
            )}
          </div>

          {/* Transform — rotation + mirror */}
          <div className="space-y-3 pt-2 border-t border-gray-800">
            <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100">
              <span className="text-xs font-mono text-gray-500">05</span>
              <span>Transform</span>
            </h3>

            <div className="flex gap-4">
              <div className="flex-1 min-w-0">
                <ControlField
                  label="Rotation"
                  tooltip="Rotate the inlay pattern"
                >
                  <NumberStepper
                    value={selectedItem.rotation ?? 0}
                    onChange={(val) => {
                      // Recalculate position if using a preset
                      if (selectedItem.positionPreset && selectedItem.positionPreset !== 'manual' && selectedItem.shapes && selectedItem.shapes.length > 0) {
                        const offset = calculateInlayOffset(
                          selectedItem.shapes,
                          cutoutShapes || null,
                          baseSize,
                          {
                            inlayScale: selectedItem.scale || 1,
                            inlayRotation: val,
                            inlayMirror: selectedItem.mirror || false,
                            inlayPosition: selectedItem.positionPreset,
                          }
                        );
                        updateItem(selectedItem.id, { rotation: val, x: offset.x, y: offset.y });
                      } else {
                        updateItem(selectedItem.id, { rotation: val });
                      }
                    }}
                    step={15}
                    unit="°"
                    aria-label="Rotation in degrees"
                  />
                </ControlField>
              </div>
              <div className="flex-1 min-w-0">
                <ControlField
                  label="Mirror"
                  tooltip="Flip the inlay horizontally"
                >
                  <ToggleButton
                    label={selectedItem.mirror ? "Enabled" : "Disabled"}
                    isToggled={!!selectedItem.mirror}
                    onToggle={() =>
                      updateItem(selectedItem.id, {
                        mirror: !selectedItem.mirror,
                      })
                    }
                    icon={<FlipHorizontal size={16} />}
                  />
                </ControlField>
              </div>
            </div>
          </div>

          {/* Cut depth — how the inlay carves into the base. */}
          <div className="space-y-3 pt-2 border-t border-gray-800">
            <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100">
              <span className="text-xs font-mono text-gray-500">06</span>
              <span>Cut depth</span>
              <span className="text-[10px] font-mono text-gray-500 ml-auto">max {maxDepth}mm</span>
            </h3>

            <div className="flex gap-4">
              <div className="flex-1 min-w-0">
                <ControlField
                  label="Depth"
                  tooltip={`How deep this inlay cuts into the base (max ${maxDepth}mm)`}
                >
                  <NumberStepper
                    value={selectedItem.depth ?? 0.6}
                    onChange={(val) => updateItem(selectedItem.id, { depth: Math.min(maxDepth, Math.max(0.1, val)) })}
                    step={0.1}
                    min={0.1}
                    max={maxDepth}
                    unit="mm"
                    aria-label="Inlay depth in millimetres"
                  />
                </ControlField>
              </div>
              <div className="flex-1 min-w-0">
                <ControlField
                  label="Extend"
                  tooltip="Extra width added to the cut for tighter/looser fit"
                >
                  <NumberStepper
                    value={selectedItem.extend ?? 0}
                    onChange={(val) => updateItem(selectedItem.id, { extend: val })}
                    step={0.1}
                    min={0}
                    unit="mm"
                    aria-label="Inlay extend in millimetres"
                  />
                </ControlField>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
};

export default InlayControls;
