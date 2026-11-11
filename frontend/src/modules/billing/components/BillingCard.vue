<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronDown, Download, Receipt, Save } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { billingApi } from '@/modules/billing/api/billing.api';
import InvoiceDetail from '@/modules/billing/components/InvoiceDetail.vue';
import InvoiceStatusBadge from '@/modules/billing/components/InvoiceStatusBadge.vue';
import { CYCLE_LABELS, CYCLE_UNIT, SUBSCRIPTION_LABELS, SUBSCRIPTION_TONES, money, periodLabel } from '@/modules/billing/utils/billing';
import type { InvoiceRow } from '@/modules/billing/types';
import { AppAlert, AppBadge, AppButton, AppErrorState, AppInput, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** The organization's own billing: what it pays, what's due, its invoices (PDF) and who invoices go to. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const billing = useAsync(() => billingApi.mine());
const canEdit = computed(() => auth.can('billing.manage'));
const sub = computed(() => billing.data.value?.subscription ?? null);
const open = ref<string | null>(null);

const name = ref<string | number | null>('');
const email = ref<string | number | null>('');
const taxId = ref<string | number | null>('');
const address = ref<string | null>('');
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
watch(
  sub,
  (s) => {
    if (!s) return;
    name.value = s.contact.billingName ?? '';
    email.value = s.contact.billingEmail ?? '';
    taxId.value = s.contact.billingTaxId ?? '';
    address.value = s.contact.billingAddress ?? '';
  },
  { immediate: true },
);
const str = (v: string | number | null) => (v === null ? '' : String(v));
const dirty = computed(
  () =>
    !!sub.value &&
    (str(name.value) !== (sub.value.contact.billingName ?? '') || str(email.value) !== (sub.value.contact.billingEmail ?? '') || str(taxId.value) !== (sub.value.contact.billingTaxId ?? '') || (address.value ?? '') !== (sub.value.contact.billingAddress ?? '')),
);

async function saveContact() {
  reset();
  saving.value = true;
  try {
    billing.data.value = await billingApi.updateContact({ billingName: str(name.value), billingEmail: str(email.value), billingTaxId: str(taxId.value), billingAddress: address.value ?? '' });
    feedback.success('Billing contact saved');
  } catch (e) {
    handle(e, 'Could not save the billing contact');
  } finally {
    saving.value = false;
  }
}

async function download(i: InvoiceRow) {
  try {
    await billingApi.pdf(i);
  } catch (e) {
    feedback.error('Could not download the invoice', e);
  }
}
</script>

<template>
  <section class="card" aria-labelledby="billing-title">
    <header class="flex min-h-14 flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 ring-1 ring-emerald-600/15 ring-inset dark:bg-emerald-500/15 dark:text-emerald-300" aria-hidden="true"><Receipt :size="17" /></span>
      <div class="min-w-0 flex-1 basis-52">
        <h2 id="billing-title" class="text-sm font-semibold text-fg">Billing</h2>
        <p class="text-xs text-fg-muted">What you pay, what's due and your invoices. Pay by bank transfer or UPI; payments are recorded by the HRMS team.</p>
      </div>
    </header>
    <div class="space-y-6 px-5 py-6">
      <AppSkeleton v-if="billing.loading.value && !billing.data.value" :lines="6" />
      <AppErrorState v-else-if="billing.error.value" :error="billing.error.value" @retry="billing.run" />
      <template v-else-if="sub && billing.data.value">
        <AppAlert v-if="billing.data.value.overdue" tone="error" :title="`${money(billing.data.value.overdue, sub.currency)} is overdue`">Please pay the overdue invoices below to keep your subscription in good standing.</AppAlert>

        <dl class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-xl bg-surface-muted/50 px-4 py-3 ring-1 ring-line/60 ring-inset">
            <dt class="text-xs text-fg-muted">Status</dt>
            <dd class="mt-1"><AppBadge :tone="SUBSCRIPTION_TONES[sub.status]" dot>{{ SUBSCRIPTION_LABELS[sub.status] }}</AppBadge></dd>
            <dd v-if="sub.status === 'TRIAL' && sub.trialEndsOn" class="mt-1 text-xs text-fg-muted">Trial ends {{ formatDate(sub.trialEndsOn) }}</dd>
          </div>
          <div class="rounded-xl bg-surface-muted/50 px-4 py-3 ring-1 ring-line/60 ring-inset">
            <dt class="text-xs text-fg-muted">{{ CYCLE_LABELS[sub.billingCycle] }} charge</dt>
            <dd class="mt-0.5 text-lg font-semibold text-fg tabular-nums">{{ money(sub.cycleAmount, sub.currency) }}</dd>
            <dd class="text-xs text-fg-muted">{{ sub.cycleAmount === null ? 'Custom pricing' : `per ${CYCLE_UNIT[sub.billingCycle]} + GST ${sub.taxRatePct}%` }}<template v-if="sub.discountPct"> · {{ sub.discountPct }}% off</template></dd>
          </div>
          <div class="rounded-xl bg-surface-muted/50 px-4 py-3 ring-1 ring-line/60 ring-inset">
            <dt class="text-xs text-fg-muted">Balance due</dt>
            <dd :class="['mt-0.5 text-lg font-semibold tabular-nums', billing.data.value.overdue ? 'text-danger-fg' : 'text-fg']">{{ money(billing.data.value.balanceDue, sub.currency) }}</dd>
          </div>
          <div class="rounded-xl bg-surface-muted/50 px-4 py-3 ring-1 ring-line/60 ring-inset">
            <dt class="text-xs text-fg-muted">Next invoice</dt>
            <dd class="mt-0.5 text-lg font-semibold text-fg">{{ sub.status === 'CANCELLED' ? '—' : formatDate(sub.nextPeriodStart) }}</dd>
          </div>
        </dl>

        <div>
          <p class="mb-2 text-sm font-semibold text-fg">Invoices</p>
          <p v-if="!billing.data.value.invoices.length" class="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-fg-muted">No invoices yet. They appear here once issued.</p>
          <ul v-else class="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
            <li v-for="i in billing.data.value.invoices" :key="i.id">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <button type="button" class="flex min-w-0 flex-1 basis-48 items-center gap-2 text-start" :aria-expanded="open === i.id" @click="open = open === i.id ? null : i.id">
                  <ChevronDown :size="15" :class="['shrink-0 text-fg-subtle transition-transform', open === i.id && 'rotate-180']" aria-hidden="true" />
                  <span class="min-w-0">
                    <span class="block font-mono text-xs font-medium text-fg">{{ i.number }}</span>
                    <span class="block text-sm text-fg-muted">{{ periodLabel(i.periodStart, i.periodEnd) }}</span>
                  </span>
                </button>
                <InvoiceStatusBadge :invoice="i" />
                <span class="w-28 text-end text-xs text-fg-muted">{{ i.status === 'PAID' ? `Paid ${formatDate(i.paidAt)}` : i.status === 'ISSUED' ? `Due ${formatDate(i.dueDate)}` : '' }}</span>
                <span class="w-28 text-end font-semibold text-fg tabular-nums">{{ money(i.total, i.currency) }}</span>
                <AppButton size="sm" variant="ghost" :icon="Download" :aria-label="`Download ${i.number}`" @click="download(i)" />
              </div>
              <div v-if="open === i.id" class="border-t border-line/70 bg-surface-muted/20 px-4 py-4"><InvoiceDetail :invoice="i" /></div>
            </li>
          </ul>
        </div>

        <form class="space-y-4" @submit.prevent="saveContact">
          <div>
            <p class="text-sm font-semibold text-fg">Billing contact</p>
            <p class="text-xs text-fg-muted">Invoices are addressed and emailed to these details. Empty fields use your company profile.</p>
          </div>
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <div class="grid gap-4 sm:grid-cols-2">
            <AppInput v-model="name" label="Bill to" :placeholder="sub.billTo.name" :disabled="!canEdit" :error="fieldErrors.billingName" />
            <AppInput v-model="email" type="email" label="Billing email" :placeholder="sub.billTo.email ?? 'accounts@company.com'" :disabled="!canEdit" :error="fieldErrors.billingEmail" />
            <AppInput v-model="taxId" label="GSTIN" :placeholder="sub.billTo.taxId ?? ''" :disabled="!canEdit" :error="fieldErrors.billingTaxId" />
            <AppTextarea v-model="address" label="Billing address" :rows="2" :placeholder="sub.billTo.address ?? ''" :disabled="!canEdit" :error="fieldErrors.billingAddress" />
          </div>
          <div v-if="canEdit" class="flex justify-end">
            <AppButton type="submit" :icon="Save" :loading="saving" :disabled="!dirty">Save contact</AppButton>
          </div>
        </form>
      </template>
    </div>
  </section>
</template>
