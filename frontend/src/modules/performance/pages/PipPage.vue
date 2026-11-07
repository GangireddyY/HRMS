<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CalendarPlus, Check, CheckCircle2, CircleSlash, XCircle } from '@lucide/vue';
import { PIP_PROGRESS, type PipProgress } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { PipDetail } from '@/modules/performance/types';
import { PIP_PROGRESS_LABELS, PIP_STATUS_LABELS, pipProgressTone, pipTone } from '@/modules/performance/utils/performance-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppCheckbox, AppDatePicker, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const inHr = computed(() => route.path.startsWith('/hr'));
const pip = useAsync(() => performanceApi.pip(id.value));
watch(id, () => void pip.run());
const p = computed(() => pip.data.value);
const today = new Date().toISOString().slice(0, 10);

const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<PipDetail>, success: string) {
  busy.value = key;
  try {
    pip.data.value = await fn();
    feedback.success(success);
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = null;
  }
}
const checkInOpen = ref(false);
const checkIn = reactive({ date: today as string | undefined, progress: 'SOME_PROGRESS' as PipProgress, note: '' });
const progressOptions = PIP_PROGRESS.map((v) => ({ value: v, label: PIP_PROGRESS_LABELS[v] }));
async function saveCheckIn() {
  checkInOpen.value = false;
  await act('checkin', () => performanceApi.checkIn(id.value, { checkInDate: checkIn.date!, progress: checkIn.progress, note: checkIn.note }), 'Check-in recorded');
}
const extendOpen = ref(false);
const newEnd = ref<string | undefined>(undefined);
const closeOpen = ref(false);
const outcome = reactive({ value: 'SUCCESSFUL' as 'SUCCESSFUL' | 'UNSUCCESSFUL' | 'CANCELLED', note: '', met: [] as boolean[] });
function openClose(o: typeof outcome.value) {
  Object.assign(outcome, { value: o, note: '', met: p.value!.objectives.map(() => o === 'SUCCESSFUL') });
  closeOpen.value = true;
}
async function close() {
  closeOpen.value = false;
  await act('close', () => performanceApi.closePip(id.value, { outcome: outcome.value, note: outcome.note, objectivesMet: outcome.value === 'CANCELLED' ? undefined : outcome.met }), 'Plan closed');
}
const ackOpen = ref(false);
const ackComment = ref('');
</script>

<template>
  <div>
    <AppSkeleton v-if="pip.loading.value && !p" :lines="8" />
    <AppErrorState v-else-if="pip.error.value" :error="pip.error.value" title="This plan isn't available" @retry="pip.run" />
    <template v-else-if="p">
      <AppPageHeader :title="inHr ? p.employee.name : 'My improvement plan'" :description="`${formatDate(p.startDate)} – ${formatDate(p.endDate)} · owner ${p.owner?.name ?? p.createdBy ?? '—'}`" :back="inHr ? '/hr/performance/pips' : '/me/performance'" :back-label="inHr ? 'Improvement plans' : 'Performance'">
        <template v-if="inHr" #leading><AppAvatar :name="p.employee.name" size="xl" /></template>
        <template #badges>
          <AppBadge :tone="pipTone[p.status]" dot>{{ PIP_STATUS_LABELS[p.status] }}</AppBadge>
          <AppBadge v-if="p.overdue" tone="danger">Past end date</AppBadge>
        </template>
        <template #actions>
          <template v-if="p.permissions.manage">
            <AppButton variant="secondary" :icon="CalendarPlus" @click="checkIn.note = ''; checkInOpen = true">Add check-in</AppButton>
            <AppButton variant="secondary" @click="newEnd = p.endDate; extendOpen = true">Change end date</AppButton>
            <AppButton variant="ghost" :icon="CircleSlash" @click="openClose('CANCELLED')">Cancel plan</AppButton>
            <AppButton variant="secondary" :icon="XCircle" @click="openClose('UNSUCCESSFUL')">Not met</AppButton>
            <AppButton :icon="CheckCircle2" @click="openClose('SUCCESSFUL')">Completed</AppButton>
          </template>
          <AppButton v-if="p.permissions.acknowledge" :icon="Check" @click="ackComment = ''; ackOpen = true">Acknowledge</AppButton>
        </template>
      </AppPageHeader>

      <AppAlert v-if="p.permissions.acknowledge" tone="info" class="mb-4" title="Please read and acknowledge this plan">Acknowledging confirms you've seen it; add a comment if you'd like to respond.</AppAlert>

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div class="space-y-4">
          <AppCard title="Why this plan">
            <p class="text-sm whitespace-pre-line text-fg">{{ p.reason }}</p>
          </AppCard>
          <AppCard title="Objectives">
            <ol class="space-y-3">
              <li v-for="(o, i) in p.objectives" :key="i" class="flex items-start gap-3 text-sm">
                <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-fg-muted">{{ i + 1 }}</span>
                <div class="min-w-0 flex-1">
                  <p class="font-medium text-fg">{{ o.title }}</p>
                  <p v-if="o.measure" class="text-fg-muted">{{ o.measure }}</p>
                </div>
                <AppBadge v-if="o.met !== null" :tone="o.met ? 'success' : 'danger'" size="sm">{{ o.met ? 'Met' : 'Not met' }}</AppBadge>
              </li>
            </ol>
          </AppCard>
          <AppCard title="Check-ins">
            <p v-if="!p.checkIns.length" class="text-sm text-fg-muted">No check-ins yet.</p>
            <ol v-else class="relative space-y-4 border-l border-line pl-6">
              <li v-for="c in p.checkIns" :key="c.id" class="relative">
                <span class="absolute top-1 -left-[29px] h-3 w-3 rounded-full border-2 border-surface bg-brand-500" aria-hidden="true" />
                <p class="flex flex-wrap items-center gap-2 text-sm"><span class="font-medium text-fg">{{ formatDate(c.checkInDate) }}</span><AppBadge size="sm" :tone="pipProgressTone[c.progress]">{{ PIP_PROGRESS_LABELS[c.progress] }}</AppBadge></p>
                <p class="mt-1 text-sm whitespace-pre-line text-fg-muted">{{ c.note }}</p>
                <p class="text-xs text-fg-subtle">{{ c.createdBy }}</p>
              </li>
            </ol>
          </AppCard>
        </div>
        <div class="space-y-4">
          <AppCard v-if="p.status !== 'ACTIVE'" title="Outcome">
            <p class="font-medium text-fg">{{ PIP_STATUS_LABELS[p.status] }}</p>
            <p class="mt-1 text-sm whitespace-pre-line text-fg-muted">{{ p.outcomeNote }}</p>
            <p class="mt-2 text-xs text-fg-subtle">{{ p.closedBy }} · {{ p.closedAt ? formatDate(p.closedAt) : '' }}</p>
          </AppCard>
          <AppCard title="Acknowledgement">
            <p v-if="!p.acknowledgedAt" class="text-sm text-fg-muted">Not acknowledged yet.</p>
            <template v-else>
              <p class="text-sm text-fg">Acknowledged {{ formatDate(p.acknowledgedAt) }}</p>
              <p v-if="p.employeeComment" class="mt-1 text-sm text-fg-muted">“{{ p.employeeComment }}”</p>
            </template>
          </AppCard>
        </div>
      </div>

      <AppModal :open="checkInOpen" title="Add check-in" size="sm" @close="checkInOpen = false">
        <div class="space-y-4">
          <AppDatePicker v-model="checkIn.date" label="Date" required :min="p.startDate" :max="today" />
          <AppSelect v-model="checkIn.progress" label="Progress" :options="progressOptions" :clearable="false" />
          <AppTextarea v-model="checkIn.note" label="Notes" required :rows="4" :maxlength="2000" placeholder="What was discussed, evidence, next steps" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="checkInOpen = false">Cancel</AppButton>
          <AppButton :loading="busy === 'checkin'" :disabled="!checkIn.date || checkIn.note.trim().length < 5" @click="saveCheckIn">Save</AppButton>
        </template>
      </AppModal>

      <AppModal :open="extendOpen" title="Change end date" description="The employee is notified." size="sm" @close="extendOpen = false">
        <AppDatePicker v-model="newEnd" label="Ends" :min="p.startDate" />
        <template #footer>
          <AppButton variant="secondary" @click="extendOpen = false">Cancel</AppButton>
          <AppButton :disabled="!newEnd || newEnd === p.endDate" @click="extendOpen = false; act('extend', () => performanceApi.updatePip(id, { endDate: newEnd! }), 'End date changed')">Save</AppButton>
        </template>
      </AppModal>

      <AppModal :open="closeOpen" :title="outcome.value === 'SUCCESSFUL' ? 'Close plan: completed successfully' : outcome.value === 'UNSUCCESSFUL' ? 'Close plan: objectives not met' : 'Cancel plan'" size="md" @close="closeOpen = false">
        <div class="space-y-4">
          <div v-if="outcome.value !== 'CANCELLED'" class="space-y-2">
            <p class="label">Objectives met</p>
            <AppCheckbox v-for="(o, i) in p.objectives" :key="i" v-model="outcome.met[i]" :label="o.title" />
          </div>
          <AppTextarea v-model="outcome.note" label="Summary" required :rows="4" :maxlength="2000" />
        </div>
        <template #footer>
          <AppButton variant="secondary" @click="closeOpen = false">Cancel</AppButton>
          <AppButton :variant="outcome.value === 'SUCCESSFUL' ? 'primary' : 'danger'" :loading="busy === 'close'" :disabled="outcome.note.trim().length < 10" @click="close">Close plan</AppButton>
        </template>
      </AppModal>

      <AppModal :open="ackOpen" title="Acknowledge the plan" size="sm" @close="ackOpen = false">
        <AppTextarea v-model="ackComment" label="Comment (optional)" :rows="3" :maxlength="2000" />
        <template #footer>
          <AppButton variant="secondary" @click="ackOpen = false">Cancel</AppButton>
          <AppButton :icon="Check" @click="ackOpen = false; act('ack', () => performanceApi.acknowledgePip(id, ackComment || null), 'Plan acknowledged')">Acknowledge</AppButton>
        </template>
      </AppModal>
    </template>
  </div>
</template>
