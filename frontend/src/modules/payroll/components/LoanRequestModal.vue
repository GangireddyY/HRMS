<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ADVANCE_MAX_TENURE_MONTHS, LOAN_MAX_TENURE_MONTHS, LOAN_TYPES, type LoanType } from '@contracts';
import { loansApi } from '@/modules/payroll/api/payroll.api';
import type { LoanDetail } from '@/modules/payroll/types';
import { LOAN_TYPE_LABELS, loanEmi, rupees } from '@/modules/payroll/utils/payroll-format';
import { employeesApi } from '@/modules/people/api/people.api';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import type { Colleague } from '@/modules/performance/types';
import { AppAlert, AppButton, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Request a loan or salary advance — for yourself, or (payroll) on an employee's behalf. Someone else approves it. */
const props = defineProps<{ open: boolean; onBehalf?: boolean }>();
const emit = defineEmits<{ close: []; saved: [loan: LoanDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ employeeId: null as string | null, type: 'ADVANCE' as LoanType, amount: '' as string | number, tenureMonths: 3 as string | number, purpose: '' });
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, { employeeId: null, type: 'ADVANCE', amount: '', tenureMonths: 3, purpose: '' });
  },
);
const typeOptions = LOAN_TYPES.map((t) => ({ value: t, label: LOAN_TYPE_LABELS[t], description: t === 'ADVANCE' ? `Interest-free, repaid within ${ADVANCE_MAX_TENURE_MONTHS} months` : `Up to ${LOAN_MAX_TENURE_MONTHS} months; interest set on approval` }));
const maxTenure = computed(() => (form.type === 'ADVANCE' ? ADVANCE_MAX_TENURE_MONTHS : LOAN_MAX_TENURE_MONTHS));
const emi = computed(() => loanEmi(Number(form.amount), 0, Number(form.tenureMonths)));
const search = async (q: string): Promise<Colleague[]> =>
  (await employeesApi.list({ page: 1, pageSize: 20, search: q || undefined, status: 'ACTIVE' })).items.map((e) => ({ id: e.id, name: e.fullName, employeeCode: e.employeeCode, department: e.department?.name ?? null, designation: e.designation?.name ?? null }));
const canSave = computed(() => (!props.onBehalf || !!form.employeeId) && Number(form.amount) >= 1000 && Number(form.tenureMonths) >= 1 && form.purpose.trim().length >= 3);
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  try {
    const body = { type: form.type, amount: Number(form.amount), tenureMonths: Number(form.tenureMonths), purpose: form.purpose };
    emit('saved', props.onBehalf ? await loansApi.raise({ ...body, employeeId: form.employeeId! }) : await loansApi.request(body));
  } catch (e) {
    handle(e, 'Could not send the request');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="onBehalf ? 'Raise a loan or advance' : 'Request a loan or advance'" description="Once approved and paid out, the instalment is deducted from the monthly salary." @close="emit('close')">
    <form id="loan-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <ColleaguePicker v-if="onBehalf" v-model:value="form.employeeId" label="Employee" required :source="search" />
      <AppSelect v-model="form.type" label="Type" :options="typeOptions" :clearable="false" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.amount" label="Amount (₹)" type="number" :min="1000" required :error="fieldErrors.amount" />
        <AppInput v-model="form.tenureMonths" label="Repay over" type="number" :min="1" :max="maxTenure" suffix="months" required :error="fieldErrors.tenureMonths" />
      </div>
      <AppTextarea v-model="form.purpose" label="What is it for?" required :rows="2" :maxlength="500" :error="fieldErrors.purpose" />
      <p v-if="emi" class="rounded-xl bg-surface-muted/60 px-4 py-3 text-sm text-fg">
        About <span class="font-semibold tabular-nums">{{ rupees(emi) }}</span> a month for {{ form.tenureMonths }} months{{ form.type === 'ADVANCE' ? ', interest-free' : ' before interest (set by the approver)' }}.
      </p>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="loan-form" :loading="saving" :disabled="!canSave">Send for approval</AppButton>
    </template>
  </AppModal>
</template>
