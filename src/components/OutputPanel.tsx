import React from 'react';
import { Download, Layers, Box } from 'lucide-react';
import { STLExporter } from 'three-stdlib';
import { useAlert } from '../context/AlertContext';
import { exportTo3MF } from 'three-3mf-exporter';
import * as THREE from 'three';
import type { Centroid } from '../colorflow/pipeline/quantize';
import type { ExtrudedGeometry } from '../colorflow/pipeline/extrude';
import { build3MF, type MeshPart } from '../colorflow/threeMfWriter';
import { emitProcessing, emitToast } from '../utils/eventBus';

interface OutputPanelProps {
  meshRef: React.RefObject<THREE.Group | null>;
  debugMode?: boolean;
  className?: string;
  /** When non-null, the 3MF export uses threeMfWriter with multi-part assembly. */
  colorFlowGeom?: {
    base: ExtrudedGeometry;
    layers: { centroid: Centroid; position: number; geom: ExtrudedGeometry }[];
    spikes: { centroidIndex: number; geom: ExtrudedGeometry; color: string }[];
  } | null;
  /** Optional filename prefix for the 3MF download. */
  colorFlowImageName?: string;
  /** Optional outline slug (used for filename suffix). */
  colorFlowOutlineSlug?: string | null;
  /** Hex color for the base mesh, used as the displaycolor in the 3MF
   *  Materials block. e.g. "#333333". */
  baseColor?: string;
  /** When provided, every exported 3MF embeds the full project (settings +
   *  original asset bytes) under `Metadata/grippy/` so the same file is
   *  both printable AND reloadable as an editable project. The callback
   *  is invoked at export time so the captured snapshot is current. */
  getSidecarPayload?: () => import('../utils/grippySidecar').GrippySidecarPayload | undefined;
}

const OutputPanel: React.FC<OutputPanelProps> = ({ meshRef, debugMode = false, className = '', colorFlowGeom, colorFlowImageName, colorFlowOutlineSlug, baseColor = '#888888', getSidecarPayload }) => {
  const { showAlert } = useAlert();

  const expandInstancedMesh = (instancedMesh: THREE.InstancedMesh): THREE.Group => {
    const group = new THREE.Group();
    group.name = instancedMesh.name;
    group.position.copy(instancedMesh.position);
    group.rotation.copy(instancedMesh.rotation);
    group.scale.copy(instancedMesh.scale);
    
    const count = instancedMesh.count;
    const matrix = new THREE.Matrix4();
    const geom = instancedMesh.geometry.clone();
    const material = instancedMesh.material;

    // Apply instance matrices
    for (let i = 0; i < count; i++) {
        instancedMesh.getMatrixAt(i, matrix);
        const mesh = new THREE.Mesh(geom, material);
        mesh.applyMatrix4(matrix);
        group.add(mesh);
    }
    return group;
  };

  // Match the new compound-pattern naming: `Pattern_0`, `Pattern_1`, …
  // (was a single `Pattern` mesh before the layer feature landed).
  const PATTERN_LAYER_NAME = /^Pattern_\d+$/;
  const isPatternLayerName = (name: string) => name === 'Pattern' || PATTERN_LAYER_NAME.test(name);

  const prepareForExport = (source: THREE.Object3D): THREE.Object3D | null => {
      // Check for InstancedMesh FIRST to ensure it gets expanded
      if (source instanceof THREE.InstancedMesh) {
          return expandInstancedMesh(source as THREE.InstancedMesh);
      }

      // Special handling for Base and Pattern_<i> (CSG results) — clone
      // shallow to drop CSG children. Matches the legacy `Pattern` name
      // for back-compat with any old saved meshes.
      if (source.name === 'Base' || isPatternLayerName(source.name)) {
          return source.clone(false);
      }
      
      // Filter out Debug and Waste meshes
      if (source.name.startsWith('Debug_')) {
          return null;
      }
      
      if (source instanceof THREE.Group) {
          const newGroup = new THREE.Group();
          newGroup.name = source.name;
          newGroup.position.copy(source.position);
          newGroup.rotation.copy(source.rotation);
          newGroup.scale.copy(source.scale);
          
          source.children.forEach(child => {
              const processed = prepareForExport(child);
              if (processed) newGroup.add(processed);
          });
          return newGroup;
      }
      
      if (source instanceof THREE.Mesh) {
          return source.clone(true);
      }
      
      return null;
  };

  const handleExport = (mode: 'merged' | 'base' | 'pattern') => {
    if (!meshRef.current) return;

    const group = meshRef.current;

    // Find meshes by name. Pattern is now potentially multi-layer
    // (`Pattern_0` / `Pattern_1` / …) — collect every match into a group
    // for export so compound layers all ride along.
    const baseMesh = group.getObjectByName("Base") as THREE.Mesh;
    const patternMeshes: THREE.Object3D[] = [];
    group.traverse((obj) => {
        if (isPatternLayerName(obj.name)) patternMeshes.push(obj);
    });

    let objectToExport: THREE.Object3D | null = null;
    let filename = 'grippysheet-model.stl';

    if (mode === 'base') {
        if (!baseMesh) {
             showAlert({ title: "Export Error", message: "Base mesh not found!", type: "error" });
             return;
        }
        objectToExport = baseMesh.clone(false);
        filename = 'grippysheet-base.stl';
    } else if (mode === 'pattern') {
        if (patternMeshes.length === 0) {
             showAlert({ title: "Export Error", message: "Pattern mesh not found!", type: "error" });
             return;
        }
        // Compound layers: collect every `Pattern_<i>` into a single
        // export group. Each gets the same Instanced→Mesh expansion
        // treatment via `prepareForExport`.
        const patternGroup = new THREE.Group();
        patternGroup.name = 'Pattern';
        patternMeshes.forEach((m) => {
            const processed = prepareForExport(m);
            if (processed) patternGroup.add(processed);
        });
        objectToExport = patternGroup;
        filename = 'grippysheet-pattern.stl';
    } else {
        // Merged
        const exportGroup = new THREE.Group();
        group.children.forEach(child => {
             const processed = prepareForExport(child);
             if (processed) exportGroup.add(processed);
        });
        objectToExport = exportGroup;
        filename = 'grippysheet-merged.stl';
    }

    if (!objectToExport) return;

    // Fix orientation for export
    // We want Z-up (flat), which matches our Three.js scene. 
    // So we don't need to rotate.
    objectToExport.updateMatrixWorld(true);

    const exporter = new STLExporter();
    const result = exporter.parse(objectToExport, { binary: true });
    
    // STLExporter (binary mode) returns a DataView<ArrayBufferLike> whose
    // buffer's TS type widens to include SharedArrayBuffer — Blob() only
    // accepts plain ArrayBuffer-backed views. The cast is safe: we never
    // construct SharedArrayBuffer-backed exports.
    const blob = new Blob([result as BlobPart], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.style.display = 'none';
    document.body.appendChild(link);

    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.click();

    document.body.removeChild(link);
    // Delay-revoke matches `downloadBlob` below — synchronous revoke can
    // abort the download read on slower devices before the browser's
    // file-save flow has had a chance to claim the blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    emitToast({ message: 'STL exported', detail: filename, tone: 'ready' });
  };

  function downloadBlob(blob: Blob, filename: string) {
    const link = document.createElement('a');
    link.style.display = 'none';
    document.body.appendChild(link);
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const handleExport3MF = async () => {
    emitProcessing({ key: 'export:3mf', busy: true, label: 'exporting 3MF' });
    try {
      if (colorFlowGeom) {
        // ColorFlow path — multi-part assembly via threeMfWriter
        const parts: MeshPart[] = [{ name: 'base', mesh: colorFlowGeom.base, color: baseColor }];
        colorFlowGeom.layers.forEach((entry) => {
          const c = entry.centroid;
          const hex = `${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
          parts.push({
            name: `color_${entry.position + 1}_${hex}`,
            mesh: entry.geom,
            color: `#${hex}`,
          });
        });
        colorFlowGeom.spikes.forEach((spike, i) => {
          const suffix = spike.centroidIndex >= 0 ? `c${spike.centroidIndex}` : `u${i}`;
          parts.push({
            name: `spikes_${suffix}`,
            mesh: spike.geom,
            color: spike.color,
          });
        });
        // Embed the full Grippy project under Metadata/grippy/ so the same
        // .3mf reloads as an editable project. Slicers ignore the sidecar;
        // the user gets one file that both prints and round-trips.
        const sidecar = getSidecarPayload?.();
        const blob = await build3MF(parts, 'footpad_assembly', sidecar);
        const stem = (colorFlowImageName || 'design').replace(/\.[^.]+$/, '');
        const suffix = colorFlowOutlineSlug || 'outline';
        const filename = `${stem}_${suffix}.3mf`;
        downloadBlob(blob, filename);
        emitToast({ message: '3MF exported', detail: filename, tone: 'ready' });
        return;
      }

      // Pattern path — existing three-3mf-exporter walk
      if (!meshRef.current) return;

      const group = meshRef.current;
      const exportGroup = new THREE.Group();

      group.children.forEach((child) => {
        const processed = prepareForExport(child);
        if (processed) exportGroup.add(processed);
      });

      if (exportGroup.children.length === 0) {
        showAlert({ title: "Export Error", message: "Nothing to export! The scene appears empty.", type: "warning" });
        return;
      }

      exportGroup.updateMatrixWorld(true);

      let blob = await exportTo3MF(exportGroup, {});
      // Inject the Grippy sidecar by reopening the writer's blob, adding
      // our Metadata/grippy/ entries, and regenerating. three-3mf-exporter
      // doesn't expose a custom-metadata API, so post-process is the only
      // path. Skipped when no payload is available (e.g. headless tests).
      const sidecar = getSidecarPayload?.();
      if (sidecar) {
        const { default: JSZipMod } = await import('jszip');
        const { addGrippySidecar } = await import('../utils/grippySidecar');
        const zip = await JSZipMod.loadAsync(blob);
        addGrippySidecar(zip, sidecar);
        blob = await zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
      }
      const filename = 'grippysheet-model.3mf';
      downloadBlob(blob, filename);
      emitToast({ message: '3MF exported', detail: filename, tone: 'ready' });
    } catch (e) {
      console.error("3MF Export Error:", e);
      showAlert({
        title: "Export Failed",
        message: `Failed to export 3MF: ${e instanceof Error ? e.message : String(e)}`,
        type: "error",
        confirmText: "OK",
      });
    } finally {
      emitProcessing({ key: 'export:3mf', busy: false });
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="space-y-1.5">
        <div className="grid grid-cols-1 gap-1.5">
            <button
            onClick={handleExport3MF}
            // Primary CTA — the goal action of the whole tool.
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-br from-brand-500 to-accent-500 hover:from-brand-400 hover:to-accent-500 text-white font-display font-bold tracking-wide rounded-lg transition-all shadow-glow-brand ring-1 ring-white/15"
            >
            <Box size={18} />
            EXPORT 3MF
            <span className="text-white/70 text-xs font-mono font-normal tracking-normal">· Bambu / Orca</span>
            </button>

            <button
            onClick={() => handleExport('merged')}
            // Secondary — single-mesh STL fallback.
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-gray-400 hover:text-white text-xs font-medium rounded-md hover:bg-gray-700/50 transition-colors"
            >
            <Layers size={13} />
            Export merged STL
            </button>
            
            {debugMode && (
              <div className="grid grid-cols-2 gap-2">
                  <button
                  onClick={() => handleExport('base')}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors border border-gray-600"
                  >
                  <Box size={16} />
                  Base Only
                  </button>
                  <button
                  onClick={() => handleExport('pattern')}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors border border-gray-600"
                  >
                  <Download size={16} />
                  Pattern Only
                  </button>
              </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default OutputPanel;
