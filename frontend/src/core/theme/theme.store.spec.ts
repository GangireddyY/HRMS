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

  it('exposes every theme declared in the catalog', () => {
    mockSystemDark(false);
    expect(useThemeStore().themes.map((t) => t.key)).toEqual(COLOR_THEMES.map((t) => t.key));
  });
});
