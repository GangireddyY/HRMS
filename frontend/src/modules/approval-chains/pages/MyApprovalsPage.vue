<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Check, Clock, DoorOpen, FileSignature, Inbox, Luggage, Plane, Receipt, X } from '@lucide/vue';
import type { ApprovalInboxItem, ApprovalSubject } from '@contracts';
import { APPROVAL_SUBJECT_LABELS } from '@contracts';
import { approvalInboxApi, canReject } from '@/modules/approval-chains/api/approval-inbox.api';
import { AppAlert, AppBadge, AppButton, AppDatePicker, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime, formatMoney } from '@/shared/utils/format';

/** Requests waiting at an approval-chain step you decide, whatever the kind, decided right here. */
const feedback = useFeedbackStore();
const inbox = useAsync(() => approvalInboxApi.waiting());

const ICONS: Record<ApprovalSubject, typeof Plane> = { LEAVE: Plane, EXPENSE: Receipt, TRAVEL: Luggage, EXIT: DoorOpen, OFFER: FileSignature };
const groups = computed(() => {
  const by = new Map<ApprovalSubject, ApprovalInboxItem[]>();
  for (const i of inbox.data.value ?? []) by.set(i.subject, [...(by.get(i.subject) ?? []), i]);
  return [...by.entries()];
});

const open = ref<{ item: ApprovalInboxItem; decision: 'approve' | 'reject' } | null>(null);
const form = reactive({ note: '', lastWorkingDay: undefined as string | undefined });
const busy = ref(false);
function start(item: ApprovalInboxItem, decision: 'approve' | 'reject') {
  open.value = { item, decision };
  form.note = '';
  form.lastWorkingDay = item.suggestedDate ?? undefined;
}
const valid = computed(() => {
  if (!open.value) return false;
  if (open.value.decision === 'reject') return form.note.trim().length >= 3;
  return open.value.item.subject !== 'EXIT' || !!form.lastWorkingDay;
});
async function decide() {
  if (!open.value || !valid.value) return;
  const { item, decision } = open.value;
  busy.value = true;
  try {
    await approvalInboxApi.decide(item, decision, { note: form.note.trim() || null, ...(item.subject === 'EXIT' ? { lastWorkingDay: form.lastWorkingDay } : {}) });
    feedback.success(decision === 'approve' ? (item.stepNumber < item.steps ? 'Approved; it moves to the next step' : 'Approved') : 'Rejected');
    open.value = null;
    await inbox.run();
  } catch (e) {
    feedback.error('Could not record your decision', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="My approvals" description="Requests waiting at an approval step you decide, including ones you're covering for a colleague." />
    <AppSkeleton v-if="inbox.loading.value && !inbox.data.value" :lines="6" />
    <AppErrorState v-else-if="inbox.error.value" :error="inbox.error.value" @retry="inbox.run" />
    <AppEmptyState v-else-if="!groups.length" :icon="Inbox" title="Nothing waiting for you" description="When a request reaches a step you approve, it shows here and you get a notification." />
    <section v-for="[subject, items] in groups" v-else :key="subject" class="card overflow-hidden" :aria-labelledby="`inbox-${subject}`">
      <h2 :id="`inbox-${subject}`" class="flex items-center gap-2 border-b border-line/70 px-4 py-3 text-sm font-semibold text-fg">
        <component :is="ICONS[subject]" :size="16" class="text-fg-muted" aria-hidden="true" />{{ APPROVAL_SUBJECT_LABELS[subject] }}
        <AppBadge size="sm" tone="neutral">{{ items.length }}</AppBadge>
      </h2>
      <ul class="divide-y divide-line/70">
        <li v-for="i in items" :key="i.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-fg">{{ i.person }} · {{ i.title }}<template v-if="i.amount !== null"> · <span class="tabular-nums">{{ formatMoney(i.amount) }}</span></template></p>
            <p class="truncate text-xs text-fg-muted">{{ i.detail }}</p>
            <p class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
              <AppBadge size="sm" tone="info">{{ i.chain }} · step {{ i.stepNumber }} of {{ i.steps }}: {{ i.step }}</AppBadge>
              <AppBadge v-if="i.onBehalf" size="sm" tone="neutral">Covering</AppBadge>
              <span v-if="i.escalated" class="text-danger">Overdue, escalated</span>
              <span v-else-if="i.dueAt" class="flex items-center gap-1"><Clock :size="12" aria-hidden="true" />Due {{ formatDateTime(i.dueAt) }}</span>
              <span v-else>Waiting since {{ formatDate(i.waitingSince) }}</span>
            </p>
          </div>
          <div class="flex gap-2">
            <AppButton v-if="canReject(i.subject)" size="sm" variant="secondary" :icon="X" @click="start(i, 'reject')">Reject</AppButton>
            <AppButton size="sm" :icon="Check" @click="start(i, 'approve')">{{ i.subject === 'EXIT' ? 'Accept' : 'Approve' }}</AppButton>
          </div>
        </li>
      </ul>
    </section>

    <AppModal
      :open="!!open"
      :title="open ? `${open.decision === 'approve' ? (open.item.subject === 'EXIT' ? 'Accept' : 'Approve') : 'Reject'}: ${open.item.person}` : ''"
      size="sm"
      @close="open = null"
    >
      <form v-if="open" id="inbox-decision" class="space-y-4" novalidate @submit.prevent="decide">
        <p class="text-sm text-fg-muted">{{ open.item.title }} · {{ open.item.detail }}</p>
        <AppAlert v-if="open.decision === 'approve' && open.item.stepNumber < open.item.steps" tone="info">After you, it goes to the next step of “{{ open.item.chain }}”.</AppAlert>
        <AppDatePicker v-if="open.item.subject === 'EXIT' && open.decision === 'approve'" v-model="form.lastWorkingDay" label="Last working day" required />
        <AppTextarea v-model="form.note" :label="open.decision === 'reject' ? 'Reason' : 'Note (optional)'" :required="open.decision === 'reject'" :rows="3" :maxlength="500" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="open = null">Cancel</AppButton>
        <AppButton form="inbox-decision" type="submit" :variant="open?.decision === 'reject' ? 'danger' : 'primary'" :loading="busy" :disabled="!valid">
          {{ open?.decision === 'reject' ? 'Reject' : open?.item.subject === 'EXIT' ? 'Accept' : 'Approve' }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
