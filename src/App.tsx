import React, { useState, useRef } from "react";
import ModelViewer from "./components/ModelViewer";
import Controls from "./components/Controls";
import OutputPanel from "./components/OutputPanel";
import * as THREE from 'three';
import { AlertProvider } from './context/AlertContext';
import { BaseSettings, InlaySettings, GeometrySettings } from './types/schemas';

import { defaultBaseSettings, defaultInlaySettings, defaultGeometrySettings } from './utils/schemaDefaults';
import WelcomeModal from "./components/WelcomeModal";

const App = () => {
  // Base Settings
  const [baseSettings, setBaseSettings] = useState<BaseSettings>(defaultBaseSettings);

  // Geometry Settings
  const [geometrySettings, setGeometrySettings] = useState<GeometrySettings>(defaultGeometrySettings);

  // Inlay Settings
  const [inlaySettings, setInlaySettings] = useState<InlaySettings>(defaultInlaySettings);

  // Welcome Modal State
  const [showWelcome, setShowWelcome] = useState(() => {
      // Check local storage on init
      return !localStorage.getItem('welcome_modal_dismissed');
  });

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
  };

  return (
    <AlertProvider>
    <div className="h-[100dvh] flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Panel - 3D Viewer */}
        <div className="h-1/2 md:h-auto flex-1 flex flex-col p-4 min-w-0">
            <div className="flex-1 relative bg-gray-900 rounded-lg border border-gray-800 overflow-hidden shadow-inner">
                <ModelViewer 
                  baseSettings={baseSettings}
                  inlaySettings={inlaySettings}
                  onInlayChange={setInlaySettings}
                  geometrySettings={geometrySettings}
                  meshRef={meshRef} 
                  activeTab={activeTab}
                />
            </div>
        </div>

        {/* Right Panel - Controls & Output */}
        <div className={`
            md:h-auto w-full md:w-96 overflow-hidden flex flex-col md:p-4 bg-gray-950 md:bg-transparent transition-all duration-300 ease-in-out
            ${isControlsCollapsed ? 'h-auto flex-shrink-0 md:flex-none' : 'h-1/2 flex-1 md:flex-none'}
        `}>
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
            <div className={`flex-shrink-0 transition-opacity duration-300 ${isControlsCollapsed ? 'opacity-0 h-0 overflow-hidden md:opacity-100 md:h-auto md:overflow-visible' : 'opacity-100'}`}>
               {/* OutputPanel moved to Controls */}
            </div>
        </div>
      </main>

      {/* Welcome Modal */}
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
    </div>
    </AlertProvider>
  );
};

export default App; // Force update
