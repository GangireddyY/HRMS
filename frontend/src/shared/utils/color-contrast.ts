/** Contrast helpers for user-chosen colors (leave types, departments) that carry white text. */

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const toHex = (rgb: [number, number, number]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
const cache = new Map<string, string>();

/** The color itself, or a darker shade of it, on which white text reaches 4.5:1 (WCAG AA). */
export function fillForWhiteText(color: string): string {
  const hit = cache.get(color);
  if (hit) return hit;
  const rgb = parseHex(color);
  let out = color;
  if (rgb) {
    for (let k = 0; k <= 0.7; k += 0.04) {
      const shade = rgb.map((c) => c * (1 - k)) as [number, number, number];
      if (1.05 / (luminance(shade) + 0.05) >= 4.5) {
        out = k === 0 ? color : toHex(shade);
        break;
      }
    }
  }
  cache.set(color, out);
  return out;
}
