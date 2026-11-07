<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Paperclip, X } from '@lucide/vue';
import { REIMBURSEMENT_STATUSES, type ReimbursementStatus } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import type { Claim } from '@/modules/payroll/types';
import { CLAIM_CATEGORY_LABELS, CLAIM_STATUS_LABELS, claimTone, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSelect, AppTabs, AppTextarea, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Claims to approve (within `payroll.reimbursement.approve` scope, never your own) and all claims in scope. */
const feedback = useFeedbackStore();
const view = ref<'approve' | 'all'>('approve');
const tabs = [
  { key: 'approve', label: 'To approve' },
  { key: 'all', label: 'All claims' },
];
const table = useTable((q) => payrollApi.claims({ ...q, view: view.value }), { filters: { status: undefined as ReimbursementStatus | undefined } });
watch(view, () => void table.load());
const statusOptions = REIMBURSEMENT_STATUSES.map((s) => ({ value: s, label: CLAIM_STATUS_LABELS[s] }));

const reviewing = ref<Claim | null>(null);
const decision = ref<'approve' | 'reject'>('approve');
const note = ref('');
const busy = ref(false);
function open(c: Claim, d: 'approve' | 'reject') {
  reviewing.value = c;
  decision.value = d;
  note.value = '';
}
async function decide() {
  busy.value = true;
  try {
    const c = reviewing.value!;
    await (decision.value === 'approve' ? payrollApi.approveClaim(c.id, note.value || null) : payrollApi.rejectClaim(c.id, note.value));
    feedback.success(decision.value === 'approve' ? 'Claim approved' : 'Claim rejected', `${c.employee?.name} has been notified.`);
    reviewing.value = null;
    await table.load();
  } catch (e) {
    feedback.error('Could not record the decision', e);
  } finally {
    busy.value = false;
  }
}
async function receipt(c: Claim) {
  try {
    await payrollApi.downloadReceipt(c.id, c.receipt!.fileName);
  } catch (e) {
    feedback.error('Could not download the receipt', e);
  }
}
const columns = computed<TableColumn<Claim>[]>(() => [
  { key: 'employee', label: 'Employee' },
  { key: 'title', label: 'Expense' },
  { key: 'amount', label: 'Amount', align: 'right' },
  ...(view.value === 'all' ? [{ key: 'status', label: 'Status' }] : []),
  { key: 'actions', label: '', align: 'right' },
]);
</script>

<template>
  <div>
    <AppPageHeader title="Reimbursements" description="Approve expense claims; approved claims are paid (tax-free) with the next payroll run." />
    <AppTabs v-model="view" :tabs="tabs">
      <AppCard :padded="false">
        <div v-if="view === 'all'" class="flex justify-end border-b border-line p-4">
          <AppSelect v-model="table.filters.status" class="w-52" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </div>
        <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" caption="Reimbursement claims" :empty-title="view === 'approve' ? 'Nothing to approve' : 'No claims'" @page="table.setPage" @retry="table.load">
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ row.employee?.employeeCode }}{{ row.employee?.department ? ` · ${row.employee.department}` : '' }}</p>
              </div>
            </div>
          </template>
          <template #cell-title="{ row }">
            <p class="font-medium text-fg">{{ row.title }}</p>
            <p class="text-xs text-fg-muted">{{ CLAIM_CATEGORY_LABELS[row.category] }} · {{ formatDate(row.expenseDate) }} · claimed {{ timeAgo(row.createdAt) }}</p>
            <p v-if="row.description" class="mt-0.5 line-clamp-2 text-xs text-fg-muted">{{ row.description }}</p>
          </template>
          <template #cell-amount="{ row }"><span class="font-medium tabular-nums">{{ rupees(row.amount, true) }}</span></template>
          <template #cell-status="{ row }">
            <AppBadge :tone="claimTone[row.status]" dot>{{ CLAIM_STATUS_LABELS[row.status] }}</AppBadge>
            <p v-if="row.reviewedBy" class="mt-0.5 text-xs text-fg-muted">by {{ row.reviewedBy }}</p>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-1">
              <AppButton v-if="row.receipt" size="sm" variant="ghost" :icon="Paperclip" :aria-label="`Receipt for ${row.title}`" @click="receipt(row)" />
              <template v-if="row.permissions.review">
                <AppButton size="sm" variant="secondary" :icon="X" @click="open(row, 'reject')">Reject</AppButton>
                <AppButton size="sm" :icon="Check" @click="open(row, 'approve')">Approve</AppButton>
              </template>
            </div>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <AppModal :open="!!reviewing" :title="reviewing ? `${decision === 'approve' ? 'Approve' : 'Reject'} ${rupees(reviewing.amount, true)} for ${reviewing.employee?.name}?` : ''" :description="reviewing?.title" size="sm" @close="reviewing = null">
      <AppTextarea v-model="note" :label="decision === 'approve' ? 'Note (optional)' : 'Reason'" :required="decision === 'reject'" :rows="3" :maxlength="500" />
      <template #footer>
        <AppButton variant="secondary" @click="reviewing = null">Cancel</AppButton>
        <AppButton :variant="decision === 'approve' ? 'primary' : 'danger'" :loading="busy" :disabled="decision === 'reject' && note.trim().length < 3" @click="decide">{{ decision === 'approve' ? 'Approve' : 'Reject' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
