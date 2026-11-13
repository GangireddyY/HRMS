<script setup lang="ts">
import { ref, watch } from 'vue';
import { BookOpenText, Download, Settings2 } from '@lucide/vue';
import type { PayrollJournal } from '@contracts';
import { formatAmount } from '@/core/locale/currency';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import { AppAlert, AppButton, AppErrorState, AppModal, AppSkeleton } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** The accounting journal of an approved run, with the Tally import files. */
const props = defineProps<{ open: boolean; runId: string; canConfigure: boolean }>();
const emit = defineEmits<{ close: [] }>();
const feedback = useFeedbackStore();
const journal = ref<PayrollJournal | null>(null);
const error = ref<unknown>(null);
const loading = ref(false);
async function load() {
  loading.value = true;
  error.value = null;
  try {
    journal.value = await payrollApi.journal(props.runId);
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}
watch(
  () => props.open,
  (open) => {
    if (open) void load();
  },
  { immediate: true },
);
const money = (n: number) => (n ? formatAmount(n, { currency: journal.value?.currency, decimals: true }) : '');
const busy = ref<'vouchers' | 'masters' | null>(null);
async function download(part: 'vouchers' | 'masters') {
  busy.value = part;
  try {
    await payrollApi.downloadTally(props.runId, part);
  } catch (e) {
    feedback.error('Could not download the Tally file', e);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <AppModal :open="props.open" :title="journal ? `Accounting journal · ${journal.period}` : 'Accounting journal'" :description="journal?.narration" size="xl" :guide="false" @close="emit('close')">
    <AppSkeleton v-if="loading && !journal" :lines="8" />
    <AppErrorState v-else-if="error" :error="error" title="Could not build the journal" @retry="load" />
    <div v-else-if="journal" class="space-y-4">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <p>
          <span class="text-fg-muted">Voucher date</span> <span class="font-medium text-fg tabular-nums">{{ journal.date }}</span>
        </p>
        <p>
          <span class="text-fg-muted">Payslips</span> <span class="font-medium text-fg tabular-nums">{{ journal.payslips }}</span>
        </p>
        <p>
          <span class="text-fg-muted">Total</span> <span class="font-medium text-fg tabular-nums">{{ money(journal.totalDebit) }}</span>
        </p>
      </div>
      <div class="card overflow-x-auto">
        <table class="w-full min-w-[36rem] text-sm">
          <caption class="sr-only">
            Journal lines
          </caption>
          <thead>
            <tr class="border-b border-line/70 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
              <th scope="col" class="px-4 py-2 text-start">Ledger</th>
              <th scope="col" class="px-4 py-2 text-end">Debit</th>
              <th scope="col" class="px-4 py-2 text-end">Credit</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line/60">
            <template v-for="l in journal.lines" :key="l.ledger">
              <tr>
                <th scope="row" class="px-4 py-2 text-start font-medium text-fg" :class="l.credit > 0 && 'ps-8'">{{ l.credit ? `To ${l.ledger}` : l.ledger }}</th>
                <td class="px-4 py-2 text-end tabular-nums">{{ money(l.debit) }}</td>
                <td class="px-4 py-2 text-end tabular-nums">{{ money(l.credit) }}</td>
              </tr>
              <tr v-for="c in l.costCentres" :key="`${l.ledger}-${c.name}`" class="text-xs text-fg-muted">
                <td class="px-4 py-1 ps-8">Cost centre · {{ c.name }}</td>
                <td class="px-4 py-1 text-end tabular-nums">{{ money(c.amount) }}</td>
                <td />
              </tr>
            </template>
          </tbody>
          <tfoot>
            <tr class="border-t border-line font-semibold text-fg">
              <th scope="row" class="px-4 py-2 text-start">Total</th>
              <td class="px-4 py-2 text-end tabular-nums">{{ money(journal.totalDebit) }}</td>
              <td class="px-4 py-2 text-end tabular-nums">{{ money(journal.totalCredit) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <AppAlert tone="info" title="Importing into Tally">
        In Tally, open the company and use Gateway → Import → Vouchers with the journal file. Import the ledger masters file first (Import → Masters) if any ledger is new. Tally refuses the same
        journal twice, so a run can't be posted again by mistake.
      </AppAlert>
    </div>
    <template #footer>
      <AppButton v-if="props.canConfigure" variant="ghost" :icon="Settings2" to="/hr/payroll/setup?tab=accounting">Ledger names</AppButton>
      <AppButton variant="secondary" :icon="BookOpenText" :loading="busy === 'masters'" :disabled="!journal" @click="download('masters')">Ledger masters (XML)</AppButton>
      <AppButton :icon="Download" :loading="busy === 'vouchers'" :disabled="!journal" @click="download('vouchers')">Journal for Tally (XML)</AppButton>
    </template>
  </AppModal>
</template>
