<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, Ban, CreditCard, Download, FilePlus2, Mail, Pencil, ReceiptText, Send, Trash2, Users, Wallet } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { platformBillingApi, type InvoiceLineInput } from '@/modules/billing/api/billing.api';
import InvoiceDetail from '@/modules/billing/components/InvoiceDetail.vue';
import InvoiceEditorModal from '@/modules/billing/components/InvoiceEditorModal.vue';
import InvoiceStatusBadge from '@/modules/billing/components/InvoiceStatusBadge.vue';
import RecordPaymentModal from '@/modules/billing/components/RecordPaymentModal.vue';
import SubscriptionTermsModal from '@/modules/billing/components/SubscriptionTermsModal.vue';
import type { InvoiceRow } from '@/modules/billing/types';
import { CYCLE_LABELS, CYCLE_UNIT, SUBSCRIPTION_LABELS, SUBSCRIPTION_TONES, money, periodLabel } from '@/modules/billing/utils/billing';
import { AppAlert, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { errorMessage } from '@/core/http/http-client';
import { appLocale } from '@/core/locale/locale';
import { formatDate } from '@/shared/utils/format';

/** One organization's billing (platform): terms, seats, contact; invoices from draft to paid. */
const route = useRoute();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const billing = useAsync(() => platformBillingApi.organization(id.value));
const canManage = computed(() => auth.canPlatform('platform.billing.manage'));
const sub = computed(() => billing.data.value?.subscription ?? null);
const num = (n: number) => n.toLocaleString(appLocale());
const seatShare = computed(() => (sub.value?.seats.limit ? Math.min(100, (sub.value.seats.used / sub.value.seats.limit) * 100) : null));

const termsOpen = ref(false);
async function saveTerms(body: Record<string, unknown>) {
  billing.data.value = await platformBillingApi.updateSubscription(id.value, body);
  feedback.success('Subscription terms saved');
}

const editorOpen = ref(false);
const editing = ref<InvoiceRow | null>(null);
function openEditor(invoice: InvoiceRow | null) {
  editing.value = invoice;
  editorOpen.value = true;
}
async function saveInvoice(body: { periodStart?: string; lines: InvoiceLineInput[]; taxRatePct?: number; notes: string }) {
  if (editing.value) {
    const updated = await platformBillingApi.updateInvoice(editing.value.id, { lines: body.lines, taxRatePct: body.taxRatePct, notes: body.notes || null });
    if (selected.value?.id === updated.id) selected.value = updated;
    feedback.success('Draft saved');
  } else {
    const created = await platformBillingApi.createInvoice(id.value, { periodStart: body.periodStart, extraLines: body.lines, ...(body.notes ? { notes: body.notes } : {}) });
    feedback.success('Draft invoice created', `${periodLabel(created.periodStart, created.periodEnd)} · ${money(created.total, created.currency)}`);
    selected.value = created;
  }
  await billing.run();
}

const selected = ref<InvoiceRow | null>(null);
const busy = ref(false);
async function act(run: () => Promise<InvoiceRow | void>, done: string) {
  busy.value = true;
  try {
    const result = await run();
    if (result) selected.value = result;
    feedback.success(done);
    await billing.run();
  } catch (e) {
    feedback.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}
async function issue(i: InvoiceRow) {
  const ok = await feedback.confirm({
    title: `Issue this invoice for ${money(i.total, i.currency)}?`,
    message: `It gets the next invoice number and is due in ${sub.value?.paymentTermsDays ?? 15} days.${sub.value?.contact.billingEmail ? ` A copy is emailed to ${sub.value.contact.billingEmail}.` : ''} It can't be edited afterwards.`,
    confirmLabel: 'Issue invoice',
  });
  if (ok) await act(() => platformBillingApi.issue(i.id), 'Invoice issued');
}
async function remove(i: InvoiceRow) {
  const ok = await feedback.confirm({ title: 'Delete this draft?', message: 'The draft is removed; you can draft the period again.', confirmLabel: 'Delete draft', danger: true });
  if (!ok) return;
  await act(() => platformBillingApi.deleteInvoice(i.id), 'Draft deleted');
  selected.value = null;
}

const paying = ref<InvoiceRow | null>(null);
async function savePayment(body: Parameters<typeof platformBillingApi.recordPayment>[1]) {
  const updated = await platformBillingApi.recordPayment(paying.value!.id, body);
  selected.value = updated;
  feedback.success(updated.status === 'PAID' ? 'Paid in full' : 'Payment recorded', `${money(body.amount, updated.currency)} for ${updated.number}`);
  await billing.run();
}

const voiding = ref<InvoiceRow | null>(null);
const voidReason = ref<string | null>('');
const voidError = ref<string | null>(null);
function openVoid(i: InvoiceRow) {
  voiding.value = i;
  voidReason.value = '';
  voidError.value = null;
}
async function confirmVoid() {
  try {
    selected.value = await platformBillingApi.void(voiding.value!.id, (voidReason.value ?? '').trim());
    voiding.value = null;
    feedback.success('Invoice voided');
    await billing.run();
  } catch (e) {
    voidError.value = errorMessage(e);
  }
}

async function download(i: InvoiceRow) {
  try {
    await platformBillingApi.pdf(i);
  } catch (e) {
    feedback.error('Could not download the PDF', e);
  }
}
</script>

<template>
  <div>
    <RouterLink to="/platform/billing" class="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"><ArrowLeft :size="15" aria-hidden="true" /> Billing</RouterLink>
    <AppErrorState v-if="billing.error.value && !billing.data.value" :error="billing.error.value" @retry="billing.run" />
    <AppSkeleton v-else-if="!billing.data.value" :lines="10" />
    <template v-else>
      <AppPageHeader :title="billing.data.value.organization.name" :description="`${sub?.plan?.name ?? 'No'} plan · billed ${CYCLE_LABELS[sub!.billingCycle].toLowerCase()}`">
        <template #actions>
          <AppButton v-if="canManage" variant="secondary" :icon="Pencil" @click="termsOpen = true">Edit terms</AppButton>
          <AppButton v-if="canManage" :icon="FilePlus2" :disabled="sub?.status === 'CANCELLED'" @click="openEditor(null)">Draft invoice</AppButton>
        </template>
      </AppPageHeader>

      <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <AppCard title="Invoices" :icon="ReceiptText" :padded="false">
          <AppEmptyState v-if="!billing.data.value.invoices.length" :icon="ReceiptText" title="No invoices yet" :description="sub?.pricePerMonth === null ? 'Set a monthly price in the terms (the plan has custom pricing), then draft the first invoice.' : 'Draft the first invoice for the next period.'" />
          <ul v-else class="divide-y divide-line">
            <li v-for="i in billing.data.value.invoices" :key="i.id">
              <button
                type="button"
                :class="['flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-start transition-colors hover:bg-surface-muted/50', selected?.id === i.id && 'bg-accent-soft/40']"
                :aria-expanded="selected?.id === i.id"
                @click="selected = selected?.id === i.id ? null : i"
              >
                <span class="min-w-0 flex-1 basis-40">
                  <span class="block font-mono text-xs font-medium text-fg">{{ i.number ?? 'Draft' }}</span>
                  <span class="block text-sm text-fg">{{ periodLabel(i.periodStart, i.periodEnd) }}</span>
                </span>
                <InvoiceStatusBadge :invoice="i" />
                <span class="w-28 text-end text-xs text-fg-muted">{{ i.dueDate ? `Due ${formatDate(i.dueDate)}` : '' }}</span>
                <span class="w-32 text-end font-semibold text-fg tabular-nums">{{ money(i.total, i.currency) }}</span>
              </button>
              <div v-if="selected?.id === i.id" class="space-y-4 border-t border-line/70 bg-surface-muted/20 px-4 py-4">
                <InvoiceDetail :invoice="selected" />
                <div class="flex flex-wrap justify-end gap-2">
                  <AppButton size="sm" variant="secondary" :icon="Download" @click="download(selected)">PDF</AppButton>
                  <template v-if="canManage">
                    <template v-if="selected.status === 'DRAFT'">
                      <AppButton size="sm" variant="ghost" :icon="Trash2" :disabled="busy" @click="remove(selected)">Delete</AppButton>
                      <AppButton size="sm" variant="secondary" :icon="Pencil" @click="openEditor(selected)">Edit</AppButton>
                      <AppButton size="sm" :icon="Send" :loading="busy" @click="issue(selected)">Issue</AppButton>
                    </template>
                    <AppButton v-if="(selected.status === 'ISSUED' || selected.status === 'DRAFT') && !selected.amountPaid" size="sm" variant="ghost" :icon="Ban" @click="openVoid(selected)">Void</AppButton>
                    <AppButton v-if="selected.status === 'ISSUED'" size="sm" :icon="Wallet" @click="paying = selected">Record payment</AppButton>
                  </template>
                </div>
              </div>
            </li>
          </ul>
        </AppCard>

        <div class="space-y-5">
          <AppCard title="Subscription" :icon="CreditCard">
            <div class="mb-4 flex flex-wrap items-center gap-2">
              <AppBadge :tone="SUBSCRIPTION_TONES[sub!.status]" dot>{{ SUBSCRIPTION_LABELS[sub!.status] }}</AppBadge>
              <AppBadge v-if="billing.data.value.overdue" tone="danger">{{ money(billing.data.value.overdue, sub!.currency) }} overdue</AppBadge>
              <span v-if="sub!.trialEndsOn && sub!.status === 'TRIAL'" class="text-xs text-fg-muted">Trial ends {{ formatDate(sub!.trialEndsOn) }}</span>
            </div>
            <p class="text-2xl font-semibold tracking-tight text-fg tabular-nums">
              {{ money(sub!.cycleAmount, sub!.currency) }}<span v-if="sub!.cycleAmount !== null" class="text-sm font-normal text-fg-muted"> / {{ CYCLE_UNIT[sub!.billingCycle] }} + GST {{ sub!.taxRatePct }}%</span>
            </p>
            <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt class="text-xs text-fg-muted">Monthly price</dt>
                <dd class="font-medium text-fg">{{ money(sub!.pricePerMonth, sub!.currency) }}<span v-if="sub!.priceOverride !== null" class="text-xs font-normal text-fg-muted"> (custom)</span></dd>
              </div>
              <div>
                <dt class="text-xs text-fg-muted">Discount</dt>
                <dd class="font-medium text-fg">{{ sub!.discountPct ? `${sub!.discountPct}%` : 'None' }}</dd>
              </div>
              <div>
                <dt class="text-xs text-fg-muted">Payment terms</dt>
                <dd class="font-medium text-fg">{{ sub!.paymentTermsDays }} days</dd>
              </div>
              <div>
                <dt class="text-xs text-fg-muted">Next period</dt>
                <dd class="font-medium text-fg">{{ sub!.status === 'CANCELLED' ? '—' : formatDate(sub!.nextPeriodStart) }}</dd>
              </div>
              <div class="col-span-2">
                <dt class="text-xs text-fg-muted">Balance due</dt>
                <dd class="font-semibold text-fg tabular-nums">{{ money(billing.data.value.balanceDue, sub!.currency) }}</dd>
              </div>
            </dl>
            <p v-if="sub!.notes" class="mt-4 rounded-lg bg-surface-muted/60 px-3 py-2 text-xs whitespace-pre-line text-fg-muted">{{ sub!.notes }}</p>
          </AppCard>

          <AppCard title="Seats" :icon="Users">
            <p class="text-sm text-fg">
              <span class="text-2xl font-semibold tabular-nums">{{ num(sub!.seats.used) }}</span>
              <span class="text-fg-muted"> of {{ sub!.seats.limit === null ? 'unlimited' : num(sub!.seats.limit) }} in use</span>
            </p>
            <div v-if="seatShare !== null" class="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="Seats used" :aria-valuenow="sub!.seats.used" :aria-valuemax="sub!.seats.limit ?? undefined">
              <div :class="['h-full rounded-full', seatShare >= 90 ? 'bg-warning' : 'bg-brand-500']" :style="{ width: `${seatShare}%` }" />
            </div>
            <p class="mt-2 text-xs text-fg-muted">{{ sub!.seats.override !== null ? `Custom limit (plan: ${sub!.plan?.maxUsers ?? 'unlimited'})` : 'The plan’s user limit' }} · invited people count until they join or are removed.</p>
          </AppCard>

          <AppCard title="Billing contact" :icon="Mail">
            <p class="font-medium text-fg">{{ sub!.billTo.name }}</p>
            <p class="text-sm text-fg-muted">{{ sub!.billTo.email ?? 'No billing email — invoices aren’t emailed' }}</p>
            <p v-if="sub!.billTo.address" class="mt-1 text-sm text-fg-muted">{{ sub!.billTo.address }}</p>
            <p v-if="sub!.billTo.taxId" class="mt-1 font-mono text-xs text-fg-muted">GSTIN {{ sub!.billTo.taxId }}</p>
          </AppCard>
        </div>
      </div>

      <SubscriptionTermsModal v-if="sub" :open="termsOpen" :subscription="sub" :save="saveTerms" @close="termsOpen = false" />
      <InvoiceEditorModal v-if="sub" :open="editorOpen" :subscription="sub" :invoice="editing" :save="saveInvoice" @close="editorOpen = false" />
      <RecordPaymentModal :open="!!paying" :invoice="paying" :save="savePayment" @close="paying = null" />
      <AppModal :open="!!voiding" :title="`Void ${voiding?.number ?? 'this draft'}?`" description="A void invoice stays on record and isn't owed. Its period can be invoiced again." dialog @close="voiding = null">
        <div class="space-y-3">
          <AppAlert v-if="voidError">{{ voidError }}</AppAlert>
          <AppTextarea v-model="voidReason" label="Reason" :rows="2" required />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="voiding = null">Cancel</AppButton>
          <AppButton variant="danger" :disabled="(voidReason ?? '').trim().length < 3" @click="confirmVoid">Void invoice</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
