<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Plus, Trash2 } from '@lucide/vue';
import type { InvoiceLineInput } from '@/modules/billing/api/billing.api';
import type { InvoiceRow, SubscriptionDetail } from '@/modules/billing/types';
import { CYCLE_LABELS, money } from '@/modules/billing/utils/billing';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/**
 * Drafts an invoice for a period (the plan line is added by the server) with extra lines, or edits a draft's lines.
 * Totals preview the server's arithmetic: discount on the subtotal, then tax.
 */
const props = defineProps<{
  open: boolean;
  subscription: SubscriptionDetail;
  invoice?: InvoiceRow | null;
  save: (body: { periodStart?: string; lines: InvoiceLineInput[]; taxRatePct?: number; notes: string }) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
const { fieldErrors, formError, handle, reset } = useFormErrors();

interface Line {
  description: string | number | null;
  quantity: string | number | null;
  unitPrice: string | number | null;
}
const lines = ref<Line[]>([]);
const periodStart = ref<string | undefined>(undefined);
const tax = ref<string | number | null>(18);
const notes = ref<string | null>('');
const saving = ref(false);
const editing = computed(() => !!props.invoice);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const i = props.invoice;
    lines.value = i ? i.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })) : [];
    periodStart.value = i ? undefined : (props.subscription.nextPeriodStart ?? undefined);
    tax.value = i ? i.taxRatePct : props.subscription.taxRatePct;
    notes.value = i?.notes ?? '';
  },
  { immediate: true },
);

const n = (v: string | number | null) => (v === '' || v === null ? 0 : Number(v));
const months = computed(() => (props.subscription.billingCycle === 'MONTHLY' ? 1 : props.subscription.billingCycle === 'QUARTERLY' ? 3 : 12));
const planLine = computed(() => (editing.value || props.subscription.pricePerMonth === null ? null : { quantity: months.value, unitPrice: props.subscription.pricePerMonth }));
const totals = computed(() => {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const subtotal = r2((planLine.value ? planLine.value.quantity * planLine.value.unitPrice : 0) + lines.value.reduce((s, l) => s + r2(n(l.quantity) * n(l.unitPrice)), 0));
  const discount = r2(Math.max(0, subtotal) * (props.subscription.discountPct / 100));
  const taxAmount = r2((subtotal - discount) * (n(tax.value) / 100));
  return { subtotal, discount, tax: taxAmount, total: r2(subtotal - discount + taxAmount) };
});
const valid = computed(() => lines.value.every((l) => String(l.description ?? '').trim().length >= 2 && n(l.quantity) > 0) && (editing.value ? lines.value.length > 0 : true));

function add() {
  lines.value.push({ description: '', quantity: 1, unitPrice: 0 });
}

async function submit() {
  reset();
  saving.value = true;
  try {
    await props.save({
      ...(periodStart.value && !editing.value ? { periodStart: periodStart.value } : {}),
      lines: lines.value.map((l) => ({ description: String(l.description ?? '').trim(), quantity: n(l.quantity), unitPrice: n(l.unitPrice) })),
      ...(editing.value ? { taxRatePct: n(tax.value) } : {}),
      notes: notes.value ?? '',
    });
    emit('close');
  } catch (e) {
    handle(e, 'Could not save the invoice');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="editing ? 'Edit draft invoice' : 'Draft an invoice'" :description="editing ? 'Change lines, tax or notes before issuing.' : `The ${subscription.plan?.name ?? ''} plan for one ${CYCLE_LABELS[subscription.billingCycle].toLowerCase()} cycle, plus any extra lines.`" size="lg" @close="emit('close')">
    <form id="invoice-editor" class="space-y-5" @submit.prevent="submit">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div v-if="!editing" class="grid gap-4 sm:grid-cols-2">
        <AppDatePicker v-model="periodStart" label="Period starts" :help="subscription.nextPeriodStart ? 'The subscription’s next period' : 'Defaults to the start of this month'" :error="fieldErrors.periodStart" />
        <div class="flex flex-col justify-center rounded-xl bg-surface-muted/60 px-4 py-3 text-sm">
          <span class="text-fg-muted">Plan line</span>
          <span v-if="planLine" class="font-medium text-fg tabular-nums">{{ planLine.quantity }} × {{ money(planLine.unitPrice, subscription.currency) }}</span>
          <span v-else class="font-medium text-danger-fg">Set a monthly price in the subscription terms first</span>
        </div>
      </div>

      <div>
        <div class="mb-2 flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-fg">{{ editing ? 'Lines' : 'Extra lines' }}</p>
          <AppButton size="sm" variant="secondary" :icon="Plus" @click="add">Add line</AppButton>
        </div>
        <p v-if="!lines.length" class="rounded-xl border border-dashed border-line px-4 py-4 text-center text-sm text-fg-muted">
          {{ editing ? 'Add at least one line.' : 'Add one-off charges (onboarding, extra seats) or a credit with a negative price.' }}
        </p>
        <ul v-else class="space-y-2">
          <li v-for="(l, i) in lines" :key="i" class="grid items-end gap-2 rounded-xl bg-surface-muted/40 p-3 ring-1 ring-line ring-inset sm:grid-cols-[minmax(0,1fr)_90px_140px_auto]">
            <AppInput v-model="l.description" label="Description" :error="fieldErrors[`lines.${i}.description`]" />
            <AppInput v-model="l.quantity" type="number" label="Qty" :min="0.01" :step="0.01" />
            <AppInput v-model="l.unitPrice" type="number" label="Unit price" :step="0.01" />
            <AppButton variant="ghost" :icon="Trash2" :aria-label="`Remove line ${i + 1}`" @click="lines.splice(i, 1)" />
          </li>
        </ul>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-4">
          <AppInput v-if="editing" v-model="tax" type="number" label="Tax (GST)" suffix="%" :min="0" :max="100" :step="0.01" :error="fieldErrors.taxRatePct" />
          <AppTextarea v-model="notes" label="Notes on the invoice" :rows="3" :error="fieldErrors.notes" />
        </div>
        <dl class="space-y-1.5 self-start rounded-xl bg-surface-muted/60 px-4 py-3 text-sm tabular-nums">
          <div class="flex justify-between"><dt class="text-fg-muted">Subtotal</dt><dd class="text-fg">{{ money(totals.subtotal, subscription.currency) }}</dd></div>
          <div v-if="totals.discount" class="flex justify-between"><dt class="text-fg-muted">Discount ({{ subscription.discountPct }}%)</dt><dd class="text-fg">−{{ money(totals.discount, subscription.currency) }}</dd></div>
          <div class="flex justify-between"><dt class="text-fg-muted">Tax ({{ editing ? n(tax) : subscription.taxRatePct }}%)</dt><dd class="text-fg">{{ money(totals.tax, subscription.currency) }}</dd></div>
          <div class="flex justify-between border-t border-line pt-1.5 font-semibold"><dt class="text-fg">Total</dt><dd class="text-fg">{{ money(totals.total, subscription.currency) }}</dd></div>
        </dl>
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="invoice-editor" :loading="saving" :disabled="!valid || (!editing && !planLine)">{{ editing ? 'Save draft' : 'Create draft' }}</AppButton>
    </template>
  </AppModal>
</template>
