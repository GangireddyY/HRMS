<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { HandCoins, Plus } from '@lucide/vue';
import { loansApi } from '@/modules/payroll/api/payroll.api';
import LoanRequestModal from '@/modules/payroll/components/LoanRequestModal.vue';
import type { LoanDetail } from '@/modules/payroll/types';
import { LOAN_STATUS_LABELS, LOAN_TYPE_LABELS, loanTone, rupees } from '@/modules/payroll/utils/payroll-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const router = useRouter();
const feedback = useFeedbackStore();
const mine = useAsync(() => loansApi.mine());
const requesting = ref(false);
async function onSaved(l: LoanDetail) {
  requesting.value = false;
  feedback.success('Request sent', `${l.reference} is waiting for approval.`);
  await mine.run();
}
const progress = (repaid: number, principal: number) => Math.min(100, Math.round((repaid / principal) * 100));
</script>

<template>
  <div>
    <AppPageHeader title="Loans & advances" description="Ask for a salary advance or a loan. Once it's approved and paid out, the instalment is deducted from your salary every month.">
      <template #actions><AppButton :icon="Plus" :disabled="!mine.data.value?.canRequest" @click="requesting = true">New request</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="mine.loading.value && !mine.data.value" :lines="5" />
    <AppErrorState v-else-if="mine.error.value" :error="mine.error.value" @retry="mine.run" />
    <template v-else-if="mine.data.value">
      <AppCard v-if="!mine.data.value.loans.length">
        <AppEmptyState :icon="HandCoins" title="No loans or advances" description="Requests you make appear here with their repayment progress." />
      </AppCard>
      <div v-else class="grid gap-4 lg:grid-cols-2">
        <button
          v-for="l in mine.data.value.loans"
          :key="l.id"
          type="button"
          class="rounded-2xl bg-surface p-4 text-start ring-1 ring-line transition hover:ring-brand-400"
          @click="router.push(`/me/loans/${l.id}`)"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-medium text-fg">{{ LOAN_TYPE_LABELS[l.type] }} · {{ l.reference }}</p>
              <p class="text-xs text-fg-muted">{{ l.purpose }} · asked {{ formatDate(l.createdAt) }}</p>
            </div>
            <AppBadge :tone="loanTone[l.status]" dot>{{ LOAN_STATUS_LABELS[l.status] }}</AppBadge>
          </div>
          <dl class="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt class="text-xs text-fg-muted">Amount</dt>
              <dd class="font-medium text-fg tabular-nums">{{ rupees(l.principal) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-fg-muted">Instalment</dt>
              <dd class="text-fg tabular-nums">{{ l.emi ? `${rupees(l.emi)} × ${l.tenureMonths}` : `${l.tenureMonths} months` }}</dd>
            </div>
            <div>
              <dt class="text-xs text-fg-muted">Still owed</dt>
              <dd class="text-fg tabular-nums">{{ l.status === 'ACTIVE' || l.status === 'CLOSED' ? rupees(l.outstanding) : '—' }}</dd>
            </div>
          </dl>
          <div v-if="l.status === 'ACTIVE' || l.status === 'CLOSED'" class="mt-4">
            <div class="h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="progress(l.repaid, l.principal)" aria-valuemin="0" aria-valuemax="100" :aria-label="`${l.reference} repaid`">
              <div class="h-full rounded-full bg-brand-500" :style="{ width: `${progress(l.repaid, l.principal)}%` }" />
            </div>
            <p class="mt-1 text-xs text-fg-muted">{{ progress(l.repaid, l.principal) }}% repaid{{ l.nextInstalment ? ` · next deduction ${rupees(l.nextInstalment.amount)}` : '' }}</p>
          </div>
          <p v-else-if="l.start && l.status === 'APPROVED'" class="mt-3 text-xs text-fg-muted">Deductions start in {{ l.start.label }}, once it's paid out.</p>
        </button>
      </div>
    </template>
    <LoanRequestModal :open="requesting" @close="requesting = false" @saved="onSaved" />
  </div>
</template>
