<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Landmark, ReceiptText } from '@lucide/vue';
import type { ExpensePolicyRule } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import { CLAIM_CATEGORY_VISUALS } from '@/modules/payroll/utils/claim-visuals';
import { CLAIM_CATEGORY_LABELS, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppButton, AppCard, AppErrorState, AppInput, AppSkeleton, AppSwitch } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Expense policy: per category allowed / limits / receipts, and the finance approval threshold. */
const props = defineProps<{ canConfigure: boolean }>();
const feedback = useFeedbackStore();
const policy = useAsync(() => payrollApi.expensePolicy());
type Row = { category: ExpensePolicyRule['category']; allowed: boolean; perClaimLimit: number | string | null; monthlyLimit: number | string | null; receiptRequiredAbove: number | string | null };
const rows = ref<Row[]>([]);
const finance = ref<number | string | null>(null);
const financeOn = ref(false);
watch(
  () => policy.data.value,
  (p) => {
    if (!p) return;
    rows.value = p.categories.map((c) => ({ ...c }));
    finance.value = p.financeApprovalAbove;
    financeOn.value = p.financeApprovalAbove !== null;
  },
  { immediate: true },
);
const amount = (v: number | string | null) => (v === null || v === '' ? null : Number(v));
const errors = computed(() =>
  Object.fromEntries(
    rows.value.map((r) => {
      const per = amount(r.perClaimLimit);
      const month = amount(r.monthlyLimit);
      return [r.category, per && month && per > month ? 'Below the per-claim limit' : ''];
    }),
  ),
);
const dirty = computed(() => {
  const p = policy.data.value;
  if (!p) return false;
  const same = (a: number | null, b: number | string | null) => a === amount(b);
  return (
    (financeOn.value ? amount(finance.value) : null) !== p.financeApprovalAbove ||
    p.categories.some((c, i) => {
      const r = rows.value[i]!;
      return c.allowed !== r.allowed || !same(c.perClaimLimit, r.perClaimLimit) || !same(c.monthlyLimit, r.monthlyLimit) || !same(c.receiptRequiredAbove, r.receiptRequiredAbove);
    })
  );
});
const valid = computed(() => !Object.values(errors.value).some(Boolean) && (!financeOn.value || (amount(finance.value) ?? 0) > 0));
const saving = ref(false);
async function save() {
  saving.value = true;
  try {
    policy.data.value = await payrollApi.updateExpensePolicy({
      categories: rows.value.map((r) => ({ category: r.category, allowed: r.allowed, perClaimLimit: amount(r.perClaimLimit), monthlyLimit: amount(r.monthlyLimit), receiptRequiredAbove: amount(r.receiptRequiredAbove) })),
      financeApprovalAbove: financeOn.value ? amount(finance.value) : null,
    });
    feedback.success('Expense policy saved', 'New claims are checked against it.');
  } catch (e) {
    feedback.error('Could not save the expense policy', e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppCard title="Expense policy" :icon="ReceiptText" description="Limits per category, when a receipt is required, and when finance approves after the manager. Checked when an employee submits a claim." :padded="false">
    <AppSkeleton v-if="policy.loading.value && !policy.data.value" class="p-4" :lines="5" />
    <AppErrorState v-else-if="policy.error.value" :error="policy.error.value" @retry="policy.run" />
    <template v-else>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[40rem] text-sm">
          <caption class="sr-only">Expense limits per category</caption>
          <thead>
            <tr class="border-b border-line/70 text-start text-2xs font-semibold tracking-wide text-fg-muted uppercase">
              <th scope="col" class="px-4 py-2 text-start">Category</th>
              <th scope="col" class="px-2 py-2 text-start">Per claim</th>
              <th scope="col" class="px-2 py-2 text-start">Per month</th>
              <th scope="col" class="px-2 py-2 text-start">Receipt above</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line/60">
            <tr v-for="r in rows" :key="r.category" :class="!r.allowed && 'bg-surface-muted/40'">
              <th scope="row" class="px-4 py-2 text-start font-normal">
                <div class="flex items-center gap-2.5">
                  <span :class="['flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset', CLAIM_CATEGORY_VISUALS[r.category].tile]" aria-hidden="true"><component :is="CLAIM_CATEGORY_VISUALS[r.category].icon" :size="14" /></span>
                  <AppSwitch v-model="r.allowed" :disabled="!props.canConfigure" :label="CLAIM_CATEGORY_LABELS[r.category]" />
                </div>
              </th>
              <td class="px-2 py-2"><AppInput v-model="r.perClaimLimit" type="number" :min="1" :disabled="!props.canConfigure || !r.allowed" placeholder="No limit" :aria-label="`${CLAIM_CATEGORY_LABELS[r.category]} limit per claim`" /></td>
              <td class="px-2 py-2"><AppInput v-model="r.monthlyLimit" type="number" :min="1" :disabled="!props.canConfigure || !r.allowed" placeholder="No limit" :aria-label="`${CLAIM_CATEGORY_LABELS[r.category]} monthly limit`" :error="errors[r.category] || undefined" /></td>
              <td class="px-2 py-2"><AppInput v-model="r.receiptRequiredAbove" type="number" :min="0" :disabled="!props.canConfigure || !r.allowed" placeholder="Never" :aria-label="`${CLAIM_CATEGORY_LABELS[r.category]}: receipt required above`" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="border-t border-line/70 px-4 py-2 text-xs text-fg-subtle">Receipt above 0 means a receipt is always needed. The monthly limit counts pending, approved and paid claims by expense date.</p>
      <div class="space-y-3 border-t border-line/70 px-4 py-4">
        <AppSwitch v-model="financeOn" :disabled="!props.canConfigure" label="Finance approves large claims" description="After the manager approves, someone with the finance approval (not the same person) approves it too." />
        <AppInput v-if="financeOn" v-model="finance" type="number" :min="1" :icon="Landmark" label="Claims above" :disabled="!props.canConfigure" :help="amount(finance) ? `Claims over ${rupees(amount(finance))} need both approvals.` : undefined" />
        <AppAlert v-if="financeOn && !amount(finance)" tone="warning">Enter the amount above which finance approves.</AppAlert>
      </div>
      <div v-if="props.canConfigure" class="flex justify-end border-t border-line/70 px-4 py-3">
        <AppButton :loading="saving" :disabled="!dirty || !valid" @click="save">Save policy</AppButton>
      </div>
    </template>
  </AppCard>
</template>
