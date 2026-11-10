<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { FileUp } from '@lucide/vue';
import { RECEIPT_MAX_BYTES, REIMBURSEMENT_CATEGORIES, type ReimbursementCategory } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import type { Claim, ClaimUsage } from '@/modules/payroll/types';
import { CLAIM_CATEGORY_VISUALS } from '@/modules/payroll/utils/claim-visuals';
import { CLAIM_CATEGORY_LABELS, monthName, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { localToday } from '@/shared/utils/dates';

/** Claim an expense with an optional receipt (PDF or image up to 5 MB). */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [c: Claim] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ category: 'TRAVEL' as ReimbursementCategory, title: '', expenseDate: undefined as string | undefined, amount: '' as number | string, description: '' });
const receipt = ref<File | null>(null);
const input = ref<HTMLInputElement | null>(null);
const saving = ref(false);
const today = localToday();
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    receipt.value = null;
    Object.assign(form, { category: 'TRAVEL', title: '', expenseDate: today, amount: '', description: '' });
  },
  { immediate: true },
);
const usage = ref<ClaimUsage | null>(null);
const month = computed(() => (form.expenseDate ?? today).slice(0, 7));
watch(
  [() => props.open, month],
  async ([open]) => {
    if (!open) return;
    try {
      usage.value = await payrollApi.claimUsage(month.value);
    } catch {
      usage.value = null;
    }
  },
  { immediate: true },
);
const rule = computed(() => usage.value?.categories.find((c) => c.category === form.category) ?? null);
const categoryOptions = computed(() =>
  REIMBURSEMENT_CATEGORIES.filter((c) => usage.value?.categories.find((r) => r.category === c)?.allowed !== false).map((c) => ({ value: c, label: CLAIM_CATEGORY_LABELS[c] })),
);
watch(categoryOptions, (opts) => {
  if (opts.length && !opts.some((o) => o.value === form.category)) form.category = opts[0]!.value;
});
const left = computed(() => (rule.value?.monthlyLimit && usage.value ? Math.max(0, rule.value.monthlyLimit - usage.value.used[form.category]) : null));
const amountHelp = computed(() => {
  const r = rule.value;
  if (!r) return undefined;
  const parts = [r.perClaimLimit ? `Up to ${rupees(r.perClaimLimit)} per claim` : null, left.value !== null ? `${rupees(left.value)} left in ${monthName(month.value)} (of ${rupees(r.monthlyLimit)})` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
});
const overLimit = computed(() => {
  const a = Number(form.amount);
  if (!rule.value || !a) return null;
  if (rule.value.perClaimLimit && a > rule.value.perClaimLimit) return `Above the ${rupees(rule.value.perClaimLimit)} limit per claim`;
  if (left.value !== null && a > left.value) return `Only ${rupees(left.value)} is left for ${CLAIM_CATEGORY_LABELS[form.category].toLowerCase()} in ${monthName(month.value)}`;
  return null;
});
const receiptRequired = computed(() => {
  const above = rule.value?.receiptRequiredAbove;
  return above !== null && above !== undefined && Number(form.amount) > above;
});
const receiptLabel = computed(() => {
  const above = rule.value?.receiptRequiredAbove;
  if (above === null || above === undefined) return 'Receipt';
  return above === 0 ? 'Receipt (required)' : `Receipt (required above ${rupees(above)})`;
});
const financeNext = computed(() => !!usage.value?.financeApprovalAbove && Number(form.amount) > usage.value.financeApprovalAbove);
function pick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  if (f.size > RECEIPT_MAX_BYTES) {
    fieldErrors.value = { ...fieldErrors.value, file: 'The receipt must be 5 MB or smaller' };
    return;
  }
  fieldErrors.value = { ...fieldErrors.value, file: '' };
  receipt.value = f;
}
const canSave = computed(() => form.title.trim().length >= 2 && !!form.expenseDate && Number(form.amount) > 0 && !overLimit.value && (!receiptRequired.value || !!receipt.value));
async function save() {
  reset();
  saving.value = true;
  try {
    emit('saved', await payrollApi.createClaim({ category: form.category, title: form.title, expenseDate: form.expenseDate!, amount: Number(form.amount), description: form.description || null }, receipt.value));
  } catch (e) {
    handle(e, 'Could not submit the claim');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="New reimbursement claim" description="Approved claims are paid with the next payroll (not taxed)." @close="emit('close')">
    <form id="claim-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <fieldset>
        <legend class="label">Category</legend>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Category">
          <button
            v-for="c in categoryOptions"
            :key="c.value"
            type="button"
            role="radio"
            :aria-checked="form.category === c.value"
            :class="[
              'flex items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm ring-1 transition ring-inset focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
              form.category === c.value ? 'bg-accent-soft font-medium text-fg ring-brand-500/50' : 'text-fg-muted ring-line hover:bg-surface-muted',
            ]"
            @click="form.category = c.value"
          >
            <span :class="['flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset', CLAIM_CATEGORY_VISUALS[c.value].tile]" aria-hidden="true"><component :is="CLAIM_CATEGORY_VISUALS[c.value].icon" :size="14" /></span>
            <span class="min-w-0 truncate">{{ c.label }}</span>
          </button>
        </div>
      </fieldset>
      <AppInput v-model="form.title" label="What was it for?" required :maxlength="150" placeholder="e.g. Cab to client office" :error="fieldErrors.title" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.amount" label="Amount (₹)" type="number" :min="1" required :help="overLimit ? undefined : amountHelp" :error="fieldErrors.amount || overLimit || undefined" />
        <AppDatePicker v-model="form.expenseDate" label="Expense date" required :max="today" :error="fieldErrors.expenseDate" />
      </div>
      <AppTextarea v-model="form.description" label="Details" :rows="2" :maxlength="1000" />
      <div>
        <p class="label">{{ receiptLabel }}</p>
        <button type="button" class="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-line px-4 py-3 text-start transition hover:border-brand-400" @click="input?.click()">
          <FileUp :size="18" class="text-fg-subtle" aria-hidden="true" />
          <span class="text-sm" :class="receipt ? 'font-medium text-fg' : 'text-fg-muted'">{{ receipt ? receipt.name : 'PDF, PNG, JPG or WebP, up to 5 MB' }}</span>
        </button>
        <input ref="input" type="file" class="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp" aria-label="Receipt file" @change="pick" />
        <p v-if="fieldErrors.file" class="error-text" role="alert">{{ fieldErrors.file }}</p>
        <p v-else-if="receiptRequired && !receipt" class="mt-1 text-xs text-warning-fg">Attach a receipt to submit this claim.</p>
      </div>
      <AppAlert v-if="financeNext" tone="info">Claims above {{ rupees(usage!.financeApprovalAbove) }} are approved by your manager and then by finance.</AppAlert>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="claim-form" :loading="saving" :disabled="!canSave">Submit claim</AppButton>
    </template>
  </AppModal>
</template>
