import JSZip from 'jszip';
import type { ExtrudedGeometry } from './pipeline/extrude';

export interface MeshPart {
  name: string;
  mesh: ExtrudedGeometry;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  } as Record<string, string>)[c]);
}

function buildModelXml(parts: MeshPart[], assemblyName: string): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n';
  xml += '<metadata name="Application">GrippySheet ColorFlow</metadata>\n';
  xml += '<resources>\n';

  parts.forEach((p, i) => {
    const id = i + 1;
    xml += `<object id="${id}" type="model" name="${escapeXml(p.name)}"><mesh><vertices>`;
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
      xml += `<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"/>`;
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
 * Pack a list of named meshes + a parent assembly into a Bambu-compatible 3MF blob.
 */
export async function build3MF(parts: MeshPart[], assemblyName: string): Promise<Blob> {
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

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('3D/3dmodel.model', model);
  return zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
}
