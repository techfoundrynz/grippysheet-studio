import React, { useState, useRef, useCallback, useMemo } from "react";
import ModelViewer from "./components/ModelViewer";
import Controls from "./components/Controls";
import OutputPanel from "./components/OutputPanel";
import * as THREE from 'three';
import { AlertProvider } from './context/AlertContext';
import { BaseSettings, InlaySettings, GeometrySettings } from './types/schemas';
import type { ProjectDataV2 } from './types/schemas';
import { defaultBaseSettings, defaultInlaySettings, defaultGeometrySettings } from './utils/schemaDefaults';
import WelcomeModal from "./components/WelcomeModal";
import { defaultColorFlowSettings, type ColorFlowSettings } from "./colorflow/schema";
import type { Centroid } from './colorflow/pipeline/quantize';
import type { ExtrudedGeometry } from './colorflow/pipeline/extrude';
import type { SpikeSource } from './colorflow/ColorFlowControls';
import { generateSpikes } from './colorflow/spikes';
import { exportProjectBundle, type ProjectAssets } from './utils/projectUtils';

const App = () => {
  const [baseSettings, setBaseSettings] = useState<BaseSettings>(defaultBaseSettings);
  const [geometrySettings, setGeometrySettings] = useState<GeometrySettings>(defaultGeometrySettings);
  const [inlaySettings, setInlaySettings] = useState<InlaySettings>(defaultInlaySettings);
  const [colorFlowSettings, setColorFlowSettings] = useState<ColorFlowSettings>(defaultColorFlowSettings);
  const [colorFlowGeom, setColorFlowGeom] = useState<{
    base: ExtrudedGeometry;
    layers: { centroid: Centroid; position: number; geom: ExtrudedGeometry }[];
    source: SpikeSource;
  } | null>(null);
  const [projectAssets, setProjectAssets] = useState<ProjectAssets>({ inlays: {} });

  const [selectedInlayId, setSelectedInlayId] = useState<string | null>(null);
  const [previewInlay, setPreviewInlay] = useState<any>(null);

  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('welcome_modal_dismissed'));
  const [isControlsCollapsed, setIsControlsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'base' | 'inlay' | 'colorflow' | 'geometry'>('base');

  const meshRef = useRef<THREE.Group>(null);

  // Derive viewer mode from colorFlowGeom presence
  const colorFlowActive = colorFlowGeom !== null;
  const viewerMode = colorFlowActive ? 'colorflow' : 'pattern';

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
    setColorFlowGeom(null);
    setSelectedInlayId(null);
  };

  const handleProjectImported = useCallback((data: ProjectDataV2, assets: ProjectAssets) => {
    setBaseSettings(data.base as BaseSettings);
    setInlaySettings(data.inlay as InlaySettings);
    setGeometrySettings(data.geometry as GeometrySettings);
    if (data.imageMode) setColorFlowSettings(data.imageMode);
    setProjectAssets(assets);
  }, []);

  const handleImageAssetChanged = useCallback((a: { name: string; bytes: ArrayBuffer } | null) => {
    setProjectAssets((p) => ({
      ...p,
      image: a ? { name: a.name, content: a.bytes, type: 'image' } : undefined,
    }));
  }, []);

  const handleColorFlowGeomReady = useCallback((data: {
    base: ExtrudedGeometry;
    layers: { centroid: Centroid; position: number; geom: ExtrudedGeometry }[];
    source: SpikeSource;
  }) => {
    setColorFlowGeom(data);
  }, []);

  // Spike layer is derived from the colorflow source + Geometry settings +
  // ColorFlow spike settings. Lives here (not inside ColorFlowControls) so it
  // updates live even while the ColorFlow tab is frozen.
  const spikeResult = useMemo(() => {
    if (!colorFlowGeom?.source) return { groups: [], diag: '' };
    return generateSpikes({
      outlinePolygon: colorFlowGeom.source.outlinePolygon,
      layersInMm: colorFlowGeom.source.layersInMm,
      palette: colorFlowGeom.source.palette,
      stackOrder: colorFlowGeom.source.stackOrder,
      baseMm: colorFlowGeom.source.baseMm,
      colorLayerMm: colorFlowGeom.source.colorLayerMm,
      patternShape: geometrySettings.patternShapes?.[0],
      patternScale: geometrySettings.patternScale ?? 1,
      tileSpacing: geometrySettings.tileSpacing,
      distribution: geometrySettings.tilingDistribution,
      orientation: geometrySettings.tilingOrientation,
      direction: geometrySettings.tilingDirection,
      spikeMaxMm: colorFlowSettings.spikeMaxMm,
      spikeColorMatch: colorFlowSettings.spikeColorMatch,
      fallbackColor: geometrySettings.patternColor,
    });
  }, [
    colorFlowGeom?.source,
    geometrySettings.patternShapes,
    geometrySettings.patternScale,
    geometrySettings.tileSpacing,
    geometrySettings.tilingDistribution,
    geometrySettings.tilingOrientation,
    geometrySettings.tilingDirection,
    geometrySettings.patternColor,
    colorFlowSettings.spikeMaxMm,
    colorFlowSettings.spikeColorMatch,
  ]);

  // Compose colorFlowGeom + derived spikes for downstream consumers.
  const colorFlowGeomWithSpikes = useMemo(() => {
    if (!colorFlowGeom) return null;
    return {
      base: colorFlowGeom.base,
      layers: colorFlowGeom.layers,
      spikes: spikeResult.groups,
    };
  }, [colorFlowGeom, spikeResult.groups]);

  const initialImageAsset = projectAssets.image
    ? { name: projectAssets.image.name, bytes: projectAssets.image.content as ArrayBuffer }
    : null;

  return (
    <AlertProvider>
      <div className="h-[100dvh] flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
        <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <div className="h-1/2 md:h-auto flex-1 flex flex-col p-4 min-w-0">
            <div className="flex-1 relative bg-gray-900 rounded-lg border border-gray-800 overflow-hidden shadow-inner">
              <ModelViewer
                mode={viewerMode}
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
                colorFlowGeom={colorFlowGeomWithSpikes}
              />
            </div>
          </div>

          <div className={`md:h-auto w-full md:w-96 overflow-hidden flex flex-col md:p-4 bg-gray-950 md:bg-transparent transition-all duration-300 ease-in-out ${isControlsCollapsed ? 'h-auto flex-shrink-0 md:flex-none' : 'h-1/2 flex-1 md:flex-none'}`}>
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
                  colorFlowGeom={colorFlowGeomWithSpikes}
                  colorFlowImageName={projectAssets.image?.name}
                  colorFlowOutlineSlug={baseSettings.outlineSlug}
                />
              }
              colorFlowSpikeDiag={spikeResult.diag}
              colorFlowSettings={colorFlowSettings}
              setColorFlowSettings={setColorFlowSettings}
              colorFlowActive={colorFlowActive}
              onColorFlowGeomReady={handleColorFlowGeomReady}
              onColorFlowImageAssetChanged={handleImageAssetChanged}
              initialColorFlowImageAsset={initialImageAsset}
              onProjectImported={handleProjectImported}
              onExportProject={() => exportProjectBundle(viewerMode, baseSettings, inlaySettings, geometrySettings, colorFlowSettings, projectAssets)}
            />
          </div>
        </main>

        {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
      </div>
    </AlertProvider>
  );
};

export default App;
