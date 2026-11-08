import { describe, expect, it } from 'vitest';
import { BRAND_SHADES, contrastWithWhite, generateBrandPalette, parseHex } from './brand-palette';

const luminanceOrder = (hexes: string[]) => hexes.map((h) => 1 / contrastWithWhite(parseHex(h)!));

describe('brand palette', () => {
  it('keeps a color that already carries white text as shade 600', () => {
    expect(generateBrandPalette('#0e7490')!['600']).toBe('#0e7490');
  });

  it.each(['#facc15', '#22d3ee', '#ff6600', '#a3e635', '#f472b6', '#808080', '#000000', '#ffffff'])('makes shade 600 readable with white text for %s', (hex) => {
    const p = generateBrandPalette(hex)!;
    expect(contrastWithWhite(parseHex(p['600'])!)).toBeGreaterThanOrEqual(4.5);
  });

  it('runs from light to dark', () => {
    const p = generateBrandPalette('#2563eb')!;
    const order = luminanceOrder(BRAND_SHADES.map((s) => p[s]));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThan(order[i - 1]!);
  });

  it('rejects anything that is not a hex color', () => {
    expect(generateBrandPalette('teal')).toBeNull();
    expect(generateBrandPalette('#12345')).toBeNull();
  });
});
