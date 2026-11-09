<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  ArrowLeft,
  Ban,
  Building2,
  CalendarDays,
  CircleSlash,
  Clock,
  Globe,
  Hash,
  LayoutGrid,
  Mail,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  UsersRound,
} from '@lucide/vue';
import type { ModuleKey } from '@contracts';
import { platformApi } from '@/modules/platform/api/platform.api';
import OrgMark from '@/modules/platform/components/OrgMark.vue';
import { planVisual } from '@/modules/platform/utils/platform-visuals';
import OrganizationProfileForm from '@/modules/organization/components/OrganizationProfileForm.vue';
import {
  AppAlert,
  AppAvatar,
  AppBadge,
  AppButton,
  AppCard,
  AppErrorState,
  AppModal,
  AppSegmented,
  AppSelect,
  AppSkeleton,
  AppStatStrip,
  AppTabs,
  AppTextarea,
  type Fact,
  type StripItem,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { appLocale } from '@/core/locale/locale';
import { formatDate, formatDateTime, formatMoney, timeAgo } from '@/shared/utils/format';
import { MODULE_ICONS } from '@/shared/utils/module-icons';
import { COMPANY_SIZE_OPTIONS, COUNTRY_OPTIONS, MONTH_OPTIONS } from '@/shared/utils/options';
import { changedFields, toProfileFields, type ProfileFields } from '@/modules/organization/utils/profile';
import { membershipTone, organizationTone, statusLabel } from '@/shared/utils/status';

/** One tenant: identity header, overview (people, administrators, subscription, danger zone), profile and module entitlements. */
const route = useRoute();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const org = useAsync(() => platformApi.organization(id.value));
const plans = useAsync(() => platformApi.plans());
const canManage = computed(() => auth.canPlatform('platform.organizations.manage'));
const tab = ref('overview');
const busy = ref<string | null>(null);
const num = (n: number) => n.toLocaleString(appLocale());

// Status changes
const statusModal = ref<'suspend' | 'deactivate' | null>(null);
const reason = ref('');
async function changeStatus(kind: 'activate' | 'suspend' | 'deactivate') {
  busy.value = kind;
  try {
    org.data.value =
      kind === 'activate' ? await platformApi.activate(id.value) : kind === 'suspend' ? await platformApi.suspend(id.value, reason.value.trim()) : await platformApi.deactivate(id.value, reason.value.trim());
    statusModal.value = null;
    reason.value = '';
    feedback.success(`Organization ${kind === 'activate' ? 'activated' : kind === 'suspend' ? 'suspended' : 'deactivated'}`);
  } catch (e) {
    feedback.error('Status change failed', e);
  } finally {
    busy.value = null;
  }
}

// Plan
const planId = ref<string | null>(null);
watch(org.data, (o) => o && (planId.value = o.plan.id), { immediate: true });
const planOptions = computed(() => (plans.data.value ?? []).map((p) => ({ label: `${p.name}${p.isActive ? '' : ' (inactive)'}`, value: p.id, disabled: !p.isActive })));
const currentPlan = computed(() => plans.data.value?.find((p) => p.id === org.data.value?.plan.id) ?? null);
const chosenPlan = computed(() => plans.data.value?.find((p) => p.id === planId.value) ?? null);
async function savePlan() {
  busy.value = 'plan';
  try {
    org.data.value = await platformApi.updateOrganization(id.value, { planId: planId.value });
    feedback.success('Plan updated');
  } catch (e) {
    feedback.error('Could not change plan', e);
  } finally {
    busy.value = null;
  }
}

async function resend(membershipId: string) {
  busy.value = `resend:${membershipId}`;
  try {
    await platformApi.resendAdminInvitation(id.value, membershipId);
    feedback.success('Invitation resent');
  } catch (e) {
    feedback.error('Could not resend invitation', e);
  } finally {
    busy.value = null;
  }
}

// Overview
const activeUsers = computed(() => org.data.value?.members.ACTIVE ?? 0);
const seats = computed(() => {
  const max = currentPlan.value?.maxUsers ?? null;
  return { max, share: max ? Math.min(100, (activeUsers.value / max) * 100) : null };
});
const strip = computed<StripItem[]>(() => {
  const m = org.data.value?.members ?? {};
  return [
    { key: 'active', label: 'Active users', value: num(m.ACTIVE ?? 0), tone: 'success' },
    { key: 'invited', label: 'Invited', value: num(m.INVITED ?? 0), tone: 'info', hint: 'Waiting to accept' },
    { key: 'suspended', label: 'Suspended', value: num(m.SUSPENDED ?? 0), tone: 'danger' },
    {
      key: 'seats',
      label: 'Seats used',
      value: seats.value.max ? `${Math.round(seats.value.share ?? 0)}%` : 'Unlimited',
      tone: 'brand',
      hint: seats.value.max ? `${num(activeUsers.value)} of ${num(seats.value.max)}` : (currentPlan.value ? `${currentPlan.value.name} has no limit` : undefined),
    },
  ];
});
const enabledModules = computed(() => org.data.value?.modules.filter((m) => m.entitled) ?? []);
const facts = computed<Fact[]>(() => {
  const o = org.data.value;
  if (!o) return [];
  return [
    { label: 'Legal name', value: o.legalName },
    { label: 'Industry', value: o.industry },
    { label: 'Company size', value: COMPANY_SIZE_OPTIONS.find((c) => c.value === o.companySize)?.label ?? o.companySize },
    { label: 'Email', value: o.email },
    { label: 'Phone', value: o.phone },
    { label: 'Website', value: o.website },
    { label: 'Country', value: COUNTRY_OPTIONS.find((c) => c.value === o.country)?.label ?? o.country },
    { label: 'Time zone', value: o.timezone },
    { label: 'Currency', value: o.currency },
    { label: 'Financial year starts', value: MONTH_OPTIONS.find((m) => m.value === o.fiscalYearStartMonth)?.label ?? null },
    { label: 'Activated', value: o.activatedAt ? formatDate(o.activatedAt) : null },
  ];
});

// Profile
const initial = computed<ProfileFields | null>(() => (org.data.value ? toProfileFields(org.data.value) : null));
const profile = ref<ProfileFields | null>(null);
watch(initial, (v) => (profile.value = v ? { ...v } : null), { immediate: true });
const profileChanges = computed(() => (initial.value && profile.value ? changedFields(initial.value, profile.value) : {}));
const profileDirty = computed(() => canManage.value && Object.keys(profileChanges.value).length > 0);
const profileErrors = useFormErrors();
async function saveProfile() {
  profileErrors.reset();
  busy.value = 'profile';
  try {
    org.data.value = await platformApi.updateOrganization(id.value, profileChanges.value);
    feedback.success('Profile saved');
  } catch (e) {
    profileErrors.handle(e, 'Could not save profile');
  } finally {
    busy.value = null;
  }
}
function discardProfile() {
  if (initial.value) profile.value = { ...initial.value };
  profileErrors.reset();
}

// Entitlements
type OverrideChoice = 'plan' | 'on' | 'off';
const overrides = ref<Record<string, OverrideChoice>>({});
const savedOverrides = computed<Record<string, OverrideChoice>>(() => {
  const o = org.data.value;
  if (!o) return {};
  return Object.fromEntries(
    o.modules
      .filter((m) => !m.core)
      .map((m) => {
        const ov = o.featureOverrides.find((f) => f.featureKey === m.key);
        return [m.key, ov ? (ov.enabled ? 'on' : 'off') : 'plan'];
      }),
  );
});
watch(savedOverrides, (v) => (overrides.value = { ...v }), { immediate: true });
const overrideOptions = [
  { label: 'Follow plan', value: 'plan' as OverrideChoice },
  { label: 'Force enable', value: 'on' as OverrideChoice },
  { label: 'Force disable', value: 'off' as OverrideChoice },
];
const planFeatures = computed(() => new Set(plans.data.value?.find((p) => p.id === org.data.value?.plan.id)?.featureKeys ?? []));
const businessModules = computed(() => org.data.value?.modules.filter((m) => !m.core) ?? []);
const coreModules = computed(() => org.data.value?.modules.filter((m) => m.core) ?? []);
/** What a module would be with the choices on screen (before saving). */
const effective = (key: ModuleKey) => (overrides.value[key] === 'plan' ? planFeatures.value.has(key) : overrides.value[key] === 'on');
const overrideChanges = computed(() => Object.keys(overrides.value).filter((k) => overrides.value[k] !== savedOverrides.value[k]).length);
const activeOverrides = computed(() => Object.values(overrides.value).filter((v) => v !== 'plan').length);
async function saveEntitlements() {
  busy.value = 'features';
  try {
    org.data.value = await platformApi.setFeatures(
      id.value,
      Object.entries(overrides.value).map(([featureKey, choice]) => ({ featureKey, enabled: choice === 'plan' ? null : choice === 'on' })),
    );
    feedback.success('Entitlements saved');
  } catch (e) {
    feedback.error('Could not save entitlements', e);
  } finally {
    busy.value = null;
  }
}

const tabs = computed(() => [
  { key: 'overview', label: 'Overview', icon: LayoutGrid },
  { key: 'profile', label: 'Profile', icon: Building2 },
  { key: 'entitlements', label: 'Entitlements', icon: SlidersHorizontal, count: org.data.value ? enabledModules.value.length : null },
]);
</script>

<template>
  <div>
    <AppSkeleton v-if="org.loading.value && !org.data.value" :lines="8" />
    <AppErrorState v-else-if="org.error.value" :error="org.error.value" title="Could not load organization" @retry="org.run" />
    <template v-else-if="org.data.value">
      <RouterLink to="/platform/organizations" class="group mb-2 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-fg-muted transition hover:text-fg">
        <ArrowLeft :size="13" class="transition group-hover:-translate-x-0.5 rtl:rotate-180" aria-hidden="true" /> Organizations
      </RouterLink>

      <!-- Identity header -->
      <section class="card mb-4 overflow-hidden" aria-labelledby="org-name">
        <div :class="['h-1 bg-gradient-to-r', planVisual(org.data.value.plan.code).strip]" aria-hidden="true" />
        <div class="flex flex-wrap items-center gap-x-5 gap-y-4 p-5">
          <OrgMark :name="org.data.value.name" :logo-url="org.data.value.logoUrl" size="xl" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h1 id="org-name" class="truncate text-xl font-semibold tracking-tight text-fg lg:text-2xl">{{ org.data.value.name }}</h1>
              <AppBadge :tone="organizationTone[org.data.value.status]" dot>{{ statusLabel(org.data.value.status) }}</AppBadge>
              <span :class="['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', planVisual(org.data.value.plan.code).tile]">
                <component :is="planVisual(org.data.value.plan.code).icon" :size="12" aria-hidden="true" />{{ org.data.value.plan.name }}
              </span>
            </div>
            <ul class="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-muted">
              <li class="inline-flex items-center gap-1.5"><Hash :size="13" aria-hidden="true" /><span class="font-mono text-fg">{{ org.data.value.slug }}</span></li>
              <li class="inline-flex items-center gap-1.5" :title="formatDateTime(org.data.value.createdAt)"><CalendarDays :size="13" aria-hidden="true" />Created {{ formatDate(org.data.value.createdAt) }}</li>
              <li class="inline-flex items-center gap-1.5"><Globe :size="13" aria-hidden="true" />{{ COUNTRY_OPTIONS.find((c) => c.value === org.data.value!.country)?.label ?? org.data.value.country }} · {{ org.data.value.timezone }}</li>
              <li class="inline-flex items-center gap-1.5"><UsersRound :size="13" aria-hidden="true" />{{ num(activeUsers) }} active {{ activeUsers === 1 ? 'user' : 'users' }}</li>
            </ul>
          </div>
          <div v-if="canManage && org.data.value.status !== 'ACTIVE'" class="flex flex-wrap items-center gap-2">
            <AppButton :icon="RotateCcw" :loading="busy === 'activate'" @click="changeStatus('activate')">Activate</AppButton>
          </div>
        </div>
      </section>

      <AppAlert v-if="org.data.value.suspensionReason && org.data.value.status !== 'ACTIVE'" class="mb-4">
        {{ org.data.value.status === 'SUSPENDED' ? 'Suspended' : 'Deactivated' }} {{ formatDateTime(org.data.value.suspendedAt) }}: {{ org.data.value.suspensionReason }}
      </AppAlert>

      <AppTabs v-model="tab" :tabs="tabs">
        <!-- Overview -->
        <div v-if="tab === 'overview'" class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div class="min-w-0 space-y-4">
            <AppStatStrip :items="strip" label="People in this organization" />

            <AppCard title="Organization administrators" :icon="ShieldCheck" :description="`${org.data.value.admins.length} ${org.data.value.admins.length === 1 ? 'person has' : 'people have'} full administrative access`" :padded="false">
              <ul v-if="org.data.value.admins.length" class="divide-y divide-line/70">
                <li v-for="a in org.data.value.admins" :key="a.membershipId" class="flex flex-wrap items-center gap-3 px-4 py-3">
                  <AppAvatar :name="`${a.firstName} ${a.lastName}`" size="md" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-fg">{{ a.firstName }} {{ a.lastName }}</p>
                    <p class="truncate text-xs text-fg-muted">{{ a.email }}</p>
                  </div>
                  <p class="hidden text-xs text-fg-muted sm:block" :title="formatDateTime(a.lastLoginAt)">
                    <Clock :size="12" class="me-1 inline align-[-2px]" aria-hidden="true" />{{ a.lastLoginAt ? `Signed in ${timeAgo(a.lastLoginAt)}` : 'Never signed in' }}
                  </p>
                  <AppBadge :tone="membershipTone[a.status]" dot>{{ statusLabel(a.status) }}</AppBadge>
                  <AppButton v-if="a.status === 'INVITED' && canManage" size="sm" variant="secondary" :icon="Mail" :loading="busy === `resend:${a.membershipId}`" @click="resend(a.membershipId)">Resend</AppButton>
                </li>
              </ul>
              <p v-else class="px-4 py-8 text-center text-sm text-fg-muted">No administrators. The organization can’t be managed until one is invited.</p>
            </AppCard>

            <AppCard title="Enabled modules" :icon="LayoutGrid" :description="`${enabledModules.length} of ${org.data.value.modules.length} modules available to this organization`">
              <template #actions><AppButton variant="link" size="sm" @click="tab = 'entitlements'">Manage</AppButton></template>
              <ul class="flex flex-wrap gap-1.5">
                <li v-for="m in org.data.value.modules" :key="m.key" :class="['inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', m.entitled ? 'bg-accent-soft text-accent-fg ring-brand-600/15' : 'bg-surface-muted/60 text-fg-subtle ring-line line-through decoration-fg-subtle/40']">
                  <component :is="MODULE_ICONS[m.key]" :size="12" aria-hidden="true" />{{ m.name }}<span v-if="!m.entitled" class="sr-only"> (not enabled)</span>
                </li>
              </ul>
            </AppCard>

            <AppCard title="Company details" :icon="Building2">
              <template #actions><AppButton variant="link" size="sm" @click="tab = 'profile'">{{ canManage ? 'Edit' : 'View profile' }}</AppButton></template>
              <dl class="grid gap-px overflow-hidden rounded-lg bg-line/60 ring-1 ring-line/60 sm:grid-cols-2 2xl:grid-cols-3">
                <div v-for="f in facts" :key="f.label" class="min-w-0 bg-surface px-3.5 py-2.5">
                  <dt class="text-2xs font-medium text-fg-muted">{{ f.label }}</dt>
                  <dd class="mt-0.5 truncate text-sm text-fg" :title="f.value == null ? undefined : String(f.value)">{{ f.value == null || f.value === '' ? '—' : f.value }}</dd>
                </div>
              </dl>
            </AppCard>
          </div>

          <aside class="space-y-4">
            <AppCard title="Subscription">
              <div class="flex items-center gap-3">
                <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', planVisual(org.data.value.plan.code).tile]" aria-hidden="true">
                  <component :is="planVisual(org.data.value.plan.code).icon" :size="18" />
                </span>
                <div class="min-w-0">
                  <p class="font-semibold text-fg">{{ org.data.value.plan.name }}</p>
                  <p class="text-xs text-fg-muted tabular-nums">
                    {{ currentPlan ? `${formatMoney(currentPlan.monthlyPrice, currentPlan.currency)}${currentPlan.monthlyPrice !== null ? ' / month' : ' pricing'}` : '—' }}
                  </p>
                </div>
              </div>
              <div class="mt-4">
                <div class="flex items-baseline justify-between text-xs">
                  <span class="text-fg-muted">Seats</span>
                  <span class="font-medium text-fg tabular-nums">{{ num(activeUsers) }} / {{ seats.max ? num(seats.max) : 'Unlimited' }}</span>
                </div>
                <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="Seats used" :aria-valuenow="activeUsers" :aria-valuemax="seats.max ?? undefined">
                  <div :class="['h-full rounded-full', (seats.share ?? 0) >= 90 ? 'bg-danger' : (seats.share ?? 0) >= 75 ? 'bg-warning' : 'bg-brand-500']" :style="{ width: seats.share === null ? '100%' : `${seats.share}%` }" />
                </div>
              </div>
              <div class="mt-4 border-t border-line/70 pt-4">
                <AppSelect v-model="planId" label="Change plan" :options="planOptions" :disabled="!canManage" />
                <p v-if="chosenPlan && planId !== org.data.value.plan.id" class="mt-2 text-xs text-fg-muted">
                  {{ chosenPlan.name }}: {{ chosenPlan.maxUsers ? `${num(chosenPlan.maxUsers)} users` : 'unlimited users' }} · {{ chosenPlan.featureKeys.length }} modules
                  <span v-if="chosenPlan.maxUsers && activeUsers > chosenPlan.maxUsers" class="font-medium text-warning-fg"> · fewer seats than active users</span>
                </p>
                <div v-if="canManage" class="mt-3 flex justify-end">
                  <AppButton size="sm" :loading="busy === 'plan'" :disabled="planId === org.data.value.plan.id" @click="savePlan">Change plan</AppButton>
                </div>
              </div>
            </AppCard>

            <section v-if="canManage && org.data.value.status !== 'DEACTIVATED'" class="card overflow-hidden ring-1 ring-danger/25" aria-labelledby="org-danger-title">
              <header class="flex items-center gap-3 border-b border-danger/15 bg-danger-soft/40 px-4 py-3">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-danger-soft text-danger-fg" aria-hidden="true"><TriangleAlert :size="16" /></span>
                <div>
                  <h2 id="org-danger-title" class="text-sm font-semibold text-fg">Danger zone</h2>
                  <p class="text-xs text-fg-muted">All users are signed out immediately.</p>
                </div>
              </header>
              <ul class="divide-y divide-line/70">
                <li v-if="org.data.value.status === 'ACTIVE'" class="space-y-2.5 px-4 py-4">
                  <div>
                    <p class="text-sm font-medium text-fg">Suspend organization</p>
                    <p class="text-xs text-fg-muted">Temporarily blocks access, for example for non-payment. Can be reactivated.</p>
                  </div>
                  <AppButton variant="danger" size="sm" :icon="Ban" @click="statusModal = 'suspend'">Suspend</AppButton>
                </li>
                <li class="space-y-2.5 px-4 py-4">
                  <div>
                    <p class="text-sm font-medium text-fg">Deactivate organization</p>
                    <p class="text-xs text-fg-muted">Closes the tenant, for example when the customer leaves. It can be activated again later.</p>
                  </div>
                  <AppButton variant="secondary" size="sm" :icon="CircleSlash" @click="statusModal = 'deactivate'">Deactivate</AppButton>
                </li>
              </ul>
            </section>
          </aside>
        </div>

        <!-- Profile (not an AppCard: the save bar must be able to stick, so nothing here clips overflow) -->
        <section v-else-if="tab === 'profile'" class="card">
          <form v-if="profile" id="platform-org-profile" class="p-5" novalidate @submit.prevent="saveProfile">
            <AppAlert v-if="profileErrors.formError.value" class="mb-4">{{ profileErrors.formError.value }}</AppAlert>
            <OrganizationProfileForm v-model="profile" :errors="profileErrors.fieldErrors.value" :disabled="!canManage" />
          </form>
          <div v-if="profileDirty" class="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-b-md border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
            <span class="me-auto inline-flex items-center gap-2 text-sm text-fg-muted"><span class="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />You have unsaved changes</span>
            <AppButton variant="ghost" :disabled="busy === 'profile'" @click="discardProfile">Discard</AppButton>
            <AppButton type="submit" form="platform-org-profile" :icon="Save" :loading="busy === 'profile'">Save changes</AppButton>
          </div>
        </section>

        <!-- Entitlements -->
        <section v-else class="card">
          <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><SlidersHorizontal :size="16" /></span>
            <div class="min-w-0 flex-1">
              <h2 class="text-sm font-semibold text-fg">Module entitlements</h2>
              <p class="text-xs text-fg-muted">Overrides apply on top of the {{ org.data.value.plan.name }} plan for this organization only.</p>
            </div>
            <p class="text-xs text-fg-muted tabular-nums">{{ activeOverrides }} {{ activeOverrides === 1 ? 'override' : 'overrides' }} in effect</p>
          </header>
          <p class="flex flex-wrap items-center gap-1.5 border-b border-line/70 bg-surface-muted/40 px-4 py-2.5 text-xs text-fg-muted">
            Always included:
            <span v-for="m in coreModules" :key="m.key" class="inline-flex items-center gap-1 font-medium text-fg"><component :is="MODULE_ICONS[m.key]" :size="12" aria-hidden="true" />{{ m.name }}</span>
          </p>
          <ul class="divide-y divide-line/70">
            <li
              v-for="m in businessModules"
              :key="m.key"
              :class="['flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 transition-colors', overrides[m.key] !== savedOverrides[m.key] && 'bg-warning-soft/30']"
            >
              <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', effective(m.key) ? 'bg-accent-soft text-accent-fg ring-brand-600/15' : 'bg-surface-muted text-fg-subtle ring-line']" aria-hidden="true">
                <component :is="MODULE_ICONS[m.key]" :size="16" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-fg">{{ m.name }}</p>
                <p class="text-xs text-fg-muted">{{ planFeatures.has(m.key) ? 'Included in plan' : 'Not in plan' }}</p>
              </div>
              <AppSegmented
                v-if="canManage"
                :model-value="overrides[m.key] ?? 'plan'"
                :options="overrideOptions"
                size="sm"
                :label="`Override for ${m.name}`"
                class="max-sm:order-last"
                @update:model-value="(v) => (overrides = { ...overrides, [m.key]: v })"
              />
              <span v-else class="text-xs text-fg-muted">{{ overrideOptions.find((o) => o.value === overrides[m.key])?.label }}</span>
              <AppBadge class="w-20 justify-center" :tone="effective(m.key) ? 'success' : 'neutral'" dot>{{ effective(m.key) ? 'Enabled' : 'Disabled' }}</AppBadge>
            </li>
          </ul>
          <div v-if="canManage && overrideChanges" class="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-b-md border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
            <span class="me-auto inline-flex items-center gap-2 text-sm text-fg-muted"><span class="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />{{ overrideChanges }} unsaved {{ overrideChanges === 1 ? 'change' : 'changes' }}</span>
            <AppButton variant="ghost" :disabled="busy === 'features'" @click="overrides = { ...savedOverrides }">Discard</AppButton>
            <AppButton :icon="Save" :loading="busy === 'features'" @click="saveEntitlements">Save entitlements</AppButton>
          </div>
        </section>
      </AppTabs>

      <AppModal :open="!!statusModal" :title="statusModal === 'suspend' ? 'Suspend organization' : 'Deactivate organization'" description="All users of this organization are signed out immediately." size="sm" @close="statusModal = null">
        <AppTextarea v-model="reason" label="Reason" required :maxlength="500" help="Visible to platform administrators and recorded in the audit log." />
        <template #footer>
          <AppButton variant="secondary" @click="statusModal = null">Cancel</AppButton>
          <AppButton variant="danger" :loading="busy === statusModal" :disabled="reason.trim().length < 3" @click="changeStatus(statusModal!)">
            {{ statusModal === 'suspend' ? 'Suspend' : 'Deactivate' }}
          </AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
