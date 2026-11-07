<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Banknote, Calculator, Check, Plus, Printer, Send, Trash2, Undo2 } from '@lucide/vue';
import { DAILY_RATE_BASES, type DailyRateBasis } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { exitApi } from '@/modules/exit/api/exit.api';
import SettlementStatement from '@/modules/exit/components/SettlementStatement.vue';
import type { Adjustment, ExitDetail, Settlement } from '@/modules/exit/types';
import { BASIS_LABELS, inr, localIso, serviceLabel } from '@/modules/exit/utils/exit-format';
import { AppAlert, AppButton, AppCard, AppCheckbox, AppDatePicker, AppErrorState, AppInput, AppModal, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime } from '@/shared/utils/format';

/** Works out the full & final settlement and takes it through submission, approval (by someone else) and payment. */
const props = defineProps<{ exit: ExitDetail }>();
const emit = defineEmits<{ changed: [] }>();

const auth = useAuthStore();
const feedback = useFeedbackStore();
const settlement = useAsync(() => exitApi.settlement(props.exit.id));
const s = computed(() => settlement.data.value);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ encashmentBasis: 'BASIC_26' as DailyRateBasis, noticeBasis: 'GROSS_30' as DailyRateBasis, includeGratuity: null as boolean | null, gratuityNote: '', adjustments: [] as { label: string; kind: 'EARNING' | 'DEDUCTION'; amount: string | number }[] });
watch(
  s,
  (v) => {
    if (!v) return;
    Object.assign(form, {
      encashmentBasis: v.encashmentBasis ?? 'BASIC_26',
      noticeBasis: v.noticeBasis ?? 'GROSS_30',
      includeGratuity: v.includeGratuity ?? null,
      gratuityNote: v.gratuityNote ?? '',
      adjustments: (v.adjustments ?? []).map((a) => ({ ...a })),
    });
  },
  { immediate: true },
);
const basisOptions = DAILY_RATE_BASES.map((b) => ({ value: b, label: BASIS_LABELS[b] }));
const kindOptions = [
  { value: 'EARNING', label: 'Earning' },
  { value: 'DEDUCTION', label: 'Deduction' },
];
const editable = computed(() => !s.value || s.value.permissions?.calculate);
const busy = ref<string | null>(null);
async function calculate() {
  reset();
  busy.value = 'calc';
  try {
    const adjustments: Adjustment[] = form.adjustments.filter((a) => a.label.trim() && Number(a.amount) > 0).map((a) => ({ label: a.label, kind: a.kind, amount: Number(a.amount) }));
    settlement.data.value = await exitApi.calculate(props.exit.id, {
      encashmentBasis: form.encashmentBasis,
      noticeBasis: form.noticeBasis,
      ...(form.includeGratuity === null ? {} : { includeGratuity: form.includeGratuity }),
      gratuityNote: form.gratuityNote || null,
      adjustments,
    });
    feedback.success('Settlement worked out');
    emit('changed');
  } catch (e) {
    handle(e, 'Could not work out the settlement');
  } finally {
    busy.value = null;
  }
}
async function act(key: string, fn: () => Promise<Settlement>, success: string) {
  busy.value = key;
  try {
    settlement.data.value = await fn();
    feedback.success(success);
    emit('changed');
    return true;
  } catch (e) {
    feedback.error('Could not complete the action', e);
    return false;
  } finally {
    busy.value = null;
  }
}
const returning = ref(false);
const returnNote = ref('');
const paying = ref(false);
const pay = reactive({ paidOn: localIso(new Date()) as string | undefined, reference: '' });
async function submit() {
  if (!(await feedback.confirm({ title: 'Submit the settlement?', message: 'Someone else with settlement access approves it. Recoveries and the last working day are then fixed.', confirmLabel: 'Submit' }))) return;
  await act('submit', () => exitApi.submitSettlement(props.exit.id), 'Settlement submitted');
}
async function approve() {
  if (!(await feedback.confirm({ title: `Approve ${inr(s.value!.netPayable)}?`, message: 'Encashed leave is taken off the balance and the employee can see the statement.', confirmLabel: 'Approve' }))) return;
  await act('approve', () => exitApi.approveSettlement(props.exit.id), 'Settlement approved');
}
const gratuityEligible = computed(() => s.value?.inputs?.gratuity.eligible ?? null);
const print = () => window.print();
</script>

<template>
  <div class="space-y-4">
    <AppSkeleton v-if="settlement.loading.value && !s" :lines="6" />
    <AppErrorState v-else-if="settlement.error.value" :error="settlement.error.value" @retry="settlement.run" />
    <template v-else>
      <AppAlert v-if="s?.returnedNote && s.status === 'DRAFT'" tone="warning" title="Sent back">{{ s.returnedNote }}</AppAlert>
      <AppCard v-if="editable" title="Work out the settlement" description="Leave encashment, gratuity, notice pay and clearance recoveries are calculated; add anything else (e.g. a bonus or TDS) below.">
        <form id="settlement-form" class="space-y-4" novalidate @submit.prevent="calculate">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <div class="grid gap-4 sm:grid-cols-2">
            <AppSelect v-model="form.encashmentBasis" label="Leave encashment rate" :options="basisOptions" :clearable="false" />
            <AppSelect v-model="form.noticeBasis" label="Notice pay rate" :options="basisOptions" :clearable="false" />
          </div>
          <div v-if="s?.inputs" class="rounded-xl p-3 text-sm ring-1 ring-line">
            <p class="text-fg">{{ s.inputs.gratuity.basis }} · counted as {{ s.inputs.gratuityYears }} year{{ s.inputs.gratuityYears === 1 ? '' : 's' }} ({{ serviceLabel(s.inputs.service) }})</p>
            <AppCheckbox class="mt-2" :model-value="form.includeGratuity ?? gratuityEligible ?? false" label="Pay gratuity" @update:model-value="(v: boolean) => (form.includeGratuity = v)" />
            <AppTextarea v-if="(form.includeGratuity ?? gratuityEligible) !== gratuityEligible" v-model="form.gratuityNote" class="mt-2" label="Why the eligibility is overridden" required :rows="2" :maxlength="1000" :error="fieldErrors.gratuityNote" />
          </div>
          <div>
            <div class="mb-2 flex items-center justify-between">
              <p class="label mb-0">Other earnings and deductions</p>
              <AppButton size="sm" variant="ghost" :icon="Plus" :disabled="form.adjustments.length >= 30" @click="form.adjustments.push({ label: '', kind: 'DEDUCTION', amount: '' })">Add line</AppButton>
            </div>
            <p v-if="!form.adjustments.length" class="text-sm text-fg-muted">None. Add the income tax (TDS) on the settlement worked out by payroll, bonuses or loan recoveries.</p>
            <div v-for="(a, i) in form.adjustments" :key="i" class="mb-2 grid items-start gap-2 sm:grid-cols-[1fr_160px_160px_auto]">
              <AppInput v-model="a.label" :aria-label="`Line ${i + 1} description`" placeholder="e.g. Income tax (TDS)" :maxlength="120" />
              <AppSelect v-model="a.kind" :aria-label="`Line ${i + 1} type`" :options="kindOptions" :clearable="false" />
              <AppInput v-model="a.amount" :aria-label="`Line ${i + 1} amount`" type="number" :min="0" placeholder="₹" />
              <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove line ${i + 1}`" @click="form.adjustments.splice(i, 1)" />
            </div>
          </div>
        </form>
        <template #footer>
          <div class="flex flex-wrap justify-end gap-2">
            <AppButton type="submit" form="settlement-form" variant="secondary" :icon="Calculator" :loading="busy === 'calc'">{{ s ? 'Recalculate' : 'Work out settlement' }}</AppButton>
            <AppButton v-if="s?.permissions?.submit" :icon="Send" :loading="busy === 'submit'" @click="submit">Submit for approval</AppButton>
          </div>
        </template>
      </AppCard>

      <template v-if="s">
        <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p class="text-xs text-fg-muted">
            <template v-if="s.calculatedBy">Worked out by {{ s.calculatedBy }}{{ s.calculatedAt ? `, ${formatDateTime(s.calculatedAt)}` : '' }}</template>
            <template v-if="s.submittedBy"> · submitted by {{ s.submittedBy }}</template>
            <template v-if="s.approvedBy"> · approved by {{ s.approvedBy }}</template>
            <template v-if="s.inputs"> · Basic {{ inr(s.inputs.monthlyBasic) }}, gross {{ inr(s.inputs.monthlyGross) }} a month (salary from {{ formatDate(s.inputs.salaryEffectiveFrom) }}); leave as of {{ formatDate(s.inputs.asOf) }}</template>
          </p>
          <div class="flex flex-wrap gap-2">
            <AppButton v-if="s.permissions?.returnToDraft" variant="secondary" :icon="Undo2" @click="returning = true">Send back</AppButton>
            <AppButton v-if="s.permissions?.approve" :icon="Check" :loading="busy === 'approve'" @click="approve">Approve</AppButton>
            <AppButton v-if="s.permissions?.pay" :icon="Banknote" @click="paying = true">Mark paid</AppButton>
            <AppButton variant="secondary" :icon="Printer" @click="print">Print</AppButton>
          </div>
        </div>
        <SettlementStatement :settlement="s" :organization="auth.organization?.name" />
      </template>
    </template>

    <AppModal :open="returning" title="Send the settlement back" size="sm" @close="returning = false">
      <AppTextarea v-model="returnNote" label="What needs to change" required :rows="3" :maxlength="1000" />
      <template #footer>
        <AppButton variant="secondary" @click="returning = false">Cancel</AppButton>
        <AppButton :loading="busy === 'return'" :disabled="returnNote.trim().length < 3" @click="act('return', () => exitApi.returnSettlement(exit.id, returnNote), 'Sent back').then((ok) => ok && (returning = false))">Send back</AppButton>
      </template>
    </AppModal>
    <AppModal :open="paying" title="Mark the settlement paid" size="sm" @close="paying = false">
      <div class="space-y-4">
        <AppDatePicker v-model="pay.paidOn" label="Paid on" required :max="localIso(new Date())" />
        <AppInput v-model="pay.reference" label="Payment reference" required :maxlength="120" placeholder="Bank transfer (UTR) number" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="paying = false">Cancel</AppButton>
        <AppButton :loading="busy === 'pay'" :disabled="!pay.paidOn || pay.reference.trim().length < 2" @click="act('pay', () => exitApi.paySettlement(exit.id, { paidOn: pay.paidOn!, reference: pay.reference }), 'Settlement paid').then((ok) => ok && (paying = false))">Save</AppButton>
      </template>
    </AppModal>
  </div>
</template>
