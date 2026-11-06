<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CalendarClock, CheckCircle2, UserCheck, XCircle } from '@lucide/vue';
import { exitApi } from '@/modules/exit/api/exit.api';
import ClearanceList from '@/modules/exit/components/ClearanceList.vue';
import SettlementPanel from '@/modules/exit/components/SettlementPanel.vue';
import type { ExitDetail } from '@/modules/exit/types';
import { REASON_LABELS, STATUS_LABELS, TYPE_LABELS, serviceLabel, statusTone } from '@/modules/exit/utils/exit-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppCheckbox, AppDatePicker, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTabs, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const detail = useAsync(() => exitApi.get(id.value));
watch(id, () => void detail.run());
const e = computed(() => detail.data.value);
const set = (next: ExitDetail) => (detail.data.value = next);
const tab = ref('overview');
const tabs = computed(() => [
  { key: 'overview', label: 'Overview' },
  ...(e.value?.clearanceItems.length ? [{ key: 'clearance', label: `Clearance (${e.value.clearance.done}/${e.value.clearance.total})` }] : []),
  ...(e.value?.permissions.settle ? [{ key: 'settlement', label: 'Full & final' }] : []),
]);

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<ExitDetail>, success: string) {
  busy.value = key;
  try {
    set(await fn());
    feedback.success(success);
    return true;
  } catch (err) {
    feedback.error('Could not complete the action', err);
    return false;
  } finally {
    busy.value = null;
  }
}

// Accepting / changing the last working day.
const dayModal = ref<'approve' | 'edit' | null>(null);
const dayForm = reactive({ lastWorkingDay: undefined as string | undefined, waiveNotice: false, note: '' });
function openDay(kind: 'approve' | 'edit') {
  const x = e.value!;
  Object.assign(dayForm, { lastWorkingDay: x.lastWorkingDay ?? x.requestedLastDay ?? x.noticeEndsOn, waiveNotice: x.noticeWaived, note: '' });
  dayModal.value = kind;
}
const shortfall = computed(() => {
  if (!e.value || !dayForm.lastWorkingDay || dayForm.waiveNotice) return 0;
  return Math.max(0, Math.round((Date.parse(e.value.noticeEndsOn) - Date.parse(dayForm.lastWorkingDay)) / 86_400_000));
});
async function saveDay() {
  const ok =
    dayModal.value === 'approve'
      ? await act('day', () => exitApi.approve(id.value, { lastWorkingDay: dayForm.lastWorkingDay!, waiveNotice: dayForm.waiveNotice, note: dayForm.note || null }), 'Resignation accepted')
      : await act('day', () => exitApi.update(id.value, { lastWorkingDay: dayForm.lastWorkingDay!, waiveNotice: dayForm.waiveNotice }), 'Last working day updated');
  if (ok) dayModal.value = null;
}
async function complete() {
  if (!(await feedback.confirm({ title: `Complete ${e.value?.employee?.name}'s exit?`, message: 'Their status becomes Exited from the last working day.', confirmLabel: 'Complete exit' }))) return;
  await act('complete', () => exitApi.complete(id.value), 'Exit completed');
}
const cancelling = ref(false);
const cancelReason = ref('');
async function cancel() {
  if (await act('cancel', () => exitApi.cancel(id.value, cancelReason.value), 'Exit cancelled')) cancelling.value = false;
}
const rehireOptions = [
  { value: 'yes', label: 'Eligible for rehire' },
  { value: 'no', label: 'Not eligible for rehire' },
];
const rehire = computed({
  get: () => (e.value?.eligibleForRehire === true ? 'yes' : e.value?.eligibleForRehire === false ? 'no' : null),
  set: (v: string | null) => void act('rehire', () => exitApi.update(id.value, { eligibleForRehire: v === null ? null : v === 'yes' }), 'Saved'),
});
</script>

<template>
  <div>
    <AppSkeleton v-if="detail.loading.value && !e" :lines="8" />
    <AppErrorState v-else-if="detail.error.value" :error="detail.error.value" @retry="detail.run" />
    <template v-else-if="e">
      <AppPageHeader :title="e.employee?.name ?? 'Exit'" :description="[e.employee?.employeeCode, e.employee?.designation, e.employee?.department].filter(Boolean).join(' · ')" back="/hr/exits" back-label="Exits">
        <template #badges>
          <AppBadge>{{ TYPE_LABELS[e.type] }}</AppBadge>
          <AppBadge :tone="statusTone[e.status]" dot>{{ STATUS_LABELS[e.status] }}</AppBadge>
        </template>
        <template #actions>
          <AppButton v-if="e.permissions.cancel" variant="ghost" :icon="XCircle" @click="cancelling = true">Cancel exit</AppButton>
          <AppButton v-if="e.permissions.manage && e.status === 'APPROVED'" variant="secondary" :icon="CalendarClock" @click="openDay('edit')">Change last day</AppButton>
          <AppButton v-if="e.permissions.approve" :icon="UserCheck" @click="openDay('approve')">Accept resignation</AppButton>
          <AppButton v-if="e.permissions.manage && e.status === 'APPROVED'" :icon="CheckCircle2" :disabled="!e.permissions.complete" :loading="busy === 'complete'" @click="complete">Complete exit</AppButton>
        </template>
      </AppPageHeader>
      <AppAlert v-if="e.permissions.completeBlocker" tone="info" class="mb-6">{{ e.permissions.completeBlocker }}.</AppAlert>
      <AppAlert v-if="e.status === 'CANCELLED' || e.status === 'WITHDRAWN'" tone="info" class="mb-6">{{ STATUS_LABELS[e.status] }}{{ e.closedAt ? ` on ${formatDate(e.closedAt)}` : '' }}{{ e.closedReason ? `: ${e.closedReason}` : '' }}</AppAlert>

      <AppTabs v-model="tab" :tabs="tabs">
        <div v-if="tab === 'overview'" class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <AppCard title="Separation">
            <dl class="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt class="text-fg-muted">{{ e.type === 'RESIGNATION' ? 'Resigned on' : 'Notice given on' }}</dt>
                <dd class="text-fg">{{ formatDate(e.submittedOn) }}</dd>
              </div>
              <div>
                <dt class="text-fg-muted">Notice period</dt>
                <dd class="text-fg">{{ e.noticeDays }} days, ends {{ formatDate(e.noticeEndsOn) }}</dd>
              </div>
              <div>
                <dt class="text-fg-muted">Last working day</dt>
                <dd class="font-medium text-fg">{{ e.lastWorkingDay ? formatDate(e.lastWorkingDay) : '—' }}<span v-if="e.requestedLastDay && !e.lastWorkingDay" class="font-normal text-fg-muted"> (asked for {{ formatDate(e.requestedLastDay) }})</span></dd>
              </div>
              <div>
                <dt class="text-fg-muted">Notice not served</dt>
                <dd class="text-fg">{{ e.noticeWaived ? 'Waived' : `${e.shortfallDays} days` }}</dd>
              </div>
              <div>
                <dt class="text-fg-muted">Service</dt>
                <dd class="text-fg">{{ serviceLabel(e.service) }} (joined {{ e.employee ? formatDate(e.employee.dateOfJoining) : '—' }})</dd>
              </div>
              <div>
                <dt class="text-fg-muted">Reason</dt>
                <dd class="text-fg">{{ REASON_LABELS[e.reason] }}</dd>
              </div>
            </dl>
            <p v-if="e.reasonDetail" class="mt-4 text-sm whitespace-pre-line text-fg">{{ e.reasonDetail }}</p>
            <p v-if="e.decidedBy" class="mt-4 text-xs text-fg-muted">Accepted by {{ e.decidedBy }}{{ e.decidedAt ? `, ${formatDate(e.decidedAt)}` : '' }}{{ e.decisionNote ? ` — “${e.decisionNote}”` : '' }}</p>
            <p v-if="e.completedBy" class="text-xs text-fg-muted">Completed by {{ e.completedBy }}{{ e.completedAt ? `, ${formatDate(e.completedAt)}` : '' }}</p>
          </AppCard>
          <div class="space-y-6">
            <AppCard v-if="e.permissions.manage" title="Exit survey">
              <template v-if="e.feedback">
                <p class="text-sm text-fg">Would recommend: <span class="font-medium tabular-nums">{{ e.feedback.wouldRecommend }}/10</span> · {{ e.feedback.wouldRejoin ? 'would come back' : 'would not come back' }}</p>
                <p v-if="e.feedback.liked" class="mt-2 text-sm text-fg"><span class="text-fg-muted">Liked:</span> {{ e.feedback.liked }}</p>
                <p v-if="e.feedback.improve" class="mt-1 text-sm text-fg"><span class="text-fg-muted">Improve:</span> {{ e.feedback.improve }}</p>
              </template>
              <p v-else class="text-sm text-fg-muted">Not answered yet.</p>
            </AppCard>
            <AppCard v-if="e.permissions.manage" title="Rehire">
              <AppSelect v-model="rehire" label="Eligibility" placeholder="Not decided" :options="rehireOptions" :disabled="busy === 'rehire'" />
            </AppCard>
          </div>
        </div>
        <ClearanceList v-else-if="tab === 'clearance'" :exit="e" @updated="set" />
        <SettlementPanel v-else :exit="e" @changed="detail.run" />
      </AppTabs>

      <AppModal :open="!!dayModal" :title="dayModal === 'approve' ? `Accept ${e.employee?.name}'s resignation` : 'Change the last working day'" size="sm" @close="dayModal = null">
        <div class="space-y-4">
          <AppDatePicker v-model="dayForm.lastWorkingDay" label="Last working day" required :min="e.submittedOn" />
          <p class="text-xs text-fg-muted">Notice ends {{ formatDate(e.noticeEndsOn) }}.<template v-if="shortfall"> {{ shortfall }} days would not be served{{ e.type === 'RESIGNATION' ? ' and can be recovered' : ' and are paid in lieu' }}.</template></p>
          <AppCheckbox v-model="dayForm.waiveNotice" label="Waive the notice not served" />
          <AppTextarea v-if="dayModal === 'approve'" v-model="dayForm.note" label="Note to the employee" :rows="2" :maxlength="1000" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="dayModal = null">Cancel</AppButton>
          <AppButton :loading="busy === 'day'" :disabled="!dayForm.lastWorkingDay" @click="saveDay">{{ dayModal === 'approve' ? 'Accept' : 'Save' }}</AppButton>
        </template>
      </AppModal>
      <AppModal :open="cancelling" title="Cancel this exit?" description="The employee becomes active again." size="sm" @close="cancelling = false">
        <AppTextarea v-model="cancelReason" label="Reason" required :rows="3" :maxlength="1000" />
        <template #footer>
          <AppButton variant="secondary" @click="cancelling = false">Keep it</AppButton>
          <AppButton variant="danger" :loading="busy === 'cancel'" :disabled="cancelReason.trim().length < 3" @click="cancel">Cancel exit</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
