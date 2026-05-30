import React, { useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, PerspectiveCamera, Line, ContactShadows } from '@react-three/drei';
import { InlayInteractionHandles } from './interaction/InlayInteractionHandles';
import { InlayHoverHint } from './interaction/InlayHoverHint';
import { TileRemovalHint } from './interaction/TileRemovalHint';
import { Box, Layers, ScanLine, Activity, Ghost, Camera as CameraIcon, Palette, Scissors, Eraser } from 'lucide-react';
import * as THREE from 'three';
import ScreenshotModal from './ScreenshotModal';
import { ErrorBoundary } from './ErrorBoundary';
import ImperativeModel from './ImperativeModel';
import Spinner from './Spinner';
import { BaseSettings, InlaySettings, GeometrySettings } from '../types/schemas';
import type { ColorFlowSettings } from '../colorflow/schema';
import CameraRig, { ViewState } from './CameraRig';
import FpsTracker from './FpsTracker';
import ScreenshotManager from './ScreenshotManager';
import { ColorFlowModel } from '../colorflow/ColorFlowModel';
import { TwoDViewer } from '../colorflow/TwoDViewer';
import { shapeToPolygon, transformOutlinePolygon, type OutlinePolygon } from '../colorflow/outlineToPolygon';
import type { Centroid } from '../colorflow/pipeline/quantize';
import type { ExtrudedGeometry } from '../colorflow/pipeline/extrude';
import { eventBus, emitFileDrop, emitToast, emitOpenOutlineLibrary, emitSetActiveTab } from '../utils/eventBus';
import IconTooltip from './ui/IconTooltip';
import ContextMenu, { ContextMenuItem } from './ui/ContextMenu';

interface ModelViewerProps {
  mode?: 'pattern' | 'colorflow';
  baseSettings: BaseSettings;
  inlaySettings: InlaySettings;
  geometrySettings: GeometrySettings;
  setGeometrySettings?: React.Dispatch<React.SetStateAction<GeometrySettings>>;
  meshRef: React.RefObject<THREE.Group | null>;
  onInlayChange?: (settings: InlaySettings) => void;
  selectedInlayId?: string | null;
  setSelectedInlayId?: (id: string | null) => void;
  previewInlay?: any;
  setPreviewInlay?: (item: any) => void;
  activeTab?: string;
  colorFlowGeom?: {
    base: ExtrudedGeometry;
    layers: { centroid: Centroid; position: number; geom: ExtrudedGeometry }[];
    spikes: { centroidIndex: number; geom: ExtrudedGeometry; color: string }[];
    source?: {
      layersInMm: import('../colorflow/workerProtocol').TracedLayerEntry[];
      palette: Centroid[];
      stackOrder: number[];
    };
  } | null;
  colorFlowSettings: ColorFlowSettings;
  /** When the App lifts the tile-removal mode (so the Geometry tab can
   *  surface its own toggle), these props let ModelViewer's toolbar
   *  button mirror that shared state. Optional — falls back to viewer-
   *  local state when the parent doesn't lift. */
  tileRemovalMode?: boolean;
  setTileRemovalMode?: React.Dispatch<React.SetStateAction<boolean>>;
}

const ModelViewer: React.FC<ModelViewerProps> = ({
  mode = 'pattern',
  baseSettings,
  inlaySettings,
  geometrySettings,
  setGeometrySettings,
  meshRef,
  onInlayChange,
  activeTab = 'base',
  selectedInlayId,
  setSelectedInlayId,
  previewInlay,
  setPreviewInlay,
  colorFlowGeom,
  colorFlowSettings,
  tileRemovalMode: tileRemovalModeProp,
  setTileRemovalMode: setTileRemovalModeProp,
}) => {
  const { size, thickness, color, cutoutShapes, baseOutlineRotation, baseOutlineMirror } = baseSettings;
  

// ... (skipping unchanged parts) ...



  const {
      patternShapes, patternType, patternScale, patternScaleZ,
      isTiled, tileSpacing, patternMargin,
      tilingDistribution, tilingDirection, tilingOrientation,
      clipToOutline, debugMode, patternColor: geomPatternColor, rotationClamp,
      holeMode,
      removedTiles: geomRemovedTiles,
      addedSpikes: geomAddedSpikes,
      extraLayers: geomExtraLayers,
  } = geometrySettings;

  // Default to the lightweight 2D top-down preview. Users opt into 3D when
  // they want a rendered look — saves GPU + main-thread work otherwise.
  const [renderMode, setRenderMode] = useState<'2d' | '3d'>('2d');
  const [viewState, setViewState] = useState<ViewState>({ type: 'ortho', timestamp: Date.now() });
  const [cameraType, setCameraType] = useState<'perspective' | 'orthographic'>('orthographic');

  // Initial sync
  useEffect(() => {
     if (viewState.type === 'ortho') setCameraType('orthographic');
     else setCameraType('perspective');
  }, []); 

  const [outlineState, setOutlineState] = useState({ base: false, inlay: false, pattern: false });
  const [wireframeState, setWireframeState] = useState({ base: false, inlay: false, pattern: false });
  const [showOutlinesMenu, setShowOutlinesMenu] = useState(false);
  const [showWireframeMenu, setShowWireframeMenu] = useState(false);
  
  const [showFps, setShowFps] = useState(true);
  const [baseOpacity, setBaseOpacity] = useState(1.0);
  const [inlayOpacity, setInlayOpacity] = useState(1.0);
  const [patternOpacity, setPatternOpacity] = useState(1.0);
  const [showOpacityMenu, setShowOpacityMenu] = useState(false);
  const [displayMode, setDisplayMode] = useState<'normal' | 'toon'>('normal');
  const [showDisplayMenu, setShowDisplayMenu] = useState(false);
  const [debugState, setDebugState] = useState({ pattern: false, holes: false, inlay: false });
  const [showDebugMenu, setShowDebugMenu] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  // Viewer-local "tile removal mode". When ON, hovering a pattern tile in
  // either 2D or 3D paints a red hint; clicking removes that tile from the
  // owning layer's `removedTiles` set. Mutually exclusive with normal
  // orbit/drag — OrbitControls remains enabled (so the user can still pan),
  // but the tile-click handler intercepts mouseups on the canvas first.
  // Lifted to App level so the Geometry tab can also drive it — gives users
  // a second discovery surface inside the right panel where they're already
  // configuring patterns. ModelViewer renders the toolbar mirror of the
  // toggle; props fall back to local state when the parent doesn't lift.
  const [tileRemovalModeLocal, setTileRemovalModeLocal] = useState(false);
  const tileRemovalMode = tileRemovalModeProp ?? tileRemovalModeLocal;
  const setTileRemovalMode = setTileRemovalModeProp ?? setTileRemovalModeLocal;
  // Global processing keys → label. UI shows spinner if non-empty.
  const [processingMap, setProcessingMap] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    return eventBus.on('processing', (e: { key: string; busy: boolean; label?: string }) => {
      // Functional setState — two emits on the same tick (e.g. one phase
      // ending while the next begins) would otherwise both clone the same
      // stale ref and the second would clobber the first's mutation.
      setProcessingMap((prev) => {
        const next = new Map(prev);
        if (e.busy) next.set(e.key, e.label ?? '');
        else next.delete(e.key);
        return next;
      });
    });
  }, []);

  const activeLabels = Array.from(processingMap.values()).filter((l) => l.length > 0);
  const isAnyProcessing = isProcessing || processingMap.size > 0;

  // Outline polygon (with Base rotation/mirror applied) — used by the 2D
  // preview viewer. Recomputed only when the relevant inputs change.
  const outlinePolygon2D = React.useMemo<OutlinePolygon | null>(() => {
    if (!cutoutShapes || cutoutShapes.length === 0) return null;
    const raw = shapeToPolygon(cutoutShapes[0], 64);
    return transformOutlinePolygon(raw, baseOutlineRotation ?? 0, !!baseOutlineMirror);
  }, [cutoutShapes, baseOutlineRotation, baseOutlineMirror]);

  // Pad-dimension readout. Use the loaded outline's bbox; fall back to the
  // configured square `size` when no outline is set.
  const padDims = React.useMemo(() => {
    if (cutoutShapes && cutoutShapes.length > 0) {
      const pts = cutoutShapes[0].getPoints(32);
      if (pts.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of pts) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        return { w: maxX - minX, h: maxY - minY, fromOutline: true };
      }
    }
    return { w: size, h: size, fromOutline: false };
  }, [cutoutShapes, size]);
  const fpsRef = React.useRef<HTMLDivElement>(null);
  const [showScreenshotModal, setShowScreenshotModal] = useState(false);
  const captureRef = React.useRef<((bgColor: string | null) => void) | null>(null);
  const opacityMenuRef = React.useRef<HTMLDivElement>(null);
  const displayMenuRef = React.useRef<HTMLDivElement>(null);
  const outlinesMenuRef = React.useRef<HTMLDivElement>(null);
  const wireframeMenuRef = React.useRef<HTMLDivElement>(null);
  const debugMenuRef = React.useRef<HTMLDivElement>(null);
  const orbitRef = React.useRef<any>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Toggle OrbitControls based on dragging state
  useEffect(() => {
    if (orbitRef.current) {
        orbitRef.current.enabled = !isDragging;
    }
  }, [isDragging]);


  const handleCapture = (bgColor: string | null) => {
      if (captureRef.current) {
          captureRef.current(bgColor);
          setShowScreenshotModal(false);
      }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (opacityMenuRef.current && !opacityMenuRef.current.contains(event.target as Node)) {
        setShowOpacityMenu(false);
      }
      if (displayMenuRef.current && !displayMenuRef.current.contains(event.target as Node)) {
        setShowDisplayMenu(false);
      }
      if (outlinesMenuRef.current && !outlinesMenuRef.current.contains(event.target as Node)) {
        setShowOutlinesMenu(false);
      }
      if (wireframeMenuRef.current && !wireframeMenuRef.current.contains(event.target as Node)) {
        setShowWireframeMenu(false);
      }
      if (debugMenuRef.current && !debugMenuRef.current.contains(event.target as Node)) {
        setShowDebugMenu(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [opacityMenuRef, displayMenuRef, outlinesMenuRef, wireframeMenuRef, debugMenuRef]);

  // Keyboard shortcuts. Match the hints printed in the IconTooltip kbds:
  //   2 / 3 → 2D/3D mode toggle
  //   O     → orthographic view (3D only)
  //   I     → isometric view (3D only)
  //   F     → FPS counter toggle
  // Never fires while a text input / textarea / contenteditable is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === '2') { setRenderMode('2d'); e.preventDefault(); }
      else if (k === '3') { setRenderMode('3d'); e.preventDefault(); }
      else if (k === 'o' && renderMode === '3d') { setViewState({ type: 'ortho', timestamp: Date.now() }); e.preventDefault(); }
      else if (k === 'i' && renderMode === '3d') { setViewState({ type: 'iso', timestamp: Date.now() }); e.preventDefault(); }
      else if (k === 'f') { setShowFps((v) => !v); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [renderMode]);

  // Idle wayfinding hint. After ~8s of cursor inactivity on the viewer
  // AND the user hasn't dismissed it before, surface a contextual nudge
  // toward the next likely action. `localStorage` remembers the dismissal
  // so users only see the hint once per browser.
  const [showHint, setShowHint] = useState(false);
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem('viewer_hint_dismissed') === 'true'; }
    catch { return false; }
  });
  const idleTimerRef = React.useRef<number | null>(null);
  useEffect(() => {
    if (hintDismissed) return;
    const reset = () => {
      setShowHint(false);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => setShowHint(true), 8000);
    };
    reset();
    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    return () => {
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
    // hintDismissed is a real dep — once it flips true, the effect re-runs
    // and the cleanup unsubscribes the listeners + clears the timer so the
    // hint can't re-fire later in the same session.
  }, [hintDismissed]);
  const dismissHint = () => {
    setShowHint(false);
    setHintDismissed(true);
    try { localStorage.setItem('viewer_hint_dismissed', 'true'); }
    catch (err) { console.warn('[viewer-hint] localStorage write failed', err); }
  };
  // Pick which hint to show based on the current scene state. Order matters:
  // first true match wins.
  const hint = (() => {
    const hasBase = !!(cutoutShapes && cutoutShapes.length > 0);
    const hasColorFlow = mode === 'colorflow' && !!colorFlowGeom;
    if (!hasBase) return { line1: 'Drag a deck DXF onto the canvas', line2: 'or pick from the library in the Base tab' };
    if (renderMode === '2d') return { line1: 'Press 3 to spin it in 3D', line2: 'or drop an image for a multi-color print' };
    if (!hasColorFlow) return { line1: 'Drop an image to start a ColorFlow', line2: 'PNG · JPG · SVG — anywhere on the canvas' };
    return null;
  })();

  // Canvas-level drag-and-drop. Lets users drop an image or DXF anywhere
  // on the viewer instead of hunting for the right-panel uploader. Image
  // files route to ColorFlow; DXFs route to the base outline. The drop
  // counter tracks nested enter/leave events so the overlay doesn't
  // flicker when the cursor crosses child elements.
  // Right-click context menu. Tracks both open-state and the click
  // coordinates so the menu portal can position at the cursor. Set via
  // onContextMenu on the outer viewer div; cleared by ContextMenu's
  // own click-outside / Escape handling.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Hidden file inputs that back the "Upload Outline…" / "Upload Image…"
  // context-menu items. Drag-drop is keyboard-inaccessible, so this is the
  // keyboard-friendly path to the same emitFileDrop pipeline the canvas
  // drag handler uses.
  const outlineInputRef = React.useRef<HTMLInputElement>(null);
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  const handleOutlineFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset before any early return so the user can pick the same file
    // again later (browsers suppress the change event if the value matches).
    e.target.value = '';
    if (!file) return;
    emitFileDrop({ file, kind: 'shape:base' });
    emitSetActiveTab('base');
  };

  const handleImageFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    emitFileDrop({ file, kind: 'image:colorflow' });
    emitSetActiveTab('colorflow');
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    // Only intercept right-clicks on the empty canvas — let native menus
    // through on inputs / contenteditables that might land here later.
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
    }
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const contextMenuItems: Array<ContextMenuItem | false | null> = (() => {
    const switchTo = renderMode === '2d' ? '3d' : '2d';
    const items: Array<ContextMenuItem | false | null> = [
      {
        label: switchTo === '3d' ? 'Switch to 3D' : 'Switch to 2D',
        shortcut: switchTo === '3d' ? '3' : '2',
        onClick: () => {
          setRenderMode(switchTo);
          emitToast({
            message: switchTo === '3d' ? 'Switched to 3D' : 'Switched to 2D',
            detail: switchTo === '3d' ? 'O for orthographic · I for isometric' : 'top-down preview',
            tone: 'info',
          });
        },
      },
    ];
    if (renderMode === '3d') {
      items.push({ separator: true });
      items.push({
        label: 'Reset View',
        shortcut: 'O',
        onClick: () => {
          setViewState({ type: 'ortho', timestamp: Date.now() });
          emitToast({ message: 'View reset', detail: 'orthographic', tone: 'info' });
        },
      });
      items.push({
        label: 'Take Screenshot',
        onClick: () => setShowScreenshotModal(true),
      });
    }
    items.push({ separator: true });
    // Keyboard-accessible equivalents to drag-drop. Routes through the same
    // emitFileDrop pipeline so subscribers (BaseControls / ColorFlowControls)
    // handle parse + toast identically — no duplicate success notifications
    // here. We do emit a `set-active-tab` so the relevant tab is open by the
    // time the parse completes.
    items.push({
      label: 'Upload Outline…',
      onClick: () => outlineInputRef.current?.click(),
    });
    items.push({
      label: 'Upload Image…',
      onClick: () => imageInputRef.current?.click(),
    });
    items.push({
      label: 'Open Library',
      onClick: () => {
        // Switch to Base tab first so the modal opens against the
        // right surface, then ask BaseControls to flip its showLibrary.
        emitSetActiveTab('base');
        emitOpenOutlineLibrary();
        emitToast({ message: 'Outline library', detail: 'pick a deck shape', tone: 'info' });
      },
    });
    return items;
  })();

  // Drag-classify: returns 'image' for image MIME, 'shape' only when one of
  // the dragged entries advertises a DXF/SVG MIME (or comes with no MIME
  // hint at all — common for these formats), and 'unknown' otherwise so
  // the overlay doesn't promise a successful drop for unsupported types.
  const [dropKind, setDropKind] = useState<'image' | 'shape' | 'unknown' | null>(null);
  const dragCounter = React.useRef(0);
  const dragKindFromEvent = (e: React.DragEvent): 'image' | 'shape' | 'unknown' => {
    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return 'unknown';
    let sawShapeMime = false;
    let sawUnknownMime = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind !== 'file') continue;
      if (it.type.startsWith('image/')) return 'image';
      if (it.type === '' || it.type === 'application/octet-stream') {
        // DXF/SVG often come through without a MIME on Linux/Windows.
        sawUnknownMime = true;
      } else if (it.type === 'image/svg+xml' || it.type === 'application/dxf') {
        sawShapeMime = true;
      }
    }
    if (sawShapeMime || sawUnknownMime) return 'shape';
    return 'unknown';
  };
  const onDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setDropKind(dragKindFromEvent(e));
  };
  const onDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDropKind(null);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragCounter.current = 0;
    setDropKind(null);
    // Multi-file drops: take the first and warn so the user knows the
    // others were ignored. Beats silent truncation.
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    if (files.length > 1) {
      emitToast({ message: 'Multiple files dropped', detail: `using first · ${files[0].name}`, tone: 'info' });
    }
    const file = files[0];
    const isImage = file.type.startsWith('image/');
    const lower = file.name.toLowerCase();
    const isDxf = lower.endsWith('.dxf');
    const isSvg = lower.endsWith('.svg');
    const isProject = lower.endsWith('.3mf') || lower.endsWith('.zip');
    // Success toasts ('Image loaded', 'Outline loaded', 'Project loaded')
    // fire from the consuming subscriber once the parse actually succeeds.
    // We only emit error toasts here for truly unsupported formats.
    if (isProject) {
      // Project drops route through the same loader as the Open button —
      // dispatched async so any UI mid-update (drag-leave, tab switch)
      // settles before the loader runs.
      void (async () => {
        try {
          const { importProjectBundle } = await import('../utils/projectUtils');
          const { emitProjectLoaded } = await import('../utils/eventBus');
          const { data, importedAssets } = await importProjectBundle(file);
          emitProjectLoaded({ data, assets: importedAssets ?? {} });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          emitToast({ message: 'Project failed to load', detail: msg.slice(0, 120), tone: 'error' });
        }
      })();
    } else if (isImage) {
      emitFileDrop({ file, kind: 'image:colorflow' });
    } else if (isDxf || isSvg) {
      emitFileDrop({ file, kind: 'shape:base' });
    } else {
      emitToast({ message: 'Unsupported file', detail: `${file.name} · expected image / DXF / SVG / .3mf project`, tone: 'error' });
    }
  };


  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={handleContextMenu}
      className="w-full h-full rounded-lg overflow-hidden border border-gray-800 relative group"
      style={{
        // Mirror the 2D canvas atmosphere — near-black base with warm/cool
        // radial blooms — so the viewer reads as a "lit surface" regardless
        // of which mode (2D/3D) is active.
        background: '#07090c',
        backgroundImage: [
          'radial-gradient(circle at 18% 22%, rgba(255, 107, 26, 0.10), transparent 55%)',
          'radial-gradient(circle at 85% 85%, rgba(0, 212, 255, 0.06), transparent 55%)',
        ].join(', '),
      }}
    >
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-row flex-wrap justify-center items-center gap-2 max-w-[calc(100%-1rem)] p-1.5 bg-gray-900/85 backdrop-blur-md rounded-xl border border-gray-700/60 shadow-xl ring-1 ring-black/30">

        {/* 2D / 3D mode toggle — bigger pill with animated active indicator
            so it reads as the primary viewer control, not chrome. */}
        <div className="relative inline-flex bg-gray-950/60 rounded-lg p-0.5 text-xs font-display font-semibold tracking-wide">
          <IconTooltip label="2D top-down preview" shortcut="2">
            <button
              onClick={() => setRenderMode('2d')}
              className={`relative z-10 px-3.5 py-1.5 rounded-md transition-colors ${renderMode === '2d' ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
              aria-label="2D preview"
            >2D</button>
          </IconTooltip>
          <IconTooltip label="3D render" shortcut="3">
            <button
              onClick={() => setRenderMode('3d')}
              className={`relative z-10 px-3.5 py-1.5 rounded-md transition-colors ${renderMode === '3d' ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
              aria-label="3D render"
            >3D</button>
          </IconTooltip>
          {/* Sliding active indicator. */}
          <span
            className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-md bg-gradient-to-br from-brand-500 to-accent-500 shadow-glow-brand transition-transform duration-200 ease-out"
            style={{ transform: renderMode === '2d' ? 'translateX(2px)' : 'translateX(calc(100% + 2px))' }}
          />
        </div>

        <div className="w-px bg-gray-700 mx-1" />

        <IconTooltip label="Orthographic view" shortcut="O">
          <button
            onClick={() => setViewState({ type: 'ortho', timestamp: Date.now() })}
            disabled={renderMode === '2d'}
            className={`p-2 rounded hover:bg-gray-700 transition-colors ${viewState.type === 'ortho' && renderMode === '3d' ? 'bg-brand-500/15 text-brand-400' : 'text-gray-400'} disabled:opacity-30 disabled:cursor-not-allowed`}
            aria-label="Orthographic View"
          >
            <Layers size={20} />
          </button>
        </IconTooltip>
        <IconTooltip label="Isometric view" shortcut="I">
          <button
            onClick={() => setViewState({ type: 'iso', timestamp: Date.now() })}
            disabled={renderMode === '2d'}
            className={`p-2 rounded hover:bg-gray-700 transition-colors ${viewState.type === 'iso' && renderMode === '3d' ? 'bg-brand-500/15 text-brand-400' : 'text-gray-400'} disabled:opacity-30 disabled:cursor-not-allowed`}
            aria-label="Isometric View"
          >
            <Box size={20} />
          </button>
        </IconTooltip>



        {debugMode && renderMode === '3d' && (
          <>
            <div className="w-px bg-gray-700 mx-1" />
            
            <div className="relative" ref={outlinesMenuRef}>
                <button
                onClick={() => setShowOutlinesMenu(!showOutlinesMenu)}
                className={`p-2 rounded hover:bg-gray-700 transition-colors ${Object.values(outlineState).some(v => v) ? 'bg-green-500/20 text-green-400' : 'text-gray-400'}`}
                title="Toggle Outlines"
                >
                <ScanLine size={20} />
                </button>
                
                {showOutlinesMenu && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-gray-800 border border-gray-700 rounded shadow-lg p-2 z-50 min-w-[160px] flex flex-col gap-1">
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={outlineState.base} 
                                onChange={(e) => setOutlineState(prev => ({...prev, base: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-green-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Grip Shape</span>
                        </label>
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={outlineState.inlay} 
                                onChange={(e) => setOutlineState(prev => ({...prev, inlay: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-green-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Inlay</span>
                        </label>
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={outlineState.pattern} 
                                onChange={(e) => setOutlineState(prev => ({...prev, pattern: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-green-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Pattern</span>
                        </label>
                    </div>
                )}
            </div>

            <div className="relative" ref={wireframeMenuRef}>
                <button
                    onClick={() => setShowWireframeMenu(!showWireframeMenu)}
                    className={`p-2 rounded hover:bg-gray-700 transition-colors ${Object.values(wireframeState).some(v => v) ? 'bg-yellow-500/20 text-yellow-400' : 'text-gray-400'}`}
                    title="Toggle Wireframe"
                >
                    <Box size={20} className="stroke-[1.5]" />
                </button>

                {showWireframeMenu && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-gray-800 border border-gray-700 rounded shadow-lg p-2 z-50 min-w-[160px] flex flex-col gap-1">
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={wireframeState.base} 
                                onChange={(e) => setWireframeState(prev => ({...prev, base: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-yellow-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Grip Shape</span>
                        </label>
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={wireframeState.inlay} 
                                onChange={(e) => setWireframeState(prev => ({...prev, inlay: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-yellow-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Inlay</span>
                        </label>
                        <label className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 rounded cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={wireframeState.pattern} 
                                onChange={(e) => setWireframeState(prev => ({...prev, pattern: e.target.checked}))}
                                className="rounded bg-gray-600 border-gray-500 text-yellow-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-200">Pattern</span>
                        </label>
                    </div>
                )}
            </div>

            <div className="relative" ref={debugMenuRef}>
                <button
                    onClick={() => setShowDebugMenu(!showDebugMenu)}
                    className={`p-2 rounded hover:bg-gray-700 transition-colors ${Object.values(debugState).some(v => v) ? 'bg-red-500/20 text-red-400' : 'text-gray-400'}`}
                    title="Toggle Cutting Zones"
                >
                    <Scissors size={20} />
                </button>

                {showDebugMenu && (
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-gray-800 border border-gray-700 rounded shadow-lg p-2 z-50 min-w-[200px] flex flex-col gap-1">
                        <button
                            onClick={() => setDebugState(prev => ({...prev, pattern: !prev.pattern}))}
                            className={`w-full text-left px-3 py-2 rounded transition-colors text-sm flex items-center gap-2 ${
                                debugState.pattern 
                                    ? 'bg-brand-500/15 text-brand-400' 
                                    : 'text-gray-300 hover:bg-gray-700'
                            }`}
                        >
                            <span>Pattern Cutter</span>
                        </button>
                        
                        <button
                            onClick={() => setDebugState(prev => ({...prev, inlay: !prev.inlay}))}
                             className={`w-full text-left px-3 py-2 rounded transition-colors text-sm flex items-center gap-2 ${
                                debugState.inlay 
                                    ? 'bg-green-500/20 text-green-400' 
                                    : 'text-gray-300 hover:bg-gray-700'
                            }`}
                        >
                            <span>Inlay Cutter</span>
                        </button>
                        
                        <button
                            onClick={() => setDebugState(prev => ({...prev, holes: !prev.holes}))}
                             className={`w-full text-left px-3 py-2 rounded transition-colors text-sm flex items-center gap-2 ${
                                debugState.holes 
                                    ? 'bg-red-500/20 text-red-400' 
                                    : 'text-gray-300 hover:bg-gray-700'
                            }`}
                        >
                            <span>Hole Cutter</span>
                        </button>
                    </div>
                )}
            </div>
          </>
        )}
        
        <div className="w-px bg-gray-700 mx-1" />

        <IconTooltip label="FPS counter" shortcut="F">
          <button
              onClick={() => setShowFps(!showFps)}
              className={`p-2 rounded hover:bg-gray-700 transition-colors ${showFps ? 'bg-signal-info/15 text-signal-info' : 'text-gray-400'}`}
              aria-label="Toggle FPS counter"
          >
              <Activity size={20} />
          </button>
        </IconTooltip>
        {/* Tile removal mode — pattern-mode only. The toggle is hidden in
            ColorFlow (no pattern tiles to remove there) and when the parent
            didn't pass setGeometrySettings (defensive — should never happen
            in practice but keeps the prop-optional contract intact). */}
        {mode === 'pattern' && setGeometrySettings && (
          <IconTooltip label="Tile selection — click tiles to remove">
            <button
                onClick={() => setTileRemovalMode((v) => !v)}
                className={`p-2 rounded hover:bg-gray-700 transition-colors ${tileRemovalMode ? 'bg-signal-error/15 text-signal-error ring-1 ring-signal-error/40 shadow-[0_0_12px_rgba(255,56,96,0.35)]' : 'text-gray-400'}`}
                aria-label="Toggle tile selection mode"
                aria-pressed={tileRemovalMode}
            >
                <Eraser size={20} />
            </button>
          </IconTooltip>
        )}
        <div className="relative" ref={opacityMenuRef}>
            <IconTooltip label="Opacity">
              <button
                onClick={() => setShowOpacityMenu(!showOpacityMenu)}
                className={`flex items-center gap-2 p-2 rounded hover:bg-gray-700 transition-colors ${patternOpacity < 1 ? 'bg-brand-500/15 text-brand-400' : 'text-gray-400'}`}
                aria-label="Grip Geometry Opacity"
              >
                <Ghost size={20} />
              </button>
            </IconTooltip>
            
            {showOpacityMenu && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-gray-800 border border-gray-700 rounded shadow-lg p-4 z-50 min-w-[200px] flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Base Opacity</span>
                            <span>{Math.round(baseOpacity * 100)}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={baseOpacity * 100} 
                            onChange={(e) => setBaseOpacity(parseInt(e.target.value) / 100)}
                            className="w-full "
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Inlay Opacity</span>
                            <span>{Math.round(inlayOpacity * 100)}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={inlayOpacity * 100} 
                            onChange={(e) => setInlayOpacity(parseInt(e.target.value) / 100)}
                            className="w-full "
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Pattern Opacity</span>
                            <span>{Math.round(patternOpacity * 100)}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            value={patternOpacity * 100} 
                            onChange={(e) => setPatternOpacity(parseInt(e.target.value) / 100)}
                            className="w-full "
                        />
                    </div>
                </div>
            )}
        </div>  
        <div className="relative" ref={displayMenuRef}>
            <IconTooltip label="Render style">
              <button
                onClick={() => setShowDisplayMenu(!showDisplayMenu)}
                className={`flex items-center gap-2 p-2 rounded hover:bg-gray-700 transition-colors ${displayMode === 'toon' ? 'bg-pink-500/20 text-pink-400' : 'text-gray-400'}`}
                aria-label="Display Mode"
              >
                <Palette size={20} />
              </button>
            </IconTooltip>
            
            {showDisplayMenu && (
                <div className="absolute top-full right-0 mt-2 bg-gray-800 border border-gray-700 rounded shadow-lg overflow-hidden whitespace-nowrap z-50 flex flex-col min-w-[100px]">
                    <button 
                        className={`text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors ${displayMode === 'normal' ? 'bg-brand-500/15 text-brand-400' : 'text-gray-300'}`}
                        onClick={() => { setDisplayMode('normal'); setShowDisplayMenu(false); }}
                    >
                        Normal
                    </button>
                    <button 
                        className={`text-left px-4 py-2 text-sm hover:bg-gray-700 transition-colors ${displayMode === 'toon' ? 'bg-pink-500/20 text-pink-400' : 'text-gray-300'}`}
                        onClick={() => { setDisplayMode('toon'); setShowDisplayMenu(false); }}
                    >
                        Toon
                    </button>
                </div>
            )}
        </div>     
        <IconTooltip label="Screenshot">
          <button
              onClick={() => setShowScreenshotModal(true)}
              className="p-2 rounded hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
              aria-label="Screenshot"
          >
              <CameraIcon size={20} />
          </button>
        </IconTooltip>
      </div>

      {/* Idle wayfinding pill — fades in after ~8s of inactivity, points
          at the next likely action based on what's loaded. Dismissable;
          the dismissal is remembered in localStorage. */}
      {showHint && hint && !dropKind && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="flex items-start gap-3 pl-4 pr-2 py-2.5 rounded-xl bg-gray-950/85 backdrop-blur-md border border-brand-500/40 shadow-glow-brand ring-1 ring-white/5 max-w-sm">
            <span className="text-brand-400 text-base leading-none mt-0.5">★</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-display font-semibold text-gray-100 tracking-wide">{hint.line1}</div>
              <div className="text-[10px] font-mono text-gray-500 mt-0.5">{hint.line2}</div>
            </div>
            <button
              onClick={dismissHint}
              className="self-start p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
              aria-label="Dismiss hint"
              title="Dismiss"
            >
              <span className="text-xs leading-none">✕</span>
            </button>
          </div>
        </div>
      )}

      {/* Drop-target overlay — full-canvas hint when a file is being
          dragged in. Image kind suggests ColorFlow; shape kind suggests
          base outline. Both share the brand-orange glow treatment. */}
      {dropKind && (() => {
        const unsupported = dropKind === 'unknown';
        const accent = unsupported ? 'border-signal-error bg-signal-error/[0.04]' : 'border-brand-500 bg-brand-500/[0.04]';
        const halo = unsupported ? '' : 'shadow-glow-brand';
        const glyph = dropKind === 'image' ? '🎨' : dropKind === 'shape' ? '📐' : '⛔';
        const headline = dropKind === 'image'
          ? 'Drop to start a ColorFlow'
          : dropKind === 'shape'
            ? 'Drop to load the deck outline'
            : 'Unsupported file';
        const sub = dropKind === 'image'
          ? 'PNG · JPG · SVG · WebP'
          : dropKind === 'shape'
            ? 'DXF · SVG'
            : 'release elsewhere to cancel';
        return (
          <div className={`absolute inset-0 z-30 flex items-center justify-center pointer-events-none ${accent} backdrop-blur-[2px] animate-in fade-in duration-150`}>
            <div className={`px-6 py-5 rounded-2xl border-2 border-dashed ${accent.split(' ')[0]} bg-gray-950/85 ${halo} text-center`}>
              <div className="text-3xl mb-2">{glyph}</div>
              <div className="font-display font-bold text-lg tracking-wide text-white">{headline}</div>
              <div className="text-[11px] font-mono text-gray-400 mt-1">{sub}</div>
            </div>
          </div>
        );
      })()}

      {isAnyProcessing && (
          <>
            {/* Top-right telemetry pill — signals what's running. */}
            <div className="absolute top-4 right-4 z-20 flex items-center gap-2 px-2.5 py-1.5 bg-gray-950/85 backdrop-blur-md rounded-lg border border-signal-info/40 shadow-lg ring-1 ring-signal-info/20">
                <span className="inline-block w-2 h-2 rounded-full bg-signal-info animate-pulse shadow-[0_0_10px_rgba(0,212,255,0.7)]" />
                <span className="text-[10px] font-display font-semibold tracking-widest text-signal-info">WORKING</span>
                {activeLabels.length > 0 && (
                  <span className="text-[10px] font-mono text-signal-info/80 max-w-[180px] truncate">
                    {activeLabels.join(' · ')}
                  </span>
                )}
            </div>
            {/* Canvas shimmer veil — diagonal sweep makes progress feel alive
                during multi-second parses (DXF, STL, ColorFlow trace+extrude). */}
            <div className="absolute inset-0 z-[5] pointer-events-none overflow-hidden">
              <div className="absolute inset-0 opacity-25 bg-gradient-to-br from-transparent via-signal-info/15 to-transparent bg-[length:200%_200%] animate-[shimmer_2.4s_linear_infinite]" />
            </div>
          </>
      )}

      {(() => {
        // Empty-state guidance overlay — only in 3D mode. The 2D canvas
        // paints its own hero empty state (ghost deck silhouette + headline)
        // so the overlay would double up.
        const hasBase = !!(cutoutShapes && cutoutShapes.length > 0);
        const hasColorFlow = mode === 'colorflow' && !!colorFlowGeom;
        if (hasBase || hasColorFlow || isAnyProcessing || renderMode === '2d') return null;
        return (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="bg-gray-900/85 backdrop-blur border border-gray-700 rounded-lg px-5 py-4 text-center max-w-sm">
              <p className="text-sm text-gray-200 font-medium">Pick a base outline to start</p>
              <p className="text-[11px] text-gray-400 mt-1">
                Use the <span className="text-brand-400">Base tab</span> → Outline Library — or upload your own DXF.
              </p>
            </div>
          </div>
        );
      })()}

      {(() => {
        // ColorFlow + pattern coexistence hint. In colorflow mode the 3D
        // viewer renders ColorFlowModel, which only shows pattern bumps
        // once the user clicks "Generate preview" (heavy spike pipeline
        // is gated behind a button by design). Without this hint the
        // pattern silently vanishes from the 3D scene the moment an
        // image is dropped — reported as "image removes the grip pattern".
        const hasPattern = !!geometrySettings.patternShapes?.[0];
        const hasSpikesGenerated = (colorFlowGeom?.spikes.length ?? 0) > 0;
        if (
          renderMode !== '3d' ||
          mode !== 'colorflow' ||
          !colorFlowGeom ||
          !hasPattern ||
          hasSpikesGenerated ||
          isAnyProcessing
        ) {
          return null;
        }
        return (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
            <div className="bg-gray-900/85 backdrop-blur border border-brand-500/40 rounded-lg px-4 py-2.5 text-center shadow-lg max-w-sm">
              <p className="text-[11px] font-mono text-brand-400 tracking-wider mb-1">PATTERN STAGED</p>
              <p className="text-xs text-gray-300 leading-snug">
                Open the <span className="text-brand-400">ColorFlow tab</span> and click <span className="text-gray-100 font-medium">Generate preview</span> to add your pattern as spikes on top of the colors.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Consolidated bottom-right info chip — pad size + (optional) FPS in
          one panel. Skipped entirely in 2D since TwoDViewer paints its own
          pad-dim chip into the canvas overlay. The FPS counter is kept here
          (separate ref) so FpsTracker can mutate textContent without React. */}
      {renderMode === '3d' && (
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 px-2.5 py-1 bg-gray-900/70 backdrop-blur-sm border border-gray-700/60 rounded-md text-[11px] font-mono tabular-nums pointer-events-none select-none shadow-lg">
          <span className={padDims.fromOutline ? 'text-gray-200' : 'text-gray-500'}>
            <span className="text-gray-500">pad </span>
            {padDims.w.toFixed(1)} × {padDims.h.toFixed(1)} mm
          </span>
          {showFps && (
            <>
              <span className="text-gray-700">·</span>
              <span ref={fpsRef} className="text-signal-ready font-semibold w-14 text-right">0 FPS</span>
            </>
          )}
        </div>
      )}

      {/* Initial-Canvas-load veil — disappears once the renderer reports
          `onCreated`. Avoids a black flash on first paint. Skipped in 2D mode
          since the Three.js Canvas doesn't mount until the user opts in. */}
      {!canvasReady && renderMode === '3d' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm pointer-events-none">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-300">
            <Spinner size={16} />
            <span>Initializing 3D viewer…</span>
          </div>
        </div>
      )}

      {renderMode === '2d' && (
        <TwoDViewer
          outlinePolygon={outlinePolygon2D}
          layersInMm={colorFlowGeom?.source?.layersInMm ?? []}
          palette={colorFlowGeom?.source?.palette ?? []}
          stackOrder={colorFlowGeom?.source?.stackOrder ?? []}
          inlayItems={colorFlowGeom ? undefined : inlaySettings.items}
          geometrySettings={geometrySettings}
          baseColor={color}
          spikeColorMatch={colorFlowSettings.spikeColorMatch}
          tileRemovalMode={mode === 'pattern' && tileRemovalMode}
          onGeometryChange={setGeometrySettings}
        />
      )}

      <ErrorBoundary>
      <div className={renderMode === '3d' ? 'absolute inset-0' : 'hidden'}>
      <Canvas shadows onCreated={() => setCanvasReady(true)}>
        {/* Top-down ortho. `up={[0, 1, 0]}` is critical: with the world's
            z-up convention and a camera looking straight down -Z, using
            `up=[0,0,1]` is parallel to the view direction (gimbal lock) —
            the resulting camera basis is degenerate and Raycaster builds
            invalid rays so click-to-remove silently misses every tile.
            See TileRemovalHint. The perspective iso camera keeps z-up
            because its view direction isn't parallel to z. */}
        <OrthographicCamera makeDefault={cameraType === 'orthographic'} position={[0, 0, 1000]} near={-2000} far={2000} up={[0, 1, 0]} />
        <PerspectiveCamera makeDefault={cameraType === 'perspective'} position={[500, -500, 500]} near={0.1} far={5000} up={[0, 0, 1]} fov={45} />
        
        {showFps && <FpsTracker fpsRef={fpsRef as React.RefObject<HTMLDivElement>} />}
        <ScreenshotManager triggerRef={captureRef} size={size} />
        <CameraRig viewState={viewState} size={size} setCameraType={setCameraType} />
        <OrbitControls 
            ref={orbitRef}
            makeDefault 
            mouseButtons={{
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.PAN,
                RIGHT: THREE.MOUSE.PAN
            }}
        />
        {/* Product-photo lighting rig — cool hemisphere fill, warm key from
            the upper-right, gentler cool rim from the upper-left to suggest
            the same warm/cool bloom the canvas backdrop paints. */}
        <hemisphereLight args={[0xe8f2ff, 0x1a1a1f, 0.55]} />
        <directionalLight position={[180, -120, 220]} intensity={1.15} color={0xfff0e0} />
        <directionalLight position={[-160, 80, 140]} intensity={0.35} color={0xc0e0ff} />
        {/* Soft contact shadow under the pad — gives the model the same
            "resting on a surface" weight the 2D viewer gets from its
            canvas drop shadow. Sits just below the base z=0 plane. */}
        <ContactShadows
          position={[0, 0, -0.01]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={1200}
          blur={2.6}
          opacity={0.55}
          far={40}
          color={0x000000}
          // Bake the shadow once instead of every frame. The scene is
          // effectively static between user actions; re-bake is triggered
          // by remounting via the `key` (changes when the model changes).
          frames={1}
          key={`shadow-${(cutoutShapes && cutoutShapes.length) ?? 0}-${(colorFlowGeom?.layers.length ?? 0)}-${(colorFlowGeom?.spikes.length ?? 0)}`}
        />
        {/* Studio floor — a near-black circular plane sitting just under the
            contact-shadow pass so the shadow lands on a surface instead of
            disappearing into the canvas backdrop. Sized far past the pad
            bounds (radius ~2800mm vs ~200-260mm pad) so the edge never reads
            as a disc, only as "ground". Scene is Z-up; circleGeometry defaults
            to the XY plane, so no rotation is needed. */}
        <mesh position={[0, 0, -0.5]} renderOrder={-2}>
          <circleGeometry args={[2800, 96]} />
          <meshStandardMaterial color={0x0e1218} metalness={0} roughness={0.95} />
        </mesh>
        {/* Warm-bloom tint — a much smaller plane biased off-center toward the
            upper-left, at a whisper of brand-orange opacity. Echoes the warm
            radial bloom on the 2D canvas backdrop without being visible as a
            shape. Sits a hair above the floor to avoid z-fighting. */}
        <mesh position={[-220, 220, -0.49]} renderOrder={-1}>
          <circleGeometry args={[900, 64]} />
          <meshStandardMaterial color={0xff6b1a} metalness={0} roughness={1} transparent opacity={0.04} />
        </mesh>

            {/* Route to ColorFlowModel in colorflow mode, ImperativeModel in pattern mode */}
            {mode === 'colorflow' ? (
              <ColorFlowModel
                ref={meshRef}
                baseGeom={colorFlowGeom?.base ?? null}
                layers={colorFlowGeom?.layers ?? []}
                spikes={colorFlowGeom?.spikes ?? []}
                displayMode={displayMode}
                baseColor={color}
              />
            ) : (
              <ImperativeModel
                ref={meshRef}
                size={size}
                thickness={thickness}
                color={color}
                cutoutShapes={cutoutShapes}
                baseOutlineRotation={baseOutlineRotation}
                baseOutlineMirror={baseOutlineMirror}
                patternColor={geomPatternColor}
                patternShapes={patternShapes}
                patternType={patternType}
                patternScale={patternScale}
                patternScaleZ={patternScaleZ === '' ? undefined : Number(patternScaleZ)}
                isTiled={isTiled}
                tileSpacing={tileSpacing}
                patternMargin={patternMargin}
                tilingDistribution={tilingDistribution}
                tilingDirection={tilingDirection}
                tilingOrientation={tilingOrientation}
                baseRotation={geometrySettings.baseRotation}
                rotationClamp={rotationClamp}
                patternMaxHeight={geometrySettings.patternMaxHeight === '' ? undefined : Number(geometrySettings.patternMaxHeight)}
                removedTiles={geomRemovedTiles}
                addedSpikes={geomAddedSpikes}
                extraLayers={geomExtraLayers}
                clipToOutline={clipToOutline}
                holeMode={holeMode}

                inlayItems={inlaySettings.items}


                wireframeBase={wireframeState.base}
                wireframeInlay={wireframeState.inlay}
                wireframePattern={wireframeState.pattern}
                baseOpacity={baseOpacity}
                inlayOpacity={inlayOpacity}
                patternOpacity={patternOpacity}
                displayMode={displayMode}
                onProcessingChange={setIsProcessing}
                debugShowPatternCutter={debugState.pattern}
                debugShowInlayCutter={debugState.inlay}
                debugShowHoleCutter={debugState.holes}
                isDragging={isDragging}
                previewInlay={previewInlay}
              />
            )}

        {mode === 'pattern' && activeTab === 'inlay' && onInlayChange && (
            <InlayInteractionHandles
                baseSettings={baseSettings}
                inlaySettings={inlaySettings}
                onInlayChange={onInlayChange}
                setIsDragging={setIsDragging}
                thickness={thickness}
                selectedInlayId={selectedInlayId || null}
                setSelectedInlayId={setSelectedInlayId}
                setPreviewInlay={setPreviewInlay}
                cutoutShapes={cutoutShapes}
            />
        )}

        {/* Hover discoverability for inlays. Only mounts in pattern-mode + on
            the Inlay tab — same gating as InlayInteractionHandles — so users
            see the orange outline + pointer cursor where clicking actually
            leads somewhere (a selection that then surfaces the green handles).
            Suppresses internally when an inlay is selected or mid-drag. */}
        {mode === 'pattern' && activeTab === 'inlay' && setSelectedInlayId && (
            <InlayHoverHint
                meshRef={meshRef}
                selectedInlayId={selectedInlayId || null}
                setSelectedInlayId={setSelectedInlayId}
                isDragging={isDragging}
            />
        )}

        {/* Tile removal hover hint + click handler. Pattern-mode only.
            Lives inside the Canvas so it can raycast against the imperative
            pattern meshes and overlay an outline at the hovered tile. */}
        {mode === 'pattern' && setGeometrySettings && (
            <TileRemovalHint
                meshRef={meshRef}
                enabled={tileRemovalMode}
                onGeometryChange={setGeometrySettings}
            />
        )}
        
        {outlineState.base && cutoutShapes && cutoutShapes.length > 0 && (
             (() => {
                const shape = cutoutShapes[0];
                const rawPoints = shape.getPoints();
                 // 1. Mirror
                let pts = baseOutlineMirror ? rawPoints.map(p => new THREE.Vector2(-p.x, p.y)) : rawPoints;
                
                 // 2. Rotate
                if (baseOutlineRotation) {
                    const rad = baseOutlineRotation * (Math.PI / 180);
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    pts = pts.map(p => new THREE.Vector2(
                        p.x * cos - p.y * sin,
                        p.x * sin + p.y * cos
                    ));
                }

                return (
                    <Line
                    points={pts} 
                    color="#4ade80"
                    lineWidth={2}
                    position={[0, 0, thickness + 0.1]}
                    scale={[1, 1, 1]}
                    />
                );
             })()
        )}

        {outlineState.inlay && inlaySettings.items && inlaySettings.items.length > 0 && inlaySettings.items.map((item, itemIdx) => {
             // Calculate effective position for the outline
             // We use the item's x/y directly as we did in ImperativeModel
             const dx = item.x || 0;
             const dy = item.y || 0;
             
             const shapeList = item.shapes || [];
             
             return shapeList.map((shapeParams: any, shapeIdx: number) => {
                const shape = shapeParams.shape || shapeParams;
                const rawPoints = shape.getPoints();
                
                // 1. Mirror
                // Mirroring flips X. 
                let points = item.mirror 
                    ? rawPoints.map((p: THREE.Vector2) => new THREE.Vector2(-p.x, p.y)) 
                    : rawPoints;

                // 2. We can't use simple <Line> rotation prop because we need to apply it around the center 
                // BEFORE translation.
                // Actually <Line> rotation rotates around the object's origin. 
                // If we set position=[dx, dy], rotation will rotate around (dx, dy) which is what we want 
                // IF the geometry is centered at 0,0.
                
                // However, mirroring reverses winding order which might not matter for a Line,
                // but if we mirror points manually, we are good.
                
                return (
                <Line
                    key={`inlay-outline-${item.id}-${shapeIdx}`}
                    points={points} 
                    color="#4ade80"
                    lineWidth={2}
                    position={[dx, dy, thickness + 0.1 + ((itemIdx + 1) * 0.001)]}
                    scale={[item.scale, item.scale, 1]}
                    rotation={[0, 0, item.rotation * (Math.PI / 180)]}
                />
                );
             });
        })}

        {outlineState.pattern && patternShapes && patternShapes.length > 0 && patternShapes[0] instanceof THREE.Shape && (
             <Line
                points={patternShapes[0].getPoints()} 
                color="#4ade80"
                lineWidth={2}
                position={[0, 0, thickness + 0.2]}
            />
        )}

        {/* Rotate GridHelper 90deg X to lie on XY plane. Args 2/3 set the
            center axis colour + grid line colour — picked to disappear into
            the new dark backdrop instead of fighting it. */}
        <gridHelper args={[2000, 20, 0x1a2030, 0x14181f]} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} />
      </Canvas>
      </div>
      </ErrorBoundary>
      <ScreenshotModal
         isOpen={showScreenshotModal}
         onClose={() => setShowScreenshotModal(false)}
         onCapture={handleCapture}
      />
      <ContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextMenuItems}
        onClose={() => setContextMenu(null)}
      />
      {/* Hidden file inputs backing the right-click "Upload Outline…" /
          "Upload Image…" menu items. Kept here (not inside the menu) so the
          inputs persist across menu open/close cycles and so the `.click()`
          call from the menu item's onClick targets a live DOM node. */}
      <input
        ref={outlineInputRef}
        type="file"
        accept=".dxf,.svg"
        hidden
        onChange={handleOutlineFilePick}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleImageFilePick}
      />
    </div>
  );
};

export default ModelViewer;
