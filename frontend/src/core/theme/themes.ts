/** Color themes. Palettes live in src/app/styles/themes.css under `[data-theme='<key>']`. */
export const COLOR_THEMES = [
  { key: 'indigo', label: 'Indigo', description: 'Default product theme', swatch: '#4f46e5' },
  { key: 'ocean', label: 'Ocean', description: 'Calm corporate blue', swatch: '#2563eb' },
  { key: 'emerald', label: 'Emerald', description: 'Fresh and balanced', swatch: '#047857' },
  { key: 'violet', label: 'Violet', description: 'Bold and creative', swatch: '#7c3aed' },
  { key: 'rose', label: 'Rose', description: 'Warm and energetic', swatch: '#e11d48' },
  { key: 'amber', label: 'Amber', description: 'Sunny and optimistic', swatch: '#b45309' },
  { key: 'slate', label: 'Slate', description: 'Neutral and minimal', swatch: '#475569' },
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number]['key'];

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

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

/** Also read by the pre-paint script in index.html; change both together. */
export const THEME_STORAGE_KEYS = { mode: 'hrms.theme', color: 'hrms.colorTheme', sidebar: 'hrms.sidebar' } as const;

export function isColorTheme(value: unknown): value is ColorTheme {
  return COLOR_THEMES.some((t) => t.key === value);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return (THEME_MODES as readonly unknown[]).includes(value);
}

export function isSidebarStyle(value: unknown): value is SidebarStyle {
  return SIDEBAR_STYLES.some((s) => s.key === value);
}

/** Applies a resolved theme to the document root (`data-theme`, `data-sidebar` and the `dark` class). */
export function applyTheme(root: HTMLElement, theme: { color: ColorTheme; dark: boolean; sidebar: SidebarStyle }): void {
  root.dataset.theme = theme.color;
  root.dataset.sidebar = theme.sidebar;
  root.classList.toggle('dark', theme.dark);
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
}

/** Reads a CSS custom property from the document root, e.g. `--brand-500`. */
export function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
