import React, { useState } from 'react';
import { Freeze } from 'react-freeze';
import { exportProject, importProject } from '../utils/projectUtils';
import { BaseSettings, InlaySettings, GeometrySettings, ProjectSchemaV1 } from '../types/schemas';
import { RotateCcw, HelpCircle, ChevronDown, Download, Upload } from 'lucide-react';
import { useAlert } from '../context/AlertContext';
import SegmentedControl from './ui/SegmentedControl';
import { calculateInlayScale } from '../utils/patternUtils';
import * as THREE from 'three';

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
  exportControls
}) => {
  const { showAlert } = useAlert();
  const [activeTab, setActiveTab] = useState<'base' | 'inlay' | 'geometry'>('base');
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
      showAlert({
          title: "Reset Settings?",
          message: "Are you sure you want to reset all settings to their defaults? This action cannot be undone and your current design will be lost.",
          type: "warning",
          confirmText: "Confirm Reset",
          cancelText: "Cancel",
          onConfirm: () => {
              if (onReset) onReset();
          }
      });
  };

  // Logic to handle Outline Loading at the top level
  const handleOutlineLoaded = (shapes: any[]) => {
      // 1. Set Outline
      updateBase({ cutoutShapes: shapes });

      // 2. Check if we need to resize existing inlay (if it exists in inlaySettings)
      if (inlaySettings.inlayShapes && inlaySettings.inlayShapes.length > 0) {
           const scale = calculateInlayScale(inlaySettings.inlayShapes, shapes as THREE.Shape[], baseSettings.size);
           updateInlay({ inlayScale: scale });
      }
  };

  const handleExportClick = () => {
      exportProject(baseSettings, inlaySettings, geometrySettings);
  };

  const handleImportClick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;

          try {
              const { data, versionMismatch, importedVersion } = await importProject(file);
              
              if (versionMismatch) {
                  showAlert({
                      title: "Version Mismatch",
                      message: `The imported project version (${importedVersion}) does not match the current version (${ProjectSchemaV1.shape.version.value}). Some settings may be missing or incorrect.`,
                      type: "warning",
                      confirmText: "Continue Anyway",
                      cancelText: "Cancel",
                      onConfirm: () => {
                           setBaseSettings(data.base);
                           setInlaySettings(data.inlay);
                           setGeometrySettings(data.geometry);
                      }
                  });
              } else {
                   setBaseSettings(data.base);
                   setInlaySettings(data.inlay);
                   setGeometrySettings(data.geometry);
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

  const renderFooter = (className = "p-4 bg-gray-800 space-y-4") => (
      <div className={className}>
            {/* Reset Button */}
            {onReset && (
                <button
                    onClick={handleResetClick}
                    className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/50 hover:border-red-400 p-3 rounded-lg flex items-center justify-center gap-2 transition-all font-medium"
                >
                    <RotateCcw size={18} />
                    Reset All Settings
                </button>
            )}

            {/* Debug Import/Export */}
            {geometrySettings.debugMode && (
                <div className="grid grid-cols-2 gap-2 pt-2">
                    <button
                        onClick={handleImportClick}
                        className="bg-gray-700 hover:bg-gray-600 text-gray-300 p-2 rounded-lg flex items-center justify-center gap-2 text-sm"
                        title="Import Project JSON"
                    >
                        <Download size={14} />
                        Import Settings
                    </button>
                    <button
                        onClick={handleExportClick}
                        className="bg-gray-700 hover:bg-gray-600 text-gray-300 p-2 rounded-lg flex items-center justify-center gap-2 text-sm"
                        title="Export Project JSON"
                    >
                        <Upload size={14} />
                        Export Settings
                    </button>
                </div>
            )}

            {/* Export Buttons */}
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
                  <button
                      onClick={onToggleCollapse}
                      className="md:hidden p-1 -ml-1 text-gray-400 hover:text-white transition-colors"
                  >
                      <ChevronDown size={20} className={`transition-transform duration-300 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`} />
                  </button>
             )}
             <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                GrippySheet Studio
             </h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onOpenWelcome}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-all"
              title="Help & Info"
            >
              <HelpCircle size={20} />
            </button>
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

        <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isCollapsed ? 'max-h-0 opacity-0 md:max-h-[500px] md:opacity-100 m-0' : 'max-h-[500px] opacity-100'}`}>
          <SegmentedControl
            value={activeTab}
            onChange={(val) => setActiveTab(val as any)}
            options={[
              { value: 'base', label: 'Base' },
              { value: 'inlay', label: 'Inlay' },
              { value: 'geometry', label: 'Geometry' }
            ]}
          />
        </div>
      </div>

      <div className={`flex-1 min-h-0 flex flex-col transition-all duration-300 ease-in-out ${isCollapsed ? 'max-h-0 opacity-0 md:max-h-[2000px] md:opacity-100' : 'max-h-[2000px] opacity-100'}`}>
        <div className="flex-1 md:overflow-y-auto overflow-visible custom-scrollbar p-6 flex flex-col gap-6">
            
            <Freeze freeze={activeTab !== 'base'}>
                <div className={activeTab === 'base' ? 'block' : 'hidden'}>
                    <BaseControls 
                        settings={baseSettings} 
                        updateSettings={updateBase}
                        onOutlineLoaded={handleOutlineLoaded}
                    />
                </div>
            </Freeze>

            <Freeze freeze={activeTab !== 'inlay'}>
                <div className={activeTab === 'inlay' ? 'block' : 'hidden'}>
                    <InlayControls 
                        settings={inlaySettings}
                        updateSettings={updateInlay}
                        cutoutShapes={baseSettings.cutoutShapes}
                        baseSize={baseSettings.size}
                        baseColor={baseSettings.color}
                    />
                </div>
            </Freeze>

            <Freeze freeze={activeTab !== 'geometry'}>
                <div className={activeTab === 'geometry' ? 'block' : 'hidden'}>
                    <GeometryControls 
                        settings={geometrySettings}
                        updateSettings={updateGeom}
                        baseSize={baseSettings.size}
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
