export type OutlineGroup = 'xr' | 'gt' | 'pint' | 'other';

export interface OutlineEntry {
  slug: string;
  name: string;
  group: OutlineGroup;
  file: string;
  widthMm: number;
  heightMm: number;
}

export const OUTLINE_LIBRARY: OutlineEntry[] = [
  { slug: 'xrstock',         name: 'XR Stock',          group: 'xr',    file: '/outlines/xrstock.dxf',         widthMm: 232.9, heightMm: 219.7 },
  { slug: 'xrcobraviper',    name: 'XR Cobra/Viper',    group: 'xr',    file: '/outlines/xrcobraviper.dxf',    widthMm: 229.3, heightMm: 211.5 },
  { slug: 'xrkushwide',      name: 'XR Kush Wide',      group: 'xr',    file: '/outlines/xrkushwide.dxf',      widthMm: 251.5, heightMm: 218.0 },
  { slug: 'xrmushiesv2',     name: 'XR Mushies V2',     group: 'xr',    file: '/outlines/xrmushiesv2.dxf',     widthMm: 230.8, heightMm: 216.5 },
  { slug: 'xrpubpad',        name: 'XR PubPad',         group: 'xr',    file: '/outlines/xrpubpad.dxf',        widthMm: 233.6, heightMm: 220.0 },
  { slug: 'xrstompies',      name: 'XR Stompies',       group: 'xr',    file: '/outlines/xrstompies.dxf',      widthMm: 231.9, heightMm: 201.0 },
  { slug: 'xrviperbitewide', name: 'XR Viperbite Wide', group: 'xr',    file: '/outlines/xrviperbitewide.dxf', widthMm: 254.7, heightMm: 236.7 },
  { slug: 'gtstock',         name: 'GT Stock',          group: 'gt',    file: '/outlines/gtstock.dxf',         widthMm: 229.3, heightMm: 203.4 },
  { slug: 'gtkushwide',      name: 'GT Kush Wide',      group: 'gt',    file: '/outlines/gtkushwide.dxf',      widthMm: 255.3, heightMm: 233.9 },
  { slug: 'gtmushies',       name: 'GT Mushies',        group: 'gt',    file: '/outlines/gtmushies.dxf',       widthMm: 246.5, heightMm: 226.1 },
  { slug: 'gtfst',           name: 'GT FST',            group: 'gt',    file: '/outlines/gtfst.dxf',           widthMm: 239.0, heightMm: 216.7 },
  { slug: 'gtlowboyflared',  name: 'GT Lowboy Flared',  group: 'gt',    file: '/outlines/gtlowboyflared.dxf',  widthMm: 255.8, heightMm: 215.2 },
  { slug: 'pint',            name: 'Pint',              group: 'pint',  file: '/outlines/pint.dxf',            widthMm: 206.1, heightMm: 173.4 },
  { slug: 'pintmatix',       name: 'Pint Matix',        group: 'pint',  file: '/outlines/pintmatix.dxf',       widthMm: 241.4, heightMm: 194.9 },
  { slug: 'floatwheel',      name: 'Floatwheel',        group: 'other', file: '/outlines/floatwheel.dxf',      widthMm: 233.0, heightMm: 200.6 },
  { slug: 'gosmilox7',       name: 'Gosmilo X7',        group: 'other', file: '/outlines/gosmilox7.dxf',       widthMm: 231.7, heightMm: 222.5 },
];

export function getOutlineBySlug(slug: string): OutlineEntry | undefined {
  return OUTLINE_LIBRARY.find((o) => o.slug === slug);
}
