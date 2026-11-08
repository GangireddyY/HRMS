import { watch } from 'vue';
import type { AppearancePreferences } from '@contracts';
import type { useAuthStore } from '@/core/auth/auth.store';
import { applyLocale, DEFAULT_LOCALE_PREFS, readLocalePrefs, REGIONS, saveLocalePrefs, type LocalePrefs } from '@/core/locale/locale';
import { authApi } from '@/modules/auth/api/auth.api';
import type { useThemeStore } from './theme.store';

type Auth = ReturnType<typeof useAuthStore>;
type Theme = ReturnType<typeof useThemeStore>;

function localePart(prefs: AppearancePreferences): Partial<LocalePrefs> {
  const out: Partial<LocalePrefs> = {};
  if (REGIONS.some((r) => r.key === prefs.region)) out.region = prefs.region as LocalePrefs['region'];
  if (prefs.hourCycle === 'auto' || prefs.hourCycle === 'h12' || prefs.hourCycle === 'h23') out.hourCycle = prefs.hourCycle;
  if (prefs.direction === 'auto' || prefs.direction === 'ltr' || prefs.direction === 'rtl') out.direction = prefs.direction;
  return out;
}

/** Saves region formats on the account (used before the page reloads to apply them). */
export async function saveLocaleToAccount(prefs: LocalePrefs): Promise<void> {
  try {
    await authApi.updatePreferences({ region: prefs.region, hourCycle: prefs.hourCycle, direction: prefs.direction });
  } catch {
    // Signed out or offline: the choice still applies in this browser.
  }
}

/**
 * Keeps appearance in step with the account and the organization:
 * - the organization's brand color feeds the Organization theme;
 * - on sign-in, choices saved on the account are applied (region formats reload the page once to take effect);
 *   an account with nothing saved yet takes this browser's current choices;
 * - later theme changes are saved to the account straight away.
 */
export function syncAppearance(auth: Auth, theme: Theme): void {
  watch(() => auth.organization?.brandColor ?? null, (c) => theme.setOrganizationBrand(c), { immediate: true });

  watch(
    () => auth.user?.id,
    (id) => {
      if (!id || !auth.user) return;
      const remote = auth.user.preferences ?? {};
      if (Object.keys(remote).length === 0) {
        const locale = readLocalePrefs();
        void authApi.updatePreferences({ mode: theme.mode, color: theme.choice, sidebar: theme.sidebar, region: locale.region, hourCycle: locale.hourCycle, direction: locale.direction }).catch(() => undefined);
        return;
      }
      theme.applyRemote(remote);
      const local = readLocalePrefs();
      const next = { ...DEFAULT_LOCALE_PREFS, ...local, ...localePart(remote) };
      if (next.region !== local.region || next.hourCycle !== local.hourCycle || next.direction !== local.direction) {
        saveLocalePrefs(next);
        applyLocale(document.documentElement, next);
        window.location.reload();
      }
    },
    { immediate: true },
  );

  // Choices are discrete clicks, so save right away; changes made together (Reset) go in one request.
  let pending: { mode: string; color: string | null; sidebar: string } | null = null;
  theme.onPreferencesChange((prefs) => {
    if (!auth.isAuthenticated) return;
    const first = !pending;
    pending = { mode: prefs.mode, color: prefs.color, sidebar: prefs.sidebar };
    if (first)
      queueMicrotask(() => {
        const body = pending!;
        pending = null;
        void authApi.updatePreferences(body).catch(() => undefined);
      });
  });
}
