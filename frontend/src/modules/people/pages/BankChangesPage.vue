<script setup lang="ts">
import { ref } from 'vue';
import { Check, Landmark, ShieldCheck, X } from '@lucide/vue';
import { employeesApi } from '@/modules/people/api/people.api';
import type { BankChangeRequest } from '@/modules/people/types';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppInput, AppModal, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** Salary bank account changes waiting for a second person's approval (maker-checker), oldest first. */
const feedback = useFeedbackStore();
const queue = useAsync(() => employeesApi.bankChanges());

const rejecting = ref<BankChangeRequest | null>(null);
const note = ref('');
const busy = ref<string | null>(null);

async function approve(r: BankChangeRequest) {
  busy.value = r.id;
  try {
    await employeesApi.approveBankChange(r.id);
    feedback.success('Bank account change approved', `${r.employee?.name ?? 'The employee'} has been told; the next salary goes to ••••${r.accountLast4 ?? '—'}.`);
    await queue.run();
  } catch (e) {
    feedback.error('Could not approve the change', e);
  } finally {
    busy.value = null;
  }
}
async function reject() {
  const r = rejecting.value;
  if (!r) return;
  busy.value = r.id;
  try {
    await employeesApi.rejectBankChange(r.id, note.value.trim());
    feedback.success('Bank account change rejected', 'The employee has been told.');
    rejecting.value = null;
    note.value = '';
    await queue.run();
  } catch (e) {
    feedback.error('Could not reject the change', e);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Bank account changes" description="Changes to an existing salary account take effect only after a second person approves them. Call the employee on a known number before approving.">
      <template #badges>
        <AppBadge v-if="queue.data.value?.length" tone="warning" dot>{{ queue.data.value.length }} waiting</AppBadge>
      </template>
    </AppPageHeader>
    <AppSkeleton v-if="queue.loading.value && !queue.data.value" :lines="4" />
    <AppErrorState v-else-if="queue.error.value" :error="queue.error.value" @retry="queue.run" />
    <AppCard v-else-if="!queue.data.value?.length">
      <AppEmptyState :icon="ShieldCheck" title="Nothing waiting" description="Bank account changes that need a second approval show up here." />
    </AppCard>
    <AppCard v-else :padded="false">
      <ul class="divide-y divide-line/60">
        <li v-for="r in queue.data.value" :key="r.id" class="flex flex-wrap items-center gap-4 px-5 py-4">
          <AppAvatar :name="r.employee?.name ?? '?'" size="sm" />
          <div class="min-w-0 flex-1">
            <RouterLink v-if="r.employee" :to="`/hr/employees/${r.employee.id}`" class="font-medium text-fg hover:text-accent-fg hover:underline">{{ r.employee.name }}</RouterLink>
            <p class="text-xs text-fg-muted">{{ r.employee?.employeeCode }} · requested <span :title="formatDateTime(r.requestedAt)">{{ timeAgo(r.requestedAt) }}</span></p>
          </div>
          <div class="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-1.5 text-sm">
            <Landmark :size="14" class="text-fg-subtle" aria-hidden="true" />
            <span class="font-mono text-fg">••••{{ r.accountLast4 ?? '—' }}</span>
            <span class="text-fg-muted">{{ [r.ifsc, r.bankName].filter(Boolean).join(' · ') }}</span>
          </div>
          <div v-if="r.canReview" class="flex gap-2">
            <AppButton size="sm" variant="secondary" :icon="X" :disabled="!!busy" @click="rejecting = r">Reject</AppButton>
            <AppButton size="sm" :icon="Check" :loading="busy === r.id" :disabled="!!busy" @click="approve(r)">Approve</AppButton>
          </div>
          <p v-else class="text-xs text-fg-subtle">You requested this change — someone else must approve it.</p>
        </li>
      </ul>
    </AppCard>

    <AppModal :open="!!rejecting" title="Reject bank account change" :description="rejecting?.employee?.name" size="sm" dialog @close="rejecting = null">
      <AppInput v-model="note" label="Reason (shared with the employee)" required :maxlength="500" />
      <template #footer>
        <AppButton variant="secondary" @click="rejecting = null">Cancel</AppButton>
        <AppButton variant="danger" :icon="X" :loading="!!busy" :disabled="note.trim().length < 3" @click="reject">Reject change</AppButton>
      </template>
    </AppModal>
  </div>
</template>
