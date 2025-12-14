export const hexToRgb = (hex: string): { r: number, g: number, b: number } | null => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
};

// Returns Euclidean distance between two colors (0-100 normalized approx)
export const calculateColorDistance = (color1: string, color2: string): number => {
    if (color1 === 'transparent' || color2 === 'transparent') return color1 === color2 ? 0 : 100;
    if (color1 === 'base' || color2 === 'base') return color1 === color2 ? 0 : 100;

    const rgb1 = hexToRgb(color1);
    const rgb2 = hexToRgb(color2);

    if (!rgb1 || !rgb2) return 100;

    const rDiff = rgb1.r - rgb2.r;
    const gDiff = rgb1.g - rgb2.g;
    const bDiff = rgb1.b - rgb2.b;

    // Max Euclidean distance is sqrt(255^2 * 3) approx 441.67
    const distance = Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);

    // Normalize to 0-100
    return (distance / 441.67) * 100;
};

export const flattenColors = (shapes: any[], threshold: number): any[] => {
    // 1. Collect all unique colors
    const uniqueColors = Array.from(new Set(shapes.map(s => s.color))).filter(c => c !== 'transparent' && c !== 'base');

    if (uniqueColors.length <= 1) return shapes;

    const consolidatedColors: { [key: string]: string } = {};

    // 2. Group similar colors
    // Simple greedy approach: take a color, find all close ones, merge to the first one.
    const processed = new Set<string>();

    for (const color of uniqueColors) {
        if (processed.has(color)) continue;

        processed.add(color);
        consolidatedColors[color] = color; // Map to itself initially

        for (const otherColor of uniqueColors) {
            if (color === otherColor || processed.has(otherColor)) continue;

            const dist = calculateColorDistance(color, otherColor);
            if (dist <= threshold) {
                consolidatedColors[otherColor] = color; // Map other to this group leader
                processed.add(otherColor);
            }
        }
    }

    // 3. Remap shapes
    return shapes.map(s => {
        if (s.color === 'transparent' || s.color === 'base') return s;
        const newColor = consolidatedColors[s.color] || s.color;
        return { ...s, color: newColor };
    });
};
