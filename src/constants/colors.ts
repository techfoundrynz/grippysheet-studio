// Onewheel-community-flavored palette names — same Tailwind-anchored hex
// values as before, but the labels speak to the build culture (Pint/XR/GT
// thane talk, classic mod colors, stealth/floatlife vibes) instead of
// generic Tailwind class names.
export const COLORS: Record<string, string> = {
    'Rider Red':      '#ef4444',
    'Stockwheel Orange': '#f97316',
    'Amber Glow':     '#f59e0b',
    'Voltage Yellow': '#eab308',
    'Thane Lime':     '#84cc16',
    'Float Green':    '#22c55e',
    'VESC Mint':      '#10b981',
    'Teal Carve':     '#14b8a6',
    'Bonk Cyan':      '#06b6d4',
    'Hookipa Blue':   '#0ea5e9',
    'Pit Crew Blue':  '#3b82f6',
    'Nightride':      '#6366f1',
    'Pushback Violet':'#8b5cf6',
    'Headlight Purple':'#a855f7',
    'Mauka Magenta':  '#d946ef',
    'Trickline Pink': '#ec4899',
    'Sunset Rose':    '#f43f5e',
    'Stealth Black':  '#202020',
    'Gunmetal':       '#555555',
    'Concrete Gray':  '#aaaaaa',
    'Float Plate White':'#ffffff',
};

// Default to graphite so the brand colors (orange / signal green) read
// crisply against the pad in the canvas instead of fighting a hot purple.
export const DEFAULT_BASE_COLOR = COLORS['Gunmetal'];
export const DEFAULT_PATTERN_COLOR = COLORS['Stockwheel Orange'];
