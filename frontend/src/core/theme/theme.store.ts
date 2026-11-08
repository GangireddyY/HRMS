import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { generateBrandPalette, paletteVars } from './brand-palette';
import {
  applyTheme,
  COLOR_THEMES,
  DEFAULT_COLOR_THEME,
  DEFAULT_SIDEBAR_STYLE,
  DEFAULT_THEME_MODE,
  isColorTheme,
  isSidebarStyle,
  isThemeMode,
  LEGACY_COLOR_THEMES,
  ORGANIZATION_THEME,
  SIDEBAR_STYLES,
  THEME_MODE_INFO,
  THEME_STORAGE_KEYS,
  type ColorTheme,
  type SidebarStyle,
  type ThemeMode,
} from './themes';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, quota); the theme still applies for this session.
  }
}

function readStored<T>(key: string, guard: (v: unknown) => v is T, fallback: T): T {
  const value = read(key);
  return guard(value) ? value : fallback;
}

/** The user's own color choice, or null to follow the organization (its brand palette, else the default theme). */
function readColorChoice(): ColorTheme | null {
  const stored = read(THEME_STORAGE_KEYS.color);
  if (stored !== null && stored in LEGACY_COLOR_THEMES) {
    persist(THEME_STORAGE_KEYS.color, LEGACY_COLOR_THEMES[stored]!);
    return LEGACY_COLOR_THEMES[stored]!;
  }
  return isColorTheme(stored) ? stored : null;
}

export type ThemePreferences = { mode: ThemeMode; color: ColorTheme | null; sidebar: SidebarStyle };

/**
 * Appearance preferences: color theme, mode (light, dark, system, dim, black, paper) and sidebar style. Saved in the
 * browser for first paint and, when signed in, on the account (see main.ts) so every device matches.
 */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readStored(THEME_STORAGE_KEYS.mode, isThemeMode, DEFAULT_THEME_MODE));
  const choice = ref<ColorTheme | null>(readColorChoice());
  const sidebar = ref<SidebarStyle>(readStored(THEME_STORAGE_KEYS.sidebar, isSidebarStyle, DEFAULT_SIDEBAR_STYLE));
  const brandColor = ref<string | null>(null);

  const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;
  const systemDark = ref(media?.matches ?? false);
  media?.addEventListener?.('change', (e) => (systemDark.value = e.matches));

  const brandPalette = computed(() => (brandColor.value ? generateBrandPalette(brandColor.value) : null));
  /** The theme in effect: the user's choice, else the organization's brand, else the default. */
  const color = computed<ColorTheme>(() => {
    const c = choice.value;
    if (c && !(c === ORGANIZATION_THEME && !brandPalette.value)) return c;
    return brandPalette.value ? ORGANIZATION_THEME : DEFAULT_COLOR_THEME;
  });
  const isDark = computed(() => THEME_MODE_INFO[mode.value].dark ?? systemDark.value);
  const surface = computed(() => THEME_MODE_INFO[mode.value].surface);
  const current = computed(() =>
    color.value === ORGANIZATION_THEME && brandPalette.value
      ? { key: ORGANIZATION_THEME, label: 'Organization brand', description: 'Your organization’s colors', swatch: brandPalette.value['600'] }
      : (COLOR_THEMES.find((t) => t.key === color.value) ?? COLOR_THEMES[0]),
  );

  // Sync flush so anything reading CSS variables after a change sees the new palette.
  watch(
    [color, isDark, sidebar, surface, brandPalette],
    () => {
      const palette = color.value === ORGANIZATION_THEME && brandPalette.value ? paletteVars(brandPalette.value) : null;
      applyTheme(document.documentElement, { color: color.value, dark: isDark.value, sidebar: sidebar.value, surface: surface.value, palette });
      persist(THEME_STORAGE_KEYS.brandPalette, palette ? JSON.stringify(palette) : null);
    },
    { immediate: true, flush: 'sync' },
  );
  watch(mode, (value) => persist(THEME_STORAGE_KEYS.mode, value), { flush: 'sync' });
  watch(choice, (value) => persist(THEME_STORAGE_KEYS.color, value), { flush: 'sync' });
  watch(sidebar, (value) => persist(THEME_STORAGE_KEYS.sidebar, value), { flush: 'sync' });

  let onChange: ((prefs: ThemePreferences) => void) | null = null;
  let applyingRemote = false;
  watch([mode, choice, sidebar], () => !applyingRemote && onChange?.({ mode: mode.value, color: choice.value, sidebar: sidebar.value }), { flush: 'sync' });

  /** Called with every user change (not with changes applied from the account). */
  function onPreferencesChange(fn: ((prefs: ThemePreferences) => void) | null): void {
    onChange = fn;
  }

  /** Applies choices saved on the account; invalid or missing values leave the current ones. */
  function applyRemote(prefs: Partial<Record<'mode' | 'color' | 'sidebar', string>>): void {
    applyingRemote = true;
    try {
      if (isThemeMode(prefs.mode)) mode.value = prefs.mode;
      const c = prefs.color && prefs.color in LEGACY_COLOR_THEMES ? LEGACY_COLOR_THEMES[prefs.color] : prefs.color;
      if (isColorTheme(c)) choice.value = c;
      if (isSidebarStyle(prefs.sidebar)) sidebar.value = prefs.sidebar;
    } finally {
      applyingRemote = false;
    }
  }

  function setOrganizationBrand(value: string | null | undefined): void {
    brandColor.value = value && generateBrandPalette(value) ? value : null;
  }

  function setMode(value: ThemeMode): void {
    if (isThemeMode(value)) mode.value = value;
  }

  function setColor(value: ColorTheme): void {
    if (isColorTheme(value)) choice.value = value;
  }

  function setSidebar(value: SidebarStyle): void {
    if (isSidebarStyle(value)) sidebar.value = value;
  }

  function toggleMode(): void {
    mode.value = isDark.value ? 'light' : 'dark';
  }

  function reset(): void {
    mode.value = DEFAULT_THEME_MODE;
    choice.value = null;
    sidebar.value = DEFAULT_SIDEBAR_STYLE;
  }

  return {
    mode,
    color,
    choice,
    sidebar,
    brandColor,
    brandPalette,
    isDark,
    surface,
    modeInfo: computed(() => THEME_MODE_INFO[mode.value]),
    current,
    themes: COLOR_THEMES,
    sidebarStyles: SIDEBAR_STYLES,
    setMode,
    setColor,
    setSidebar,
    setOrganizationBrand,
    toggleMode,
    reset,
    applyRemote,
    onPreferencesChange,
  };
});
