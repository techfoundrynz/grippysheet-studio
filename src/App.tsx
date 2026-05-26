import React, { useState, useRef, useCallback, useMemo } from "react";
import ModelViewer from "./components/ModelViewer";
import Controls from "./components/Controls";
const OutputPanel = React.lazy(() => import("./components/OutputPanel"));
import * as THREE from 'three';
import { AlertProvider } from './context/AlertContext';
import { BaseSettings, InlaySettings, GeometrySettings, InlayItem } from './types/schemas';
import type { ProjectDataV2 } from './types/schemas';
import { defaultBaseSettings, defaultInlaySettings, defaultGeometrySettings } from './utils/schemaDefaults';
import WelcomeModal from "./components/WelcomeModal";
import ToastHost from "./components/ui/ToastHost";
import { defaultColorFlowSettings, type ColorFlowSettings } from "./colorflow/schema";
import type { Centroid } from './colorflow/pipeline/quantize';
import type { ExtrudedGeometry } from './colorflow/pipeline/extrude';
import type { SpikeSource } from './colorflow/ColorFlowControls';
import { generateSpikes } from './colorflow/spikes';
import { emitProcessing, eventBus, emitToast } from './utils/eventBus';
import { type ProjectAssets } from './utils/projectUtils';
import { saveAutoSnapshot, loadAutoSnapshot, clearAutoSnapshot, type AutoSaveSnapshot } from './utils/autoSave';
import ResumeBanner from './components/ResumeBanner';

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
  const [previewInlay, setPreviewInlay] = useState<InlayItem | null>(null);

  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('welcome_modal_dismissed_v2'));
  const [isControlsCollapsed, setIsControlsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'base' | 'inlay' | 'colorflow' | 'geometry'>('base');

  // Resume banner — seed from localStorage exactly once on mount. We only
  // load the snapshot here; the "user has live work already" check happens
  // below against the App's actual initial state (which is just defaults
  // at this point — the snapshot can't have been applied yet).
  const [resumeSnapshot, setResumeSnapshot] = useState<AutoSaveSnapshot | null>(() => loadAutoSnapshot());

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

  // Auto-save settings into localStorage so a tab refresh / accidental
  // close doesn't lose the user's work. Debounced inside `saveAutoSnapshot`
  // so rapid slider drags coalesce into a single write. Runtime-only fields
  // (THREE.Shape arrays) are stripped here, same contract as the 3MF sidecar.
  //
  // While the Resume banner is showing we suppress auto-save — otherwise the
  // default settings we mount with would clobber the very snapshot the user
  // is being asked to restore, before they've had a chance to click Open.
  React.useEffect(() => {
    if (resumeSnapshot) return;
    const project: ProjectDataV2 = {
      version: 2,
      timestamp: Date.now(),
      mode: viewerMode,
      base: { ...baseSettings, cutoutShapes: null },
      inlay: { ...inlaySettings },
      geometry: { ...geometrySettings, patternShapes: null },
      imageMode: colorFlowSettings,
    };
    saveAutoSnapshot({ project });
  }, [baseSettings, inlaySettings, geometrySettings, colorFlowSettings, viewerMode, resumeSnapshot]);

  // Canvas drag-drop bridge — when ModelViewer emits a file-drop event,
  // switch to the relevant tab so the user sees what just happened. The
  // payload itself is consumed by the tab-specific controls (ColorFlow
  // image hydration / Base outline loader).
  React.useEffect(() => {
    return eventBus.on('file-drop', (e: { kind: 'image:colorflow' | 'shape:base' }) => {
      if (e.kind === 'image:colorflow') setActiveTab('colorflow');
      else if (e.kind === 'shape:base') setActiveTab('base');
    });
  }, []);

  // Imperative tab-switch bus. Used by the viewer context menu's
  // "Open Library" item so it can land the user on the Base tab before
  // popping the library modal (BaseControls subscribes separately).
  React.useEffect(() => {
    return eventBus.on('set-active-tab', (e: { tab: 'base' | 'inlay' | 'colorflow' | 'geometry' }) => {
      setActiveTab(e.tab);
    });
  }, []);

  // Canvas-drop project load. ModelViewer parses the .3mf / .zip off the
  // main thread and emits this once the sidecar is validated. Routing it
  // through the same handler the Open button uses keeps the two paths
  // identical (state + assets + toast feedback).
  React.useEffect(() => {
    return eventBus.on('project-loaded', (e) => {
      if (e.data.mode === 'colorflow') {
        handleProjectImported(e.data, e.assets);
        setActiveTab('colorflow');
        setColorFlowGeom(null); // force a re-extrude from restored settings
      } else {
        handleProjectImported(e.data, e.assets);
      }
      emitToast({ message: 'Project loaded', detail: 'settings + assets restored', tone: 'ready' });
    });
    // handleProjectImported is stable (useCallback w/ []). Re-binding on
    // every render would still be safe, but [] keeps it tight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Resume-banner actions. "Open" applies the snapshot, drops the banner,
  // and prompts the user to re-upload assets (we don't persist bytes — see
  // `autoSave.ts`). "Start fresh" wipes the snapshot. "Dismiss" leaves the
  // snapshot in place so a later refresh can still resume.
  const handleResumeOpen = useCallback(() => {
    if (!resumeSnapshot) return;
    handleProjectImported(resumeSnapshot.project, {});
    setResumeSnapshot(null);
    emitToast({
      message: 'Session restored',
      detail: 'upload your image / outline again if needed',
      tone: 'info',
    });
  }, [resumeSnapshot, handleProjectImported]);

  const handleResumeDiscard = useCallback(() => {
    clearAutoSnapshot();
    setResumeSnapshot(null);
  }, []);

  const handleResumeDismiss = useCallback(() => {
    setResumeSnapshot(null);
  }, []);

  // Suppress the banner when the user already has meaningful work in flight
  // — re-showing the prompt after a hot-reload or after they've started a
  // new design would be confusing. Heuristic per the spec: any cutoutShapes
  // present OR ColorFlow geometry resolved.
  const userHasLiveWork =
    (baseSettings.cutoutShapes && baseSettings.cutoutShapes.length > 0) || colorFlowGeom !== null;
  const showResumeBanner = !!resumeSnapshot && !userHasLiveWork;

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

  // Spikes are heavy enough that auto-regen on every slider/toggle freezes the
  // page. They live in explicit state and only update when the user clicks the
  // "Generate preview" button in the ColorFlow tab.
  const [spikeGroups, setSpikeGroups] = useState<{ centroidIndex: number; geom: ExtrudedGeometry; color: string }[]>([]);
  const [spikeDiag, setSpikeDiag] = useState<string>('');
  const [generatedSpikeInputsKey, setGeneratedSpikeInputsKey] = useState<string | null>(null);

  // Hash of every input that affects spike output. Compared against
  // `generatedSpikeInputsKey` to know when spikes are stale.
  const currentSpikeInputsKey = useMemo(() => {
    if (!colorFlowGeom?.source) return null;
    const hasPattern = !!geometrySettings.patternShapes?.[0];
    if (!hasPattern) return null;
    return JSON.stringify({
      paletteVer: colorFlowGeom.source.palette.length,
      stackOrderVer: colorFlowGeom.source.stackOrder.join(','),
      baseMm: colorFlowGeom.source.baseMm,
      colorLayerMm: colorFlowGeom.source.colorLayerMm,
      patternShape: hasPattern,
      patternScale: geometrySettings.patternScale,
      tileSpacing: geometrySettings.tileSpacing,
      patternMargin: geometrySettings.patternMargin,
      tilingDistribution: geometrySettings.tilingDistribution,
      tilingOrientation: geometrySettings.tilingOrientation,
      tilingDirection: geometrySettings.tilingDirection,
      patternColor: geometrySettings.patternColor,
      spikeMaxMm: colorFlowSettings.spikeMaxMm,
      spikeColorMatch: colorFlowSettings.spikeColorMatch,
    });
  }, [colorFlowGeom?.source, geometrySettings, colorFlowSettings.spikeMaxMm, colorFlowSettings.spikeColorMatch]);

  // When the underlying source changes by VALUE (palette length, base
  // thickness, layer count), existing spikes reference the old color polygons
  // — drop them so the user doesn't see misaligned bumps until they
  // regenerate. We key by content not reference so the post-Generate render
  // (which produces a new but equivalent source object) doesn't trigger a
  // false-positive clear and wipe the spikes we just generated.
  const sourceShape = colorFlowGeom?.source
    ? `${colorFlowGeom.source.palette.length}|${colorFlowGeom.source.stackOrder.join(',')}|${colorFlowGeom.source.baseMm}|${colorFlowGeom.source.colorLayerMm}`
    : null;
  React.useEffect(() => {
    setSpikeGroups([]);
    setSpikeDiag('');
    setGeneratedSpikeInputsKey(null);
  }, [sourceShape]);

  const canGenerateSpikes = !!colorFlowGeom?.source && !!geometrySettings.patternShapes?.[0];
  const spikesStale = canGenerateSpikes && currentSpikeInputsKey !== generatedSpikeInputsKey;

  const handleGenerateSpikes = useCallback(() => {
    if (!colorFlowGeom?.source || !canGenerateSpikes) return;
    emitProcessing({ key: 'spikes:generate', busy: true, label: 'generating spikes' });
    // Yield to the browser so the spinner paints before the heavy work runs.
    setTimeout(() => {
      try {
        const result = generateSpikes({
          outlinePolygon: colorFlowGeom.source.outlinePolygon,
          layersInMm: colorFlowGeom.source.layersInMm,
          palette: colorFlowGeom.source.palette,
          stackOrder: colorFlowGeom.source.stackOrder,
          baseMm: colorFlowGeom.source.baseMm,
          colorLayerMm: colorFlowGeom.source.colorLayerMm,
          patternShape: geometrySettings.patternShapes?.[0],
          patternScale: geometrySettings.patternScale ?? 1,
          tileSpacing: geometrySettings.tileSpacing,
          patternMargin: geometrySettings.patternMargin,
          distribution: geometrySettings.tilingDistribution,
          orientation: geometrySettings.tilingOrientation,
          direction: geometrySettings.tilingDirection,
          spikeMaxMm: colorFlowSettings.spikeMaxMm,
          spikeColorMatch: colorFlowSettings.spikeColorMatch,
          fallbackColor: geometrySettings.patternColor,
        });
        setSpikeGroups(result.groups);
        setSpikeDiag(result.diag);
        setGeneratedSpikeInputsKey(currentSpikeInputsKey);
      } finally {
        emitProcessing({ key: 'spikes:generate', busy: false });
      }
    }, 16);
  }, [colorFlowGeom?.source, canGenerateSpikes, geometrySettings, colorFlowSettings.spikeMaxMm, colorFlowSettings.spikeColorMatch, currentSpikeInputsKey]);

  // Compose colorFlowGeom + spikes for downstream consumers. `source` is kept
  // around for the 2D viewer's live polygon/tile rendering.
  const colorFlowGeomWithSpikes = useMemo(() => {
    if (!colorFlowGeom) return null;
    return {
      base: colorFlowGeom.base,
      layers: colorFlowGeom.layers,
      spikes: spikeGroups,
      source: colorFlowGeom.source,
    };
  }, [colorFlowGeom, spikeGroups]);

  const initialImageAsset = useMemo(
    () => projectAssets.image
      ? { name: projectAssets.image.name, bytes: projectAssets.image.content as ArrayBuffer }
      : null,
    [projectAssets.image],
  );

  return (
    <AlertProvider>
      <ToastHost />
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
                setGeometrySettings={setGeometrySettings}
                meshRef={meshRef}
                activeTab={activeTab}
                selectedInlayId={selectedInlayId}
                setSelectedInlayId={setSelectedInlayId}
                previewInlay={previewInlay}
                setPreviewInlay={setPreviewInlay}
                colorFlowGeom={colorFlowGeomWithSpikes}
                colorFlowSettings={colorFlowSettings}
              />
              {showResumeBanner && resumeSnapshot && (
                <ResumeBanner
                  snapshot={resumeSnapshot}
                  onResume={handleResumeOpen}
                  onDiscard={handleResumeDiscard}
                  onDismiss={handleResumeDismiss}
                />
              )}
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
              onProjectAssetsChanged={(mutate) => setProjectAssets((prev) => mutate(prev))}
              exportControls={
                <React.Suspense fallback={
                  <div className="space-y-2 animate-pulse">
                    <div className="h-9 rounded-lg bg-gray-900 border border-gray-800" />
                    <div className="h-11 rounded-lg bg-gradient-to-br from-brand-500/30 to-accent-500/30" />
                  </div>
                }>
                  <OutputPanel
                    meshRef={meshRef}
                    debugMode={geometrySettings.debugMode ?? false}
                    className="bg-transparent border-0 shadow-none p-0 !p-0"
                    colorFlowGeom={colorFlowGeomWithSpikes}
                    colorFlowImageName={projectAssets.image?.name}
                    colorFlowOutlineSlug={baseSettings.outlineSlug}
                    baseColor={baseSettings.color}
                    getSidecarPayload={() => ({
                      project: {
                        version: 2 as const,
                        timestamp: Date.now(),
                        mode: viewerMode,
                        base: { ...baseSettings, cutoutShapes: null },
                        inlay: { ...inlaySettings },
                        geometry: { ...geometrySettings, patternShapes: null },
                        imageMode: colorFlowSettings,
                      },
                      assets: projectAssets,
                    })}
                  />
                </React.Suspense>
              }
              colorFlowSpikeDiag={spikeDiag}
              colorFlowCanGenerateSpikes={canGenerateSpikes}
              colorFlowSpikesStale={spikesStale}
              colorFlowHasSpikes={spikeGroups.length > 0}
              onGenerateSpikes={handleGenerateSpikes}
              colorFlowSettings={colorFlowSettings}
              setColorFlowSettings={setColorFlowSettings}
              colorFlowActive={colorFlowActive}
              colorFlowPaletteSize={colorFlowGeom?.source.palette.length ?? 0}
              onColorFlowGeomReady={handleColorFlowGeomReady}
              onColorFlowImageAssetChanged={handleImageAssetChanged}
              initialColorFlowImageAsset={initialImageAsset}
              onProjectImported={handleProjectImported}
            />
          </div>
        </main>

        {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
      </div>
    </AlertProvider>
  );
};

export default App;
