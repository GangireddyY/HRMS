<script setup lang="ts">
import { ref, watch } from 'vue';
import { PAYMENT_METHODS, type PaymentMethod } from '@contracts';
import type { InvoiceRow } from '@/modules/billing/types';
import { METHOD_LABELS, money } from '@/modules/billing/utils/billing';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { localToday } from '@/shared/utils/dates';

/** A payment received against an issued invoice: the full balance by default, or part of it. */
const props = defineProps<{ open: boolean; invoice: InvoiceRow | null; save: (body: { amount: number; paidOn: string; method: PaymentMethod; reference?: string; note?: string }) => Promise<void> }>();
const emit = defineEmits<{ close: [] }>();
const { fieldErrors, formError, handle, reset } = useFormErrors();

const amount = ref<string | number | null>(null);
const paidOn = ref<string | undefined>(undefined);
const method = ref<PaymentMethod>('BANK_TRANSFER');
const reference = ref<string | number | null>('');
const note = ref<string | number | null>('');
const saving = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open || !props.invoice) return;
    reset();
    amount.value = props.invoice.balance;
    paidOn.value = localToday();
    method.value = 'BANK_TRANSFER';
    reference.value = '';
    note.value = '';
  },
  { immediate: true },
);

async function submit() {
  reset();
  saving.value = true;
  try {
    await props.save({ amount: Number(amount.value), paidOn: paidOn.value ?? localToday(), method: method.value, ...(reference.value ? { reference: String(reference.value) } : {}), ...(note.value ? { note: String(note.value) } : {}) });
    emit('close');
  } catch (e) {
    handle(e, 'Could not record the payment');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Record a payment" :description="invoice ? `${invoice.number} · balance due ${money(invoice.balance, invoice.currency)}` : ''" dialog @close="emit('close')">
    <form id="record-payment" class="grid gap-4 sm:grid-cols-2" @submit.prevent="submit">
      <AppAlert v-if="formError" class="sm:col-span-2">{{ formError }}</AppAlert>
      <AppInput v-model="amount" type="number" label="Amount received" :min="0.01" :step="0.01" :error="fieldErrors.amount" required />
      <AppDatePicker v-model="paidOn" label="Received on" :error="fieldErrors.paidOn" />
      <AppSelect v-model="method" label="Method" :options="PAYMENT_METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }))" :error="fieldErrors.method" />
      <AppInput v-model="reference" label="Reference" placeholder="UTR, cheque no." :maxlength="100" :error="fieldErrors.reference" />
      <AppInput v-model="note" class="sm:col-span-2" label="Note" :maxlength="500" :error="fieldErrors.note" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="record-payment" :loading="saving" :disabled="!amount || Number(amount) <= 0">Record payment</AppButton>
    </template>
  </AppModal>
</template>
