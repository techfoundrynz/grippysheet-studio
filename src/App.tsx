import React, { useState, useRef } from "react";
import ModelViewer from "./components/ModelViewer";
import Controls from "./components/Controls";
import OutputPanel from "./components/OutputPanel";
import * as THREE from 'three';
import { AlertProvider } from './context/AlertContext';
import { BaseSettings, InlaySettings, GeometrySettings } from './types/schemas';
import { defaultBaseSettings, defaultInlaySettings, defaultGeometrySettings } from './utils/schemaDefaults';
import WelcomeModal from "./components/WelcomeModal";
import { ModeToggle, type StudioMode } from "./components/ui/ModeToggle";
import { defaultColorFlowSettings, type ColorFlowSettings } from "./colorflow/schema";
import { ColorFlowControls } from './colorflow/ColorFlowControls';
import type { Centroid } from './colorflow/pipeline/quantize';
import type { ExtrudedGeometry } from './colorflow/pipeline/extrude';

const App = () => {
  const [mode, setMode] = useState<StudioMode>('pattern');

  const [baseSettings, setBaseSettings] = useState<BaseSettings>(defaultBaseSettings);
  const [geometrySettings, setGeometrySettings] = useState<GeometrySettings>(defaultGeometrySettings);
  const [inlaySettings, setInlaySettings] = useState<InlaySettings>(defaultInlaySettings);
  const [colorFlowSettings, setColorFlowSettings] = useState<ColorFlowSettings>(defaultColorFlowSettings);
  const [colorFlowGeom, setColorFlowGeom] = useState<{ base: ExtrudedGeometry; layers: { centroid: Centroid; geom: ExtrudedGeometry }[] } | null>(null);

  const [selectedInlayId, setSelectedInlayId] = useState<string | null>(null);
  const [previewInlay, setPreviewInlay] = useState<any>(null);

  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('welcome_modal_dismissed'));
  const [isControlsCollapsed, setIsControlsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'base' | 'inlay' | 'geometry'>('base');

  const meshRef = useRef<THREE.Group>(null);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        setGeometrySettings(prev => ({ ...prev, debugMode: !prev.debugMode }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleReset = () => {
    setBaseSettings(defaultBaseSettings);
    setGeometrySettings(defaultGeometrySettings);
    setInlaySettings(defaultInlaySettings);
    setColorFlowSettings(defaultColorFlowSettings);
    setSelectedInlayId(null);
  };

  return (
    <AlertProvider>
      <div className="h-[100dvh] flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
        <div className="absolute top-4 right-4 z-30">
          <ModeToggle mode={mode} onChange={setMode} />
        </div>

        <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <div className="h-1/2 md:h-auto flex-1 flex flex-col p-4 min-w-0">
            <div className="flex-1 relative bg-gray-900 rounded-lg border border-gray-800 overflow-hidden shadow-inner">
              <ModelViewer
                mode={mode}
                baseSettings={baseSettings}
                inlaySettings={inlaySettings}
                onInlayChange={setInlaySettings}
                geometrySettings={geometrySettings}
                meshRef={meshRef}
                activeTab={activeTab}
                selectedInlayId={selectedInlayId}
                setSelectedInlayId={setSelectedInlayId}
                previewInlay={previewInlay}
                setPreviewInlay={setPreviewInlay}
                colorFlowGeom={colorFlowGeom}
              />
            </div>
          </div>

          <div className={`md:h-auto w-full md:w-96 overflow-hidden flex flex-col md:p-4 bg-gray-950 md:bg-transparent transition-all duration-300 ease-in-out ${isControlsCollapsed ? 'h-auto flex-shrink-0 md:flex-none' : 'h-1/2 flex-1 md:flex-none'}`}>
            {mode === 'pattern' ? (
              <Controls
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                baseSettings={baseSettings}
                setBaseSettings={setBaseSettings}
                inlaySettings={inlaySettings}
                setInlaySettings={setInlaySettings}
                geometrySettings={geometrySettings}
                setGeometrySettings={setGeometrySettings}
                onReset={handleReset}
                selectedInlayId={selectedInlayId}
                setSelectedInlayId={setSelectedInlayId}
                onOpenWelcome={() => setShowWelcome(true)}
                isCollapsed={isControlsCollapsed}
                onToggleCollapse={() => setIsControlsCollapsed(!isControlsCollapsed)}
                exportControls={
                  <OutputPanel
                    meshRef={meshRef}
                    debugMode={geometrySettings.debugMode ?? false}
                    className="bg-transparent border-0 shadow-none p-0 !p-0"
                  />
                }
              />
            ) : (
              <ColorFlowControls
                baseSettings={baseSettings}
                setBaseSettings={setBaseSettings}
                settings={colorFlowSettings}
                setSettings={setColorFlowSettings}
                onGeometryReady={setColorFlowGeom}
              />
            )}
          </div>
        </main>

        {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
      </div>
    </AlertProvider>
  );
};

export default App; // Force update
