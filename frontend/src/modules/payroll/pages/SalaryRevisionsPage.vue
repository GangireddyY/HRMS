<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowRight, ArrowUpRight, BadgeCheck, Check, Undo2, X } from '@lucide/vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import type { SalaryRevision, SalaryRevisionStatus } from '@/modules/payroll/types';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppInput, AppModal, AppPageHeader, AppSegmented, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime, timeAgo } from '@/shared/utils/format';

/** Raises above the approval threshold, waiting for a second person (maker-checker), plus the decided ones. */
const feedback = useFeedbackStore();
const status = ref<SalaryRevisionStatus | 'ALL'>('PENDING');
const list = useAsync(() => payrollApi.salaryRevisions(status.value));
watch(status, () => void list.run());
const views = [
  { value: 'PENDING', label: 'Waiting' },
  { value: 'ALL', label: 'All' },
];
const waiting = computed(() => (status.value === 'PENDING' ? (list.data.value?.length ?? 0) : 0));
const TONE: Record<SalaryRevisionStatus, 'warning' | 'success' | 'danger' | 'neutral'> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' };
const LABEL: Record<SalaryRevisionStatus, string> = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Withdrawn' };

const rejecting = ref<SalaryRevision | null>(null);
const note = ref('');
const busy = ref<string | null>(null);

async function act(r: SalaryRevision, fn: () => Promise<unknown>, done: string, detail?: string) {
  busy.value = r.id;
  try {
    await fn();
    feedback.success(done, detail);
    await list.run();
    return true;
  } catch (e) {
    feedback.error('Could not update the revision', e);
    return false;
  } finally {
    busy.value = null;
  }
}
const approve = (r: SalaryRevision) => act(r, () => payrollApi.approveSalaryRevision(r.id), 'Salary revision approved', `${r.employee?.name ?? 'The employee'} has been notified; payroll uses it from ${formatDate(r.effectiveFrom)}.`);
const withdraw = (r: SalaryRevision) => act(r, () => payrollApi.cancelSalaryRevision(r.id), 'Request withdrawn');
async function reject() {
  const r = rejecting.value;
  if (!r) return;
  if (await act(r, () => payrollApi.rejectSalaryRevision(r.id, note.value.trim()), 'Salary revision rejected', 'The requester has been told why.')) {
    rejecting.value = null;
    note.value = '';
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Salary revisions" description="Raises above your organization's approval threshold take effect only after someone other than the requester approves them.">
      <template #badges>
        <AppBadge v-if="waiting" tone="warning" dot>{{ waiting }} waiting</AppBadge>
      </template>
      <template #actions>
        <AppSegmented v-model="status" :options="views" label="Show" />
      </template>
    </AppPageHeader>
    <AppSkeleton v-if="list.loading.value && !list.data.value" :lines="4" />
    <AppErrorState v-else-if="list.error.value" :error="list.error.value" @retry="list.run" />
    <AppCard v-else-if="!list.data.value?.length">
      <AppEmptyState :icon="BadgeCheck" :title="status === 'PENDING' ? 'Nothing waiting' : 'No revisions yet'" description="Raises above the approval threshold (Payroll setup) show up here." />
    </AppCard>
    <AppCard v-else :padded="false">
      <ul class="divide-y divide-line/60">
        <li v-for="r in list.data.value" :key="r.id" class="flex flex-wrap items-center gap-4 px-5 py-4">
          <AppAvatar :name="r.employee?.name ?? '?'" size="sm" />
          <div class="min-w-0 flex-1">
            <p class="flex flex-wrap items-center gap-2">
              <RouterLink v-if="r.employee" :to="`/hr/employees/${r.employee.id}`" class="font-medium text-fg hover:text-accent-fg hover:underline">{{ r.employee.name }}</RouterLink>
              <AppBadge v-if="status === 'ALL'" :tone="TONE[r.status]" size="sm">{{ LABEL[r.status] }}</AppBadge>
            </p>
            <p class="text-xs text-fg-muted">
              {{ r.employee?.employeeCode }} · from {{ formatDate(r.effectiveFrom) }}{{ r.reason ? ` · ${r.reason}` : '' }} · requested
              <span :title="formatDateTime(r.requestedAt)">{{ timeAgo(r.requestedAt) }}</span>{{ r.requestedBy ? ` by ${r.requestedBy}` : '' }}
            </p>
            <p v-if="r.reviewNote" class="mt-1 text-xs text-fg-muted">“{{ r.reviewNote }}”{{ r.reviewedBy ? ` — ${r.reviewedBy}` : '' }}</p>
          </div>
          <div class="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-1.5 text-sm tabular-nums">
            <span class="text-fg-muted">{{ rupees(r.previousCtc) }}</span>
            <ArrowRight :size="13" class="text-fg-subtle" aria-label="to" />
            <span class="font-semibold text-fg">{{ rupees(r.annualCtc) }}</span>
            <span class="inline-flex items-center gap-0.5 rounded-full bg-success-soft px-1.5 py-px text-2xs font-semibold text-success-fg">
              <ArrowUpRight :size="11" aria-hidden="true" />{{ r.raisePercent }}%
            </span>
          </div>
          <div v-if="r.canReview" class="flex gap-2">
            <AppButton size="sm" variant="secondary" :icon="X" :disabled="!!busy" @click="rejecting = r">Reject</AppButton>
            <AppButton size="sm" :icon="Check" :loading="busy === r.id" :disabled="!!busy" @click="approve(r)">Approve</AppButton>
          </div>
          <AppButton v-else-if="r.mine && r.status === 'PENDING'" size="sm" variant="ghost" :icon="Undo2" :loading="busy === r.id" :disabled="!!busy" @click="withdraw(r)">Withdraw</AppButton>
          <p v-else-if="r.status === 'PENDING'" class="text-xs text-fg-subtle">Waiting for someone with approval rights</p>
        </li>
      </ul>
    </AppCard>

    <AppModal :open="!!rejecting" title="Reject salary revision" :description="rejecting?.employee?.name" size="sm" dialog @close="rejecting = null">
      <AppInput v-model="note" label="Reason (shared with the requester)" required :maxlength="500" />
      <template #footer>
        <AppButton variant="secondary" @click="rejecting = null">Cancel</AppButton>
        <AppButton variant="danger" :icon="X" :loading="!!busy" :disabled="note.trim().length < 3" @click="reject">Reject revision</AppButton>
      </template>
    </AppModal>
  </div>
</template>
