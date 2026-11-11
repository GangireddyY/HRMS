<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Landmark, SlidersHorizontal, Sparkles } from '@lucide/vue';
import type { CompensationPoolView } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppButton, AppCard, AppInput, AppModal } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Increase pools per department for the cycle: what's planned and committed against each, and setting them (HR). */
const props = defineProps<{ cycleId: string; canConfigure: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const feedback = useFeedbackStore();
const { formError, handle, reset } = useFormErrors();
const data = useAsync(() => performanceApi.budgetPools(props.cycleId));
defineExpose({ refresh: () => data.run() });

const pools = computed(() => data.data.value?.pools ?? []);
const width = (p: CompensationPoolView, part: number) => {
  const scale = Math.max(p.amount ?? 0, p.committed + p.planned, 1);
  return `${Math.min(100, (part / scale) * 100)}%`;
};

const open = ref(false);
const form = reactive<{ rows: { departmentId: string | null; department: string; suggested: number | null; amount: string | number }[] }>({ rows: [] });
function edit() {
  reset();
  form.rows = pools.value.map((p) => ({ departmentId: p.departmentId, department: p.department, suggested: p.suggested, amount: p.amount ?? '' }));
  open.value = true;
}
function useSuggested() {
  for (const r of form.rows) if (r.suggested !== null) r.amount = r.suggested;
}
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  try {
    data.data.value = await performanceApi.setBudgetPools(
      props.cycleId,
      form.rows.filter((r) => r.amount !== '' && r.amount !== null).map((r) => ({ departmentId: r.departmentId, amount: Number(r.amount) })),
    );
    open.value = false;
    feedback.success('Increase pools saved');
    emit('changed');
  } catch (e) {
    handle(e, 'Could not save the pools');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppCard title="Department pools" :icon="Landmark" description="Each department's share of the increase budget; approvals that would overspend a pool need an explicit override." :padded="false">
    <template v-if="canConfigure" #actions><AppButton size="xs" variant="ghost" :icon="SlidersHorizontal" @click="edit">Set pools</AppButton></template>
    <p v-if="data.loading.value && !data.data.value" class="px-4 py-3 text-sm text-fg-muted">Loading…</p>
    <p v-else-if="!pools.length" class="px-4 py-3 text-sm text-fg-muted">No departments yet.</p>
    <ul v-else class="divide-y divide-line/70">
      <li v-for="p in pools" :key="p.departmentId ?? 'none'" class="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_8rem] sm:items-center">
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-fg">{{ p.department }}</p>
          <p class="text-2xs text-fg-muted">{{ p.headcount }} people · payroll {{ rupees(p.currentPayroll) }}</p>
        </div>
        <div>
          <div class="flex h-2 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`Committed ${rupees(p.committed)}, planned ${rupees(p.planned)}${p.amount !== null ? ` of ${rupees(p.amount)}` : ''}`">
            <span class="h-full bg-brand-500" :style="{ width: width(p, p.committed) }" />
            <span :class="['h-full', p.remaining !== null && p.remaining < 0 ? 'bg-danger/50' : 'bg-brand-500/35']" :style="{ width: width(p, p.planned) }" />
          </div>
          <p class="mt-1 text-2xs text-fg-muted">{{ rupees(p.committed) }} approved · {{ rupees(p.planned) }} recommended<template v-if="p.suggested !== null"> · suggested pool {{ rupees(p.suggested) }}</template></p>
        </div>
        <p class="text-end text-sm tabular-nums">
          <template v-if="p.amount === null"><span class="text-fg-subtle">No pool</span></template>
          <template v-else>
            <span :class="['block font-semibold', p.remaining! < 0 ? 'text-danger-fg' : 'text-fg']">{{ rupees(p.remaining!) }}</span>
            <span class="block text-2xs text-fg-subtle">left of {{ rupees(p.amount) }}</span>
          </template>
        </p>
      </li>
    </ul>

    <AppModal :open="open" title="Increase pools" description="Annual CTC increase each department may give in this cycle. Leave empty for no pool." size="md" @close="open = false">
      <form id="pools-form" class="space-y-3" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <div class="flex justify-end"><AppButton size="xs" variant="ghost" :icon="Sparkles" @click="useSuggested">Use suggested amounts</AppButton></div>
        <div v-for="r in form.rows" :key="r.departmentId ?? 'none'" class="grid grid-cols-[minmax(0,1fr)_11rem] items-end gap-3">
          <div class="min-w-0 pb-2">
            <p class="truncate text-sm text-fg">{{ r.department }}</p>
            <p class="text-2xs text-fg-subtle">{{ r.suggested !== null ? `Suggested ${rupees(r.suggested)}` : 'Set the cycle budget % for a suggestion' }}</p>
          </div>
          <AppInput v-model="r.amount" type="number" :min="0" :step="1000" :aria-label="`Pool for ${r.department}`" placeholder="No pool" />
        </div>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton form="pools-form" type="submit" :loading="saving">Save pools</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
