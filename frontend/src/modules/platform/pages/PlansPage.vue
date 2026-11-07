<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Pencil, Plus } from '@lucide/vue';
import { MODULES } from '@contracts';
import { platformApi } from '@/modules/platform/api/platform.api';
import type { Plan } from '@/modules/platform/types';
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppCard,
  AppCheckbox,
  AppErrorState,
  AppInput,
  AppModal,
  AppPageHeader,
  AppSelect,
  AppSkeleton,
  AppSwitch,
  AppTextarea,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatMoney } from '@/shared/utils/format';
import { CURRENCY_OPTIONS } from '@/shared/utils/options';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const plans = useAsync(() => platformApi.plans());
const canManage = computed(() => auth.canPlatform('platform.plans.manage'));
const businessModules = MODULES.filter((m) => !m.core);
const moduleName = (key: string) => MODULES.find((m) => m.key === key)?.name ?? key;

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
</script>

<template>
  <div>
    <AppPageHeader title="Plans & entitlements" description="Subscription plans define user limits and which modules organizations can use.">
      <template #actions><AppButton v-if="canManage" :icon="Plus" @click="openEditor(null)">New plan</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="plans.loading.value && !plans.data.value" :lines="6" />
    <AppErrorState v-else-if="plans.error.value" :error="plans.error.value" @retry="plans.run" />
    <div v-else class="grid gap-5 md:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4">
      <AppCard v-for="p in plans.data.value" :key="p.id">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="flex items-center gap-2 text-lg font-semibold">{{ p.name }} <AppBadge v-if="!p.isActive">Inactive</AppBadge></p>
            <p class="font-mono text-xs text-fg-subtle">{{ p.code }}</p>
          </div>
          <AppButton v-if="canManage" variant="ghost" size="sm" :icon="Pencil" :aria-label="`Edit ${p.name}`" @click="openEditor(p)" />
        </div>
        <p class="mt-2 min-h-10 text-sm text-fg-muted">{{ p.description }}</p>
        <p class="mt-3 text-2xl font-semibold">{{ formatMoney(p.monthlyPrice, p.currency) }}<span v-if="p.monthlyPrice !== null" class="text-sm font-normal text-fg-muted"> / month</span></p>
        <dl class="mt-3 flex gap-4 text-sm">
          <div><dt class="text-xs text-fg-muted">User limit</dt><dd class="font-medium">{{ p.maxUsers ?? 'Unlimited' }}</dd></div>
          <div><dt class="text-xs text-fg-muted">Organizations</dt><dd class="font-medium">{{ p.organizationCount }}</dd></div>
        </dl>
        <div class="mt-4 flex flex-wrap gap-1.5">
          <AppBadge v-for="k in p.featureKeys" :key="k" tone="brand">{{ moduleName(k) }}</AppBadge>
        </div>
      </AppCard>
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
          <legend class="label">Included modules</legend>
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
