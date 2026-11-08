/**
 * Generates a 50–950 brand scale from one color, in OKLCH so steps look even to the eye. Shade 600 carries white
 * text (buttons, today markers), so it is darkened until white reaches 4.5:1; when the chosen color already works
 * there, it is used as-is so the organization's exact color appears on primary actions.
 */

export const BRAND_SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;
export type BrandShade = (typeof BRAND_SHADES)[number];
export type BrandPalette = Record<BrandShade, string>;

const LIGHTNESS: Record<BrandShade, number> = { 50: 0.975, 100: 0.95, 200: 0.9, 300: 0.83, 400: 0.74, 500: 0.64, 600: 0.54, 700: 0.46, 800: 0.39, 900: 0.32, 950: 0.24 };
const CHROMA: Record<BrandShade, number> = { 50: 0.12, 100: 0.22, 200: 0.4, 300: 0.65, 400: 0.85, 500: 1, 600: 1, 700: 0.92, 800: 0.8, 900: 0.68, 950: 0.55 };

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
}

const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklch([r, g, b]: Rgb): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}

/** OKLCH to sRGB; `null` when out of gamut. */
function fromOklch(L: number, C: number, h: number): Rgb | null {
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(fromLinear) as Rgb;
  return rgb.every((c) => c >= -0.0005 && c <= 1.0005) ? rgb : null;
}

/** Closest in-gamut color at this lightness and hue (chroma reduced until it fits). */
function inGamut(L: number, C: number, h: number): Rgb {
  for (let c = C; c > 0; c -= 0.002) {
    const rgb = fromOklch(L, c, h);
    if (rgb) return rgb;
  }
  return fromOklch(L, 0, h) ?? [L, L, L];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const contrastWithWhite = (rgb: Rgb) => 1.05 / (luminance(rgb) + 0.05);

export function generateBrandPalette(hex: string): BrandPalette | null {
  const base = parseHex(hex);
  if (!base) return null;
  const [baseL, baseC, h] = toOklch(base);
  const chroma = Math.min(baseC, 0.26);
  const out = {} as BrandPalette;
  for (const shade of BRAND_SHADES) out[shade] = toHex(inGamut(LIGHTNESS[shade], chroma * CHROMA[shade], h));

  // Shade 600: the chosen color itself when it carries white text and is mid-dark; otherwise darken until it does.
  if (contrastWithWhite(base) >= 4.5 && baseL >= 0.4 && baseL <= 0.62) out['600'] = toHex(base);
  else {
    let L = LIGHTNESS['600'];
    let rgb = inGamut(L, chroma, h);
    while (contrastWithWhite(rgb) < 4.5 && L > 0.2) rgb = inGamut((L -= 0.01), chroma, h);
    out['600'] = toHex(rgb);
  }
  // Keep the darker shades darker than 600.
  const l600 = toOklch(parseHex(out['600'])!)[0];
  for (const [shade, step] of [['700', 0.07], ['800', 0.13], ['900', 0.19], ['950', 0.27]] as const) {
    const L = Math.min(LIGHTNESS[shade], l600 - step);
    out[shade] = toHex(inGamut(Math.max(0.12, L), chroma * CHROMA[shade], h));
  }
  return out;
}

/** CSS custom properties for a palette (`--brand-50` … `--brand-950`). */
export function paletteVars(palette: BrandPalette): Record<string, string> {
  return Object.fromEntries(BRAND_SHADES.map((s) => [`--brand-${s}`, palette[s]]));
}
