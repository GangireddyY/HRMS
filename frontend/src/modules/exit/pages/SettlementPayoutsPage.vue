<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { AlertTriangle, Banknote, CheckCheck, ChevronDown, Download, History, Landmark, Wallet } from '@lucide/vue';
import { BANK_FILE_FORMAT_LABELS, BANK_FILE_FORMATS, type BankFileFormat } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { exitApi } from '@/modules/exit/api/exit.api';
import type { SettlementPayout } from '@/modules/exit/types';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppDatePicker, AppDropdown, AppInput, AppMenuItem, AppModal, AppPageHeader, AppStatStrip, AppTabs, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { localToday } from '@/shared/utils/dates';
import { formatDate, formatMoney } from '@/shared/utils/format';

/** Approved full & final settlements to pay: a bank transfer file for the chosen ones, then mark them paid together. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const tab = ref<'APPROVED' | 'PAID'>('APPROVED');
const payouts = useAsync(() => exitApi.payouts(tab.value));
watch(tab, () => {
  selected.value = [];
  void payouts.run();
});
const rows = computed(() => payouts.data.value?.items ?? []);
const selected = ref<string[]>([]);
const chosen = computed(() => rows.value.filter((r) => selected.value.includes(r.id)));
const scope = computed(() => (chosen.value.length ? chosen.value : rows.value));
const canDisburse = computed(() => auth.can('payroll.disburse'));
const tabs = computed(() => [
  { key: 'APPROVED', label: 'To pay', icon: Wallet, count: tab.value === 'APPROVED' ? (payouts.data.value?.summary.count ?? null) : null },
  { key: 'PAID', label: 'Paid', icon: History },
]);

const strip = computed<StripItem[]>(() => {
  const s = payouts.data.value?.summary;
  if (tab.value === 'PAID') return [{ key: 'paid', label: 'Paid settlements', value: s?.count ?? 0, tone: 'success', hint: s ? formatMoney(s.total) : undefined }];
  return [
    { key: 'count', label: 'Waiting to be paid', value: s?.count ?? 0, tone: 'brand', hint: s?.count ? 'Approved settlements' : 'Nothing to pay' },
    { key: 'total', label: 'Total payable', value: formatMoney(s?.total ?? 0), tone: 'info', hint: 'Net of recoveries' },
    { key: 'overdue', label: 'Past the due date', value: s?.overdue ?? 0, tone: s?.overdue ? 'danger' : 'neutral', hint: s?.overdue ? 'Pay these first' : 'All within the due date' },
    { key: 'bank', label: 'No bank details', value: s?.withoutBank ?? 0, tone: s?.withoutBank ? 'warning' : 'success', hint: s?.withoutBank ? 'Left out of the bank file' : 'All in the bank file' },
  ];
});

const columns = computed<TableColumn<SettlementPayout>[]>(() => [
  { key: 'employee', label: 'Employee', exportValue: (r) => r.employee.name },
  { key: 'amount', label: 'Net payable', align: 'right', exportValue: (r) => r.netPayable },
  { key: 'bank', label: 'Bank', exportValue: (r) => r.bank?.ifsc ?? '' },
  { key: 'due', label: tab.value === 'PAID' ? 'Paid' : 'Due', exportValue: (r) => (tab.value === 'PAID' ? r.paidOn : r.dueOn) },
]);

async function download(format: BankFileFormat) {
  try {
    await exitApi.downloadPayoutFile(chosen.value.map((r) => r.id), format);
    const skipped = scope.value.filter((r) => !r.bank || r.netPayable <= 0).length;
    feedback.success('Bank file downloaded', skipped ? `${skipped} settlement${skipped === 1 ? ' was' : 's were'} left out (no bank details or nothing to pay).` : 'Upload it to the bank, then mark the settlements paid.');
  } catch (e) {
    feedback.error('Could not download the bank file', e);
  }
}

const payOpen = ref(false);
const pay = reactive({ paidOn: localToday() as string | undefined, reference: '' });
const paying = ref(false);
const payTotal = computed(() => scope.value.reduce((n, r) => n + r.netPayable, 0));
function openPay() {
  Object.assign(pay, { paidOn: localToday(), reference: '' });
  payOpen.value = true;
}
async function markPaid() {
  paying.value = true;
  try {
    const result = await exitApi.payMany({ ids: scope.value.map((r) => r.id), paidOn: pay.paidOn!, reference: pay.reference });
    payOpen.value = false;
    selected.value = [];
    if (result.paid) feedback.success(`${result.paid} settlement${result.paid === 1 ? '' : 's'} marked paid`, result.failed.length ? `${result.failed.length} could not be: ${result.failed[0]!.reason}` : 'Each employee has been notified.');
    else feedback.error('No settlement was marked paid', result.failed[0]?.reason);
    await payouts.run();
  } catch (e) {
    feedback.error('Could not mark the settlements paid', e);
  } finally {
    paying.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Settlement payouts" description="Pay approved full & final settlements: download a bank transfer file, upload it to the bank, then mark them paid with the transfer reference." back="/hr/exits" back-label="Exits">
      <template v-if="tab === 'APPROVED' && rows.length" #actions>
        <AppDropdown v-if="canDisburse" label="Bank file" width="w-72" align="left">
          <template #trigger="{ toggle }"><AppButton variant="secondary" :icon="Download" :icon-right="ChevronDown" @click="toggle">Bank file{{ chosen.length ? ` (${chosen.length})` : '' }}</AppButton></template>
          <template #default="{ close }">
            <AppMenuItem v-for="f in BANK_FILE_FORMATS" :key="f" @select="close(); download(f)">{{ BANK_FILE_FORMAT_LABELS[f] }}</AppMenuItem>
          </template>
        </AppDropdown>
        <AppButton :icon="CheckCheck" @click="openPay">Mark {{ chosen.length ? chosen.length : 'all' }} paid</AppButton>
      </template>
    </AppPageHeader>

    <AppStatStrip :items="strip" :loading="payouts.loading.value && !payouts.data.value" label="Settlement payouts" />

    <AppTabs v-model="tab" :tabs="tabs">
      <AppCard :padded="false">
        <AppDataTable
          v-model:selected="selected"
          :columns="columns"
          :rows="rows"
          :loading="payouts.loading.value"
          :error="payouts.error.value"
          caption="Settlements"
          :empty-title="tab === 'APPROVED' ? 'Nothing to pay' : 'No paid settlements yet'"
          :empty-description="tab === 'APPROVED' ? 'Approved full & final settlements appear here until they are paid.' : 'Settlements you mark paid appear here with their transfer reference.'"
          :selectable="tab === 'APPROVED'"
          :select-label="(r: SettlementPayout) => `Select the settlement of ${r.employee.name}`"
          export-file="settlement-payouts"
          @retry="payouts.run"
        >
          <template #cell-employee="{ row }">
            <RouterLink :to="`/hr/exits/${row.caseId}`" class="flex items-center gap-3 hover:underline">
              <AppAvatar :name="row.employee.name" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ row.employee.employeeCode }}{{ row.employee.department ? ` · ${row.employee.department}` : '' }}</p>
              </div>
            </RouterLink>
          </template>
          <template #cell-amount="{ row }">
            <span :class="['font-semibold tabular-nums', row.netPayable > 0 ? 'text-fg' : 'text-fg-subtle']">{{ formatMoney(row.netPayable) }}</span>
            <p v-if="row.netPayable <= 0" class="text-2xs text-fg-subtle">Nothing to pay</p>
          </template>
          <template #cell-bank="{ row }">
            <span v-if="row.bank" class="inline-flex items-center gap-1.5 text-sm text-fg"><Landmark :size="13" class="text-fg-subtle" aria-hidden="true" />{{ row.bank.name ?? 'Bank' }} <span class="font-mono text-xs text-fg-muted">{{ row.bank.ifsc }}</span></span>
            <AppBadge v-else tone="warning" size="sm"><AlertTriangle :size="11" aria-hidden="true" />No bank details</AppBadge>
          </template>
          <template #cell-due="{ row }">
            <template v-if="tab === 'PAID'">
              <p class="text-sm text-fg">{{ formatDate(row.paidOn) }}</p>
              <p class="truncate font-mono text-2xs text-fg-muted">{{ row.paymentReference }}</p>
            </template>
            <template v-else>
              <p :class="['text-sm', row.overdue ? 'font-medium text-danger-fg' : 'text-fg']">{{ formatDate(row.dueOn) }}</p>
              <p v-if="row.overdue" class="text-2xs text-danger-fg">Past due</p>
            </template>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <AppModal :open="payOpen" :title="`Mark ${scope.length} settlement${scope.length === 1 ? '' : 's'} paid`" :description="`${formatMoney(payTotal)} in total. Each employee is told it has been paid.`" size="sm" @close="payOpen = false">
      <div class="space-y-4">
        <AppDatePicker v-model="pay.paidOn" label="Paid on" required :max="localToday()" />
        <AppInput v-model="pay.reference" label="Transfer reference" required :maxlength="120" placeholder="e.g. the bank's batch or UTR number" :icon="Banknote" />
        <AppAlert v-if="scope.some((r) => !r.bank)" tone="warning">Some of these have no bank details: pay them another way before marking them paid.</AppAlert>
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="payOpen = false">Cancel</AppButton>
        <AppButton :icon="CheckCheck" :loading="paying" :disabled="!pay.paidOn || pay.reference.trim().length < 2" @click="markPaid">Mark paid</AppButton>
      </template>
    </AppModal>
  </div>
</template>
