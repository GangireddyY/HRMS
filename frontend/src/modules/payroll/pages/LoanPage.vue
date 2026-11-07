<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Ban, CalendarClock, CheckCircle2, HandCoins, Send, Wallet, XCircle } from '@lucide/vue';
import { loansApi } from '@/modules/payroll/api/payroll.api';
import type { LoanDetail } from '@/modules/payroll/types';
import { LOAN_STATUS_LABELS, LOAN_TYPE_LABELS, MONTH_NAMES, REPAYMENT_SOURCE_LABELS, loanEmi, loanTone, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppDatePicker, AppErrorState, AppInput, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppStatCard, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** One loan or advance: terms, repayments and the remaining schedule; HR actions depend on the caller's permissions. */
const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const hr = computed(() => route.path.startsWith('/hr'));
const loan = useAsync(() => loansApi.get(id.value));
watch(id, () => void loan.run());
const l = computed(() => loan.data.value);
const today = new Date().toISOString().slice(0, 10);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const busy = ref(false);
const modal = ref<'approve' | 'reject' | 'disburse' | 'defer' | 'repay' | null>(null);

// Months payroll can still deduct from (first open month and the next twelve).
const months = ref<{ value: string; label: string }[]>([]);
async function loadMonths() {
  if (months.value.length) return;
  const first = await loansApi.firstMonth();
  months.value = Array.from({ length: 13 }, (_, i) => {
    const index = first.year * 12 + first.month - 1 + i;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    return { value: `${y}-${m}`, label: `${MONTH_NAMES[m - 1]} ${y}` };
  });
}
const parseMonth = (v: string) => {
  const [y, m] = v.split('-').map(Number) as [number, number];
  return { year: y, month: m };
};

const approveForm = reactive({ amount: '' as string | number, tenureMonths: '' as string | number, interestRate: 0 as string | number, start: '', note: '' });
const rejectNote = ref('');
const disburseForm = reactive({ disbursedOn: today as string | undefined, reference: '' });
const deferForm = reactive({ start: '', note: '' });
const repayForm = reactive({ amount: '' as string | number, paidOn: today as string | undefined, note: '' });
const previewEmi = computed(() => loanEmi(Number(approveForm.amount), l.value?.type === 'ADVANCE' ? 0 : Number(approveForm.interestRate), Number(approveForm.tenureMonths)));

async function open(kind: NonNullable<typeof modal.value>) {
  reset();
  const x = l.value!;
  try {
    if (kind === 'approve' || kind === 'defer') await loadMonths();
  } catch (e) {
    feedback.error('Could not load the payroll months', e);
    return;
  }
  if (kind === 'approve') Object.assign(approveForm, { amount: x.principal, tenureMonths: x.tenureMonths, interestRate: 0, start: months.value[0]?.value ?? '', note: '' });
  if (kind === 'reject') rejectNote.value = '';
  if (kind === 'disburse') Object.assign(disburseForm, { disbursedOn: today, reference: '' });
  if (kind === 'defer') Object.assign(deferForm, { start: months.value[1]?.value ?? months.value[0]?.value ?? '', note: '' });
  if (kind === 'repay') Object.assign(repayForm, { amount: x.outstanding, paidOn: today, note: '' });
  modal.value = kind;
}

async function act(fn: () => Promise<LoanDetail>, success: string) {
  reset();
  busy.value = true;
  try {
    loan.data.value = await fn();
    feedback.success(success);
    modal.value = null;
  } catch (e) {
    handle(e, 'Could not complete the action');
  } finally {
    busy.value = false;
  }
}
const approve = () =>
  act(
    () =>
      loansApi.approve(id.value, {
        amount: Number(approveForm.amount),
        tenureMonths: Number(approveForm.tenureMonths),
        ...(l.value!.type === 'LOAN' ? { interestRate: Number(approveForm.interestRate) } : {}),
        startYear: parseMonth(approveForm.start).year,
        startMonth: parseMonth(approveForm.start).month,
        note: approveForm.note || null,
      }),
    'Approved',
  );
const reject = () => act(() => loansApi.reject(id.value, rejectNote.value), 'Request turned down');
const disburse = () => act(() => loansApi.disburse(id.value, { disbursedOn: disburseForm.disbursedOn!, reference: disburseForm.reference }), 'Marked as paid out');
const defer = () => act(() => loansApi.defer(id.value, { startYear: parseMonth(deferForm.start).year, startMonth: parseMonth(deferForm.start).month, note: deferForm.note }), 'Deductions moved');
const repay = () => act(() => loansApi.repay(id.value, { amount: Number(repayForm.amount), paidOn: repayForm.paidOn!, note: repayForm.note }), 'Repayment recorded');
async function cancel() {
  if (!(await feedback.confirm({ title: `Cancel ${l.value?.reference}?`, message: 'Nothing will be paid out or deducted.', confirmLabel: 'Cancel it' }))) return;
  busy.value = true;
  try {
    loan.data.value = await loansApi.cancel(id.value);
    feedback.success('Cancelled');
  } catch (e) {
    feedback.error('Could not cancel it', e);
  } finally {
    busy.value = false;
  }
}
const period = (y: number, m: number) => `${MONTH_NAMES[m - 1]} ${y}`;
</script>

<template>
  <div>
    <AppSkeleton v-if="loan.loading.value && !l" :lines="8" />
    <AppErrorState v-else-if="loan.error.value" :error="loan.error.value" title="This loan isn't available" @retry="loan.run" />
    <template v-else-if="l">
      <AppPageHeader
        :title="`${LOAN_TYPE_LABELS[l.type]} · ${l.reference}`"
        :description="hr ? [l.employee?.name, l.employee?.employeeCode, l.employee?.department].filter(Boolean).join(' · ') : l.purpose"
        :back="hr ? '/hr/payroll/loans' : '/me/loans'"
        back-label="Loans & advances"
      >
        <template #badges><AppBadge :tone="loanTone[l.status]" dot>{{ LOAN_STATUS_LABELS[l.status] }}</AppBadge></template>
        <template #actions>
          <AppButton v-if="l.permissions.cancel" variant="ghost" :icon="Ban" :loading="busy && !modal" @click="cancel">Cancel</AppButton>
          <AppButton v-if="l.permissions.reject" variant="secondary" :icon="XCircle" @click="open('reject')">Turn down</AppButton>
          <AppButton v-if="l.permissions.approve" :icon="CheckCircle2" @click="open('approve')">Approve</AppButton>
          <AppButton v-if="l.permissions.disburse" :icon="Send" @click="open('disburse')">Mark paid out</AppButton>
          <AppButton v-if="l.permissions.defer" variant="secondary" :icon="CalendarClock" @click="open('defer')">Defer deductions</AppButton>
          <AppButton v-if="l.permissions.repay" variant="secondary" :icon="Wallet" @click="open('repay')">Record repayment</AppButton>
        </template>
      </AppPageHeader>
      <AppAlert v-if="l.status === 'REJECTED' && l.decisionNote" tone="warning" class="mb-4">Not approved by {{ l.decidedBy }}: {{ l.decisionNote }}</AppAlert>

      <div class="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AppStatCard label="Amount" :value="rupees(l.principal)" :icon="HandCoins" />
        <AppStatCard label="Monthly instalment" :value="l.emi ? rupees(l.emi) : '—'" :hint="`${l.tenureMonths} months${l.interestRate ? ` at ${l.interestRate}% a year` : l.emi ? ', interest-free' : ''}`" />
        <AppStatCard label="Repaid" :value="rupees(l.repaid)" :hint="l.interestPaid ? `plus ${rupees(l.interestPaid)} interest` : `${l.instalmentsPaid} instalment${l.instalmentsPaid === 1 ? '' : 's'}`" />
        <AppStatCard label="Still owed" :value="l.status === 'ACTIVE' || l.status === 'CLOSED' ? rupees(l.outstanding) : '—'" :hint="l.nextInstalment ? `next deduction ${rupees(l.nextInstalment.amount)}` : undefined" />
      </div>

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="space-y-4">
          <AppCard title="Repayment schedule" :description="l.schedule.length ? 'What payroll will deduct, month by month.' : undefined">
            <p v-if="!l.schedule.length" class="text-sm text-fg-muted">{{ l.status === 'CLOSED' ? 'Fully repaid.' : 'The schedule appears once the request is approved.' }}</p>
            <div v-else class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="text-left text-xs text-fg-muted">
                  <tr><th class="py-2 font-medium">Month</th><th class="py-2 text-right font-medium">Principal</th><th class="py-2 text-right font-medium">Interest</th><th class="py-2 text-right font-medium">Deduction</th><th class="py-2 text-right font-medium">Balance after</th></tr>
                </thead>
                <tbody class="divide-y divide-line">
                  <tr v-for="r in l.schedule" :key="`${r.year}-${r.month}`">
                    <td class="py-2 text-fg">{{ period(r.year, r.month) }}</td>
                    <td class="py-2 text-right tabular-nums">{{ rupees(r.principal, true) }}</td>
                    <td class="py-2 text-right tabular-nums">{{ rupees(r.interest, true) }}</td>
                    <td class="py-2 text-right font-medium tabular-nums">{{ rupees(r.amount, true) }}</td>
                    <td class="py-2 text-right text-fg-muted tabular-nums">{{ rupees(r.balance, true) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </AppCard>
          <AppCard title="Repayments">
            <p v-if="!l.repayments.length" class="text-sm text-fg-muted">Nothing repaid yet.</p>
            <ul v-else class="divide-y divide-line text-sm">
              <li v-for="r in l.repayments" :key="r.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p class="text-fg">{{ REPAYMENT_SOURCE_LABELS[r.source] }}{{ r.period ? ` · ${r.period} payroll` : '' }}</p>
                  <p class="text-xs text-fg-muted">{{ formatDate(r.paidOn) }}{{ r.note ? ` · ${r.note}` : '' }}</p>
                </div>
                <p class="text-right tabular-nums">
                  <span class="font-medium text-fg">{{ rupees(r.principal + r.interest, true) }}</span>
                  <span v-if="r.interest" class="block text-xs text-fg-muted">incl. {{ rupees(r.interest, true) }} interest</span>
                </p>
              </li>
            </ul>
          </AppCard>
        </div>
        <AppCard title="Details">
          <dl class="space-y-3 text-sm">
            <div><dt class="text-fg-muted">Purpose</dt><dd class="text-fg">{{ l.purpose }}</dd></div>
            <div><dt class="text-fg-muted">Requested</dt><dd class="text-fg">{{ formatDate(l.createdAt) }}{{ l.raisedBy ? ` · raised by ${l.raisedBy}` : '' }}</dd></div>
            <div v-if="l.decidedBy"><dt class="text-fg-muted">{{ l.status === 'REJECTED' ? 'Turned down' : 'Approved' }}</dt><dd class="text-fg">{{ l.decidedBy }}, {{ formatDate(l.decidedAt) }}<span v-if="l.decisionNote && l.status !== 'REJECTED'" class="block text-xs text-fg-muted">“{{ l.decisionNote }}”</span></dd></div>
            <div v-if="l.start"><dt class="text-fg-muted">Deductions from</dt><dd class="text-fg">{{ l.start.label }}</dd></div>
            <div v-if="l.disbursedOn"><dt class="text-fg-muted">Paid out</dt><dd class="text-fg">{{ formatDate(l.disbursedOn) }}{{ l.disbursementReference ? ` · ref ${l.disbursementReference}` : '' }}{{ l.disbursedBy ? ` · ${l.disbursedBy}` : '' }}</dd></div>
            <div v-if="l.closedAt"><dt class="text-fg-muted">Closed</dt><dd class="text-fg">{{ formatDate(l.closedAt) }}</dd></div>
          </dl>
        </AppCard>
      </div>

      <AppModal :open="modal === 'approve'" :title="`Approve ${l.reference}`" description="The instalment is fixed now and deducted by payroll from the month you choose, once the money is paid out." @close="modal = null">
        <form id="approve-loan" class="space-y-4" novalidate @submit.prevent="approve">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <div class="grid gap-4 sm:grid-cols-2">
            <AppInput v-model="approveForm.amount" label="Amount (₹)" type="number" :min="1000" :max="l.principal" required :help="`Requested ${rupees(l.principal)}`" :error="fieldErrors.amount" />
            <AppInput v-model="approveForm.tenureMonths" label="Repay over" type="number" :min="1" :max="l.type === 'ADVANCE' ? 12 : 60" suffix="months" required :error="fieldErrors.tenureMonths" />
            <AppInput v-if="l.type === 'LOAN'" v-model="approveForm.interestRate" label="Interest a year" type="number" :min="0" :max="30" :step="0.25" suffix="%" help="On the reducing balance; 0 for interest-free" :error="fieldErrors.interestRate" />
            <AppSelect v-model="approveForm.start" label="First deduction" :options="months" :clearable="false" :error="fieldErrors.startMonth" />
          </div>
          <AppTextarea v-model="approveForm.note" label="Note to the employee" :rows="2" :maxlength="1000" />
          <p v-if="previewEmi" class="rounded-xl bg-surface-muted/60 px-4 py-3 text-sm text-fg">Instalment <span class="font-semibold tabular-nums">{{ rupees(previewEmi) }}</span> a month for {{ approveForm.tenureMonths }} months.</p>
        </form>
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton type="submit" form="approve-loan" :loading="busy" :disabled="!approveForm.start">Approve</AppButton>
        </template>
      </AppModal>

      <AppModal :open="modal === 'reject'" :title="`Turn down ${l.reference}?`" size="sm" @close="modal = null">
        <AppAlert v-if="formError" class="mb-4">{{ formError }}</AppAlert>
        <AppTextarea v-model="rejectNote" label="Reason (shared with the employee)" required :rows="3" :maxlength="1000" :error="fieldErrors.note" />
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Keep it</AppButton>
          <AppButton variant="danger" :loading="busy" :disabled="rejectNote.trim().length < 3" @click="reject">Turn down</AppButton>
        </template>
      </AppModal>

      <AppModal :open="modal === 'disburse'" :title="`Pay out ${l.reference}`" :description="`${rupees(l.principal)} to ${l.employee?.name ?? 'the employee'}. Deductions start in ${l.start?.label}.`" size="sm" @close="modal = null">
        <div class="space-y-4">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppDatePicker v-model="disburseForm.disbursedOn" label="Paid on" required :max="today" :error="fieldErrors.disbursedOn" />
          <AppInput v-model="disburseForm.reference" label="Bank reference" required :maxlength="120" :error="fieldErrors.reference" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton :loading="busy" :disabled="!disburseForm.disbursedOn || disburseForm.reference.trim().length < 2" @click="disburse">Mark paid out</AppButton>
        </template>
      </AppModal>

      <AppModal :open="modal === 'defer'" :title="`Defer ${l.reference}`" description="Payroll deducts nothing until the month you choose." size="sm" @close="modal = null">
        <div class="space-y-4">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppSelect v-model="deferForm.start" label="Next deduction" :options="months" :clearable="false" :error="fieldErrors.startMonth" />
          <AppTextarea v-model="deferForm.note" label="Reason" required :rows="2" :maxlength="500" :error="fieldErrors.note" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton :loading="busy" :disabled="!deferForm.start || deferForm.note.trim().length < 3" @click="defer">Defer</AppButton>
        </template>
      </AppModal>

      <AppModal :open="modal === 'repay'" :title="`Repayment on ${l.reference}`" :description="`${rupees(l.outstanding)} is still owed. Paying it all closes the loan.`" size="sm" @close="modal = null">
        <div class="space-y-4">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppInput v-model="repayForm.amount" label="Amount (₹)" type="number" :min="1" :max="l.outstanding" required :error="fieldErrors.amount" />
          <AppDatePicker v-model="repayForm.paidOn" label="Paid on" required :max="today" :error="fieldErrors.paidOn" />
          <AppTextarea v-model="repayForm.note" label="How it was paid" required :rows="2" :maxlength="500" :error="fieldErrors.note" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="modal = null">Cancel</AppButton>
          <AppButton :loading="busy" :disabled="Number(repayForm.amount) <= 0 || !repayForm.paidOn || repayForm.note.trim().length < 3" @click="repay">Record</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
