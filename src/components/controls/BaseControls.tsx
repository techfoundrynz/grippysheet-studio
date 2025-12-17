import React from 'react';
import { BaseSettings } from '../../types/schemas';
import { COLORS } from '../../constants/colors';
import { FlipHorizontal, BookOpen } from 'lucide-react';
import ShapeUploader from '../ShapeUploader';
import ControlField from '../ui/ControlField';
import DebouncedInput from '../DebouncedInput';
import ToggleButton from '../ui/ToggleButton';
import PatternLibraryModal, { PatternPreset } from '../PatternLibraryModal';
import { parseDxfToShapes } from '../../utils/dxfUtils';
import { useAlert } from '../../context/AlertContext';

interface BaseControlsProps {
  settings: BaseSettings;
  updateSettings: (updates: Partial<BaseSettings>) => void;
  onOutlineLoaded: (shapes: any[]) => void;
}

const BaseControls: React.FC<BaseControlsProps> = ({
  settings,
  updateSettings,
  onOutlineLoaded
}) => {
  const { size, thickness, color, cutoutShapes } = settings;
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [showLibrary, setShowLibrary] = React.useState(false);
  const { showAlert } = useAlert();

  const handleOutlineLoaded = (shapes: any[], name: string | null) => {
      updateSettings({ cutoutShapes: shapes });
      setFileName(name);
      onOutlineLoaded(shapes);
  };

  return (
    <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="space-y-2">
        <ShapeUploader 
            label="Upload Outline" 
            shapes={cutoutShapes || null}
            fileName={fileName}
            onUpload={(loadedShapes, name) => handleOutlineLoaded(loadedShapes, name)}
            onClear={() => {
                updateSettings({ cutoutShapes: [] });
                setFileName(null);
            }}
            allowedTypes={['dxf']}
            adornment={
                <button
                    onClick={() => setShowLibrary(true)}
                    className="p-1 rounded-lg transition-colors border bg-gray-700/50 hover:bg-gray-700 text-gray-400 hover:text-white border-gray-600 hover:border-gray-500"
                    title="Open Outline Library"
                >
                    <BookOpen size={12} />
                </button>
            }
        />
        
        <PatternLibraryModal
            isOpen={showLibrary}
            onClose={() => setShowLibrary(false)}
            category="outlines"
            onSelect={async (preset: PatternPreset) => {
                setShowLibrary(false);
                try {
                    const response = await fetch(`/${preset.category}/${preset.file}`);
                    if (!response.ok) throw new Error('Failed to fetch');
                    const text = await response.text();
                    
                    if (preset.type === 'dxf') {
                        const shapes = parseDxfToShapes(text);
                        // Wrap shapes if needed to match expected structure or pass directly?
                        // ShapeUploader usually passes arrays of shapes. Inlay controls wraps them. 
                        // BaseControls `cutoutShapes` usually expects plain shapes or shapes with holes.
                        // `parseDxfToShapes` returns `THREE.Shape[]`.
                        handleOutlineLoaded(shapes, preset.name);
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
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
          />
        </ControlField>
      )}

      <ControlField label="Thickness (mm)" tooltip="Total thickness (height) of the base sheet">
        <DebouncedInput
          type="number"
          value={thickness}
          onChange={(val) => updateSettings({ thickness: Number(val) })}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
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
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all outline-none"
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
