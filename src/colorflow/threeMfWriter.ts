import JSZip from 'jszip';
import type { ExtrudedGeometry } from './pipeline/extrude';
import { addGrippySidecar, type GrippySidecarPayload } from '../utils/grippySidecar';

export interface MeshPart {
  name: string;
  mesh: ExtrudedGeometry;
  /**
   * Display color for this part as `"#RRGGBB"` (or `"#RRGGBBAA"`).
   * Emitted into the 3MF Materials and Properties extension so slicers
   * (BambuStudio / OrcaSlicer / PrusaSlicer) show the part in its
   * assigned color and can auto-map it to a filament profile by name.
   */
  color: string;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  } as Record<string, string>)[c]);
}

function buildModelXml(parts: MeshPart[], assemblyName: string): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<model unit="millimeter" xml:lang="en-US"';
  xml += ' xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"';
  xml += ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">\n';
  xml += '<metadata name="Application">GrippySheet ColorFlow</metadata>\n';
  xml += '<resources>\n';

  // Materials block — one <m:base> per part. The pid+p1 on each triangle
  // (below) references this group's id ("1") and the part's index here.
  xml += '<m:basematerials id="1">';
  parts.forEach((p) => {
    xml += `<m:base name="${escapeXml(p.name)}" displaycolor="${escapeXml(p.color)}"/>`;
  });
  xml += '</m:basematerials>\n';

  parts.forEach((p, i) => {
    const id = i + 1;
    const matIndex = i;
    // Object-level pid/pindex gives slicers that only honour per-object material
    // (rather than walking per-triangle pid/p1) a fallback display colour.
    xml += `<object id="${id}" type="model" name="${escapeXml(p.name)}" pid="1" pindex="${matIndex}"><mesh><vertices>`;
    const positions = p.mesh.positions;
    const n = positions.length / 3;
    for (let v = 0; v < n; v++) {
      const x = positions[v * 3].toFixed(3);
      const y = positions[v * 3 + 1].toFixed(3);
      const z = positions[v * 3 + 2].toFixed(3);
      xml += `<vertex x="${x}" y="${y}" z="${z}"/>`;
    }
    xml += '</vertices><triangles>';
    const indices = p.mesh.indices;
    for (let t = 0; t < indices.length; t += 3) {
      xml += `<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}" pid="1" p1="${matIndex}"/>`;
    }
    xml += '</triangles></mesh></object>\n';
  });

  const parentId = parts.length + 1;
  xml += `<object id="${parentId}" type="model" name="${escapeXml(assemblyName)}"><components>`;
  parts.forEach((_, i) => { xml += `<component objectid="${i + 1}"/>`; });
  xml += '</components></object>\n';

  xml += '</resources>\n<build>\n';
  xml += `<item objectid="${parentId}"/>\n`;
  xml += '</build>\n</model>\n';
  return xml;
}

/**
 * Build a Bambu/Orca-style `Metadata/model_settings.config` declaring each
 * object as a separate "extruder" so slicers that read this BambuStudio-
 * proprietary metadata (which is most of them in the Onewheel grip
 * community) auto-assign one filament per part, instead of dumping every
 * part onto extruder 1 grey.
 */
function buildModelSettingsConfig(parts: MeshPart[]): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n';
  parts.forEach((p, i) => {
    const objId = i + 1;
    const extruder = i + 1;
    xml += `  <object id="${objId}">\n`;
    xml += `    <metadata key="name" value="${escapeXml(p.name)}"/>\n`;
    xml += `    <metadata key="extruder" value="${extruder}"/>\n`;
    xml += `  </object>\n`;
  });
  xml += '</config>\n';
  return xml;
}

/**
 * Pack a list of named, colored meshes + a parent assembly into a Bambu-
 * compatible 3MF blob with the 3MF Materials and Properties extension
 * for filament-color hints, plus Bambu's proprietary metadata so
 * "Load filaments from project" can auto-assign extruders.
 */
export async function build3MF(
  parts: MeshPart[],
  assemblyName: string,
  sidecar?: GrippySidecarPayload,
): Promise<Blob> {
  if (parts.length === 0) throw new Error('build3MF: no parts');
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '<Relationship Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/>\n' +
    '</Relationships>';
  const model = buildModelXml(parts, assemblyName);
  const modelSettings = buildModelSettingsConfig(parts);

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('3D/3dmodel.model', model);
  zip.file('Metadata/model_settings.config', modelSettings);
  // Optional Grippy sidecar — embeds full project state so the same
  // .3mf prints AND reloads as an editable project. Slicers ignore
  // `Metadata/grippy/` paths.
  if (sidecar) addGrippySidecar(zip, sidecar);
  return zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
}
