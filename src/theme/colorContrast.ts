function parseHexRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '');
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const srgb = v / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function toHex([r, g, b]: [number, number, number]): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, '0')).join('')
  );
}

/**
 * Zapewnia wyraźny kontrast (>= 3.6:1) pionowej szyny i pierścieni przystanków
 * względem tła karty w obu motywach (ciemnym i jasnym).
 */
export function resolveRailStrokeColor(accentHex: string, surfaceHex: string): string {
  const accent = parseHexRgb(accentHex);
  const surface = parseHexRgb(surfaceHex);
  if (!accent || !surface) return accentHex;
  if (contrastRatio(accent, surface) >= 3.6) return accentHex;

  const isDarkSurface = relativeLuminance(surface) < 0.25;
  const target: [number, number, number] = isDarkSurface ? [255, 255, 255] : [0, 0, 0];
  for (let step = 1; step <= 10; step++) {
    const t = step * 0.08;
    const mixed: [number, number, number] = [
      accent[0] + (target[0] - accent[0]) * t,
      accent[1] + (target[1] - accent[1]) * t,
      accent[2] + (target[2] - accent[2]) * t,
    ];
    if (contrastRatio(mixed, surface) >= 4.0) return toHex(mixed);
  }
  return toHex([
    accent[0] + (target[0] - accent[0]) * 0.6,
    accent[1] + (target[1] - accent[1]) * 0.6,
    accent[2] + (target[2] - accent[2]) * 0.6,
  ]);
}
