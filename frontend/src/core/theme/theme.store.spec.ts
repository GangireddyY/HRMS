import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useThemeStore } from './theme.store';
import { COLOR_THEMES, THEME_STORAGE_KEYS } from './themes';

function mockSystemDark(dark: boolean) {
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: dark, addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb) })),
  );
  return (matches: boolean) => listeners.forEach((cb) => cb({ matches }));
}

describe('theme store', () => {
  const root = document.documentElement;

  beforeEach(() => {
    localStorage.clear();
    root.className = '';
    delete root.dataset.theme;
    delete root.dataset.sidebar;
    setActivePinia(createPinia());
  });

  it('defaults to the indigo theme following the system mode', () => {
    mockSystemDark(true);
    const theme = useThemeStore();
    expect(theme.mode).toBe('system');
    expect(theme.color).toBe('indigo');
    expect(theme.isDark).toBe(true);
    expect(root.dataset.theme).toBe('indigo');
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('restores saved preferences and ignores invalid stored values', () => {
    mockSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEYS.mode, 'dark');
    localStorage.setItem(THEME_STORAGE_KEYS.color, 'not-a-theme');
    const theme = useThemeStore();
    expect(theme.mode).toBe('dark');
    expect(theme.color).toBe('indigo');
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('applies and persists color and mode changes immediately', () => {
    mockSystemDark(false);
    const theme = useThemeStore();
    theme.setColor('emerald');
    theme.setMode('dark');
    expect(root.dataset.theme).toBe('emerald');
    expect(root.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEYS.color)).toBe('emerald');
    expect(localStorage.getItem(THEME_STORAGE_KEYS.mode)).toBe('dark');

    theme.toggleMode();
    expect(theme.mode).toBe('light');
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('tracks operating-system changes in system mode', () => {
    const emit = mockSystemDark(false);
    const theme = useThemeStore();
    expect(theme.isDark).toBe(false);
    emit(true);
    expect(theme.isDark).toBe(true);
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('applies, persists and validates the sidebar style', () => {
    mockSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEYS.sidebar, 'neon');
    const theme = useThemeStore();
    expect(theme.sidebar).toBe('light');
    expect(root.dataset.sidebar).toBe('light');
    theme.setSidebar('brand');
    expect(root.dataset.sidebar).toBe('brand');
    expect(localStorage.getItem(THEME_STORAGE_KEYS.sidebar)).toBe('brand');
  });

  it('dim, black and paper set a surface palette on top of dark or light', () => {
    mockSystemDark(false);
    const theme = useThemeStore();
    theme.setMode('dim');
    expect(theme.isDark).toBe(true);
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.dataset.surface).toBe('dim');
    theme.setMode('black');
    expect(root.dataset.surface).toBe('black');
    theme.setMode('paper');
    expect(theme.isDark).toBe(false);
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.dataset.surface).toBe('paper');
    expect(localStorage.getItem(THEME_STORAGE_KEYS.mode)).toBe('paper');
    theme.setMode('light');
    expect(root.dataset.surface).toBeUndefined();
  });

  it('reset returns to the defaults', () => {
    mockSystemDark(false);
    const theme = useThemeStore();
    theme.setColor('rose');
    theme.setMode('dark');
    theme.setSidebar('dark');
    theme.reset();
    expect(theme.color).toBe('indigo');
    expect(theme.mode).toBe('system');
    expect(theme.sidebar).toBe('light');
  });

  it('moves saved themes that were replaced to their closest current theme', () => {
    mockSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEYS.color, 'ocean');
    const theme = useThemeStore();
    expect(theme.color).toBe('teal');
    expect(root.dataset.theme).toBe('teal');
    expect(localStorage.getItem(THEME_STORAGE_KEYS.color)).toBe('teal');
  });

  it('follows the organization brand until the user picks a theme, and again after reset', () => {
    mockSystemDark(false);
    const theme = useThemeStore();
    theme.setOrganizationBrand('#0e7490');
    expect(theme.color).toBe('organization');
    expect(root.dataset.theme).toBe('organization');
    expect(root.style.getPropertyValue('--brand-600')).toBe('#0e7490');
    expect(localStorage.getItem(THEME_STORAGE_KEYS.brandPalette)).toContain('--brand-600');

    theme.setColor('berry');
    expect(theme.color).toBe('berry');
    expect(root.style.getPropertyValue('--brand-600')).toBe('');
    expect(localStorage.getItem(THEME_STORAGE_KEYS.brandPalette)).toBeNull();

    theme.reset();
    expect(theme.color).toBe('organization');
    theme.setOrganizationBrand(null);
    expect(theme.color).toBe('indigo');
  });

  it('reports user changes for the account but not choices applied from it', () => {
    mockSystemDark(false);
    const theme = useThemeStore();
    const seen: unknown[] = [];
    theme.onPreferencesChange((p) => seen.push(p));
    theme.applyRemote({ mode: 'dark', color: 'ocean', sidebar: 'nope' });
    expect(theme.mode).toBe('dark');
    expect(theme.color).toBe('teal');
    expect(theme.sidebar).toBe('light');
    expect(seen).toHaveLength(0);
    theme.setSidebar('brand');
    expect(seen).toEqual([{ mode: 'dark', color: 'teal', sidebar: 'brand' }]);
  });

  it('exposes every theme declared in the catalog', () => {
    mockSystemDark(false);
    expect(useThemeStore().themes.map((t) => t.key)).toEqual(COLOR_THEMES.map((t) => t.key));
  });
});
