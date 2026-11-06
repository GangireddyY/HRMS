import { ref, watch, type Ref } from 'vue';

export interface LogoAppearance {
  /** Width ÷ height. */
  aspect: number;
  /** The image has no transparent edges, i.e. it carries its own background. */
  opaque: boolean;
  /** Average colour along the image edge (its background when opaque), as a CSS colour. */
  edgeColor: string;
  /** Relative luminance (0 = black, 1 = white) of the visible artwork. */
  luminance: number;
}

/** WCAG relative luminance of an sRGB colour (0–255 channels). */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Luminance of a computed CSS colour such as "rgb(24, 24, 27)"; null if it cannot be parsed. */
export function cssColorLuminance(color: string): number | null {
  const m = color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  return m ? relativeLuminance(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** Samples a downscaled copy of the image; needs a same-origin (or CORS-enabled) image. */
export function analyseLogo(img: HTMLImageElement): LogoAppearance {
  const aspect = img.naturalWidth / Math.max(img.naturalHeight, 1);
  const w = 96;
  const h = Math.max(8, Math.round(w / aspect));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let alphaSum = 0;
  let samples = 0;
  const edge = { r: 0, g: 0, b: 0, n: 0 };
  const sampleEdge = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    alphaSum += data[i + 3]!;
    samples++;
    if (data[i + 3]! > 200) {
      edge.r += data[i]!;
      edge.g += data[i + 1]!;
      edge.b += data[i + 2]!;
      edge.n++;
    }
  };
  for (let x = 0; x < w; x++) {
    sampleEdge(x, 0);
    sampleEdge(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    sampleEdge(0, y);
    sampleEdge(w - 1, y);
  }
  const opaque = alphaSum / samples > 240;
  const er = edge.n ? edge.r / edge.n : 255;
  const eg = edge.n ? edge.g / edge.n : 255;
  const eb = edge.n ? edge.b / edge.n : 255;

  // Artwork = visible pixels that are not the background colour.
  let lumSum = 0;
  let lumWeight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    if (a < 0.5) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (opaque && Math.abs(r - er) + Math.abs(g - eg) + Math.abs(b - eb) < 40) continue;
    lumSum += relativeLuminance(r, g, b) * a;
    lumWeight += a;
  }
  return {
    aspect,
    opaque,
    edgeColor: `rgb(${Math.round(er)}, ${Math.round(eg)}, ${Math.round(eb)})`,
    luminance: lumWeight ? lumSum / lumWeight : 0.5,
  };
}

/** Loads the image and analyses it; `null` while loading or if the image cannot be read. */
export function useLogoAppearance(src: Ref<string | null | undefined>): Ref<LogoAppearance | null> {
  const appearance = ref<LogoAppearance | null>(null);
  watch(
    src,
    (url) => {
      appearance.value = null;
      if (!url) return;
      const img = new Image();
      img.onload = () => {
        if (src.value !== url) return;
        try {
          appearance.value = analyseLogo(img);
        } catch {
          // Unreadable pixels (e.g. a cross-origin image without CORS): keep only the shape.
          appearance.value = { aspect: img.naturalWidth / Math.max(img.naturalHeight, 1), opaque: true, edgeColor: '#ffffff', luminance: 0.5 };
        }
      };
      img.src = url;
    },
    { immediate: true },
  );
  return appearance;
}
