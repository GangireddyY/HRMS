<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type Component } from 'vue';
import { onBeforeRouteLeave, useRoute } from 'vue-router';
import {
  Boxes,
  Building2,
  Check,
  CircleAlert,
  CreditCard,
  FileClock,
  Globe,
  KeyRound,
  LockKeyhole,
  MapPin,
  Palette,
  Save,
  ShieldCheck,
  Timer,
  Zap,
} from '@lucide/vue';
import { organizationApi } from '@/modules/organization/api/organization.api';
import type { SecurityPolicy } from '@/modules/organization/types';
import OrganizationBrandColor from '@/modules/organization/components/OrganizationBrandColor.vue';
import OrganizationLogoUploader from '@/modules/organization/components/OrganizationLogoUploader.vue';
import OrganizationProfileForm from '@/modules/organization/components/OrganizationProfileForm.vue';
import { AppAlert, AppBadge, AppButton, AppErrorState, AppInput, AppPageHeader, AppSkeleton, AppSwitch } from '@/shared/components';
import { apiAssetUrl } from '@/core/http/http-client';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { appLocale } from '@/core/locale/locale';
import { formatDateTime, timeAgo } from '@/shared/utils/format';
import { MODULE_ICONS } from '@/shared/utils/module-icons';
import { organizationTone, statusLabel } from '@/shared/utils/status';
import { changedFields, toProfileFields, type ProfileFields } from '@/modules/organization/utils/profile';

/**
 * Organization settings on one page: branding, company profile, security policy and subscription, with a section
 * navigator and a single save bar for the two editable forms (profile and security policy).
 */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const route = useRoute();
const num = (n: number) => n.toLocaleString(appLocale());

// ---- Profile ---------------------------------------------------------------------------------------------------
const org = useAsync(() => organizationApi.get());
const initial = computed<ProfileFields | null>(() => (org.data.value ? toProfileFields(org.data.value) : null));
const profile = ref<ProfileFields | null>(null);
const profileErrors = useFormErrors();
const savingProfile = ref(false);
const canEditProfile = computed(() => auth.can('organization.update'));
const profileChanges = computed(() => (initial.value && profile.value ? changedFields(initial.value, profile.value) : {}));
const profileDirty = computed(() => canEditProfile.value && Object.keys(profileChanges.value).length > 0);
watch(initial, (v) => (profile.value = v ? { ...v } : null), { immediate: true });
const logoSrc = computed(() => apiAssetUrl(org.data.value?.logoUrl ?? null));

async function saveProfile() {
  profileErrors.reset();
  savingProfile.value = true;
  try {
    org.data.value = await organizationApi.update(profileChanges.value);
    await auth.loadContext();
    feedback.success('Organization profile saved');
  } catch (e) {
    profileErrors.handle(e, 'Could not save profile');
  } finally {
    savingProfile.value = false;
  }
}

async function onBrandColor(brandColor: string | null) {
  if (org.data.value) org.data.value = { ...org.data.value, brandColor };
  await auth.loadContext();
}

function onLogo(logoUrl: string | null) {
  if (org.data.value) org.data.value = { ...org.data.value, logoUrl };
}

// ---- Security policy -------------------------------------------------------------------------------------------
const POLICY_KEYS = [
  'passwordMinLength',
  'passwordRequireUppercase',
  'passwordRequireLowercase',
  'passwordRequireNumber',
  'passwordRequireSymbol',
  'passwordHistoryCount',
  'passwordMaxAgeDays',
  'lockoutThreshold',
  'lockoutDurationMinutes',
  'sessionIdleTimeoutMinutes',
  'sessionMaxLifetimeHours',
  'mfaRequired',
] as const;
const policy = useAsync(() => organizationApi.securityPolicy());
const policyForm = reactive<Partial<SecurityPolicy>>({});
const policyErrors = useFormErrors();
const savingPolicy = ref(false);
const canEditPolicy = computed(() => auth.can('organization.security.manage'));
watch(policy.data, (p) => p && Object.assign(policyForm, p), { immediate: true });
const policyDirty = computed(() => canEditPolicy.value && !!policy.data.value && POLICY_KEYS.some((k) => policyForm[k] !== policy.data.value![k]));

async function savePolicy() {
  policyErrors.reset();
  if (policyForm.mfaRequired && !policy.data.value?.mfaRequired) {
    const ok = await feedback.confirm({
      title: 'Require two-factor authentication?',
      message: 'Users without 2FA will be restricted to the security page until they enrol.',
      confirmLabel: 'Require 2FA',
    });
    if (!ok) return;
  }
  savingPolicy.value = true;
  try {
    const { id: _id, updatedAt: _u, ...body } = policyForm as SecurityPolicy;
    policy.data.value = await organizationApi.updateSecurityPolicy(body);
    await auth.loadContext();
    feedback.success('Security policy saved');
  } catch (e) {
    policyErrors.handle(e, 'Could not save policy');
  } finally {
    savingPolicy.value = false;
  }
}

/** A quick read of the policy as it is being edited, against common hardening baselines. */
const checkup = computed(() => [
  { label: 'Two-factor required', ok: !!policyForm.mfaRequired },
  { label: '12+ character passwords', ok: (policyForm.passwordMinLength ?? 0) >= 12 },
  { label: 'Recent passwords blocked', ok: (policyForm.passwordHistoryCount ?? 0) >= 3 },
  { label: 'Lockout within 5 attempts', ok: !!policyForm.lockoutThreshold && policyForm.lockoutThreshold <= 5 },
  { label: 'Idle sign-out within 30 min', ok: !!policyForm.sessionIdleTimeoutMinutes && policyForm.sessionIdleTimeoutMinutes <= 30 },
]);
const checkupScore = computed(() => checkup.value.filter((c) => c.ok).length);

// ---- Subscription ----------------------------------------------------------------------------------------------
const subscription = useAsync(() => organizationApi.subscription());
const seatShare = computed(() => {
  const s = subscription.data.value;
  return s?.plan.maxUsers ? Math.min(100, (s.userCount / s.plan.maxUsers) * 100) : null;
});
const includedModules = computed(() => subscription.data.value?.modules.filter((m) => m.entitled).length ?? 0);

// ---- Save bar --------------------------------------------------------------------------------------------------
const saving = computed(() => savingProfile.value || savingPolicy.value);
const dirty = computed(() => profileDirty.value || policyDirty.value);

async function saveAll() {
  if (profileDirty.value) await saveProfile();
  if (policyDirty.value) await savePolicy();
}

function discard() {
  if (initial.value) profile.value = { ...initial.value };
  if (policy.data.value) Object.assign(policyForm, policy.data.value);
  profileErrors.reset();
  policyErrors.reset();
}

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true;
  return feedback.confirm({ title: 'Discard unsaved changes?', message: 'Your changes to the organization settings have not been saved.', confirmLabel: 'Discard changes', danger: true });
});

// ---- Section navigator -----------------------------------------------------------------------------------------
interface NavItem {
  id: string;
  label: string;
  icon: Component;
  dirty?: () => boolean;
}
const nav: { title: string; items: NavItem[] }[] = [
  {
    title: 'Organization',
    items: [
      { id: 'branding', label: 'Branding', icon: Palette },
      { id: 'company', label: 'Company', icon: Building2, dirty: () => profileDirty.value },
      { id: 'contact', label: 'Contact & address', icon: MapPin },
      { id: 'regional', label: 'Regional settings', icon: Globe },
    ],
  },
  {
    title: 'Security',
    items: [
      { id: 'passwords', label: 'Passwords', icon: KeyRound, dirty: () => policyDirty.value },
      { id: 'lockout', label: 'Account lockout', icon: LockKeyhole },
      { id: 'sessions', label: 'Sessions', icon: Timer },
      { id: 'mfa', label: 'Two-factor', icon: ShieldCheck },
    ],
  },
  {
    title: 'Subscription',
    items: [
      { id: 'plan', label: 'Plan & seats', icon: CreditCard },
      { id: 'modules', label: 'Modules', icon: Boxes },
    ],
  },
];
const ids = nav.flatMap((g) => g.items.map((i) => i.id));
const active = ref(ids[0]!);
const anchorId = (id: string) => `settings-${id}`;
let main: HTMLElement | null = null;
let lockUntil = 0;

function go(id: string) {
  active.value = id;
  lockUntil = Date.now() + 800;
  document.getElementById(anchorId(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function onScroll() {
  if (!main || Date.now() < lockUntil) return;
  const line = main.getBoundingClientRect().top + main.clientHeight * 0.35;
  let current = ids[0]!;
  for (const id of ids) {
    const el = document.getElementById(anchorId(id));
    if (el && el.getBoundingClientRect().top <= line) current = id;
  }
  if (main.scrollTop > 0 && main.scrollTop + main.clientHeight >= main.scrollHeight - 2) current = ids.filter((id) => document.getElementById(anchorId(id))).at(-1) ?? current;
  active.value = current;
}

onMounted(() => {
  main = document.getElementById('main');
  main?.addEventListener('scroll', onScroll, { passive: true });
});
onBeforeUnmount(() => main?.removeEventListener('scroll', onScroll));

/** `/admin/organization#security` (or any section id) opens the page at that section once it has rendered. */
const ALIASES: Record<string, string> = { profile: 'company', brand: 'branding', security: 'passwords', subscription: 'plan' };
const wanted = route.hash.slice(1);
if (wanted) {
  const target = ALIASES[wanted] ?? wanted;
  const stop = watch(
    () => !!(org.data.value && policy.data.value),
    async (ready) => {
      if (!ready || !ids.includes(target)) return;
      await nextTick();
      go(target);
      stop();
    },
    { immediate: true },
  );
}
</script>

<template>
  <div>
    <AppPageHeader title="Organization settings" description="Branding, company profile, regional defaults, security policy and subscription.">
      <template #leading>
        <span class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface ring-1 ring-line shadow-xs" aria-hidden="true">
          <img v-if="logoSrc" :src="logoSrc" alt="" class="h-full w-full object-contain p-1.5" />
          <span v-else class="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-semibold text-white">{{ org.data.value?.name.charAt(0).toUpperCase() ?? '' }}</span>
        </span>
      </template>
      <template v-if="org.data.value" #badges>
        <AppBadge :tone="organizationTone[org.data.value.status]" dot>{{ statusLabel(org.data.value.status) }}</AppBadge>
        <AppBadge tone="brand">{{ org.data.value.plan.name }} plan</AppBadge>
      </template>
    </AppPageHeader>

    <AppErrorState v-if="org.error.value" :error="org.error.value" title="Could not load organization settings" @retry="org.run" />
    <div v-else class="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
      <!-- Section navigator -->
      <nav aria-label="Settings sections" class="min-w-0 lg:sticky lg:top-4">
        <ol class="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:hidden">
          <li v-for="item in nav.flatMap((g) => g.items)" :key="item.id">
            <button
              type="button"
              :class="['inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap ring-1 transition', active === item.id ? 'bg-accent-soft text-accent-fg ring-brand-600/20' : 'bg-surface text-fg-muted ring-line hover:text-fg']"
              @click="go(item.id)"
            >
              <component :is="item.icon" :size="13" aria-hidden="true" />{{ item.label }}
            </button>
          </li>
        </ol>
        <div class="hidden space-y-5 lg:block">
          <div v-for="g in nav" :key="g.title">
            <p class="px-2.5 pb-1.5 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{{ g.title }}</p>
            <ul class="space-y-0.5">
              <li v-for="item in g.items" :key="item.id">
                <button
                  type="button"
                  :aria-current="active === item.id ? 'location' : undefined"
                  :class="[
                    'group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-start text-sm transition-colors',
                    active === item.id ? 'bg-surface font-medium text-fg shadow-xs ring-1 ring-line' : 'text-fg-muted hover:bg-surface-muted/70 hover:text-fg',
                  ]"
                  @click="go(item.id)"
                >
                  <span v-if="active === item.id" class="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-brand-600 dark:bg-brand-400" aria-hidden="true" />
                  <component :is="item.icon" :size="15" :class="active === item.id ? 'text-accent-fg' : 'text-fg-subtle group-hover:text-fg-muted'" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                  <span v-if="item.dirty?.()" class="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-label="Unsaved changes" />
                </button>
              </li>
            </ul>
          </div>
          <div class="space-y-2 border-t border-line/70 px-2.5 pt-4 text-xs text-fg-muted">
            <p v-if="org.data.value">Profile updated <span class="text-fg" :title="formatDateTime(org.data.value.updatedAt)">{{ timeAgo(org.data.value.updatedAt) }}</span></p>
            <p v-if="policy.data.value">Policy updated <span class="text-fg" :title="formatDateTime(policy.data.value.updatedAt)">{{ timeAgo(policy.data.value.updatedAt) }}</span></p>
            <RouterLink v-if="auth.can('audit.view')" to="/admin/audit-logs" class="inline-flex items-center gap-1.5 font-medium text-accent-fg hover:underline">
              <FileClock :size="13" aria-hidden="true" />Review changes in the audit log
            </RouterLink>
          </div>
        </div>
      </nav>

      <div class="min-w-0 space-y-6">
        <!-- Branding -->
        <section :id="anchorId('branding')" class="card scroll-mt-4" aria-labelledby="branding-title">
          <header class="flex min-h-14 flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 ring-1 ring-violet-600/15 ring-inset dark:bg-violet-500/15 dark:text-violet-300" aria-hidden="true"><Palette :size="17" /></span>
            <div class="min-w-0 flex-1">
              <h2 id="branding-title" class="text-sm font-semibold text-fg">Branding</h2>
              <p class="text-xs text-fg-muted">Your logo and color across the sidebar, theme and documents.</p>
            </div>
            <span class="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted"><Zap :size="11" aria-hidden="true" />Applies immediately</span>
          </header>
          <div class="divide-y divide-line/70 px-5">
            <AppSkeleton v-if="!org.data.value" class="py-6" :lines="4" />
            <template v-else>
              <div class="grid gap-x-10 gap-y-4 py-6 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div>
                  <p class="text-sm font-semibold text-fg">Logo</p>
                  <p class="mt-1 text-sm text-fg-muted">Shown at the top of the sidebar for everyone in your organization.</p>
                </div>
                <OrganizationLogoUploader :logo-url="org.data.value.logoUrl" :organization-name="org.data.value.name" :disabled="!canEditProfile" @changed="onLogo" />
              </div>
              <div class="grid gap-x-10 gap-y-4 py-6 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div>
                  <p class="text-sm font-semibold text-fg">Brand color</p>
                  <p class="mt-1 text-sm text-fg-muted">Becomes the Organization theme: a full, accessible palette generated from your color. It is the default for everyone who hasn’t picked a theme of their own.</p>
                </div>
                <OrganizationBrandColor :brand-color="org.data.value.brandColor" :logo-url="org.data.value.logoUrl" :disabled="!canEditProfile" @changed="onBrandColor" />
              </div>
            </template>
          </div>
        </section>

        <!-- Company profile -->
        <section class="card" aria-labelledby="profile-title">
          <header class="flex min-h-14 flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 ring-1 ring-sky-600/15 ring-inset dark:bg-sky-500/15 dark:text-sky-300" aria-hidden="true"><Building2 :size="17" /></span>
            <div class="min-w-0 flex-1">
              <h2 id="profile-title" class="text-sm font-semibold text-fg">Company profile</h2>
              <p class="text-xs text-fg-muted">Legal details, registered office and regional defaults.</p>
            </div>
            <span v-if="!canEditProfile" class="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted"><LockKeyhole :size="11" aria-hidden="true" />Read only</span>
          </header>
          <div class="px-5 py-6">
            <AppSkeleton v-if="!profile" :lines="8" />
            <form v-else id="org-profile" novalidate @submit.prevent="saveProfile">
              <AppAlert v-if="profileErrors.formError.value" class="mb-6">{{ profileErrors.formError.value }}</AppAlert>
              <OrganizationProfileForm v-model="profile" :errors="profileErrors.fieldErrors.value" :disabled="!canEditProfile" anchor-prefix="settings-" />
            </form>
          </div>
        </section>

        <!-- Security policy -->
        <section class="card" aria-labelledby="security-title">
          <header class="flex min-h-14 flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15 ring-inset dark:bg-emerald-500/15 dark:text-emerald-300" aria-hidden="true"><ShieldCheck :size="17" /></span>
            <div class="min-w-0 flex-1">
              <h2 id="security-title" class="text-sm font-semibold text-fg">Security policy</h2>
              <p class="text-xs text-fg-muted">Applies to everyone who signs in to this organization.</p>
            </div>
            <span v-if="!canEditPolicy" class="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted"><LockKeyhole :size="11" aria-hidden="true" />Read only</span>
          </header>
          <div class="px-5 py-6">
            <AppSkeleton v-if="policy.loading.value && !policy.data.value" :lines="8" />
            <AppErrorState v-else-if="policy.error.value" :error="policy.error.value" @retry="policy.run" />
            <form v-else-if="policy.data.value" id="org-policy" novalidate @submit.prevent="savePolicy">
              <AppAlert v-if="policyErrors.formError.value" class="mb-6">{{ policyErrors.formError.value }}</AppAlert>

              <div class="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl bg-surface-muted/60 px-4 py-3 ring-1 ring-line/70 ring-inset">
                <div class="flex items-center gap-3">
                  <span
                    :class="[
                      'flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold tabular-nums ring-4',
                      checkupScore >= 4 ? 'bg-success-soft text-success-fg ring-success/15' : checkupScore >= 2 ? 'bg-warning-soft text-warning-fg ring-warning/20' : 'bg-danger-soft text-danger-fg ring-danger/15',
                    ]"
                  >
                    {{ checkupScore }}/{{ checkup.length }}
                  </span>
                  <div>
                    <p class="text-sm font-semibold text-fg">Security checkup</p>
                    <p class="text-xs text-fg-muted">Recommended settings in place</p>
                  </div>
                </div>
                <ul class="flex flex-1 flex-wrap gap-1.5" aria-label="Recommendations">
                  <li
                    v-for="c in checkup"
                    :key="c.label"
                    :class="['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', c.ok ? 'bg-success-soft text-success-fg ring-success/15' : 'bg-surface text-fg-muted ring-line']"
                  >
                    <component :is="c.ok ? Check : CircleAlert" :size="12" aria-hidden="true" />{{ c.label }}<span class="sr-only">{{ c.ok ? ' (in place)' : ' (not in place)' }}</span>
                  </li>
                </ul>
              </div>

              <fieldset :disabled="!canEditPolicy" class="divide-y divide-line/70">
                <div :id="anchorId('passwords')" class="grid scroll-mt-4 gap-x-10 gap-y-4 pb-8 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div>
                    <p class="text-sm font-semibold text-fg">Password requirements</p>
                    <p class="mt-1 text-sm text-fg-muted">Rules every new password must meet. Longer passwords protect better than complex ones.</p>
                  </div>
                  <div class="space-y-5">
                    <div class="grid gap-4 sm:grid-cols-3">
                      <AppInput v-model="policyForm.passwordMinLength" type="number" label="Minimum length" suffix="chars" :min="8" :max="128" :error="policyErrors.fieldErrors.value.passwordMinLength" />
                      <AppInput v-model="policyForm.passwordHistoryCount" type="number" label="Password history" suffix="passwords" help="Previous passwords that cannot be reused" :min="0" :max="24" :error="policyErrors.fieldErrors.value.passwordHistoryCount" />
                      <AppInput v-model="policyForm.passwordMaxAgeDays" type="number" label="Maximum age" suffix="days" help="0 = passwords never expire" :min="0" :max="365" :error="policyErrors.fieldErrors.value.passwordMaxAgeDays" />
                    </div>
                    <div class="grid gap-px overflow-hidden rounded-lg bg-line/60 ring-1 ring-line/60 sm:grid-cols-2">
                      <div class="bg-surface px-4 py-3"><AppSwitch v-model="policyForm.passwordRequireUppercase" label="Require uppercase letter" description="A–Z" /></div>
                      <div class="bg-surface px-4 py-3"><AppSwitch v-model="policyForm.passwordRequireLowercase" label="Require lowercase letter" description="a–z" /></div>
                      <div class="bg-surface px-4 py-3"><AppSwitch v-model="policyForm.passwordRequireNumber" label="Require number" description="0–9" /></div>
                      <div class="bg-surface px-4 py-3"><AppSwitch v-model="policyForm.passwordRequireSymbol" label="Require symbol" description="Such as ! @ # $" /></div>
                    </div>
                  </div>
                </div>
                <div :id="anchorId('lockout')" class="grid scroll-mt-4 gap-x-10 gap-y-4 py-8 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div>
                    <p class="text-sm font-semibold text-fg">Account lockout</p>
                    <p class="mt-1 text-sm text-fg-muted">Slows down password guessing by locking an account after repeated failures.</p>
                  </div>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <AppInput v-model="policyForm.lockoutThreshold" type="number" label="Failed attempts" suffix="attempts" :min="3" :max="20" :error="policyErrors.fieldErrors.value.lockoutThreshold" />
                    <AppInput v-model="policyForm.lockoutDurationMinutes" type="number" label="Lockout duration" suffix="min" :min="1" :max="1440" :error="policyErrors.fieldErrors.value.lockoutDurationMinutes" />
                  </div>
                </div>
                <div :id="anchorId('sessions')" class="grid scroll-mt-4 gap-x-10 gap-y-4 py-8 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div>
                    <p class="text-sm font-semibold text-fg">Sessions</p>
                    <p class="mt-1 text-sm text-fg-muted">How long people stay signed in when idle, and at most.</p>
                  </div>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <AppInput v-model="policyForm.sessionIdleTimeoutMinutes" type="number" label="Idle timeout" suffix="min" :min="5" :max="1440" :error="policyErrors.fieldErrors.value.sessionIdleTimeoutMinutes" />
                    <AppInput v-model="policyForm.sessionMaxLifetimeHours" type="number" label="Maximum lifetime" suffix="hours" :min="1" :max="720" :error="policyErrors.fieldErrors.value.sessionMaxLifetimeHours" />
                  </div>
                </div>
                <div :id="anchorId('mfa')" class="grid scroll-mt-4 gap-x-10 gap-y-4 pt-8 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div>
                    <p class="text-sm font-semibold text-fg">Two-factor authentication</p>
                    <p class="mt-1 text-sm text-fg-muted">The single most effective protection against stolen passwords.</p>
                  </div>
                  <div :class="['rounded-xl px-4 py-4 ring-1 ring-inset transition-colors', policyForm.mfaRequired ? 'bg-success-soft/60 ring-success/20' : 'bg-surface-muted/50 ring-line']">
                    <AppSwitch v-model="policyForm.mfaRequired" label="Require 2FA for all users" description="Users must enrol an authenticator app before accessing HRMS." />
                  </div>
                </div>
              </fieldset>
            </form>
          </div>
        </section>

        <!-- Subscription -->
        <section class="card" aria-labelledby="subscription-title">
          <header class="flex min-h-14 flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 ring-1 ring-amber-600/15 ring-inset dark:bg-amber-500/15 dark:text-amber-300" aria-hidden="true"><CreditCard :size="17" /></span>
            <div class="min-w-0 flex-1">
              <h2 id="subscription-title" class="text-sm font-semibold text-fg">Subscription</h2>
              <p class="text-xs text-fg-muted">Your plan, seats and included modules. Contact your platform administrator to change them.</p>
            </div>
          </header>
          <div class="space-y-6 px-5 py-6">
            <AppSkeleton v-if="subscription.loading.value && !subscription.data.value" :lines="6" />
            <AppErrorState v-else-if="subscription.error.value" :error="subscription.error.value" @retry="subscription.run" />
            <template v-else-if="subscription.data.value">
              <div :id="anchorId('plan')" class="relative scroll-mt-4 overflow-hidden rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white shadow-card">
                <div class="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
                <div class="relative flex flex-wrap items-end justify-between gap-6">
                  <div class="min-w-0">
                    <p class="text-xs font-medium tracking-wide text-white/70 uppercase">Current plan</p>
                    <p class="mt-1 text-3xl font-semibold tracking-tight">{{ subscription.data.value.plan.name }}</p>
                    <p class="mt-1 max-w-md text-sm text-white/75">{{ subscription.data.value.plan.description }}</p>
                  </div>
                  <dl class="grid w-full max-w-sm grid-cols-2 gap-4">
                    <div>
                      <dt class="text-xs text-white/70">Seats used</dt>
                      <dd class="mt-0.5 text-lg font-semibold tabular-nums">
                        {{ num(subscription.data.value.userCount) }}<span class="text-sm font-normal text-white/70"> / {{ subscription.data.value.plan.maxUsers ? num(subscription.data.value.plan.maxUsers) : 'Unlimited' }}</span>
                      </dd>
                    </div>
                    <div>
                      <dt class="text-xs text-white/70">Modules</dt>
                      <dd class="mt-0.5 text-lg font-semibold tabular-nums">{{ includedModules }}<span class="text-sm font-normal text-white/70"> of {{ subscription.data.value.modules.length }} included</span></dd>
                    </div>
                    <div class="col-span-2">
                      <div
                        class="h-2 overflow-hidden rounded-full bg-white/20"
                        role="progressbar"
                        aria-label="User seats used"
                        :aria-valuenow="subscription.data.value.userCount"
                        :aria-valuemax="subscription.data.value.plan.maxUsers ?? undefined"
                      >
                        <div class="h-full rounded-full bg-white transition-[width] duration-500" :style="{ width: seatShare === null ? '100%' : `${seatShare}%` }" />
                      </div>
                      <p class="mt-1.5 text-2xs text-white/70">{{ seatShare === null ? 'No seat limit on this plan' : `${Math.round(seatShare)}% of seats in use` }}</p>
                    </div>
                  </dl>
                </div>
              </div>

              <div :id="anchorId('modules')" class="scroll-mt-4">
                <div class="mb-3 flex items-baseline justify-between gap-3">
                  <p class="text-sm font-semibold text-fg">Modules</p>
                  <p class="text-xs text-fg-muted tabular-nums">{{ includedModules }} included · {{ subscription.data.value.modules.length - includedModules }} available on other plans</p>
                </div>
                <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <li
                    v-for="m in subscription.data.value.modules"
                    :key="m.key"
                    :class="['flex items-start gap-3 rounded-xl p-3.5 ring-1 ring-inset transition', m.entitled ? 'bg-surface ring-line' : 'bg-surface-muted/40 ring-line/70 [&_.mod-text]:opacity-70']"
                  >
                    <span
                      :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', m.entitled ? 'bg-accent-soft text-accent-fg ring-brand-600/15' : 'bg-surface text-fg-subtle ring-line']"
                      aria-hidden="true"
                    >
                      <component :is="MODULE_ICONS[m.key]" :size="16" />
                    </span>
                    <div class="mod-text min-w-0 flex-1">
                      <p class="text-sm leading-5 font-medium text-fg">{{ m.name }}</p>
                      <p class="mt-0.5 line-clamp-2 text-xs text-fg-muted">{{ m.description }}</p>
                    </div>
                    <AppBadge v-if="m.core" size="sm" tone="brand">Core</AppBadge>
                    <span v-else-if="m.entitled" class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-fg" title="Included"><Check :size="12" :stroke-width="3" aria-hidden="true" /><span class="sr-only">Included</span></span>
                    <AppBadge v-else size="sm">Not included</AppBadge>
                  </li>
                </ul>
              </div>
            </template>
          </div>
        </section>

        <!-- Unsaved changes: appears only when a form has changes, and stays in view while scrolling. -->
        <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="translate-y-3 opacity-0" leave-active-class="transition duration-150" leave-to-class="translate-y-3 opacity-0">
          <div v-if="dirty" class="sticky bottom-4 z-20">
            <div class="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-2xl bg-surface-raised px-4 py-3 shadow-pop ring-1 ring-line" role="region" aria-label="Unsaved changes">
              <span class="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
              <p class="min-w-0 flex-1 text-sm text-fg">
                <span class="font-medium">Unsaved changes</span>
                <span class="text-fg-muted"> in </span>
                <button v-if="profileDirty" type="button" class="font-medium text-accent-fg hover:underline" @click="go('company')">company profile</button>
                <span v-if="profileDirty && policyDirty" class="text-fg-muted"> and </span>
                <button v-if="policyDirty" type="button" class="font-medium text-accent-fg hover:underline" @click="go('passwords')">security policy</button>
              </p>
              <AppButton variant="ghost" size="sm" :disabled="saving" @click="discard">Discard</AppButton>
              <AppButton size="sm" :icon="Save" :loading="saving" @click="saveAll">Save changes</AppButton>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>
