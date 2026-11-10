<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Check, FileImage, FileText, Hourglass, Inbox, Landmark, ListChecks, PieChart, Receipt, Wallet, X } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { REIMBURSEMENT_STATUSES, type ReimbursementCategory, type ReimbursementStatus } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import ClaimGridCard from '@/modules/payroll/components/ClaimGridCard.vue';
import type { Claim } from '@/modules/payroll/types';
import { CLAIM_CATEGORY_VISUALS } from '@/modules/payroll/utils/claim-visuals';
import { CLAIM_CATEGORY_LABELS, CLAIM_STATUS_LABELS, claimStatusLabel, claimTone, monthName, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppAvatar, AppBadge, AppBulkDecision, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSelect, AppStatStrip, AppTabs, AppTextarea, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { runBulk } from '@/shared/utils/bulk';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/**
 * Claims to approve (within `payroll.reimbursement.approve` scope, never your own), the finance queue (claims above
 * the finance threshold the manager approved, for `payroll.reimbursement.finance`), and all claims in scope.
 */
const feedback = useFeedbackStore();
const auth = useAuthStore();
const route = useRoute();
const isFinance = computed(() => auth.can('payroll.reimbursement.finance'));
const isApprover = computed(() => auth.can('payroll.reimbursement.approve'));
type View = 'approve' | 'finance' | 'all';
const view = ref<View>(route.query.tab === 'finance' && isFinance.value ? 'finance' : isApprover.value ? 'approve' : isFinance.value ? 'finance' : 'all');
const table = useTable((q) => payrollApi.claims({ ...q, view: view.value }), { filters: { status: undefined as ReimbursementStatus | undefined } });
watch(view, () => void table.load());
const statusOptions = REIMBURSEMENT_STATUSES.map((s) => ({ value: s, label: CLAIM_STATUS_LABELS[s] }));

/** What's waiting and what's approved but not yet paid, for the summary; independent of the table's page and filters. */
const pending = useAsync(() => fetchAllPages((page, pageSize) => payrollApi.claims({ view: 'approve', page, pageSize })), { immediate: isApprover.value });
const financeQueue = useAsync(() => fetchAllPages((page, pageSize) => payrollApi.claims({ view: 'finance', page, pageSize })), { immediate: isFinance.value });
const approved = useAsync(() => fetchAllPages((page, pageSize) => payrollApi.claims({ view: 'all', status: 'APPROVED', page, pageSize })));
const refreshSummary = () => Promise.all([isApprover.value ? pending.run() : null, isFinance.value ? financeQueue.run() : null, approved.run()]);
const waiting = computed(() => (view.value === 'finance' ? (financeQueue.data.value ?? []) : (pending.data.value ?? [])));
const DAY = 86_400_000;
const ageDays = (c: Claim) => Math.floor((Date.now() - new Date(c.createdAt).getTime()) / DAY);
/** Claims waiting longer than this are highlighted. */
const SLA_DAYS = 7;
const tabs = computed(() => [
  ...(isApprover.value ? [{ key: 'approve', label: 'To approve', icon: Inbox, count: pending.data.value?.length ?? null }] : []),
  ...(isFinance.value ? [{ key: 'finance', label: 'Finance approval', icon: Landmark, count: financeQueue.data.value?.length ?? null }] : []),
  { key: 'all', label: 'All claims', icon: ListChecks },
]);
const policy = useAsync(() => payrollApi.expensePolicy());
const threshold = computed(() => policy.data.value?.financeApprovalAbove ?? null);
const strip = computed<StripItem[]>(() => {
  const list = waiting.value;
  const oldest = list.length ? Math.max(...list.map(ageDays)) : 0;
  const overdue = list.filter((c) => ageDays(c) > SLA_DAYS).length;
  const ok = approved.data.value ?? [];
  return [
    { key: 'waiting', label: view.value === 'finance' ? 'Waiting for finance' : 'Waiting for you', value: list.length, tone: 'warning', hint: list.length ? `Oldest ${oldest === 0 ? 'today' : `${oldest} day${oldest === 1 ? '' : 's'} ago`}` : 'Nothing to approve' },
    { key: 'amount', label: 'Amount to approve', value: rupees(list.reduce((n, c) => n + c.amount, 0)), tone: 'brand', hint: list.length ? `${list.filter((c) => c.receipt).length} of ${list.length} with a receipt` : undefined },
    { key: 'overdue', label: `Waiting over ${SLA_DAYS} days`, value: overdue, tone: overdue ? 'danger' : 'neutral', hint: overdue ? 'Decide these first' : 'All within a week' },
    { key: 'approved', label: 'Approved · next payroll', value: ok.length, tone: 'info', hint: ok.length ? `${rupees(ok.reduce((n, c) => n + c.amount, 0))} to pay, tax-free` : 'Nothing to pay out' },
  ];
});
const byCategory = computed(() => {
  const totals = new Map<ReimbursementCategory, { amount: number; count: number }>();
  for (const c of waiting.value) {
    const t = totals.get(c.category) ?? { amount: 0, count: 0 };
    t.amount += c.amount;
    t.count += 1;
    totals.set(c.category, t);
  }
  const sum = [...totals.values()].reduce((n, t) => n + t.amount, 0);
  return [...totals.entries()].map(([category, t]) => ({ category, ...t, share: sum ? (t.amount / sum) * 100 : 0 })).sort((a, b) => b.amount - a.amount);
});

const reviewing = ref<Claim | null>(null);
const decision = ref<'approve' | 'reject'>('approve');
const note = ref('');
const busy = ref(false);
function open(c: Claim, d: 'approve' | 'reject') {
  reviewing.value = c;
  decision.value = d;
  note.value = '';
  void payrollApi.claim(c.id).then(
    (full) => reviewing.value?.id === full.id && (reviewing.value = full),
    () => undefined,
  );
}
const goesToFinance = computed(() => !!reviewing.value && reviewing.value.approvalStage === 'MANAGER' && threshold.value !== null && reviewing.value.amount > threshold.value);
async function decide() {
  busy.value = true;
  try {
    const c = reviewing.value!;
    const done = await (decision.value === 'approve' ? payrollApi.approveClaim(c.id, note.value || null) : payrollApi.rejectClaim(c.id, note.value));
    feedback.success(done.approvalStage === 'FINANCE' ? 'Approved · sent to finance' : decision.value === 'approve' ? 'Claim approved' : 'Claim rejected', `${c.employee?.name} has been notified.`);
    reviewing.value = null;
    await Promise.all([table.load(), refreshSummary()]);
  } catch (e) {
    feedback.error('Could not record the decision', e);
  } finally {
    busy.value = false;
  }
}
const selected = ref<string[]>([]);
const bulkBusy = ref(false);
async function bulk(action: 'approve' | 'reject', reason = '') {
  bulkBusy.value = true;
  const { done, failed } = await runBulk([...selected.value], (id) => (action === 'approve' ? payrollApi.approveClaim(id, null) : payrollApi.rejectClaim(id, reason)));
  bulkBusy.value = false;
  selected.value = failed;
  const verb = action === 'approve' ? 'approved' : 'rejected';
  if (done) feedback.success(`${done} ${done === 1 ? 'claim' : 'claims'} ${verb}`, failed.length ? `${failed.length} could not be ${verb} and stay selected.` : 'Everyone has been notified.');
  else feedback.error(`Could not ${action} the selected claims`);
  await Promise.all([table.load(), refreshSummary()]);
}

async function receipt(c: Claim) {
  try {
    await payrollApi.downloadReceipt(c.id, c.receipt!.fileName);
  } catch (e) {
    feedback.error('Could not download the receipt', e);
  }
}
const fileSize = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const fileKind = (contentType: string) => (contentType === 'application/pdf' ? 'PDF' : contentType.replace('image/', '').toUpperCase());
const columns = computed<TableColumn<Claim>[]>(() => [
  { key: 'title', label: 'Expense' },
  { key: 'employee', label: 'Employee' },
  { key: 'amount', label: 'Amount', align: 'right' },
  ...(view.value !== 'approve' ? [{ key: 'status', label: view.value === 'finance' ? 'Manager approval' : 'Status' }] : []),
  { key: 'actions', label: '', align: 'right' },
]);
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Reimbursements" description="Approve expense claims; approved claims are paid (tax-free) with the next payroll run." />

    <AppStatStrip :items="strip" :loading="pending.loading.value && !pending.data.value" label="Reimbursement summary" />

    <div class="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <div class="min-w-0">
        <AppTabs v-model="view" :tabs="tabs">
          <template v-if="view === 'all'" #actions>
            <AppSelect v-model="table.filters.status" size="sm" class="w-48" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
          </template>
          <AppCard :padded="false">
            <AppDataTable
              v-model:selected="selected"
              :columns="columns"
              :rows="table.rows.value"
              :loading="table.loading.value"
              :error="table.error.value"
              :meta="table.meta.value"
              caption="Reimbursement claims"
              :empty-title="view === 'approve' ? 'Nothing to approve' : 'No claims'"
              :empty-description="view === 'approve' ? 'You are all caught up. New claims from your team appear here.' : 'Claims employees submit appear here with their status.'"
              :filtered="table.isFiltered.value"
              selectable
              :can-select="(r: Claim) => r.permissions.review"
              :select-label="(r: Claim) => `Select ${r.title} for ${r.employee?.name ?? 'employee'}`"
              @page="table.setPage"
              @retry="table.load"
              @clear="table.clearFilters()"
            >
              <template #bulk><AppBulkDecision :count="selected.length" noun="claim" :busy="bulkBusy" @approve="bulk('approve')" @reject="(r) => bulk('reject', r)" /></template>
              <template #cell-title="{ row }">
                <div class="flex min-w-0 items-start gap-3">
                  <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', CLAIM_CATEGORY_VISUALS[row.category].tile]" aria-hidden="true">
                    <component :is="CLAIM_CATEGORY_VISUALS[row.category].icon" :size="16" />
                  </span>
                  <div class="min-w-0">
                    <p class="truncate font-medium text-fg">{{ row.title }}</p>
                    <p class="truncate text-xs text-fg-muted">{{ CLAIM_CATEGORY_LABELS[row.category] }} · spent {{ formatDate(row.expenseDate) }} · claimed {{ timeAgo(row.createdAt) }}</p>
                    <p v-if="row.status === 'PENDING' && ageDays(row) > SLA_DAYS" class="inline-flex items-center gap-1 text-2xs font-medium text-danger-fg"><Hourglass :size="11" aria-hidden="true" />Waiting over {{ SLA_DAYS }} days</p>
                    <p v-else-if="row.payroll" class="text-2xs text-fg-subtle">{{ row.status === 'PAID' ? 'Paid in' : 'In' }} the {{ row.payroll.period }} payroll</p>
                    <p v-if="row.description" class="mt-0.5 line-clamp-2 max-w-md text-xs text-fg-subtle">{{ row.description }}</p>
                    <button
                      v-if="row.receipt"
                      type="button"
                      class="mt-1.5 inline-flex h-6 max-w-64 items-center gap-1.5 rounded-md px-2 text-2xs font-medium text-fg-muted ring-1 ring-line transition ring-inset hover:bg-surface-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                      :aria-label="`Download receipt for ${row.title}: ${row.receipt.fileName}`"
                      :title="row.receipt.fileName"
                      @click.stop="receipt(row)"
                    >
                      <component :is="row.receipt.contentType === 'application/pdf' ? FileText : FileImage" :size="12" class="shrink-0" aria-hidden="true" />
                      <span class="truncate">{{ row.receipt.fileName }}</span>
                      <span class="shrink-0 text-fg-subtle">{{ fileKind(row.receipt.contentType) }} · {{ fileSize(row.receipt.size) }}</span>
                    </button>
                    <p v-else class="mt-1 text-2xs text-fg-subtle">No receipt attached</p>
                  </div>
                </div>
              </template>
              <template #cell-employee="{ row }">
                <div class="flex items-center gap-2.5 max-md:justify-end">
                  <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
                  <div class="min-w-0 max-md:text-end">
                    <p class="truncate text-sm font-medium text-fg">{{ row.employee?.name }}</p>
                    <p class="truncate text-2xs text-fg-muted">{{ row.employee?.employeeCode }}{{ row.employee?.department ? ` · ${row.employee.department}` : '' }}</p>
                  </div>
                </div>
              </template>
              <template #cell-amount="{ row }"><span class="font-semibold text-fg tabular-nums">{{ rupees(row.amount, true) }}</span></template>
              <template #cell-status="{ row }">
                <template v-if="view === 'finance'">
                  <p class="text-sm text-fg">{{ row.trail.find((t: Claim['trail'][number]) => t.step === 'MANAGER')?.by ?? '—' }}</p>
                  <p class="text-2xs text-fg-muted">{{ timeAgo(row.trail.find((t: Claim['trail'][number]) => t.step === 'MANAGER')?.at ?? row.createdAt) }}</p>
                </template>
                <template v-else>
                  <AppBadge :tone="claimTone[row.status]" dot>{{ claimStatusLabel(row) }}</AppBadge>
                  <p v-if="row.reviewedBy" class="mt-0.5 text-2xs text-fg-muted">by {{ row.reviewedBy }}</p>
                </template>
              </template>
              <template #cell-actions="{ row }">
                <div class="flex items-center justify-end gap-1.5 whitespace-nowrap">
                  <template v-if="row.permissions.review">
                    <AppButton size="sm" variant="secondary" :icon="X" @click="open(row, 'reject')">Reject</AppButton>
                    <AppButton size="sm" :icon="Check" @click="open(row, 'approve')">Approve</AppButton>
                  </template>
                </div>
              </template>
              <template #card="{ row }">
                <ClaimGridCard :claim="row" mode="review" :selectable="row.permissions.review" :sla-days="SLA_DAYS" @approve="open(row, 'approve')" @reject="open(row, 'reject')" @receipt="receipt(row)" />
              </template>
            </AppDataTable>
          </AppCard>
        </AppTabs>
      </div>

      <aside class="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-1">
        <AppCard title="Waiting, by category" :icon="PieChart" :description="waiting.length ? `${waiting.length} claim${waiting.length === 1 ? '' : 's'} to decide` : undefined">
          <ul v-if="byCategory.length" class="space-y-3">
            <li v-for="c in byCategory" :key="c.category" class="flex items-center gap-3">
              <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', CLAIM_CATEGORY_VISUALS[c.category].tile]" aria-hidden="true">
                <component :is="CLAIM_CATEGORY_VISUALS[c.category].icon" :size="15" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline justify-between gap-2 text-sm">
                  <span class="truncate text-fg">{{ CLAIM_CATEGORY_LABELS[c.category] }} <span class="text-2xs text-fg-subtle tabular-nums">· {{ c.count }}</span></span>
                  <span class="shrink-0 font-medium text-fg tabular-nums">{{ rupees(c.amount) }}</span>
                </div>
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                  <div :class="['h-full rounded-full', CLAIM_CATEGORY_VISUALS[c.category].bar]" :style="{ width: `${Math.max(3, c.share)}%` }" />
                </div>
              </div>
            </li>
          </ul>
          <div v-else class="flex items-center gap-3 rounded-lg bg-surface-muted/60 px-3 py-3">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-success-fg ring-1 ring-line ring-inset" aria-hidden="true"><Check :size="15" /></span>
            <p class="text-xs text-fg-muted">Nothing is waiting for your decision.</p>
          </div>
        </AppCard>

        <AppCard title="How payouts work" :icon="Wallet">
          <ol class="space-y-3 text-sm">
            <li class="flex gap-3">
              <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-fg" aria-hidden="true">1</span>
              <p class="text-xs text-fg-muted"><span class="font-medium text-fg">Check the receipt</span> — open it from the claim before you decide.</p>
            </li>
            <li class="flex gap-3">
              <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-fg" aria-hidden="true">2</span>
              <p class="text-xs text-fg-muted"><span class="font-medium text-fg">Approve or reject</span> — the employee is notified; a rejection needs a reason.</p>
            </li>
            <li class="flex gap-3">
              <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-fg" aria-hidden="true">3</span>
              <p class="text-xs text-fg-muted"><span class="font-medium text-fg">Paid with payroll</span> — approved claims are added, tax-free, to the next payroll run.</p>
            </li>
          </ol>
          <p class="mt-4 flex items-center gap-2 border-t border-line/70 pt-3 text-xs text-fg-muted"><Receipt :size="13" aria-hidden="true" />Select several claims to approve or reject them together.</p>
        </AppCard>
      </aside>
    </div>

    <AppModal :open="!!reviewing" :title="reviewing ? `${decision === 'approve' ? 'Approve' : 'Reject'} ${rupees(reviewing.amount, true)} for ${reviewing.employee?.name}?` : ''" :description="reviewing?.title" size="sm" @close="reviewing = null">
      <div v-if="reviewing" class="mb-4 flex items-center gap-3 rounded-lg bg-surface-muted/60 px-3 py-2.5">
        <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', CLAIM_CATEGORY_VISUALS[reviewing.category].tile]" aria-hidden="true">
          <component :is="CLAIM_CATEGORY_VISUALS[reviewing.category].icon" :size="16" />
        </span>
        <div class="min-w-0 flex-1 text-xs text-fg-muted">
          <p class="truncate">{{ CLAIM_CATEGORY_LABELS[reviewing.category] }} · spent {{ formatDate(reviewing.expenseDate) }} · claimed {{ timeAgo(reviewing.createdAt) }}</p>
          <p v-if="reviewing.description" class="line-clamp-2 text-fg-subtle">{{ reviewing.description }}</p>
        </div>
        <AppButton v-if="reviewing.receipt" size="xs" variant="secondary" :icon="FileText" @click="receipt(reviewing)">Receipt</AppButton>
      </div>
      <dl v-if="reviewing?.policy && (reviewing.policy.perClaimLimit || reviewing.policy.monthlyLimit)" class="mb-4 grid grid-cols-2 gap-2 text-xs">
        <div class="rounded-lg bg-surface-muted/60 px-3 py-2">
          <dt class="text-fg-subtle">Limit per claim</dt>
          <dd class="font-medium text-fg tabular-nums">{{ reviewing.policy.perClaimLimit ? rupees(reviewing.policy.perClaimLimit) : 'None' }}</dd>
        </div>
        <div class="rounded-lg bg-surface-muted/60 px-3 py-2">
          <dt class="text-fg-subtle">Claimed in {{ monthName(reviewing.policy.month) }}</dt>
          <dd class="font-medium text-fg tabular-nums">{{ rupees(reviewing.policy.monthUsed) }}<template v-if="reviewing.policy.monthlyLimit"> of {{ rupees(reviewing.policy.monthlyLimit) }}</template></dd>
        </div>
      </dl>
      <ol v-if="reviewing?.trail.length" class="mb-4 space-y-1.5" aria-label="Approvals so far">
        <li v-for="(t, i) in reviewing.trail" :key="i" class="flex items-start gap-2 text-xs">
          <span :class="['mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full', t.decision === 'APPROVED' ? 'bg-success text-white' : 'bg-danger text-white']" aria-hidden="true"><component :is="t.decision === 'APPROVED' ? Check : X" :size="10" :stroke-width="3" /></span>
          <p class="text-fg-muted">
            <span class="font-medium text-fg">{{ t.step === 'MANAGER' ? 'Manager' : 'Finance' }}</span> · {{ t.decision === 'APPROVED' ? 'approved' : 'rejected' }} by {{ t.by ?? '—' }} {{ timeAgo(t.at) }}<template v-if="t.note"> · “{{ t.note }}”</template>
          </p>
        </li>
      </ol>
      <AppAlert v-if="decision === 'approve' && goesToFinance" tone="info" class="mb-4">Above {{ rupees(threshold) }}: finance approves it after you.</AppAlert>
      <AppTextarea v-model="note" :label="decision === 'approve' ? 'Note (optional)' : 'Reason'" :required="decision === 'reject'" :rows="3" :maxlength="500" />
      <template #footer>
        <AppButton variant="secondary" @click="reviewing = null">Cancel</AppButton>
        <AppButton :variant="decision === 'approve' ? 'primary' : 'danger'" :loading="busy" :disabled="decision === 'reject' && note.trim().length < 3" @click="decide">{{ decision === 'approve' ? 'Approve' : 'Reject' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
