<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CircleCheckBig, Plus, XCircle } from '@lucide/vue';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import AddTaskModal from '@/modules/onboarding/components/AddTaskModal.vue';
import ChecklistTasks from '@/modules/onboarding/components/ChecklistTasks.vue';
import type { CaseDetail } from '@/modules/onboarding/types';
import { CASE_STATUS_LABELS, caseStatusTone } from '@/modules/onboarding/utils/onboarding-format';
import { employeesApi } from '@/modules/people/api/people.api';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** One onboarding case. Used by HR (/hr/onboarding/:id) and by joiners' managers (/me/onboarding/cases/:id). */
const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const detail = useAsync(() => onboardingApi.get(id.value));
watch(id, () => void detail.run());
const backTo = computed(() => (route.path.startsWith('/me/') ? '/me/onboarding' : '/hr/onboarding'));

const d = computed(() => detail.data.value);
const manage = computed(() => !!d.value?.permissions.manage && d.value.status === 'IN_PROGRESS');
const pct = computed(() => (d.value?.progress.total ? Math.round((d.value.progress.done / d.value.progress.total) * 100) : 0));
function onUpdated(next: CaseDetail) {
  detail.data.value = next;
}

const colleagues = useAsync(() => (manage.value ? employeesApi.list({ status: 'ACTIVE', pageSize: 100, sort: 'name:asc' }) : Promise.resolve(null)), { immediate: false });
watch(manage, (m) => m && !colleagues.data.value && void colleagues.run(), { immediate: true });
const buddyOptions = computed(() => (colleagues.data.value?.items ?? []).filter((e) => e.id !== d.value?.employee.id).map((e) => ({ value: e.id, label: e.fullName, description: e.designation?.name })));
async function setBuddy(buddyId: string | null | undefined) {
  try {
    detail.data.value = await onboardingApi.update(id.value, { buddyId: buddyId ?? null });
    feedback.success(buddyId ? 'Buddy assigned' : 'Buddy removed');
  } catch (e) {
    feedback.error('Could not change the buddy', e);
  }
}

const addOpen = ref(false);
async function onTaskAdded(next: CaseDetail) {
  addOpen.value = false;
  detail.data.value = next;
  feedback.success('Task added');
}

const completing = ref(false);
async function complete() {
  if (!(await feedback.confirm({ title: 'Complete onboarding?', message: `${d.value!.employee.name} is notified that their onboarding is complete.`, confirmLabel: 'Complete onboarding' }))) return;
  completing.value = true;
  try {
    detail.data.value = await onboardingApi.complete(id.value);
    feedback.success('Onboarding completed');
  } catch (e) {
    feedback.error('Could not complete onboarding', e);
  } finally {
    completing.value = false;
  }
}

const cancelOpen = ref(false);
const cancelReason = ref('');
async function cancel() {
  try {
    detail.data.value = await onboardingApi.cancel(id.value, cancelReason.value);
    cancelOpen.value = false;
    feedback.success('Onboarding cancelled');
  } catch (e) {
    feedback.error('Could not cancel onboarding', e);
  }
}
</script>

<template>
  <div>
    <AppSkeleton v-if="detail.loading.value && !d" :lines="8" />
    <AppErrorState v-else-if="detail.error.value" :error="detail.error.value" title="Could not load the onboarding" @retry="detail.run" />
    <template v-else-if="d">
      <AppPageHeader :title="d.employee.name" :description="[d.employee.designation?.name, d.employee.department?.name, `joins ${formatDate(d.joiningDate)}`].filter(Boolean).join(' · ')" :back="backTo" back-label="Onboarding">
        <template #leading><AppAvatar :name="d.employee.name" size="xl" /></template>
        <template #badges><AppBadge :tone="caseStatusTone[d.status]" dot>{{ CASE_STATUS_LABELS[d.status] }}</AppBadge></template>
        <template v-if="manage" #actions>
          <AppButton variant="ghost" :icon="XCircle" @click="cancelOpen = true; cancelReason = ''">Cancel onboarding</AppButton>
          <AppButton variant="secondary" :icon="Plus" @click="addOpen = true">Add task</AppButton>
          <AppButton :icon="CircleCheckBig" :loading="completing" :disabled="d.progress.requiredOpen > 0" @click="complete">Complete onboarding</AppButton>
        </template>
      </AppPageHeader>

      <AppAlert v-if="d.status === 'CANCELLED'" tone="warning" class="mb-4" title="Onboarding cancelled">{{ d.cancelReason }}</AppAlert>

      <div class="grid items-start gap-4 lg:grid-cols-3">
        <AppCard class="lg:col-span-2" title="Checklist" :description="manage && d.progress.requiredOpen ? `${d.progress.requiredOpen} required task${d.progress.requiredOpen === 1 ? '' : 's'} left before onboarding can be completed.` : undefined">
          <ChecklistTasks :detail="d" @updated="onUpdated" />
        </AppCard>

        <div class="space-y-4">
          <AppCard title="Progress">
            <p class="text-3xl font-semibold text-fg tabular-nums">{{ pct }}%</p>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true"><div class="h-full rounded-full bg-emerald-500 transition-all" :style="{ width: `${pct}%` }" /></div>
            <dl class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div class="rounded-lg bg-surface-muted/60 p-2"><dt class="text-fg-muted">Done</dt><dd class="text-base font-semibold text-fg">{{ d.progress.done }}/{{ d.progress.total }}</dd></div>
              <div class="rounded-lg bg-surface-muted/60 p-2"><dt class="text-fg-muted">Overdue</dt><dd class="text-base font-semibold" :class="d.progress.overdue ? 'text-red-600 dark:text-red-400' : 'text-fg'">{{ d.progress.overdue }}</dd></div>
              <div class="rounded-lg bg-surface-muted/60 p-2"><dt class="text-fg-muted">To verify</dt><dd class="text-base font-semibold" :class="d.progress.awaitingVerification ? 'text-amber-600 dark:text-amber-400' : 'text-fg'">{{ d.progress.awaitingVerification }}</dd></div>
            </dl>
          </AppCard>

          <AppCard title="People">
            <dl class="space-y-4 text-sm">
              <div>
                <dt class="text-xs text-fg-muted">Manager</dt>
                <dd class="mt-0.5 text-fg">{{ d.manager?.name ?? 'No manager' }}</dd>
              </div>
              <div>
                <dt class="text-xs text-fg-muted">Buddy</dt>
                <dd class="mt-1">
                  <AppSelect v-if="manage" :model-value="d.buddy?.id ?? null" :options="buddyOptions" placeholder="No buddy" searchable aria-label="Buddy" @update:model-value="setBuddy" />
                  <span v-else class="text-fg">{{ d.buddy?.name ?? '—' }}</span>
                </dd>
              </div>
              <div v-if="d.notes && manage">
                <dt class="text-xs text-fg-muted">Notes</dt>
                <dd class="mt-0.5 whitespace-pre-line text-fg">{{ d.notes }}</dd>
              </div>
            </dl>
            <RouterLink v-if="d.permissions.manage" :to="`/hr/employees/${d.employee.id}`" class="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">Open employee record</RouterLink>
          </AppCard>
        </div>
      </div>

      <AddTaskModal :open="addOpen" :case-id="d.id" :joining-date="d.joiningDate" @close="addOpen = false" @saved="onTaskAdded" />
      <AppModal :open="cancelOpen" title="Cancel onboarding?" :description="d.employee.name" size="sm" @close="cancelOpen = false">
        <AppTextarea v-model="cancelReason" label="Reason" required :rows="3" :maxlength="500" placeholder="e.g. The offer was withdrawn" />
        <template #footer>
          <AppButton variant="secondary" @click="cancelOpen = false">Cancel</AppButton>
          <AppButton variant="danger" :disabled="cancelReason.trim().length < 3" @click="cancel">Cancel onboarding</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
