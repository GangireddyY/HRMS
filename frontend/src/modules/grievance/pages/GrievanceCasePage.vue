<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CheckCircle2, Eye, Lock, Search } from '@lucide/vue';
import { GRIEVANCE_OUTCOMES, GRIEVANCE_PRIORITIES, type GrievanceOutcome, type GrievancePriority } from '@contracts';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import CaseDetails from '@/modules/grievance/components/CaseDetails.vue';
import CaseThread from '@/modules/grievance/components/CaseThread.vue';
import CaseTimeline from '@/modules/grievance/components/CaseTimeline.vue';
import type { CaseDetail } from '@/modules/grievance/types';
import { OUTCOME_HELP, OUTCOME_LABELS, PRIORITY_LABELS, STATUS_LABELS, priorityTone, statusTone } from '@/modules/grievance/utils/grievance-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const detail = useAsync(() => grievanceApi.get(id.value));
const handlers = useAsync(() => grievanceApi.handlers(id.value), { immediate: false });
watch(id, () => void detail.run());
const c = computed(() => (detail.data.value?.role === 'HANDLER' ? detail.data.value : null));
watch(
  () => c.value?.permissions.assign,
  (can) => {
    if (can && !handlers.data.value) void handlers.run();
  },
  { immediate: true },
);
const set = (next: CaseDetail) => (detail.data.value = next);
const handlerOptions = computed(() => (handlers.data.value ?? []).map((h) => ({ value: h.id, label: h.name, description: h.email })));
const priorityOptions = GRIEVANCE_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }));

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<CaseDetail>, success: string) {
  busy.value = key;
  try {
    set(await fn());
    feedback.success(success);
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = null;
  }
}
const assign = (userId: string | null) => act('assign', () => grievanceApi.assign(id.value, userId), userId ? 'Case assigned' : 'Case unassigned');
const setPriority = (p: GrievancePriority) => act('priority', () => grievanceApi.setPriority(id.value, p), 'Priority updated');
async function close() {
  if (!(await feedback.confirm({ title: `Close ${c.value?.reference}?`, message: 'The case becomes read-only and the complainant is told.', confirmLabel: 'Close case' }))) return;
  await act('close', () => grievanceApi.close(id.value), 'Case closed');
}

const { fieldErrors, formError, handle, reset } = useFormErrors();
const resolving = ref(false);
const resolution = reactive({ outcome: 'UPHELD' as GrievanceOutcome, summary: '', actions: '' });
const outcomeOptions = computed(() =>
  GRIEVANCE_OUTCOMES.filter((o) => o !== 'SETTLED' || !c.value?.posh || c.value.poshDetails?.conciliationRequested).map((o) => ({ value: o, label: OUTCOME_LABELS[o], description: OUTCOME_HELP[o] })),
);
function openResolve() {
  reset();
  Object.assign(resolution, { outcome: 'UPHELD', summary: '', actions: '' });
  resolving.value = true;
}
async function resolve() {
  reset();
  busy.value = 'resolve';
  try {
    set(await grievanceApi.resolve(id.value, { outcome: resolution.outcome, summary: resolution.summary, actions: resolution.actions || null }));
    resolving.value = false;
    feedback.success('Case resolved', 'The complainant has been told.');
  } catch (e) {
    handle(e, 'Could not resolve the case');
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div>
    <AppSkeleton v-if="detail.loading.value && !detail.data.value" :lines="8" />
    <AppErrorState v-else-if="detail.error.value" :error="detail.error.value" @retry="detail.run" />
    <template v-else-if="c">
      <AppPageHeader :title="c.subject" back="/hr/grievances" back-label="Grievances">
        <template #badges>
          <AppBadge>{{ c.reference }}</AppBadge>
          <AppBadge :tone="statusTone[c.status]" dot>{{ STATUS_LABELS[c.status] }}</AppBadge>
          <AppBadge v-if="c.priority" :tone="priorityTone[c.priority]">{{ PRIORITY_LABELS[c.priority] }} priority</AppBadge>
          <AppBadge v-if="c.posh" tone="violet">POSH · Internal Committee</AppBadge>
          <AppBadge v-if="c.reopened" tone="warning">Reopened</AppBadge>
        </template>
        <template v-if="c.permissions.manage" #actions>
          <AppButton v-if="c.permissions.acknowledge" variant="secondary" :icon="Eye" :loading="busy === 'ack'" @click="act('ack', () => grievanceApi.acknowledge(id), 'Case acknowledged')">Acknowledge</AppButton>
          <AppButton v-if="c.permissions.investigate" variant="secondary" :icon="Search" :loading="busy === 'investigate'" @click="act('investigate', () => grievanceApi.investigate(id), 'Investigation started')">Start investigation</AppButton>
          <AppButton v-if="c.permissions.resolve" :icon="CheckCircle2" @click="openResolve">Resolve</AppButton>
          <AppButton v-if="c.permissions.close" :icon="Lock" :loading="busy === 'close'" @click="close">Close case</AppButton>
        </template>
      </AppPageHeader>

      <AppAlert v-if="c.status === 'WITHDRAWN'" tone="info" class="mb-4">The complainant withdrew this case on {{ formatDate(c.withdrawnAt!) }}.</AppAlert>
      <AppAlert v-else-if="c.permissions.closeBlocker" tone="info" class="mb-4">{{ c.permissions.closeBlocker }}; you can close it after that, or as soon as they accept the resolution.</AppAlert>
      <AppAlert v-if="!c.permissions.manage" tone="info" class="mb-4">You were assigned to this case: you can read it and add notes. Someone with grievance management access assigns, investigates and resolves it.</AppAlert>

      <AppCard v-if="c.resolution" class="mb-4" :title="c.status === 'RESOLVED' || c.status === 'CLOSED' ? 'Resolution' : 'Previous resolution'" :description="c.resolution.resolvedBy ? `By ${c.resolution.resolvedBy} · ${formatDate(c.resolution.resolvedAt)}` : undefined">
        <p v-if="c.outcome" class="mb-2"><AppBadge tone="success">{{ OUTCOME_LABELS[c.outcome] }}</AppBadge></p>
        <p class="text-sm whitespace-pre-line text-fg">{{ c.resolution.summary }}</p>
        <template v-if="c.resolution.actions">
          <h3 class="mt-3 mb-1 text-sm font-medium text-fg">Actions <span class="font-normal text-fg-muted">(internal)</span></h3>
          <p class="text-sm whitespace-pre-line text-fg">{{ c.resolution.actions }}</p>
        </template>
        <p v-if="c.acceptedAt" class="mt-3 text-xs text-fg-muted">Accepted by the complainant on {{ formatDate(c.acceptedAt) }}.</p>
      </AppCard>

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="space-y-4">
          <CaseDetails :grievance="c" />
          <CaseThread :grievance="c" :can-note="c.permissions.note" :can-attach="c.permissions.attach" @updated="set" />
        </div>
        <div class="space-y-4">
          <AppCard title="Handling">
            <div class="space-y-4">
              <AppSelect
                v-if="c.permissions.assign"
                :model-value="c.assignee?.id ?? null"
                label="Handled by"
                :options="handlerOptions"
                :placeholder="c.posh ? 'Choose a committee member' : 'Choose a handler'"
                :disabled="busy === 'assign' || handlers.loading.value"
                @update:model-value="(v) => assign((v as string | null) ?? null)"
              />
              <div v-else>
                <p class="text-sm text-fg-muted">Handled by</p>
                <p class="text-sm text-fg">{{ c.assignee?.name ?? 'Unassigned' }}</p>
              </div>
              <AppSelect
                v-if="c.permissions.priority"
                :model-value="c.priority"
                label="Priority"
                :options="priorityOptions"
                :clearable="false"
                :disabled="busy === 'priority'"
                @update:model-value="(v) => setPriority(v as GrievancePriority)"
              />
              <p class="text-xs text-fg-muted">
                {{ c.posh ? 'Only Internal Committee members not involved in the case can be assigned.' : 'Only grievance handlers not involved in the case can be assigned.' }}
              </p>
            </div>
          </AppCard>
          <CaseTimeline :events="c.events" />
        </div>
      </div>

      <AppModal :open="resolving" :title="`Resolve ${c.reference}`" :description="c.posh ? 'Record the committee’s findings and recommendations.' : 'The summary is shared with the complainant.'" size="lg" @close="resolving = false">
        <form id="resolve-form" class="space-y-4" novalidate @submit.prevent="resolve">
          <AppAlert v-if="formError">{{ formError }}</AppAlert>
          <AppSelect v-model="resolution.outcome" label="Outcome" :options="outcomeOptions" :clearable="false" :error="fieldErrors.outcome" />
          <AppTextarea v-model="resolution.summary" label="Findings and decision" required :rows="5" :maxlength="5000" help="Shared with the complainant." :error="fieldErrors.summary" />
          <AppTextarea v-model="resolution.actions" label="Actions taken or recommended" :rows="3" :maxlength="5000" help="Internal: not shown to the complainant." :error="fieldErrors.actions" />
        </form>
        <template #footer>
          <AppButton variant="secondary" @click="resolving = false">Cancel</AppButton>
          <AppButton type="submit" form="resolve-form" :loading="busy === 'resolve'" :disabled="resolution.summary.trim().length < 10">Resolve</AppButton>
        </template>
      </AppModal>
    </template>
    <AppAlert v-else-if="detail.data.value" tone="info">
      You raised this case, so you can't handle it. <RouterLink :to="`/me/grievances/${id}`" class="font-medium underline">Follow it in My Workspace</RouterLink>.
    </AppAlert>
  </div>
</template>
