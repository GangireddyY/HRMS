import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import {
  applyTheme,
  COLOR_THEMES,
  DEFAULT_COLOR_THEME,
  DEFAULT_SIDEBAR_STYLE,
  DEFAULT_THEME_MODE,
  isColorTheme,
  isSidebarStyle,
  isThemeMode,
  SIDEBAR_STYLES,
  THEME_STORAGE_KEYS,
  type ColorTheme,
  type SidebarStyle,
  type ThemeMode,
} from './themes';

function readStored<T>(key: string, guard: (v: unknown) => v is T, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return guard(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, quota); the theme still applies for this session.
  }
}

/** Appearance preferences: color theme, light/dark/system mode and sidebar style, persisted per browser. */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readStored(THEME_STORAGE_KEYS.mode, isThemeMode, DEFAULT_THEME_MODE));
  const color = ref<ColorTheme>(readStored(THEME_STORAGE_KEYS.color, isColorTheme, DEFAULT_COLOR_THEME));
  const sidebar = ref<SidebarStyle>(readStored(THEME_STORAGE_KEYS.sidebar, isSidebarStyle, DEFAULT_SIDEBAR_STYLE));

  const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;
  const systemDark = ref(media?.matches ?? false);
  media?.addEventListener?.('change', (e) => (systemDark.value = e.matches));

  const isDark = computed(() => mode.value === 'dark' || (mode.value === 'system' && systemDark.value));
  const current = computed(() => COLOR_THEMES.find((t) => t.key === color.value) ?? COLOR_THEMES[0]);

  // Sync flush so anything reading CSS variables after a change sees the new palette.
  watch(
    [color, isDark, sidebar],
    () => applyTheme(document.documentElement, { color: color.value, dark: isDark.value, sidebar: sidebar.value }),
    { immediate: true, flush: 'sync' },
  );
  watch(mode, (value) => persist(THEME_STORAGE_KEYS.mode, value), { flush: 'sync' });
  watch(color, (value) => persist(THEME_STORAGE_KEYS.color, value), { flush: 'sync' });
  watch(sidebar, (value) => persist(THEME_STORAGE_KEYS.sidebar, value), { flush: 'sync' });

  function setMode(value: ThemeMode): void {
    if (isThemeMode(value)) mode.value = value;
  }

  function setColor(value: ColorTheme): void {
    if (isColorTheme(value)) color.value = value;
  }

  function setSidebar(value: SidebarStyle): void {
    if (isSidebarStyle(value)) sidebar.value = value;
  }

  function toggleMode(): void {
    mode.value = isDark.value ? 'light' : 'dark';
  }

  function reset(): void {
    mode.value = DEFAULT_THEME_MODE;
    color.value = DEFAULT_COLOR_THEME;
    sidebar.value = DEFAULT_SIDEBAR_STYLE;
  }

  return {
    mode,
    color,
    sidebar,
    isDark,
    current,
    themes: COLOR_THEMES,
    sidebarStyles: SIDEBAR_STYLES,
    setMode,
    setColor,
    setSidebar,
    toggleMode,
    reset,
  };
});
