<script setup lang="ts">
import { computed, ref } from 'vue';
import { Banknote, CircleCheck, FilterX, Paperclip, PieChart, Plus, Receipt, Send, Undo2 } from '@lucide/vue';
import type { ReimbursementCategory, ReimbursementStatus } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import ClaimFormModal from '@/modules/payroll/components/ClaimFormModal.vue';
import ClaimGridCard from '@/modules/payroll/components/ClaimGridCard.vue';
import type { Claim } from '@/modules/payroll/types';
import { CLAIM_CATEGORY_VISUALS } from '@/modules/payroll/utils/claim-visuals';
import { CLAIM_CATEGORY_LABELS, CLAIM_STATUS_LABELS, claimTone, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Your expense claims: this year's totals by status, what the next payroll pays you, and every claim's progress. */
const feedback = useFeedbackStore();
const table = useTable((q) => payrollApi.claims({ ...q, view: 'mine' }), { filters: { status: undefined as ReimbursementStatus | undefined } });
/** Totals and side panels; the list itself stays paginated and filterable. */
const summary = useAsync(() => fetchAllPages((page, pageSize) => payrollApi.claims({ view: 'mine', page, pageSize })));
const formOpen = ref(false);
const reload = () => Promise.all([table.load(), summary.run()]);
async function onSaved(c: Claim) {
  formOpen.value = false;
  feedback.success('Claim submitted', `${rupees(c.amount)} for "${c.title}" is waiting for approval.`);
  await reload();
}
async function withdraw(c: Claim) {
  if (!(await feedback.confirm({ title: 'Withdraw this claim?', message: `"${c.title}" (${rupees(c.amount)}) will no longer be reviewed.`, confirmLabel: 'Withdraw' }))) return;
  try {
    await payrollApi.cancelClaim(c.id);
    feedback.success('Claim withdrawn');
    await reload();
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

// ---- Summary ---------------------------------------------------------------------------------------------------
const year = new Date().getFullYear();
const all = computed(() => summary.data.value ?? []);
const thisYear = computed(() => all.value.filter((c) => new Date(c.createdAt).getFullYear() === year));
const total = (list: Claim[]) => list.reduce((s, c) => s + c.amount, 0);
const plural = (n: number, word = 'claim') => `${n} ${word}${n === 1 ? '' : 's'}`;
const ofStatus = (s: ReimbursementStatus) => thisYear.value.filter((c) => c.status === s);
const claimed = computed(() => thisYear.value.filter((c) => c.status !== 'CANCELLED'));
const strip = computed<StripItem[]>(() => {
  const pending = ofStatus('PENDING');
  const oldest = [...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return [
    { key: 'all', label: `Claimed in ${year}`, value: rupees(total(claimed.value)), hint: plural(claimed.value.length), tone: 'brand' },
    { key: 'PENDING', label: 'Awaiting approval', value: rupees(total(pending)), hint: oldest ? `${plural(pending.length)} · oldest ${timeAgo(oldest.createdAt)}` : 'Nothing waiting', tone: 'warning' },
    { key: 'APPROVED', label: 'Approved, not paid yet', value: rupees(total(ofStatus('APPROVED'))), hint: ofStatus('APPROVED').length ? `${plural(ofStatus('APPROVED').length)} · next payroll` : 'Nothing to be paid', tone: 'info' },
    { key: 'PAID', label: 'Paid to you', value: rupees(total(ofStatus('PAID'))), hint: plural(ofStatus('PAID').length), tone: 'success' },
    { key: 'REJECTED', label: 'Rejected', value: rupees(total(ofStatus('REJECTED'))), hint: plural(ofStatus('REJECTED').length), tone: 'danger' },
  ];
});
const selectStatus = (k: string | null) => (table.filters.status = !k || k === 'all' ? undefined : (k as ReimbursementStatus));

/** Approved claims (any year) that the next payroll pays out. */
const toBePaid = computed(() => all.value.filter((c) => c.status === 'APPROVED'));
const lastPaid = computed(() => all.value.find((c) => c.status === 'PAID' && c.payroll));
const byCategory = computed(() => {
  const counted = thisYear.value.filter((c) => c.status !== 'CANCELLED' && c.status !== 'REJECTED');
  const sum = total(counted);
  const map = new Map<ReimbursementCategory, { amount: number; count: number }>();
  for (const c of counted) {
    const e = map.get(c.category) ?? { amount: 0, count: 0 };
    map.set(c.category, { amount: e.amount + c.amount, count: e.count + 1 });
  }
  return [...map.entries()].map(([category, v]) => ({ category, ...v, share: sum ? Math.round((v.amount / sum) * 100) : 0 })).sort((a, b) => b.amount - a.amount);
});
const maxCategory = computed(() => Math.max(1, ...byCategory.value.map((c) => c.amount)));

// ---- List ------------------------------------------------------------------------------------------------------
function statusNote(c: Claim): string | null {
  if (c.status === 'REJECTED') return c.reviewNote ? `“${c.reviewNote}”` : c.reviewedBy ? `By ${c.reviewedBy}` : null;
  if (c.payroll) return `${c.status === 'PAID' ? 'Paid with' : 'In'} ${c.payroll.period} payroll`;
  if (c.status === 'APPROVED') return 'Paid with the next payroll';
  if (c.status === 'PENDING') return `Waiting ${timeAgo(c.createdAt).replace(/ ago$/, '')}`;
  return null;
}
const columns: TableColumn<Claim>[] = [
  { key: 'title', label: 'Expense' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];
const STEPS = [
  { icon: Send, title: 'Submit with a receipt', text: 'Claims with a receipt are approved faster.' },
  { icon: CircleCheck, title: 'Manager or finance approves', text: 'You can withdraw a claim until it is reviewed.' },
  { icon: Banknote, title: 'Paid with the next payroll', text: 'Reimbursements are added to your payslip, not taxed.' },
];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Reimbursements" description="Claim work expenses. Your manager or the finance team approves them, and approved claims are paid with the next payroll.">
      <template #actions><AppButton :icon="Plus" @click="formOpen = true">New claim</AppButton></template>
    </AppPageHeader>

    <AppStatStrip :items="strip" selectable :selected="table.filters.status ?? null" :loading="summary.loading.value && !summary.data.value" label="Claims summary" @select="selectStatus" />

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section class="card overflow-hidden" aria-labelledby="claims-title">
        <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
          <span class="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><Receipt :size="16" /></span>
          <div class="min-w-0 flex-1">
            <h2 id="claims-title" class="flex items-center gap-2 text-sm font-semibold text-fg">
              {{ table.filters.status ? `${CLAIM_STATUS_LABELS[table.filters.status]} claims` : 'Your claims' }}
              <AppBadge v-if="table.meta.value" size="sm">{{ table.meta.value.total }}</AppBadge>
            </h2>
            <p class="text-xs text-fg-muted">{{ table.filters.status ? 'All years, newest first' : 'Newest first · pick a figure above to filter' }}</p>
          </div>
          <AppButton v-if="table.filters.status" size="sm" variant="ghost" :icon="FilterX" @click="selectStatus(null)">Show all</AppButton>
          <AppSearchInput v-model="table.search.value" class="w-full sm:w-64" size="sm" placeholder="Search claims" aria-label="Search claims" />
        </header>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          caption="My claims"
          empty-title="No claims yet"
          empty-description="Spent money on work — travel, meals, internet? Claim it here and it's paid back with your salary."
          :filtered="table.isFiltered.value"
          @page="table.setPage"
          @retry="table.load"
          @clear="table.clearFilters()"
        >
          <template #empty><AppButton :icon="Plus" @click="formOpen = true">New claim</AppButton></template>
          <template #cell-title="{ row }">
            <div class="flex items-center gap-3">
              <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', CLAIM_CATEGORY_VISUALS[row.category].tile]" aria-hidden="true">
                <component :is="CLAIM_CATEGORY_VISUALS[row.category].icon" :size="17" />
              </span>
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.title }}</p>
                <p class="flex items-center gap-1.5 truncate text-xs text-fg-muted">
                  {{ CLAIM_CATEGORY_LABELS[row.category] }} · spent {{ formatDate(row.expenseDate) }}
                  <span v-if="!row.receipt" class="text-fg-subtle">· no receipt</span>
                </p>
              </div>
            </div>
          </template>
          <template #cell-submitted="{ row }"><span class="whitespace-nowrap text-fg-muted tabular-nums">{{ formatDate(row.createdAt) }}</span></template>
          <template #cell-amount="{ row }"><span :class="['font-semibold tabular-nums', row.status === 'CANCELLED' || row.status === 'REJECTED' ? 'text-fg-subtle line-through decoration-fg-subtle/50' : 'text-fg']">{{ rupees(row.amount, true) }}</span></template>
          <template #cell-status="{ row }">
            <div class="max-md:text-end">
              <AppBadge :tone="claimTone[row.status]" dot>{{ CLAIM_STATUS_LABELS[row.status] }}</AppBadge>
              <p v-if="statusNote(row)" class="mt-0.5 max-w-56 truncate text-xs text-fg-muted" :title="statusNote(row)!">{{ statusNote(row) }}</p>
              <p v-if="row.reviewedBy && row.status !== 'PENDING' && !(row.status === 'REJECTED' && !row.reviewNote)" class="max-w-56 truncate text-2xs text-fg-subtle">
                {{ row.status === 'REJECTED' ? 'Rejected' : 'Approved' }} by {{ row.reviewedBy }}<template v-if="row.reviewedAt"> · {{ formatDate(row.reviewedAt) }}</template>
              </p>
            </div>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-1">
              <AppButton v-if="row.receipt" size="sm" variant="ghost" :icon="Paperclip" :aria-label="`Receipt for ${row.title}`" :title="row.receipt.fileName" @click="receipt(row)" />
              <AppButton v-if="row.permissions.cancel" size="sm" variant="ghost" :icon="Undo2" @click="withdraw(row)">Withdraw</AppButton>
            </div>
          </template>
          <template #card="{ row }"><ClaimGridCard :claim="row" mode="mine" :note="statusNote(row)" @withdraw="withdraw(row)" @receipt="receipt(row)" /></template>
        </AppDataTable>
      </section>

      <aside class="space-y-4">
        <section class="card overflow-hidden" aria-labelledby="payout-title">
          <div class="bg-gradient-to-br from-brand-500/10 via-transparent to-brand-300/10 p-4">
            <p id="payout-title" class="flex items-center gap-2 text-xs font-semibold tracking-wide text-accent-fg uppercase"><Banknote :size="14" aria-hidden="true" />Coming with your next payroll</p>
            <p class="mt-2 text-3xl font-semibold tracking-tight text-fg tabular-nums">{{ rupees(total(toBePaid)) }}</p>
            <p class="text-xs text-fg-muted">{{ toBePaid.length ? `${plural(toBePaid.length, 'approved claim')}, paid tax-free` : 'No approved claims waiting to be paid' }}</p>
          </div>
          <ul v-if="toBePaid.length" class="divide-y divide-line/70 border-t border-line/70">
            <li v-for="c in toBePaid.slice(0, 4)" :key="c.id" class="flex items-center gap-3 px-4 py-2.5">
              <span :class="['flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset', CLAIM_CATEGORY_VISUALS[c.category].tile]" aria-hidden="true"><component :is="CLAIM_CATEGORY_VISUALS[c.category].icon" :size="14" /></span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-fg">{{ c.title }}</p>
                <p class="text-2xs text-fg-muted">{{ c.payroll ? `${c.payroll.period} payroll` : 'Next payroll' }}</p>
              </div>
              <span class="text-sm font-medium text-fg tabular-nums">{{ rupees(c.amount) }}</span>
            </li>
            <li v-if="toBePaid.length > 4" class="px-4 py-2 text-xs text-fg-muted">and {{ toBePaid.length - 4 }} more</li>
          </ul>
          <p v-if="lastPaid" class="border-t border-line/70 px-4 py-2.5 text-xs text-fg-muted">Last paid with the {{ lastPaid.payroll!.period }} payroll.</p>
        </section>

        <AppCard title="Spending by category" :description="`Claimed in ${year}, excluding rejected`" :icon="PieChart">
          <ul v-if="byCategory.length" class="space-y-3">
            <li v-for="c in byCategory" :key="c.category">
              <div class="flex items-center gap-2 text-sm">
                <component :is="CLAIM_CATEGORY_VISUALS[c.category].icon" :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-fg">{{ CLAIM_CATEGORY_LABELS[c.category] }}</span>
                <span class="font-medium text-fg tabular-nums">{{ rupees(c.amount) }}</span>
              </div>
              <div class="mt-1 flex items-center gap-2">
                <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                  <span :class="['block h-full rounded-full', CLAIM_CATEGORY_VISUALS[c.category].bar]" :style="{ width: `${(c.amount / maxCategory) * 100}%` }" />
                </span>
                <span class="w-16 text-end text-2xs text-fg-muted tabular-nums">{{ c.share }}% · {{ c.count }}</span>
              </div>
            </li>
          </ul>
          <p v-else class="text-sm text-fg-muted">Nothing claimed in {{ year }} yet.</p>
        </AppCard>

        <AppCard title="How claims are paid">
          <ol class="relative space-y-4">
            <li v-for="(s, i) in STEPS" :key="s.title" class="relative flex gap-3">
              <span v-if="i < STEPS.length - 1" class="absolute start-3.5 top-8 -bottom-4 w-px bg-line" aria-hidden="true" />
              <span class="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-fg ring-4 ring-surface" aria-hidden="true"><component :is="s.icon" :size="14" /></span>
              <div>
                <p class="text-sm font-medium text-fg">{{ s.title }}</p>
                <p class="text-xs text-fg-muted">{{ s.text }}</p>
              </div>
            </li>
          </ol>
          <AppButton class="mt-4 w-full" size="sm" variant="secondary" :icon="Plus" @click="formOpen = true">New claim</AppButton>
        </AppCard>
      </aside>
    </div>
    <ClaimFormModal :open="formOpen" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
