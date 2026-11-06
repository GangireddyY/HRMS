<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Pencil, Plus, Sparkles, Trash2 } from '@lucide/vue';
import { RECOMMENDED_LEAVE_TYPES } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import LeaveTypeFormModal from '@/modules/leave/components/LeaveTypeFormModal.vue';
import type { LeaveType } from '@/modules/leave/types';
import { ACCRUAL_SHORT, MONTH_NAMES, formatDays } from '@/modules/leave/utils/leave-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppDataTable, AppEmptyState, AppPageHeader, AppSelect, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const feedback = useFeedbackStore();
const types = useAsync(() => leaveApi.types());
const settings = useAsync(() => leaveApi.settings());

const missingRecommended = computed(() => {
  const codes = new Set((types.data.value ?? []).map((t) => t.code));
  return RECOMMENDED_LEAVE_TYPES.filter((t) => !codes.has(t.code));
});
const adding = ref(false);
async function addRecommended() {
  adding.value = true;
  try {
    const r = await leaveApi.addRecommended();
    types.data.value = r.types;
    feedback.success(`${r.added} leave type${r.added === 1 ? '' : 's'} added`, 'Review the quotas and rules to match your policy.');
  } catch (e) {
    feedback.error('Could not add the leave types', e);
  } finally {
    adding.value = false;
  }
}

const modalOpen = ref(false);
const editing = ref<LeaveType | null>(null);
function open(t: LeaveType | null = null) {
  editing.value = t;
  modalOpen.value = true;
}
async function onSaved() {
  modalOpen.value = false;
  feedback.success(editing.value ? 'Leave type updated' : 'Leave type created');
  await types.run();
}
async function remove(t: LeaveType) {
  if (!(await feedback.confirm({ title: `Delete ${t.name}?`, message: 'Only types that were never used can be deleted. Mark used types inactive instead.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await leaveApi.removeType(t.id);
    feedback.success('Leave type deleted');
    await types.run();
  } catch (e) {
    feedback.error('Could not delete the leave type', e);
  }
}

const startMonth = ref<number | null>(null);
watch(settings.data, (s) => (startMonth.value = s?.leaveYearStartMonth ?? null), { immediate: true });
const monthOptions = MONTH_NAMES.map((m, i) => ({ value: i + 1, label: `${m} – ${MONTH_NAMES[(i + 11) % 12]}` }));
const savingYear = ref(false);
async function saveYear() {
  savingYear.value = true;
  try {
    settings.data.value = await leaveApi.updateSettings(startMonth.value!);
    feedback.success('Leave year updated');
  } catch (e) {
    startMonth.value = settings.data.value?.leaveYearStartMonth ?? null;
    feedback.error('Could not change the leave year', e);
  } finally {
    savingYear.value = false;
  }
}

const columns: TableColumn<LeaveType>[] = [
  { key: 'name', label: 'Leave type' },
  { key: 'quota', label: 'Credit' },
  { key: 'carry', label: 'Carry forward' },
  { key: 'rules', label: 'Rules' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
const rules = (t: LeaveType) =>
  [
    t.minNoticeDays && `${t.minNoticeDays}d notice`,
    t.maxBackdatedDays ? `back-dated ${t.maxBackdatedDays}d` : null,
    t.maxConsecutiveDays && `max ${t.maxConsecutiveDays}d`,
    t.allowHalfDay ? 'half days' : null,
    t.countNonWorkingDays && 'counts weekends',
    t.applicableGender && (t.applicableGender === 'FEMALE' ? 'women' : 'men'),
  ].filter(Boolean).join(' · ');
</script>

<template>
  <div>
    <AppPageHeader title="Leave types" description="What employees can apply for, how days are credited and the rules for applying.">
      <template #actions>
        <AppButton v-if="missingRecommended.length && types.data.value?.length" variant="secondary" :icon="Sparkles" :loading="adding" @click="addRecommended">Add recommended</AppButton>
        <AppButton :icon="Plus" @click="open()">New leave type</AppButton>
      </template>
    </AppPageHeader>

    <AppCard class="mb-6" title="Leave year" description="Balances are credited and carried forward per leave year. It can't change once balances exist.">
      <div class="flex flex-wrap items-end gap-3">
        <AppSelect v-model="startMonth" class="w-72" label="Leave year runs" :options="monthOptions" :clearable="false" />
        <AppButton variant="secondary" :loading="savingYear" :disabled="!settings.data.value || startMonth === settings.data.value.leaveYearStartMonth" @click="saveYear">Save</AppButton>
      </div>
    </AppCard>

    <AppCard v-if="types.data.value && !types.data.value.length">
      <AppEmptyState title="No leave types yet" description="Start with the recommended set (casual, sick, earned and leave without pay) and adjust it, or create your own.">
        <div class="flex flex-wrap justify-center gap-2">
          <AppButton :icon="Sparkles" :loading="adding" @click="addRecommended">Add recommended types</AppButton>
          <AppButton variant="secondary" :icon="Plus" @click="open()">Create a leave type</AppButton>
        </div>
      </AppEmptyState>
    </AppCard>
    <AppCard v-else :padded="false">
      <AppAlert v-if="types.data.value?.some((t) => !t.isPaid && !t.unlimited)" tone="info" class="m-4 mb-0">Unpaid leave types are reported to payroll as loss of pay.</AppAlert>
      <AppDataTable :columns="columns" :rows="types.data.value ?? []" :loading="types.loading.value" :error="types.error.value" caption="Leave types" empty-title="No leave types" @retry="types.run">
        <template #cell-name="{ row }">
          <span class="flex items-center gap-2.5">
            <span class="h-3 w-3 shrink-0 rounded-full" :style="{ backgroundColor: row.color }" aria-hidden="true" />
            <span class="min-w-0">
              <span class="block font-medium text-fg">{{ row.name }} <span class="font-mono text-xs text-fg-subtle">{{ row.code }}</span></span>
              <span class="block text-xs text-fg-muted">{{ row.isPaid ? 'Paid' : 'Unpaid' }}{{ row.encashable ? ' · encashable' : '' }}</span>
            </span>
          </span>
        </template>
        <template #cell-quota="{ row }">
          <span v-if="row.unlimited" class="text-fg-muted">No limit</span>
          <span v-else-if="row.accrualFrequency === 'NONE'" class="text-fg-muted">Granted by HR</span>
          <span v-else>{{ formatDays(row.annualQuota) }} / year <span class="text-xs text-fg-subtle">· {{ ACCRUAL_SHORT[row.accrualFrequency] }}</span></span>
        </template>
        <template #cell-carry="{ row }"><span class="text-fg-muted">{{ row.unlimited ? '—' : row.carryForwardLimit ? `Up to ${formatDays(row.carryForwardLimit)}` : 'Lapses' }}</span></template>
        <template #cell-rules="{ row }"><span class="text-xs text-fg-muted">{{ rules(row) || '—' }}</span></template>
        <template #cell-status="{ row }"><AppBadge :tone="row.isActive ? 'success' : 'neutral'" dot>{{ row.isActive ? 'Active' : 'Inactive' }}</AppBadge></template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1">
            <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.name}`" @click="open(row)" />
            <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.name}`" @click="remove(row)" />
          </div>
        </template>
      </AppDataTable>
    </AppCard>

    <LeaveTypeFormModal :open="modalOpen" :type="editing" @close="modalOpen = false" @saved="onSaved" />
  </div>
</template>
