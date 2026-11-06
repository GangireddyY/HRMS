<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Play } from '@lucide/vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import type { PayrollRun } from '@/modules/payroll/types';
import { MONTH_NAMES, RUN_STATUS_LABELS, rupees, runTone } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSelect, AppTextarea, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canProcess = computed(() => auth.can('payroll.process'));
const table = useTable((q) => payrollApi.runs(q));

const now = new Date();
/** The current month and the eleven before it. */
const monthOptions = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
  return { value: `${d.getFullYear()}-${d.getMonth() + 1}`, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` };
});
const createOpen = ref(false);
const period = ref<string | null>(monthOptions[0]!.value);
const notes = ref('');
const creating = ref(false);
const { formError, handle, reset } = useFormErrors();
function openCreate() {
  reset();
  notes.value = '';
  createOpen.value = true;
}
async function create() {
  reset();
  creating.value = true;
  const [year, month] = period.value!.split('-').map(Number) as [number, number];
  try {
    const run = await payrollApi.createRun({ year, month, notes: notes.value || null });
    createOpen.value = false;
    feedback.success(`Payroll for ${run.period} started`, run.calculatedAt ? `${run.employeeCount} employees calculated.` : undefined);
    await router.push(`/hr/payroll/runs/${run.id}`);
  } catch (e) {
    handle(e, 'Could not start the payroll');
  } finally {
    creating.value = false;
  }
}

const columns: TableColumn<PayrollRun>[] = [
  { key: 'period', label: 'Month' },
  { key: 'status', label: 'Status' },
  { key: 'employees', label: 'Employees', align: 'right' },
  { key: 'gross', label: 'Gross', align: 'right' },
  { key: 'net', label: 'Net pay', align: 'right' },
  { key: 'updated', label: 'Last step' },
];
const lastStep = (r: PayrollRun) =>
  r.paidAt ? `Paid by ${r.paidBy ?? '—'} ${timeAgo(r.paidAt)}` : r.reviewedAt && r.status === 'APPROVED' ? `Approved by ${r.reviewedBy ?? '—'} ${timeAgo(r.reviewedAt)}` : r.submittedAt && r.status === 'SUBMITTED' ? `Submitted by ${r.submittedBy ?? '—'} ${timeAgo(r.submittedAt)}` : r.calculatedAt ? `Calculated ${timeAgo(r.calculatedAt)}` : `Created ${timeAgo(r.createdAt)}`;
</script>

<template>
  <div>
    <AppPageHeader title="Payroll runs" description="Monthly payroll: calculate, review and hold or adjust payslips, then send for approval. Someone else approves; payslips are published on approval.">
      <template v-if="canProcess" #actions><AppButton :icon="Play" @click="openCreate">Run payroll</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Payroll runs" empty-title="No payroll runs yet" empty-description="Set everyone's salary, then run payroll for a month." @page="table.setPage" @retry="table.load" @row-click="(row) => router.push(`/hr/payroll/runs/${row.id}`)">
        <template #cell-period="{ row }"><span class="font-medium text-fg">{{ row.period }}</span></template>
        <template #cell-status="{ row }"><AppBadge :tone="runTone[row.status]" dot>{{ RUN_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-employees="{ row }"><span class="tabular-nums">{{ row.employeeCount }}</span></template>
        <template #cell-gross="{ row }"><span class="tabular-nums text-fg-muted">{{ rupees(row.totalGross) }}</span></template>
        <template #cell-net="{ row }"><span class="font-medium tabular-nums">{{ rupees(row.totalNet) }}</span></template>
        <template #cell-updated="{ row }"><span class="text-xs text-fg-muted">{{ lastStep(row) }}</span></template>
      </AppDataTable>
    </AppCard>

    <AppModal :open="createOpen" title="Run payroll" description="Everyone employed during the month with a salary is included. Loss of pay comes from unpaid leave (and attendance, if enabled)." size="sm" @close="createOpen = false">
      <div class="space-y-4">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppSelect v-model="period" label="Month" :options="monthOptions" :clearable="false" />
        <AppTextarea v-model="notes" label="Notes" :rows="2" :maxlength="500" placeholder="Optional" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="createOpen = false">Cancel</AppButton>
        <AppButton :icon="Play" :loading="creating" :disabled="!period" @click="create">Start</AppButton>
      </template>
    </AppModal>
  </div>
</template>
