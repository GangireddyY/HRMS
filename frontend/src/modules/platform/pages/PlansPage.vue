<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Building2, Check, CreditCard, Minus, Pencil, Plus, Users } from '@lucide/vue';
import { MODULES, type ModuleKey } from '@contracts';
import { platformApi } from '@/modules/platform/api/platform.api';
import type { Plan } from '@/modules/platform/types';
import { planVisual } from '@/modules/platform/utils/platform-visuals';
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppCheckbox,
  AppEmptyState,
  AppErrorState,
  AppInput,
  AppModal,
  AppPageHeader,
  AppSelect,
  AppStatStrip,
  AppSwitch,
  AppTextarea,
  type StripItem,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { appLocale } from '@/core/locale/locale';
import { formatMoney } from '@/shared/utils/format';
import { MODULE_ICONS } from '@/shared/utils/module-icons';
import { CURRENCY_OPTIONS } from '@/shared/utils/options';

/** Subscription plans as pricing cards, a module comparison across plans, and the plan editor. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const plans = useAsync(() => platformApi.plans());
const canManage = computed(() => auth.canPlatform('platform.plans.manage'));
const businessModules = MODULES.filter((m) => !m.core);
const coreModules = MODULES.filter((m) => m.core);
const num = (n: number) => n.toLocaleString(appLocale());

const sorted = computed(() => [...(plans.data.value ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
const mostPopular = computed(() => {
  const top = [...sorted.value].sort((a, b) => b.organizationCount - a.organizationCount)[0];
  return top && top.organizationCount > 0 && sorted.value.filter((p) => p.organizationCount === top.organizationCount).length === 1 ? top.id : null;
});

/** List-price monthly revenue; only shown when every priced plan uses the same currency. */
const listRevenue = computed(() => {
  const priced = sorted.value.filter((p) => p.monthlyPrice !== null && p.organizationCount > 0);
  const currencies = new Set(priced.map((p) => p.currency));
  if (currencies.size !== 1) return null;
  return { amount: priced.reduce((n, p) => n + (p.monthlyPrice ?? 0) * p.organizationCount, 0), currency: [...currencies][0]! };
});
const strip = computed<StripItem[]>(() => {
  const list = sorted.value;
  const orgs = list.reduce((n, p) => n + p.organizationCount, 0);
  const custom = list.filter((p) => p.monthlyPrice === null).reduce((n, p) => n + p.organizationCount, 0);
  return [
    { key: 'plans', label: 'Plans', value: list.length, tone: 'brand', hint: `${list.filter((p) => p.isActive).length} available for new organizations` },
    { key: 'orgs', label: 'Subscribed organizations', value: num(orgs), tone: 'success', hint: `${custom} on custom pricing` },
    { key: 'mrr', label: 'List-price monthly revenue', value: listRevenue.value ? formatMoney(listRevenue.value.amount, listRevenue.value.currency) : '—', tone: 'violet', hint: 'Excludes custom pricing' },
    { key: 'modules', label: 'Business modules', value: businessModules.length, tone: 'info', hint: `Plus ${coreModules.length} core, always included` },
  ];
});

const editing = ref<Plan | null>(null);
const open = ref(false);
const saving = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({
  code: '',
  name: '',
  description: '',
  maxUsers: null as number | null,
  monthlyPrice: null as number | null,
  currency: 'INR',
  sortOrder: 0,
  isActive: true,
  features: {} as Record<string, boolean>,
});
const selectedModules = computed(() => Object.values(form.features).filter(Boolean).length);

function openEditor(plan: Plan | null) {
  reset();
  editing.value = plan;
  Object.assign(form, {
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    maxUsers: plan?.maxUsers ?? null,
    monthlyPrice: plan?.monthlyPrice ?? null,
    currency: plan?.currency ?? 'INR',
    sortOrder: plan?.sortOrder ?? (plans.data.value?.length ?? 0) + 1,
    isActive: plan?.isActive ?? true,
    features: Object.fromEntries(businessModules.map((m) => [m.key, plan?.featureKeys.includes(m.key) ?? false])),
  });
  open.value = true;
}

function selectAllModules(on: boolean) {
  form.features = Object.fromEntries(businessModules.map((m) => [m.key, on]));
}

async function save() {
  reset();
  saving.value = true;
  const body = {
    name: form.name.trim(),
    description: form.description.trim(),
    maxUsers: form.maxUsers || null,
    monthlyPrice: form.monthlyPrice ?? null,
    currency: form.currency,
    sortOrder: form.sortOrder,
    isActive: form.isActive,
    featureKeys: Object.entries(form.features).filter(([, on]) => on).map(([k]) => k),
  };
  try {
    if (editing.value) await platformApi.updatePlan(editing.value.id, body);
    else await platformApi.createPlan({ ...body, code: form.code.trim() });
    open.value = false;
    feedback.success(editing.value ? 'Plan updated' : 'Plan created');
    await plans.run();
  } catch (e) {
    handle(e, 'Could not save plan');
  } finally {
    saving.value = false;
  }
}

const includes = (p: Plan, key: ModuleKey) => p.featureKeys.includes(key);
</script>

<template>
  <div>
    <AppPageHeader title="Plans & entitlements" description="Subscription plans define user limits and which modules organizations can use.">
      <template #actions><AppButton v-if="canManage" :icon="Plus" @click="openEditor(null)">New plan</AppButton></template>
    </AppPageHeader>

    <AppErrorState v-if="plans.error.value" :error="plans.error.value" @retry="plans.run" />
    <div v-else class="space-y-4">
      <AppStatStrip :items="strip" :loading="plans.loading.value && !plans.data.value" label="Plans summary" />

      <!-- Loading -->
      <ul v-if="plans.loading.value && !plans.data.value" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading plans">
        <li v-for="i in 3" :key="i" class="card space-y-4 p-5">
          <div class="flex items-center gap-3"><div class="skeleton h-11 w-11 rounded-lg" /><div class="skeleton h-4 w-1/3 rounded-full" /></div>
          <div class="skeleton h-3 w-full rounded-full" />
          <div class="skeleton h-8 w-1/2 rounded-md" />
          <div class="grid grid-cols-2 gap-2"><div class="skeleton h-14 rounded-md" /><div class="skeleton h-14 rounded-md" /></div>
        </li>
      </ul>

      <AppEmptyState v-else-if="!sorted.length" :icon="CreditCard" title="No plans yet" description="Create a plan to start provisioning organizations.">
        <AppButton v-if="canManage" :icon="Plus" @click="openEditor(null)">New plan</AppButton>
      </AppEmptyState>

      <template v-else>
        <!-- Plan cards -->
        <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4">
          <li v-for="p in sorted" :key="p.id" :class="['card relative flex flex-col overflow-hidden', !p.isActive && 'opacity-80']">
            <div :class="['h-1 bg-gradient-to-r', planVisual(p.code).strip]" aria-hidden="true" />
            <div class="flex flex-1 flex-col p-5">
              <div class="flex items-start gap-3">
                <span :class="['flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', planVisual(p.code).tile]" aria-hidden="true">
                  <component :is="planVisual(p.code).icon" :size="20" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="flex flex-wrap items-center gap-2 text-base font-semibold text-fg">
                    {{ p.name }}
                    <AppBadge v-if="!p.isActive" size="sm">Inactive</AppBadge>
                    <AppBadge v-else-if="mostPopular === p.id" size="sm" tone="brand">Most organizations</AppBadge>
                  </p>
                  <p class="font-mono text-xs text-fg-subtle">{{ p.code }}</p>
                </div>
                <AppButton v-if="canManage" variant="ghost" size="sm" :icon="Pencil" :aria-label="`Edit ${p.name}`" @click="openEditor(p)" />
              </div>
              <p class="mt-3 line-clamp-2 min-h-10 text-sm text-fg-muted">{{ p.description || 'No description.' }}</p>
              <p class="mt-4 text-3xl font-semibold tracking-tight text-fg tabular-nums">
                {{ formatMoney(p.monthlyPrice, p.currency) }}<span v-if="p.monthlyPrice !== null" class="text-sm font-normal text-fg-muted"> / month</span>
                <span v-else class="ms-1 text-sm font-normal text-fg-muted">pricing</span>
              </p>
              <dl class="mt-4 grid grid-cols-2 gap-2">
                <div class="rounded-md bg-surface-muted/70 px-3 py-2">
                  <dt class="flex items-center gap-1 text-2xs font-medium text-fg-muted"><Users :size="12" aria-hidden="true" />User limit</dt>
                  <dd class="mt-0.5 text-lg font-semibold text-fg tabular-nums">{{ p.maxUsers ? num(p.maxUsers) : 'Unlimited' }}</dd>
                </div>
                <div class="rounded-md bg-surface-muted/70 px-3 py-2">
                  <dt class="flex items-center gap-1 text-2xs font-medium text-fg-muted"><Building2 :size="12" aria-hidden="true" />Organizations</dt>
                  <dd class="mt-0.5 text-lg font-semibold text-fg tabular-nums">{{ num(p.organizationCount) }}</dd>
                </div>
              </dl>
              <div class="mt-4 border-t border-line/70 pt-4">
                <div class="flex items-baseline justify-between text-xs">
                  <span class="font-medium text-fg">Modules</span>
                  <span class="text-fg-muted tabular-nums">{{ p.featureKeys.length }} of {{ businessModules.length }}</span>
                </div>
                <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                  <div :class="['h-full rounded-full', planVisual(p.code).bar]" :style="{ width: `${(p.featureKeys.length / businessModules.length) * 100}%` }" />
                </div>
                <ul class="mt-3 flex flex-wrap gap-1.5" :aria-label="`Modules in ${p.name}`">
                  <li v-for="m in businessModules.filter((x) => includes(p, x.key))" :key="m.key" class="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted ring-1 ring-line ring-inset">
                    <component :is="MODULE_ICONS[m.key]" :size="11" aria-hidden="true" />{{ m.name }}
                  </li>
                </ul>
              </div>
            </div>
          </li>
        </ul>

        <!-- Comparison -->
        <section class="card overflow-hidden" aria-labelledby="compare-title">
          <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><CreditCard :size="16" /></span>
            <div class="min-w-0">
              <h2 id="compare-title" class="text-sm font-semibold text-fg">Compare plans</h2>
              <p class="text-xs text-fg-muted">Which modules each plan includes. Per-organization overrides are set on the organization’s page.</p>
            </div>
          </header>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[40rem] text-sm">
              <caption class="sr-only">Modules included in each plan</caption>
              <thead>
                <tr class="border-b border-line/70 bg-surface-muted">
                  <th scope="col" class="sticky start-0 z-10 bg-surface-muted px-4 py-2.5 text-start text-xs font-medium text-fg-muted">Module</th>
                  <th v-for="p in sorted" :key="p.id" scope="col" class="px-4 py-2.5 text-center">
                    <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-fg">
                      <component :is="planVisual(p.code).icon" :size="13" class="text-fg-subtle" aria-hidden="true" />{{ p.name }}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" class="sticky start-0 z-10 bg-surface px-4 py-2.5 text-start font-medium text-fg">Monthly price</th>
                  <td v-for="p in sorted" :key="p.id" class="px-4 py-2.5 text-center text-fg tabular-nums">{{ formatMoney(p.monthlyPrice, p.currency) }}</td>
                </tr>
                <tr class="border-t border-line/60">
                  <th scope="row" class="sticky start-0 z-10 bg-surface px-4 py-2.5 text-start font-medium text-fg">User limit</th>
                  <td v-for="p in sorted" :key="p.id" class="px-4 py-2.5 text-center text-fg tabular-nums">{{ p.maxUsers ? num(p.maxUsers) : 'Unlimited' }}</td>
                </tr>
                <tr v-for="m in businessModules" :key="m.key" class="border-t border-line/60 hover:bg-surface-muted/40">
                  <th scope="row" class="sticky start-0 z-10 bg-surface px-4 py-2 text-start font-normal">
                    <span class="flex items-center gap-2.5 text-fg">
                      <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><component :is="MODULE_ICONS[m.key]" :size="13" /></span>
                      {{ m.name }}
                    </span>
                  </th>
                  <td v-for="p in sorted" :key="p.id" class="px-4 py-2 text-center">
                    <span v-if="includes(p, m.key)" class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success-soft text-success-fg"><Check :size="12" :stroke-width="3" aria-hidden="true" /><span class="sr-only">Included</span></span>
                    <span v-else class="inline-flex h-5 w-5 items-center justify-center text-fg-subtle/60"><Minus :size="14" aria-hidden="true" /><span class="sr-only">Not included</span></span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </div>

    <AppModal :open="open" :title="editing ? `Edit ${editing.name}` : 'New plan'" size="lg" @close="open = false">
      <form id="plan-form" class="space-y-5" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.name" label="Name" required :error="fieldErrors.name" />
          <AppInput v-model="form.code" label="Code" required :disabled="!!editing" help="Lowercase identifier, cannot be changed" :error="fieldErrors.code" />
          <AppTextarea v-model="form.description" label="Description" class="sm:col-span-2" :rows="2" :error="fieldErrors.description" />
          <AppInput v-model="form.maxUsers" type="number" label="User limit" help="Leave empty for unlimited" :min="1" :error="fieldErrors.maxUsers" />
          <div class="grid grid-cols-[1fr_100px] gap-2">
            <AppInput v-model="form.monthlyPrice" type="number" label="Monthly price" help="Empty = custom pricing" :min="0" :error="fieldErrors.monthlyPrice" />
            <AppSelect v-model="form.currency" label="Currency" :options="CURRENCY_OPTIONS" />
          </div>
          <AppInput v-model="form.sortOrder" type="number" label="Display order" :min="0" :error="fieldErrors.sortOrder" />
          <div class="flex items-end pb-2"><AppSwitch v-model="form.isActive" label="Available for new organizations" /></div>
        </div>
        <fieldset>
          <legend class="label flex w-full items-center justify-between gap-3">
            <span>Included modules <span class="font-normal text-fg-muted tabular-nums">· {{ selectedModules }} of {{ businessModules.length }}</span></span>
            <span class="flex gap-1">
              <AppButton size="xs" variant="ghost" :disabled="selectedModules === businessModules.length" @click="selectAllModules(true)">Select all</AppButton>
              <AppButton size="xs" variant="ghost" :disabled="!selectedModules" @click="selectAllModules(false)">Clear</AppButton>
            </span>
          </legend>
          <p class="help-text mb-3">Core platform features (organization, users, roles, audit) are always included.</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <AppCheckbox v-for="m in businessModules" :key="m.key" v-model="form.features[m.key]" :label="m.name" :description="m.description" />
          </div>
        </fieldset>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton type="submit" form="plan-form" :loading="saving" :disabled="!form.name.trim() || (!editing && !form.code.trim())">Save plan</AppButton>
      </template>
    </AppModal>
  </div>
</template>
