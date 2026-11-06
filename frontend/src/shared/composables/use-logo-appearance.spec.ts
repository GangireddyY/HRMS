import { describe, expect, it } from 'vitest';
import { contrastRatio, cssColorLuminance, relativeLuminance } from '@/shared/composables/use-logo-appearance';

describe('logo appearance helpers', () => {
  it('computes WCAG luminance and contrast', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1);
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(contrastRatio(1, 0)).toBeCloseTo(21);
    expect(contrastRatio(0.2, 0.2)).toBe(1);
  });

  it('reads luminance from computed CSS colours', () => {
    expect(cssColorLuminance('rgb(255, 255, 255)')).toBeCloseTo(1);
    expect(cssColorLuminance('rgba(9, 9, 11, 1)')!).toBeLessThan(0.01);
    expect(cssColorLuminance('transparent')).toBeNull();
  });
});
