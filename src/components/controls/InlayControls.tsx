import React, { useState, useEffect } from "react";
import { InlaySettings, InlayItem } from "../../types/schemas";
import {
  Palette,
  BookOpen,
  Maximize,
  FlipHorizontal,
  Layers,
  Plus,
  Trash2,
  GripVertical,
  Grid3x3,
  MousePointer2,
  ChevronDown,
} from "lucide-react";
import ShapeUploader from "../ShapeUploader";
import ControlField from "../ui/ControlField";
import DebouncedInput from "../DebouncedInput";
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
  baseColor,
  selectedInlayId,
  setSelectedInlayId,
  onInlayAssetChanged,
}) => {
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

  return (
    <div className="space-y-4">
      <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <Layers size={14} />
            Inlay Layers
          </h3>
          <span className="text-xs text-gray-500">{items.length} items</span>
        </div>

        <div className="space-y-1 max-h-40 overflow-y-auto mb-2">
          {items.map((item, index) => (
            <div
              key={item.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={() => setSelectedInlayId(item.id)}
              className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm transition-colors ${
                selectedInlayId === item.id
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                  : "bg-gray-700/50 text-gray-300 hover:bg-gray-700 hover:text-white border border-transparent"
              } ${
                dragOverIndex === index && draggedIndex !== index
                  ? "border-t-2 border-t-purple-500"
                  : ""
              } ${
                draggedIndex === index
                  ? "opacity-50"
                  : ""
              }`}
            >
              <div 
                className="cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <GripVertical size={14} />
              </div>
              <span className="truncate flex-1">
                {item.name || `Inlay ${index + 1}`} {item.shapes?.length === 0 ? "(Empty)" : ""}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteItem(item.id);
                }}
                className="p-1 hover:bg-red-500/20 hover:text-red-400 rounded transition-colors"
                title="Delete Layer"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {items.length === 0 && (
            <div className="text-center py-4 text-gray-500 text-sm italic">
              No inlays added yet
            </div>
          )}
        </div>

        <button
          onClick={handleAddLayer}
          className="w-full py-1.5 flex items-center justify-center gap-2 text-xs font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        >
          <Plus size={14} /> Add Inlay Layer
        </button>
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
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Selected Layer Properties
          </div>

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
                className="text-gray-400 hover:text-purple-400 transition-colors"
                title="Auto Scale to Fit"
              >
                <Maximize size={14} />
              </button>
            }
          >
            <DebouncedInput
              type="number"
              value={selectedItem.scale}
              onChange={(val) => {
                const num = Number(val);
                if (!isNaN(num) && num !== 0) {
                  // Recalculate position if using a preset
                  if (selectedItem.positionPreset && selectedItem.positionPreset !== 'manual' && selectedItem.shapes && selectedItem.shapes.length > 0) {
                    const offset = calculateInlayOffset(
                      selectedItem.shapes,
                      cutoutShapes || null,
                      baseSize,
                      {
                        inlayScale: num,
                        inlayRotation: selectedItem.rotation || 0,
                        inlayMirror: selectedItem.mirror || false,
                        inlayPosition: selectedItem.positionPreset,
                      }
                    );
                    updateItem(selectedItem.id, { scale: num, x: offset.x, y: offset.y });
                  } else {
                    updateItem(selectedItem.id, { scale: num });
                  }
                }
              }}
              step="0.01"
              min="0.01"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
            />
          </ControlField>

          
          
          {/* Mode Switch: Place vs Tile */}
          <div className="space-y-2 mb-4">
             <label className="text-sm font-medium text-gray-300">
              Layout Mode
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
            />
          </div>

          {/* Modifier: None | Cut | Mask */}
          <div className="mb-4">
          <ControlField label="Modifier" tooltip="How this layer interacts with the grip geometry">
            <div className="relative">
              <select
                value={selectedItem.modifier || 'none'}
                onChange={(e) => updateItem(selectedItem.id, { modifier: e.target.value as any })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none truncate"
              >
                <option value="none">None</option>
                <option value="cut">Cut</option>
                <option value="mask">Recolor</option>
                <option value="avoid">Avoid</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                <ChevronDown size={16} />
              </div>
            </div>
          </ControlField>
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
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none truncate"
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
                <ControlField label="Spacing (mm)" tooltip="Distance between tiled shapes">
                  <DebouncedInput
                    type="number"
                    value={selectedItem.tileSpacing || 0} // Default to 0 if undefined
                    onChange={(val) =>
                      updateItem(selectedItem.id, { tileSpacing: Number(val) })
                    }
                    step="0.1"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white outline-none"
                  />
                </ControlField>
              </div>
              <div className="flex-1 min-w-0">
                <ControlField label="Distribution" tooltip="Pattern layout style">
                  <div className="relative">
                    <select
                      value={selectedItem.tilingDistribution || 'grid'}
                      onChange={(e) => updateItem(selectedItem.id, { tilingDistribution: e.target.value as any })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-3 pr-10 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none appearance-none truncate"
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
                <ControlField label="X (mm)">
                  <DebouncedInput
                    type="number"
                    value={selectedItem.x ?? 0}
                    onChange={(val) =>
                      updateItem(selectedItem.id, { x: Number(val), positionPreset: 'manual' })
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                  />
                </ControlField>
              </div>
              <div className="flex-1 min-w-0">
                <ControlField label="Y (mm)">
                  <DebouncedInput
                    type="number"
                    value={selectedItem.y ?? 0}
                    onChange={(val) =>
                      updateItem(selectedItem.id, { y: Number(val), positionPreset: 'manual' })
                    }
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                  />
                </ControlField>
              </div>
            </div>
          )}

          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <ControlField
                label="Rotation (deg)"
                tooltip="Rotate the inlay pattern"
              >
                <DebouncedInput
                  type="number"
                  value={selectedItem.rotation}
                  onChange={(val) => {
                    const num = Number(val);
                    // Recalculate position if using a preset
                    if (selectedItem.positionPreset && selectedItem.positionPreset !== 'manual' && selectedItem.shapes && selectedItem.shapes.length > 0) {
                      const offset = calculateInlayOffset(
                        selectedItem.shapes,
                        cutoutShapes || null,
                        baseSize,
                        {
                          inlayScale: selectedItem.scale || 1,
                          inlayRotation: num,
                          inlayMirror: selectedItem.mirror || false,
                          inlayPosition: selectedItem.positionPreset,
                        }
                      );
                      updateItem(selectedItem.id, { rotation: num, x: offset.x, y: offset.y });
                    } else {
                      updateItem(selectedItem.id, { rotation: num });
                    }
                  }}
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


          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <ControlField
                label="Inlay Depth (mm)"
                tooltip="How deep this inlay cuts into the base"
              >
                <DebouncedInput
                  type="number"
                  value={selectedItem.depth || 0.6}
                  onChange={(val) => updateItem(selectedItem.id, { depth: Number(val) })}
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
                  value={selectedItem.extend || 0}
                  onChange={(val) => updateItem(selectedItem.id, { extend: Number(val) })}
                  step="0.1"
                  min="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
                />
              </ControlField>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default InlayControls;
