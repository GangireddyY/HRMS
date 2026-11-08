<script setup lang="ts">
import { ref } from 'vue';
import { Paperclip, Plus, Receipt } from '@lucide/vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import ClaimFormModal from '@/modules/payroll/components/ClaimFormModal.vue';
import type { Claim } from '@/modules/payroll/types';
import { CLAIM_CATEGORY_LABELS, CLAIM_STATUS_LABELS, claimTone, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const feedback = useFeedbackStore();
const table = useTable((q) => payrollApi.claims({ ...q, view: 'mine' }));
const formOpen = ref(false);
async function onSaved(c: Claim) {
  formOpen.value = false;
  feedback.success('Claim submitted', `${rupees(c.amount)} for "${c.title}" is waiting for approval.`);
  await table.load();
}
async function withdraw(c: Claim) {
  if (!(await feedback.confirm({ title: 'Withdraw this claim?', message: `"${c.title}" (${rupees(c.amount)}) will no longer be reviewed.`, confirmLabel: 'Withdraw' }))) return;
  try {
    await payrollApi.cancelClaim(c.id);
    feedback.success('Claim withdrawn');
    await table.load();
  } catch (e) {
    feedback.error('Could not withdraw the claim', e);
  }
}
async function receipt(c: Claim) {
  try {
    await payrollApi.downloadReceipt(c.id, c.receipt!.fileName);
  } catch (e) {
    feedback.error('Could not download the receipt', e);
  }
}
const columns: TableColumn<Claim>[] = [
  { key: 'title', label: 'Expense' },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Reimbursements" description="Claim work expenses. Your manager or the finance team approves them, and approved claims are paid with the next payroll.">
      <template #actions><AppButton :icon="Plus" @click="formOpen = true">New claim</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" caption="My claims" empty-title="No claims yet" @page="table.setPage" @retry="table.load" :filtered="table.isFiltered.value" @clear="table.clearFilters()">
        <template #empty><AppButton :icon="Plus" @click="formOpen = true">New claim</AppButton></template>
        <template #cell-title="{ row }">
          <p class="flex items-center gap-2 font-medium text-fg"><Receipt :size="14" class="text-fg-subtle" aria-hidden="true" />{{ row.title }}</p>
          <p class="text-xs text-fg-muted">{{ CLAIM_CATEGORY_LABELS[row.category] }} · {{ formatDate(row.expenseDate) }}</p>
        </template>
        <template #cell-amount="{ row }"><span class="font-medium tabular-nums">{{ rupees(row.amount, true) }}</span></template>
        <template #cell-status="{ row }">
          <AppBadge :tone="claimTone[row.status]" dot>{{ CLAIM_STATUS_LABELS[row.status] }}</AppBadge>
          <p v-if="row.status === 'REJECTED' && row.reviewNote" class="mt-0.5 text-xs text-fg-muted">{{ row.reviewNote }}</p>
          <p v-else-if="row.payroll" class="mt-0.5 text-xs text-fg-muted">{{ row.status === 'PAID' ? 'Paid with' : 'In' }} {{ row.payroll.period }} payroll</p>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1">
            <AppButton v-if="row.receipt" size="sm" variant="ghost" :icon="Paperclip" :aria-label="`Receipt for ${row.title}`" @click="receipt(row)" />
            <AppButton v-if="row.permissions.cancel" size="sm" variant="ghost" @click="withdraw(row)">Withdraw</AppButton>
          </div>
        </template>
      </AppDataTable>
    </AppCard>
    <ClaimFormModal :open="formOpen" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
