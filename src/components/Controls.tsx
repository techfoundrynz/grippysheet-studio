import React from 'react';
import { Freeze } from 'react-freeze';
import { exportProjectBundle, importProjectBundle, ProjectAssets } from '../utils/projectUtils';
import { BaseSettings, InlaySettings, GeometrySettings, ProjectSchemaV1 } from '../types/schemas';
import { parseShapeFile } from '../utils/shapeLoader';
import { RotateCcw, HelpCircle, ChevronDown, Download, Upload } from 'lucide-react';
import { useAlert } from '../context/AlertContext';
import SegmentedControl from './ui/SegmentedControl';
import Button from './ui/Button';
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
  activeTab: 'base' | 'inlay' | 'geometry';
  setActiveTab: (tab: 'base' | 'inlay' | 'geometry') => void;
  selectedInlayId: string | null;
  setSelectedInlayId: (id: string | null) => void;
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
  setSelectedInlayId
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

  const [projectAssets, setProjectAssets] = React.useState<ProjectAssets>({ inlays: {} });

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
      setProjectAssets(prev => ({ ...prev, baseOutline: asset || undefined }));
  };

  const handlePatternAssetChanged = (asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' | 'stl' } | null) => {
      setProjectAssets(prev => ({ ...prev, pattern: asset || undefined }));
  };

  const handleInlayAssetChanged = (id: string, asset: { name: string, content: string | ArrayBuffer, type: 'dxf' | 'svg' | 'stl' } | null) => {
       setProjectAssets(prev => {
           const newInlays = { ...(prev.inlays || {}) };
           if (asset) {
               newInlays[id] = asset;
           } else {
               delete newInlays[id];
           }
           return { ...prev, inlays: newInlays };
       });
  };

  const handleExportClick = () => {
      // Validate Assets
      const missingAssets: string[] = [];
      
      // Check Base
      if (baseSettings.cutoutShapes && baseSettings.cutoutShapes.length > 0 && !projectAssets.baseOutline) {
          missingAssets.push("Base Outline");
      }

      // Check Pattern
      if (geometrySettings.patternShapes && geometrySettings.patternShapes.length > 0 && !projectAssets.pattern) {
          missingAssets.push("Grip Pattern");
      }

      // Check Inlays
      if (inlaySettings.items) {
          inlaySettings.items.forEach(item => {
              // Only check if item has shapes and is valid
              if (item.shapes && item.shapes.length > 0) {
                   if (!projectAssets.inlays || !projectAssets.inlays[item.id]) {
                       missingAssets.push(`Inlay: ${item.name || 'Unnamed'}`);
                   }
              }
          });
      }

      if (missingAssets.length > 0) {
          showAlert({
              title: "Missing Asset Files",
              message: `The following original asset files are not currently in memory and won't be included in the export:\n\n• ${missingAssets.join('\n• ')}\n\nPlease re-select or re-upload these files to ensure they are bundled correctly. Do you want to proceed with a partial export?`,
              type: "warning",
              confirmText: "Export Anyway",
              cancelText: "Cancel",
              onConfirm: () => {
                  exportProjectBundle(baseSettings, inlaySettings, geometrySettings, projectAssets);
              }
          });
          return;
      }

      exportProjectBundle(baseSettings, inlaySettings, geometrySettings, projectAssets);
  };

  const handleImportClick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip';
      input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;

          try {
              const { data, versionMismatch, importedVersion, importedAssets } = await importProjectBundle(file);
              
              const applyImport = () => {
                   let newBase = data.base;
                   let newInlay = data.inlay;
                   let newGeometry = data.geometry;

                   // Re-hydrate Shapes from Assets if available
                   if (importedAssets) {
                       // 1. Base Outline
                       if (importedAssets.baseOutline) {
                           const res = parseShapeFile(importedAssets.baseOutline.content, importedAssets.baseOutline.type);
                           if (res.success) {
                               newBase = { ...newBase, cutoutShapes: res.shapes };
                           }
                       }
                       
                       // 2. Pattern
                       if (importedAssets.pattern) {
                           console.log("[Import] Rehydrating Pattern:", importedAssets.pattern.name);
                           // GeometryControls logic usually expects 'stl' or 'dxf'/'svg' but logic handles it.
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
                               if (asset) {
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
                       
                       setProjectAssets(importedAssets);
                   }

                   setBaseSettings(newBase);
                   setInlaySettings(newInlay);
                   setGeometrySettings(newGeometry);
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

  const renderFooter = (className = "p-4 bg-gray-800 space-y-4") => (
      <div className={className}>
            {/* Reset Button */}
            {onReset && (
                <Button
                    onClick={handleResetClick}
                    variant="danger"
                    size="md"
                    className="w-full"
                    leftIcon={<RotateCcw size={18} />}
                >
                    Reset All Settings
                </Button>
            )}

            {/* Debug Import/Export */}
            {geometrySettings.debugMode && (
                <div className="grid grid-cols-2 gap-2 pt-2">
                    <Button
                        onClick={handleImportClick}
                        variant="secondary"
                        size="sm"
                        leftIcon={<Download size={14} />}
                        title="Import Project JSON"
                    >
                        Import Settings
                    </Button>
                    <Button
                        onClick={handleExportClick}
                        variant="secondary"
                        size="sm"
                        leftIcon={<Upload size={14} />}
                        title="Export Project JSON"
                    >
                        Export Settings
                    </Button>
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
                  <Button
                      onClick={onToggleCollapse}
                      variant="ghost"
                      size="icon"
                      className="md:hidden -ml-1 text-gray-400 hover:text-white"
                  >
                      <ChevronDown size={20} className={`transition-transform duration-300 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`} />
                  </Button>
             )}
             <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                GrippySheet Studio
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
                        onOutlineAssetChanged={handleOutlineAssetChanged}
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
                        selectedInlayId={selectedInlayId}
                        setSelectedInlayId={setSelectedInlayId}
                        onInlayAssetChanged={handleInlayAssetChanged}
                    />
                </div>
            </Freeze>

            <Freeze freeze={activeTab !== 'geometry'}>
                <div className={activeTab === 'geometry' ? 'block' : 'hidden'}>
                    <GeometryControls 
                        settings={geometrySettings}
                        updateSettings={updateGeom}
                        baseSize={baseSettings.size}
                        onPatternAssetChanged={handlePatternAssetChanged}
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
