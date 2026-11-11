<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Building2, ReceiptText } from '@lucide/vue';
import type { InvoiceStatus } from '@contracts';
import { platformBillingApi } from '@/modules/billing/api/billing.api';
import InvoiceStatusBadge from '@/modules/billing/components/InvoiceStatusBadge.vue';
import type { BillingOverviewRow, InvoiceRow } from '@/modules/billing/types';
import { CYCLE_LABELS, CYCLE_UNIT, SUBSCRIPTION_LABELS, SUBSCRIPTION_TONES, money, periodLabel } from '@/modules/billing/utils/billing';
import OrgMark from '@/modules/platform/components/OrgMark.vue';
import { AppBadge, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, AppTabs, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { appLocale } from '@/core/locale/locale';
import { formatDate } from '@/shared/utils/format';

/** Platform billing: recurring revenue and balances, every organization's subscription, and all invoices. */
const router = useRouter();
const overview = useAsync(() => platformBillingApi.overview());
const tab = ref<'subscriptions' | 'invoices'>('subscriptions');
const num = (n: number) => n.toLocaleString(appLocale());

const main = computed(() => [...(overview.data.value?.totals ?? [])].sort((a, b) => b.organizations - a.organizations)[0] ?? null);
const strip = computed<StripItem[]>(() => {
  const t = main.value;
  const c = t?.currency ?? 'INR';
  return [
    { key: 'mrr', label: 'Monthly recurring', value: t ? money(t.mrr, c) : null, tone: 'brand', hint: 'Active subscriptions, before tax' },
    { key: 'outstanding', label: 'Outstanding', value: t ? money(t.outstanding, c) : null, tone: 'info', hint: 'Issued and unpaid' },
    { key: 'overdue', label: 'Overdue', value: t ? money(t.overdue, c) : null, tone: t?.overdue ? 'danger' : 'neutral', hint: 'Past the due date' },
    { key: 'collected', label: 'Collected this month', value: t ? money(t.collectedThisMonth, c) : null, tone: 'success', hint: 'Payments recorded' },
  ];
});

// Subscriptions
const status = ref<string | undefined>(undefined);
const search = ref('');
const subscriptions = computed(() =>
  (overview.data.value?.organizations ?? []).filter(
    (r) => (!status.value || (status.value === 'PAST_DUE' ? r.pastDue : r.status === status.value)) && (!search.value || `${r.organization.name} ${r.organization.slug}`.toLowerCase().includes(search.value.toLowerCase())),
  ),
);
const statusOptions = [
  { value: 'TRIAL', label: 'Trial' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAST_DUE', label: 'Past due' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const subColumns: TableColumn<BillingOverviewRow>[] = [
  { key: 'organization', label: 'Organization', value: (r) => r.organization.name },
  { key: 'plan', label: 'Plan', value: (r) => r.plan?.name ?? '' },
  { key: 'status', label: 'Status', value: (r) => SUBSCRIPTION_LABELS[r.status] },
  { key: 'seats', label: 'Seats', align: 'right', value: (r) => `${r.seats.used}/${r.seats.limit ?? '∞'}` },
  { key: 'amount', label: 'Recurring', align: 'right', value: (r) => r.cycleAmount },
  { key: 'balanceDue', label: 'Balance due', align: 'right' },
  { key: 'nextPeriodStart', label: 'Next invoice', value: (r) => r.nextPeriodStart ?? '' },
];

// Invoices
const invoices = useTable((q) => platformBillingApi.invoices(q), { url: 'inv', immediate: false, filters: { status: undefined as InvoiceStatus | 'OVERDUE' | undefined } });
const invoiceStatusOptions = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ISSUED', label: 'Awaiting payment' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PAID', label: 'Paid' },
  { value: 'VOID', label: 'Void' },
];
const invoiceColumns: TableColumn<InvoiceRow>[] = [
  { key: 'number', label: 'Invoice', value: (r) => r.number ?? 'Draft' },
  { key: 'organization', label: 'Organization', value: (r) => r.organization?.name ?? '' },
  { key: 'period', label: 'Period', value: (r) => periodLabel(r.periodStart, r.periodEnd) },
  { key: 'status', label: 'Status' },
  { key: 'dueDate', label: 'Due', value: (r) => r.dueDate ?? '' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'balance', label: 'Balance', align: 'right' },
];
watch(tab, (t) => t === 'invoices' && void invoices.load());
</script>

<template>
  <div>
    <AppPageHeader title="Billing" :description="overview.data.value ? `Subscriptions and invoices for ${num(overview.data.value.organizations.length)} organizations. Payments are recorded here as they arrive.` : 'Subscriptions, invoices and payments.'" />

    <AppStatStrip class="mb-4" :items="strip" :loading="overview.loading.value && !overview.data.value" label="Billing summary" />

    <AppTabs
      v-model="tab"
      class="mb-4"
      :tabs="[
        { key: 'subscriptions', label: 'Subscriptions', icon: Building2 },
        { key: 'invoices', label: 'Invoices', icon: ReceiptText },
      ]"
    />

    <AppCard v-if="tab === 'subscriptions'" :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px]">
        <AppSearchInput v-model="search" placeholder="Search organizations" aria-label="Search organizations" />
        <AppSelect v-model="status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable
        :grid="false"
        :columns="subColumns"
        :rows="subscriptions"
        :row-key="(r) => r.organization.id"
        :loading="overview.loading.value"
        :error="overview.error.value"
        clickable
        caption="Subscriptions"
        empty-title="No organizations"
        empty-description="Organizations appear here once they're created."
        :filtered="!!status || !!search"
        @retry="overview.run"
        @row-click="(row) => router.push(`/platform/billing/${row.organization.id}`)"
        @clear="(status = undefined), (search = '')"
      >
        <template #cell-organization="{ row }">
          <div class="flex items-center gap-3">
            <OrgMark :name="row.organization.name" size="md" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.organization.name }}</p>
              <p class="truncate font-mono text-xs text-fg-subtle">{{ row.organization.slug }}</p>
            </div>
          </div>
        </template>
        <template #cell-plan="{ row }">
          <span class="text-fg">{{ row.plan?.name ?? '—' }}</span>
          <p class="text-xs text-fg-muted">{{ CYCLE_LABELS[row.billingCycle] }}<template v-if="row.discountPct"> · {{ row.discountPct }}% off</template></p>
        </template>
        <template #cell-status="{ row }">
          <div class="flex flex-wrap gap-1.5">
            <AppBadge :tone="SUBSCRIPTION_TONES[row.status]" dot>{{ SUBSCRIPTION_LABELS[row.status] }}</AppBadge>
            <AppBadge v-if="row.pastDue" tone="danger">Past due</AppBadge>
          </div>
        </template>
        <template #cell-seats="{ row }">
          <span class="font-medium text-fg tabular-nums">{{ num(row.seats.used) }}</span><span class="text-fg-muted tabular-nums"> / {{ row.seats.limit === null ? '∞' : num(row.seats.limit) }}</span>
        </template>
        <template #cell-amount="{ row }">
          <span class="font-medium text-fg tabular-nums">{{ money(row.cycleAmount, row.currency) }}</span>
          <p v-if="row.cycleAmount !== null" class="text-xs text-fg-muted">per {{ CYCLE_UNIT[row.billingCycle] }}</p>
        </template>
        <template #cell-balanceDue="{ row }">
          <span :class="['tabular-nums', row.overdue ? 'font-semibold text-danger-fg' : row.balanceDue ? 'font-medium text-fg' : 'text-fg-muted']">{{ money(row.balanceDue, row.currency) }}</span>
        </template>
        <template #cell-nextPeriodStart="{ row }"><span class="text-fg-muted">{{ row.status === 'CANCELLED' ? '—' : formatDate(row.nextPeriodStart) }}</span></template>
      </AppDataTable>
    </AppCard>

    <AppCard v-else :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px]">
        <AppSearchInput v-model="invoices.search.value" placeholder="Search invoice number or organization" aria-label="Search invoices" />
        <AppSelect v-model="invoices.filters.status" :options="invoiceStatusOptions" placeholder="All invoices" aria-label="Filter by status" />
      </div>
      <AppDataTable
        :grid="false"
        :columns="invoiceColumns"
        :rows="invoices.rows.value"
        :loading="invoices.loading.value"
        :error="invoices.error.value"
        :meta="invoices.meta.value"
        clickable
        caption="Invoices"
        empty-title="No invoices yet"
        empty-description="Draft an invoice from an organization's billing page."
        :filtered="invoices.isFiltered.value"
        @page="invoices.setPage"
        @retry="invoices.load"
        @row-click="(row) => router.push(`/platform/billing/${row.organizationId}`)"
        @clear="invoices.clearFilters()"
      >
        <template #cell-number="{ row }"><span class="font-mono text-xs font-medium text-fg">{{ row.number ?? 'Draft' }}</span></template>
        <template #cell-organization="{ row }"><span class="text-fg">{{ row.organization?.name }}</span></template>
        <template #cell-period="{ row }"><span class="text-fg-muted">{{ periodLabel(row.periodStart, row.periodEnd) }}</span></template>
        <template #cell-status="{ row }"><InvoiceStatusBadge :invoice="row" /></template>
        <template #cell-dueDate="{ row }"><span :class="row.overdue ? 'font-medium text-danger-fg' : 'text-fg-muted'">{{ formatDate(row.dueDate) }}</span></template>
        <template #cell-total="{ row }"><span class="font-medium text-fg tabular-nums">{{ money(row.total, row.currency) }}</span></template>
        <template #cell-balance="{ row }"><span :class="['tabular-nums', row.balance ? 'text-fg' : 'text-fg-muted']">{{ money(row.balance, row.currency) }}</span></template>
      </AppDataTable>
    </AppCard>
  </div>
</template>
