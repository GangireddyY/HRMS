<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Download, FileCheck2, FileSpreadsheet, FileText, X } from '@lucide/vue';
import type { TaxProofStatus } from '@contracts';
import { employeesApi } from '@/modules/people/api/people.api';
import { statutoryApi, type TaxProof } from '@/modules/payroll/api/statutory.api';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppInput, AppModal, AppPageHeader, AppSegmented, AppSelect, AppTextarea, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { localToday } from '@/shared/utils/dates';
import { formatDate } from '@/shared/utils/format';

/** Payroll's tax desk: review investment proofs, and download the quarterly 24Q and employees' Form 16. */
const feedback = useFeedbackStore();
const [ty, tm] = localToday().split('-').map(Number) as [number, number];
const currentFy = tm >= 4 ? ty : ty - 1;
const fy = ref(currentFy);
const fyOptions = [currentFy - 1, currentFy, currentFy + 1].map((y) => ({ value: y, label: `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` }));

const table = useTable((q) => statutoryApi.proofs({ ...q, fy: fy.value }), { filters: { status: 'SUBMITTED' as TaxProofStatus | undefined } });
watch(fy, () => void table.load());
type StatusFilter = TaxProofStatus | 'ALL';
const status = computed<StatusFilter>({ get: () => table.filters.status ?? 'ALL', set: (v) => (table.filters.status = v === 'ALL' ? undefined : v) });
const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'SUBMITTED', label: 'To review' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
];
const STATUS: Record<TaxProofStatus, { label: string; tone: 'warning' | 'success' | 'danger' }> = {
  SUBMITTED: { label: 'To review', tone: 'warning' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};
const columns: TableColumn<TaxProof>[] = [
  { key: 'employee', label: 'Employee', exportValue: (p) => p.employee?.name ?? '' },
  { key: 'proof', label: 'Proof', exportValue: (p) => `${p.section} – ${p.description}` },
  { key: 'amount', label: 'Amount', align: 'right', exportValue: (p) => p.amount },
  { key: 'status', label: 'Status', exportValue: (p) => STATUS[p.status].label },
  { key: 'actions', label: '', align: 'right', noExport: true },
];

const acting = ref<{ proof: TaxProof; action: 'accept' | 'reject' } | null>(null);
const amount = ref<string | number>('');
const note = ref('');
const busy = ref(false);
function open(proof: TaxProof, action: 'accept' | 'reject') {
  acting.value = { proof, action };
  amount.value = proof.amount;
  note.value = '';
}
async function submit() {
  if (!acting.value) return;
  const { proof, action } = acting.value;
  busy.value = true;
  try {
    if (action === 'accept') await statutoryApi.acceptProof(proof.id, { amount: Number(amount.value), note: note.value || null });
    else await statutoryApi.rejectProof(proof.id, note.value);
    feedback.success(action === 'accept' ? 'Proof accepted' : 'Proof rejected', `${proof.employee?.name} has been notified.`);
    acting.value = null;
    await table.load();
  } catch (e) {
    feedback.error(`Could not ${action} the proof`, e);
  } finally {
    busy.value = false;
  }
}

// 24Q and Form 16
const quarter = ref<'Q1' | 'Q2' | 'Q3' | 'Q4'>('Q1');
const quarterOptions = [
  { value: 'Q1' as const, label: 'Q1 · Apr–Jun' },
  { value: 'Q2' as const, label: 'Q2 · Jul–Sep' },
  { value: 'Q3' as const, label: 'Q3 · Oct–Dec' },
  { value: 'Q4' as const, label: 'Q4 · Jan–Mar' },
];
const people = ref<{ value: string; label: string; description?: string }[]>([]);
const person = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
function search(q: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const page = await employeesApi.list({ search: q || undefined, pageSize: 20, sort: 'name:asc' });
      people.value = page.items.map((e) => ({ value: e.id, label: e.fullName, description: e.employeeCode }));
    } catch {
      people.value = [];
    }
  }, 250);
}
search('');
const run = (fn: () => Promise<void>, what: string) => fn().catch((e) => feedback.error(`Could not download ${what}`, e));
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Tax proofs & returns" description="Review the proofs employees submit for their declared deductions, and download the quarterly TDS return and Form 16.">
      <template #actions><AppSelect v-model="fy" class="w-44" :options="fyOptions" :clearable="false" :searchable="false" aria-label="Financial year" /></template>
    </AppPageHeader>

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <AppCard title="Investment proofs" :icon="FileCheck2" :padded="false">
        <template #actions><AppSegmented v-model="status" size="sm" :options="statusOptions" label="Filter by status" /></template>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          caption="Investment proofs"
          export-file="tax-proofs"
          :empty-title="table.filters.status === 'SUBMITTED' ? 'Nothing to review' : 'No proofs'"
          empty-description="Proofs employees submit from Salary & tax appear here."
          @page="table.setPage"
          @retry="table.load"
        >
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
                <p class="text-xs text-fg-muted">{{ row.employee?.employeeCode }} · {{ formatDate(row.createdAt) }}</p>
              </div>
            </div>
          </template>
          <template #cell-proof="{ row }">
            <button type="button" class="block max-w-64 text-start" @click="statutoryApi.downloadProof(row.id, row.file.name)">
              <span class="block truncate font-medium text-fg hover:underline">{{ row.description }}</span>
              <span class="block truncate text-xs text-fg-muted">{{ row.section }} · {{ row.file.name }}</span>
            </button>
          </template>
          <template #cell-amount="{ row }">
            <span class="font-medium tabular-nums">{{ rupees(row.amount) }}</span>
            <span v-if="row.status === 'ACCEPTED' && row.acceptedAmount !== row.amount" class="block text-xs text-success-fg tabular-nums">{{ rupees(row.acceptedAmount ?? 0) }} accepted</span>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="STATUS[row.status].tone" dot>{{ STATUS[row.status].label }}</AppBadge>
            <p v-if="row.reviewNote" class="mt-0.5 max-w-48 truncate text-xs text-fg-muted" :title="row.reviewNote">“{{ row.reviewNote }}”</p>
          </template>
          <template #cell-actions="{ row }">
            <div v-if="row.status === 'SUBMITTED'" class="flex justify-end gap-2">
              <AppButton size="sm" variant="secondary" :icon="X" :aria-label="`Reject ${row.description}`" @click="open(row, 'reject')" />
              <AppButton size="sm" :icon="Check" @click="open(row, 'accept')">Accept</AppButton>
            </div>
          </template>
        </AppDataTable>
      </AppCard>

      <div class="space-y-4">
        <AppCard title="Quarterly TDS return (24Q)" :icon="FileSpreadsheet" description="Deductee details for the quarter from approved payroll, ready for the return utility. Contains PANs.">
          <div class="flex items-end gap-2">
            <AppSelect v-model="quarter" class="flex-1" label="Quarter" :options="quarterOptions" :clearable="false" :searchable="false" />
            <AppButton :icon="Download" @click="run(() => statutoryApi.download24q(fy, quarter), '24Q')">Download</AppButton>
          </div>
        </AppCard>
        <AppCard title="Form 16" :icon="FileText" description="Part B for an employee, worked out from the year's approved payroll. Employees download their own from Salary & tax.">
          <div class="flex items-end gap-2">
            <AppSelect v-model="person" class="min-w-0 flex-1" label="Employee" :options="people" placeholder="Search by name…" searchable remote @search="search" />
            <AppButton :icon="FileText" :disabled="!person" @click="run(() => statutoryApi.openEmployeeForm16(person!, fy), 'Form 16')">Open</AppButton>
          </div>
        </AppCard>
      </div>
    </div>

    <AppModal
      :open="!!acting"
      :title="acting?.action === 'accept' ? 'Accept proof' : 'Reject proof'"
      :description="acting ? `${acting.proof.employee?.name} · ${acting.proof.sectionLabel}` : undefined"
      size="sm"
      dialog
      :guide="false"
      @close="acting = null"
    >
      <div class="space-y-3">
        <p class="rounded-lg bg-surface-muted/60 px-3 py-2 text-sm text-fg">{{ acting?.proof.description }} · {{ rupees(acting?.proof.amount ?? 0) }}</p>
        <AppInput v-if="acting?.action === 'accept'" v-model="amount" label="Accepted amount (₹)" type="number" :min="0" :max="acting.proof.amount" help="Lower it when only part of the proof qualifies." />
        <AppTextarea
          v-model="note"
          :label="acting?.action === 'accept' ? 'Note to the employee' : 'Reason'"
          :required="acting?.action === 'reject'"
          :rows="2"
          :maxlength="500"
          :placeholder="acting?.action === 'accept' ? 'Optional' : 'e.g. Landlord PAN missing'"
        />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="acting = null">Cancel</AppButton>
        <AppButton :variant="acting?.action === 'accept' ? 'primary' : 'danger'" :loading="busy" :disabled="acting?.action === 'reject' && note.trim().length < 3" @click="submit">
          {{ acting?.action === 'accept' ? 'Accept' : 'Reject' }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
