import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { scopeCovers, type AccessContext, type LoginResult, type ModuleKey, type PermissionScope, type PlatformPermission } from '@contracts';
import { authApi } from '@/modules/auth/api/auth.api';
import { ApiError } from '@/core/http/http-client';

const REFRESH_LOCK = 'hrms-token-refresh';
const PROACTIVE_REFRESH_MARGIN_MS = 60_000;

/**
 * Authentication state. The access token lives only in memory; the refresh token is an HttpOnly
 * cookie the browser sends to /api/v1/auth. Permissions come from the server (`/auth/me`) and are
 * used purely for UX (hiding menus/actions) – the API enforces authorization on every request.
 */
export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null);
  const context = ref<AccessContext | null>(null);
  const initialized = ref(false);
  let refreshInFlight: Promise<boolean> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const sessionEndedHandlers: (() => void)[] = [];

  const isAuthenticated = computed(() => !!accessToken.value && !!context.value);
  const user = computed(() => context.value?.user ?? null);
  const organization = computed(() => context.value?.activeOrganization ?? null);
  const isPlatformAdmin = computed(() => (context.value?.platformPermissions.length ?? 0) > 0);
  const isRestricted = computed(() => !!context.value && (context.value.mfaSetupRequired || context.value.passwordExpired));

  function can(permission: string, scope: PermissionScope = 'OWN'): boolean {
    const granted = context.value?.permissions[permission];
    return !!granted && scopeCovers(granted, scope);
  }

  function canAny(permissions: string[]): boolean {
    return permissions.some((p) => can(p));
  }

  function hasFeature(module: ModuleKey): boolean {
    return context.value?.features.includes(module) ?? false;
  }

  function canPlatform(permission: PlatformPermission): boolean {
    return context.value?.platformPermissions.includes(permission) ?? false;
  }

  function scheduleRefresh(expiresInSeconds: number): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    const delay = Math.max(expiresInSeconds * 1000 - PROACTIVE_REFRESH_MARGIN_MS, 10_000);
    refreshTimer = setTimeout(() => void refresh(), delay);
  }

  function setSession(token: string, expiresIn: number, ctx?: AccessContext): void {
    accessToken.value = token;
    if (ctx) context.value = ctx;
    scheduleRefresh(expiresIn);
  }

  function clear(): void {
    accessToken.value = null;
    context.value = null;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  async function doRefresh(): Promise<boolean> {
    try {
      const result = await authApi.refresh();
      setSession(result.accessToken, result.expiresIn);
      return true;
    } catch {
      return false;
    }
  }

  /** Single-flight within the tab and serialised across tabs (rotating refresh tokens must not race). */
  function refresh(): Promise<boolean> {
    if (!refreshInFlight) {
      const run = () => doRefresh();
      const locked: Promise<boolean> =
        typeof navigator !== 'undefined' && 'locks' in navigator ? (async () => await navigator.locks.request(REFRESH_LOCK, run))() : run();
      refreshInFlight = locked.finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  async function loadContext(): Promise<void> {
    context.value = await authApi.me();
  }

  /** Restores a session from the refresh cookie on page load. */
  async function bootstrap(): Promise<void> {
    if (initialized.value) return;
    try {
      if (await refresh()) await loadContext();
    } catch {
      clear();
    } finally {
      initialized.value = true;
    }
  }

  function applyLogin(result: LoginResult): LoginResult {
    if (result.status === 'AUTHENTICATED') setSession(result.accessToken, result.expiresIn, result.context);
    return result;
  }

  async function login(email: string, password: string, organizationId?: string): Promise<LoginResult> {
    return applyLogin(await authApi.login({ email, password, organizationId }));
  }

  async function verifyMfa(challengeToken: string, input: { code?: string; recoveryCode?: string }): Promise<LoginResult> {
    return applyLogin(await authApi.verifyMfa({ challengeToken, ...input }));
  }

  async function registerOrganization(payload: unknown): Promise<LoginResult> {
    return applyLogin(await authApi.registerOrganization(payload));
  }

  async function switchOrganization(organizationId: string): Promise<void> {
    const result = await authApi.switchOrganization(organizationId);
    setSession(result.accessToken, result.expiresIn, result.context);
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    } finally {
      clear();
    }
  }

  function onSessionEnded(handler: () => void): void {
    sessionEndedHandlers.push(handler);
  }

  function sessionEnded(): void {
    if (!accessToken.value && !context.value) return;
    clear();
    sessionEndedHandlers.forEach((h) => h());
  }

  return {
    accessToken,
    context,
    initialized,
    isAuthenticated,
    user,
    organization,
    isPlatformAdmin,
    isRestricted,
    can,
    canAny,
    hasFeature,
    canPlatform,
    refresh,
    bootstrap,
    loadContext,
    login,
    verifyMfa,
    registerOrganization,
    switchOrganization,
    logout,
    onSessionEnded,
    sessionEnded,
  };
});
