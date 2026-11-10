/**
 * Color themes. Palettes live in src/app/styles/themes.css under `[data-theme='<key>']`.
 * Chosen for distinct perceptual hues (OKLCH, about 50° or more apart) plus one neutral, ordered around the wheel:
 * Indigo 277°, Teal 220°, Emerald 163°, Bronze 60°, Rose 357°, Berry 325°, Graphite (no hue). Rose and Bronze sit
 * away from the danger (red, 27°) and warning (amber, 70°) status colors so a theme never reads as an alert.
 * `organization` uses the palette generated from the organization's brand color (see brand-palette.ts).
 */
export const COLOR_THEMES = [
  { key: 'indigo', label: 'Indigo', description: 'Default product theme', swatch: '#4f46e5' },
  { key: 'teal', label: 'Teal', description: 'Clear and calm', swatch: '#0e7490' },
  { key: 'emerald', label: 'Emerald', description: 'Fresh and balanced', swatch: '#047857' },
  { key: 'bronze', label: 'Bronze', description: 'Warm and grounded', swatch: '#855a2e' },
  { key: 'rose', label: 'Rose', description: 'Bold and energetic', swatch: '#be185d' },
  { key: 'berry', label: 'Berry', description: 'Creative and expressive', swatch: '#a21caf' },
  { key: 'graphite', label: 'Graphite', description: 'Neutral and minimal', swatch: '#3f3f46' },
] as const;

/** The organization's own brand palette; offered when the organization has set a brand color. */
export const ORGANIZATION_THEME = 'organization' as const;

/** Themes that were renamed or replaced; saved choices move to the closest current theme. */
export const LEGACY_COLOR_THEMES: Record<string, (typeof COLOR_THEMES)[number]['key']> = { ocean: 'teal', violet: 'berry', slate: 'graphite', amber: 'bronze' };

export type ColorTheme = (typeof COLOR_THEMES)[number]['key'] | typeof ORGANIZATION_THEME;

export const THEME_MODES = ['light', 'dark', 'system', 'dim', 'black', 'paper'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Surface palettes on top of light/dark. Styles live in src/app/styles/main.css under `[data-surface='<key>']`. */
export type SurfaceTone = 'default' | 'dim' | 'black' | 'paper';

export const THEME_MODE_INFO: Record<ThemeMode, { label: string; description: string; dark: boolean | null; surface: SurfaceTone }> = {
  light: { label: 'Light', description: 'Bright and clean', dark: false, surface: 'default' },
  dark: { label: 'Dark', description: 'Easy on the eyes at night', dark: true, surface: 'default' },
  system: { label: 'System', description: 'Follows your device', dark: null, surface: 'default' },
  dim: { label: 'Dim', description: 'Soft slate, lower contrast', dark: true, surface: 'dim' },
  black: { label: 'Black', description: 'True black for OLED screens', dark: true, surface: 'black' },
  paper: { label: 'Paper', description: 'Warm, low-glare light', dark: false, surface: 'paper' },
};

/** Sidebar palettes. Styles live in src/app/styles/main.css under `[data-sidebar='<key>']`. */
export const SIDEBAR_STYLES = [
  { key: 'light', label: 'Light', description: 'Blends with the page' },
  { key: 'dark', label: 'Dark', description: 'High-contrast charcoal' },
  { key: 'brand', label: 'Brand', description: 'Tinted with the color theme' },
] as const;

export type SidebarStyle = (typeof SIDEBAR_STYLES)[number]['key'];

export const DEFAULT_COLOR_THEME: ColorTheme = 'indigo';
export const DEFAULT_THEME_MODE: ThemeMode = 'system';
export const DEFAULT_SIDEBAR_STYLE: SidebarStyle = 'light';

/** Also read by the pre-paint script public/theme-boot.js; change both together. */
export const THEME_STORAGE_KEYS = { mode: 'hrms.theme', color: 'hrms.colorTheme', sidebar: 'hrms.sidebar', brandPalette: 'hrms.brandPalette' } as const;

export function isColorTheme(value: unknown): value is ColorTheme {
  return value === ORGANIZATION_THEME || COLOR_THEMES.some((t) => t.key === value);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return (THEME_MODES as readonly unknown[]).includes(value);
}

export function isSidebarStyle(value: unknown): value is SidebarStyle {
  return SIDEBAR_STYLES.some((s) => s.key === value);
}

/**
 * Applies a resolved theme to the document root (`data-theme`, `data-sidebar`, `data-surface`, the `dark` class and,
 * for the organization theme, the generated `--brand-*` variables inline).
 */
export function applyTheme(root: HTMLElement, theme: { color: ColorTheme; dark: boolean; sidebar: SidebarStyle; surface?: SurfaceTone; palette?: Record<string, string> | null }): void {
  root.dataset.theme = theme.color;
  for (let i = root.style.length - 1; i >= 0; i--) {
    const prop = root.style.item(i);
    if (prop.startsWith('--brand-')) root.style.removeProperty(prop);
  }
  if (theme.palette) for (const [k, v] of Object.entries(theme.palette)) root.style.setProperty(k, v);
  root.dataset.sidebar = theme.sidebar;
  if (theme.surface && theme.surface !== 'default') root.dataset.surface = theme.surface;
  else delete root.dataset.surface;
  root.classList.toggle('dark', theme.dark);
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
}

let probe: CanvasRenderingContext2D | null | undefined;

/** Resolves any CSS color (including `color-mix()`) to `rgb()`, which canvas chart libraries can parse. */
function toRgb(value: string, fallback: string): string {
  if (/^(#|rgb)/i.test(value)) return value;
  try {
    probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!probe) return fallback;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = fallback;
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = probe.getImageData(0, 0, 1, 1).data;
    return a < 255 ? `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(3)})` : `rgb(${r} ${g} ${b})`;
  } catch {
    return fallback;
  }
}

/** Reads a CSS custom property from the document root as a color chart libraries understand, e.g. `--brand-500`. */
export function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value ? toRgb(value, fallback) : fallback;
}
