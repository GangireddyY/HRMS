import { computed } from 'vue';
import { readCssVar } from './themes';
import { useThemeStore } from './theme.store';

/** Resolved theme colors for canvas-based rendering (charts) that cannot use CSS classes. */
export function useThemePalette() {
  const theme = useThemeStore();
  return computed(() => {
    // Dependencies: re-read the CSS variables whenever the theme changes.
    void theme.color;
    void theme.surface;
    const dark = theme.isDark;
    return {
      brand: readCssVar('--brand-500', '#6366f1'),
      brandMuted: readCssVar('--brand-300', '#a5b4fc'),
      danger: dark ? '#f87171' : '#f43f5e',
      grid: readCssVar('--app-border', dark ? '#27272a' : '#e4e4e7'),
      text: readCssVar('--app-text-subtle', dark ? '#71717a' : '#a1a1aa'),
      surface: readCssVar('--app-surface-raised', dark ? '#1c1c20' : '#ffffff'),
      fg: readCssVar('--app-text', dark ? '#fafafa' : '#18181b'),
      border: readCssVar('--app-border', dark ? '#27272a' : '#e4e4e7'),
    };
  });
}
