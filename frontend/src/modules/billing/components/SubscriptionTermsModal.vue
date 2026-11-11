<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { BILLING_CYCLES, SUBSCRIPTION_STATUSES, type BillingCycle, type SubscriptionStatus } from '@contracts';
import type { SubscriptionDetail } from '@/modules/billing/types';
import { CYCLE_LABELS, SUBSCRIPTION_LABELS, money } from '@/modules/billing/utils/billing';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSegmented, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Subscription terms on top of the plan: status, cycle, seat and price overrides, discount, tax, terms, contact. */
const props = defineProps<{ open: boolean; subscription: SubscriptionDetail; save: (body: Record<string, unknown>) => Promise<void> }>();
const emit = defineEmits<{ close: [] }>();
const { fieldErrors, formError, handle, reset } = useFormErrors();

const status = ref<SubscriptionStatus>('TRIAL');
const cycle = ref<BillingCycle>('MONTHLY');
const seats = ref<string | number | null>(null);
const price = ref<string | number | null>(null);
const discount = ref<string | number | null>(0);
const tax = ref<string | number | null>(18);
const terms = ref<string | number | null>(15);
const trialEndsOn = ref<string | undefined>(undefined);
const nextPeriodStart = ref<string | undefined>(undefined);
const billingName = ref<string | number | null>('');
const billingEmail = ref<string | number | null>('');
const billingAddress = ref<string | null>('');
const billingTaxId = ref<string | number | null>('');
const notes = ref<string | null>('');
const saving = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const s = props.subscription;
    status.value = s.status;
    cycle.value = s.billingCycle;
    seats.value = s.seats.override;
    price.value = s.priceOverride;
    discount.value = s.discountPct;
    tax.value = s.taxRatePct;
    terms.value = s.paymentTermsDays;
    trialEndsOn.value = s.trialEndsOn ?? undefined;
    nextPeriodStart.value = s.nextPeriodStart ?? undefined;
    billingName.value = s.contact.billingName ?? '';
    billingEmail.value = s.contact.billingEmail ?? '';
    billingAddress.value = s.contact.billingAddress ?? '';
    billingTaxId.value = s.contact.billingTaxId ?? '';
    notes.value = s.notes ?? '';
  },
  { immediate: true },
);

const numOrNull = (v: string | number | null | undefined) => (v === '' || v === null || v === undefined ? null : Number(v));
const text = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const planPrice = computed(() => props.subscription.plan?.monthlyPrice ?? null);
const preview = computed(() => {
  const p = numOrNull(price.value) ?? planPrice.value;
  if (p === null) return null;
  const months = cycle.value === 'MONTHLY' ? 1 : cycle.value === 'QUARTERLY' ? 3 : 12;
  const net = p * months * (1 - (numOrNull(discount.value) ?? 0) / 100);
  return { net, gross: net * (1 + (numOrNull(tax.value) ?? 0) / 100) };
});

async function submit() {
  reset();
  saving.value = true;
  try {
    await props.save({
      status: status.value,
      billingCycle: cycle.value,
      seats: numOrNull(seats.value),
      pricePerMonth: numOrNull(price.value),
      discountPct: numOrNull(discount.value) ?? 0,
      taxRatePct: numOrNull(tax.value) ?? 0,
      paymentTermsDays: numOrNull(terms.value) ?? 0,
      trialEndsOn: trialEndsOn.value ?? null,
      nextPeriodStart: nextPeriodStart.value ?? null,
      billingName: text(billingName.value),
      billingEmail: text(billingEmail.value),
      billingAddress: billingAddress.value ?? '',
      billingTaxId: text(billingTaxId.value),
      notes: notes.value ?? '',
    });
    emit('close');
  } catch (e) {
    handle(e, 'Could not save the subscription');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Subscription terms" description="Overrides apply on top of the plan; leave a field empty to follow the plan." size="lg" @close="emit('close')">
    <form id="subscription-terms" class="space-y-6" @submit.prevent="submit">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <fieldset class="grid gap-4 sm:grid-cols-2">
        <legend class="mb-3 text-sm font-semibold text-fg">Plan and price</legend>
        <AppSelect v-model="status" label="Status" :options="SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: SUBSCRIPTION_LABELS[s] }))" :error="fieldErrors.status" />
        <div>
          <p class="mb-1.5 text-sm font-medium text-fg">Billing cycle</p>
          <AppSegmented v-model="cycle" label="Billing cycle" :options="BILLING_CYCLES.map((c) => ({ value: c, label: CYCLE_LABELS[c] }))" />
        </div>
        <AppInput v-model="price" type="number" label="Price per month" :min="0" :step="0.01" :help="planPrice === null ? 'The plan has custom pricing: set a price to invoice' : `Plan price: ${money(planPrice, subscription.currency)}`" :error="fieldErrors.pricePerMonth" />
        <AppInput v-model="seats" type="number" label="Seats" :min="1" :help="`Plan limit: ${subscription.plan?.maxUsers ?? 'unlimited'} · ${subscription.seats.used} in use`" :error="fieldErrors.seats" />
        <AppInput v-model="discount" type="number" label="Discount" suffix="%" :min="0" :max="100" :step="0.01" :error="fieldErrors.discountPct" />
        <AppInput v-model="tax" type="number" label="Tax (GST)" suffix="%" :min="0" :max="100" :step="0.01" :error="fieldErrors.taxRatePct" />
        <AppInput v-model="terms" type="number" label="Payment terms" suffix="days" :min="0" :max="90" :error="fieldErrors.paymentTermsDays" />
        <AppDatePicker v-model="trialEndsOn" label="Trial ends" :error="fieldErrors.trialEndsOn" />
        <AppDatePicker v-model="nextPeriodStart" label="Next period starts" help="The next invoice covers the cycle from this date" :error="fieldErrors.nextPeriodStart" />
        <div v-if="preview" class="flex flex-col justify-center rounded-xl bg-surface-muted/60 px-4 py-3 text-sm">
          <span class="text-fg-muted">Each {{ CYCLE_LABELS[cycle].toLowerCase() }} invoice</span>
          <span class="font-semibold text-fg tabular-nums">{{ money(preview.gross, subscription.currency) }} <span class="font-normal text-fg-muted">incl. tax · {{ money(preview.net, subscription.currency) }} before</span></span>
        </div>
      </fieldset>
      <fieldset class="grid gap-4 sm:grid-cols-2">
        <legend class="mb-3 text-sm font-semibold text-fg">Billing contact</legend>
        <AppInput v-model="billingName" label="Bill to" :placeholder="subscription.billTo.name" :error="fieldErrors.billingName" />
        <AppInput v-model="billingEmail" type="email" label="Billing email" help="Issued invoices are emailed here" :error="fieldErrors.billingEmail" />
        <AppInput v-model="billingTaxId" label="GSTIN" :error="fieldErrors.billingTaxId" />
        <AppTextarea v-model="billingAddress" label="Billing address" :rows="2" :error="fieldErrors.billingAddress" />
      </fieldset>
      <AppTextarea v-model="notes" label="Internal notes" help="Only the platform team sees these" :rows="2" :error="fieldErrors.notes" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="subscription-terms" :loading="saving">Save terms</AppButton>
    </template>
  </AppModal>
</template>
