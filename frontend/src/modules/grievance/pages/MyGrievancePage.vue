<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Check, RotateCcw, Undo2 } from '@lucide/vue';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import CaseDetails from '@/modules/grievance/components/CaseDetails.vue';
import CaseThread from '@/modules/grievance/components/CaseThread.vue';
import CaseTimeline from '@/modules/grievance/components/CaseTimeline.vue';
import type { CaseDetail } from '@/modules/grievance/types';
import { OUTCOME_LABELS, STATUS_LABELS, STEPS, statusTone } from '@/modules/grievance/utils/grievance-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppModal, AppPageHeader, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const detail = useAsync(() => grievanceApi.get(id.value));
watch(id, () => void detail.run());
const c = computed(() => (detail.data.value?.role === 'COMPLAINANT' ? detail.data.value : null));
const set = (next: CaseDetail) => (detail.data.value = next);
const stepIndex = computed(() => (c.value ? STEPS.findIndex((s) => s.status === c.value!.status) : -1));

const busy = ref(false);
async function act(fn: () => Promise<CaseDetail>, success: string) {
  busy.value = true;
  try {
    set(await fn());
    feedback.success(success);
    return true;
  } catch (e) {
    feedback.error('Could not complete the action', e);
    return false;
  } finally {
    busy.value = false;
  }
}
async function accept() {
  if (!(await feedback.confirm({ title: 'Accept the resolution?', message: 'Your case is closed.', confirmLabel: 'Accept and close' }))) return;
  await act(() => grievanceApi.accept(id.value), 'Case closed');
}
const reasonFor = ref<'withdraw' | 'reopen' | null>(null);
const reason = ref('');
function ask(kind: 'withdraw' | 'reopen') {
  reason.value = '';
  reasonFor.value = kind;
}
async function submitReason() {
  const ok =
    reasonFor.value === 'withdraw'
      ? await act(() => grievanceApi.withdraw(id.value, reason.value.trim() || null), 'Case withdrawn')
      : await act(() => grievanceApi.reopen(id.value, reason.value.trim()), 'Case reopened');
  if (ok) reasonFor.value = null;
}
</script>

<template>
  <div>
    <AppSkeleton v-if="detail.loading.value && !detail.data.value" :lines="8" />
    <AppErrorState v-else-if="detail.error.value" :error="detail.error.value" @retry="detail.run" />
    <template v-else-if="c">
      <AppPageHeader :title="c.subject" back="/me/grievances" back-label="Grievances">
        <template #badges>
          <AppBadge>{{ c.reference }}</AppBadge>
          <AppBadge :tone="statusTone[c.status]" dot>{{ STATUS_LABELS[c.status] }}</AppBadge>
        </template>
        <template v-if="c.permissions.withdraw" #actions>
          <AppButton variant="secondary" :icon="Undo2" @click="ask('withdraw')">Withdraw</AppButton>
        </template>
      </AppPageHeader>

      <ol v-if="c.status !== 'WITHDRAWN'" class="mb-4 grid grid-cols-5 gap-2" aria-label="Progress">
        <li v-for="(s, i) in STEPS" :key="s.status" class="text-center" :aria-current="i === stepIndex ? 'step' : undefined">
          <span class="mb-1.5 block h-1.5 rounded-full" :class="i <= stepIndex ? 'bg-brand-500' : 'bg-surface-muted'" />
          <span class="text-xs" :class="i === stepIndex ? 'font-medium text-fg' : 'text-fg-muted'">{{ s.label }}</span>
        </li>
      </ol>
      <AppAlert v-else tone="info" class="mb-4">You withdrew this case.</AppAlert>

      <AppCard v-if="c.resolution" class="mb-4" :title="c.status === 'RESOLVED' || c.status === 'CLOSED' ? 'Resolution' : 'Previous resolution'" :description="c.resolution.resolvedBy ? `By ${c.resolution.resolvedBy} · ${formatDate(c.resolution.resolvedAt)}` : undefined">
        <p v-if="c.outcome" class="mb-2"><AppBadge tone="success">{{ OUTCOME_LABELS[c.outcome] }}</AppBadge></p>
        <p class="text-sm whitespace-pre-line text-fg">{{ c.resolution.summary }}</p>
        <p v-if="c.posh && c.status === 'RESOLVED'" class="mt-3 text-xs text-fg-muted">If you disagree with the committee's findings, you can appeal to the appellate authority within 90 days (section 18 of the POSH Act).</p>
        <template v-if="c.status === 'RESOLVED'" #footer>
          <div class="flex flex-wrap items-center gap-3">
            <AppButton size="sm" :icon="Check" :loading="busy" @click="accept">Accept and close</AppButton>
            <AppButton v-if="c.permissions.reopen" size="sm" variant="secondary" :icon="RotateCcw" @click="ask('reopen')">Ask to reopen</AppButton>
            <span v-if="c.permissions.reopen && c.reopenUntil" class="text-xs text-fg-muted">You can ask to reopen it once, until {{ formatDate(c.reopenUntil) }}.</span>
            <span v-else-if="c.permissions.reopenBlocker && !c.posh" class="text-xs text-fg-muted">{{ c.permissions.reopenBlocker }}.</span>
          </div>
        </template>
      </AppCard>

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <CaseThread :grievance="c" :can-note="c.permissions.note" :can-attach="c.permissions.attach" @updated="set" />
        <div class="space-y-4">
          <AppCard v-if="c.assignee" title="Handled by">
            <p class="text-sm text-fg">{{ c.assignee.name }}</p>
          </AppCard>
          <CaseDetails :grievance="c" />
          <CaseTimeline :events="c.events" />
        </div>
      </div>

      <AppModal :open="!!reasonFor" :title="reasonFor === 'withdraw' ? 'Withdraw your case?' : 'Ask to reopen'" :description="reasonFor === 'withdraw' ? 'The people handling it are told; you can raise a new case later.' : 'Explain why the resolution does not address your grievance.'" size="sm" @close="reasonFor = null">
        <AppTextarea v-model="reason" :label="reasonFor === 'withdraw' ? 'Reason (optional)' : 'Reason'" :required="reasonFor === 'reopen'" :rows="3" :maxlength="2000" />
        <template #footer>
          <AppButton variant="secondary" @click="reasonFor = null">Cancel</AppButton>
          <AppButton :loading="busy" :disabled="reasonFor === 'reopen' && reason.trim().length < 10" @click="submitReason">{{ reasonFor === 'withdraw' ? 'Withdraw' : 'Reopen' }}</AppButton>
        </template>
      </AppModal>
    </template>
    <AppAlert v-else-if="detail.data.value" tone="info">
      You handle this case. <RouterLink :to="`/hr/grievances/${id}`" class="font-medium underline">Open it in HR operations</RouterLink>.
    </AppAlert>
  </div>
</template>
