<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CalendarDays, CalendarPlus, Check, CheckCircle2, CircleSlash, ClipboardCheck, FileText, Flag, Hourglass, LifeBuoy, ListChecks, MessagesSquare, Quote, UsersRound, XCircle } from '@lucide/vue';
import { PIP_PROGRESS, type PipProgress } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { PipDetail } from '@/modules/performance/types';
import { PIP_PROGRESS_LABELS, PIP_STATUS_LABELS, pipProgressTone, pipTone } from '@/modules/performance/utils/performance-format';
import { daysBetween, pct, plural, relativeDay, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppCheckbox, AppDatePicker, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** One improvement plan, for its manager / HR and for the employee (from /me): timeline, objectives, check-ins and outcome. */
const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const inHr = computed(() => route.path.startsWith('/hr'));
const pip = useAsync(() => performanceApi.pip(id.value));
watch(id, () => void pip.run());
const p = computed(() => pip.data.value);
const today = todayIso();

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
const openCheckIn = () => {
  checkIn.note = '';
  checkInOpen.value = true;
};

// ---- Timeline --------------------------------------------------------------------------------------------------
const span = computed(() => (p.value ? Math.max(1, daysBetween(p.value.startDate, p.value.endDate)) : 1));
const elapsed = computed(() => (p.value ? Math.min(100, Math.max(0, pct(daysBetween(p.value.startDate, today), span.value))) : 0));
const timing = computed(() => {
  const d = p.value;
  if (!d) return '';
  if (d.status !== 'ACTIVE') return d.closedAt ? `Closed ${formatDate(d.closedAt)}` : 'Closed';
  if (d.startDate > today) return `Starts ${relativeDay(d.startDate)}`;
  if (d.endDate < today) return `Ended ${relativeDay(d.endDate)} · outcome not recorded yet`;
  return `Day ${daysBetween(d.startDate, today) + 1} of ${span.value + 1} · ends ${relativeDay(d.endDate)}`;
});
/** Oldest first, so the trend reads left to right. */
const checkIns = computed(() => [...(p.value?.checkIns ?? [])].sort((a, b) => a.checkInDate.localeCompare(b.checkInDate) || a.createdAt.localeCompare(b.createdAt)));
const latest = computed(() => checkIns.value.at(-1) ?? null);
const met = computed(() => (p.value?.objectives ?? []).filter((o) => o.met === true).length);
const PROGRESS_FILL: Record<PipProgress, string> = { ON_TRACK: 'bg-success', SOME_PROGRESS: 'bg-warning', OFF_TRACK: 'bg-danger' };
const stats = computed(() => {
  const d = p.value!;
  const closed = d.status !== 'ACTIVE' && d.status !== 'CANCELLED';
  return [
    { key: 'obj', label: 'Objectives', value: closed ? `${met.value} / ${d.objectives.length}` : d.objectives.length, hint: closed ? 'met' : 'to work on', icon: ListChecks, tone: 'text-accent-fg bg-accent-soft' },
    { key: 'checkins', label: 'Check-ins', value: checkIns.value.length, hint: latest.value ? `Last ${formatDate(latest.value.checkInDate)}` : 'None yet', icon: MessagesSquare, tone: 'text-info-fg bg-info-soft' },
    {
      key: 'progress',
      label: 'Latest progress',
      value: latest.value ? PIP_PROGRESS_LABELS[latest.value.progress] : '—',
      hint: latest.value ? relativeDay(latest.value.checkInDate) : 'After the first check-in',
      icon: Flag,
      tone: latest.value ? { ON_TRACK: 'text-success-fg bg-success-soft', SOME_PROGRESS: 'text-warning-fg bg-warning-soft', OFF_TRACK: 'text-danger-fg bg-danger-soft' }[latest.value.progress] : 'text-fg-muted bg-surface-muted',
    },
    { key: 'ack', label: 'Acknowledged', value: d.acknowledgedAt ? 'Yes' : 'Not yet', hint: d.acknowledgedAt ? formatDate(d.acknowledgedAt) : 'By the employee', icon: ClipboardCheck, tone: d.acknowledgedAt ? 'text-success-fg bg-success-soft' : 'text-warning-fg bg-warning-soft' },
  ];
});
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
            <AppButton variant="ghost" :icon="CircleSlash" @click="openClose('CANCELLED')">Cancel plan</AppButton>
            <AppButton variant="secondary" :icon="CalendarDays" @click="newEnd = p.endDate; extendOpen = true">Change end date</AppButton>
            <AppButton variant="secondary" :icon="CalendarPlus" @click="openCheckIn">Add check-in</AppButton>
            <AppButton variant="secondary" :icon="XCircle" @click="openClose('UNSUCCESSFUL')">Not met</AppButton>
            <AppButton :icon="CheckCircle2" @click="openClose('SUCCESSFUL')">Completed</AppButton>
          </template>
          <AppButton v-if="p.permissions.acknowledge" :icon="Check" @click="ackComment = ''; ackOpen = true">Acknowledge</AppButton>
        </template>
      </AppPageHeader>

      <AppAlert v-if="p.permissions.acknowledge" tone="info" class="mb-4" title="Please read and acknowledge this plan">Acknowledging confirms you've seen it; add a comment if you'd like to respond.</AppAlert>

      <!-- Timeline and figures -->
      <section class="card mb-4 overflow-hidden" aria-label="Plan progress">
        <div class="px-5 pt-4 pb-5">
          <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span class="font-medium text-fg">{{ formatDate(p.startDate) }}</span>
            <span :class="['font-medium', p.overdue ? 'text-danger-fg' : 'text-fg-muted']">{{ timing }}</span>
            <span class="font-medium text-fg">{{ formatDate(p.endDate) }}</span>
          </div>
          <div class="relative h-2.5 rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="elapsed" aria-valuemin="0" aria-valuemax="100" :aria-valuetext="timing" aria-label="Plan period">
            <div :class="['h-full rounded-full transition-[width] duration-700', p.status !== 'ACTIVE' ? 'bg-fg-subtle/60' : p.overdue ? 'bg-danger' : 'bg-warning']" :style="{ width: `${p.status === 'ACTIVE' ? elapsed : 100}%` }" />
            <span
              v-for="c in checkIns"
              :key="c.id"
              :class="['absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface rtl:translate-x-1/2', PROGRESS_FILL[c.progress]]"
              :style="{ insetInlineStart: `${Math.min(100, Math.max(0, pct(daysBetween(p.startDate, c.checkInDate), span)))}%` }"
              :title="`${formatDate(c.checkInDate)} · ${PIP_PROGRESS_LABELS[c.progress]}`"
              aria-hidden="true"
            />
          </div>
          <ul v-if="checkIns.length" class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-muted">
            <li v-for="(label, k) in PIP_PROGRESS_LABELS" :key="k" class="flex items-center gap-1.5"><span :class="['h-2 w-2 rounded-full', PROGRESS_FILL[k]]" aria-hidden="true" />{{ label }}</li>
            <li class="text-fg-subtle">Dots are check-ins</li>
          </ul>
        </div>
        <div class="grid grid-cols-2 gap-px border-t border-line/70 bg-line/70 xl:grid-cols-4">
          <div v-for="s in stats" :key="s.key" class="flex items-center gap-3 bg-surface px-4 py-3.5 sm:px-5">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg max-sm:hidden', s.tone]" aria-hidden="true"><component :is="s.icon" :size="17" /></span>
            <div class="min-w-0">
              <p class="text-xl leading-6 font-semibold text-fg tabular-nums">{{ s.value }}</p>
              <p class="truncate text-xs font-medium text-fg-muted">{{ s.label }}</p>
              <p class="truncate text-2xs text-fg-subtle">{{ s.hint }}</p>
            </div>
          </div>
        </div>
        <div v-if="p.status === 'ACTIVE' && (p.permissions.manage || p.permissions.acknowledge)" :class="['flex flex-wrap items-center gap-3 border-t border-line/70 px-5 py-3', p.overdue || p.permissions.acknowledge ? 'bg-accent-soft/40' : 'bg-surface-muted/50']">
          <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-full', p.overdue || p.permissions.acknowledge ? 'bg-brand-600 text-white' : 'bg-surface text-fg-muted ring-1 ring-line']" aria-hidden="true">
            <component :is="p.overdue || p.permissions.acknowledge ? Flag : Hourglass" :size="15" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-2xs font-semibold tracking-wide text-accent-fg uppercase">Next step</p>
            <p class="text-sm font-medium text-fg">
              {{
                p.permissions.acknowledge
                  ? 'Read the plan and acknowledge it'
                  : p.overdue
                    ? 'The plan has ended: record the outcome'
                    : latest
                      ? `Keep checking in · last one ${relativeDay(latest.checkInDate)}`
                      : 'Hold the first check-in and record it here'
              }}
            </p>
          </div>
          <AppButton v-if="p.permissions.acknowledge" size="sm" :icon="Check" @click="ackComment = ''; ackOpen = true">Acknowledge</AppButton>
          <template v-else-if="p.overdue">
            <AppButton size="sm" variant="secondary" :icon="XCircle" @click="openClose('UNSUCCESSFUL')">Not met</AppButton>
            <AppButton size="sm" :icon="CheckCircle2" @click="openClose('SUCCESSFUL')">Completed</AppButton>
          </template>
          <AppButton v-else size="sm" variant="secondary" :icon="CalendarPlus" @click="openCheckIn">Add check-in</AppButton>
        </div>
      </section>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div class="min-w-0 space-y-4">
          <AppCard title="Why this plan" :icon="FileText">
            <figure class="flex gap-2.5">
              <Quote :size="16" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
              <blockquote class="text-sm whitespace-pre-line text-fg">{{ p.reason }}</blockquote>
            </figure>
          </AppCard>

          <AppCard title="Objectives" :icon="ListChecks" :description="p.status === 'ACTIVE' || p.status === 'CANCELLED' ? plural(p.objectives.length, 'objective') : `${met} of ${plural(p.objectives.length, 'objective')} met`" :padded="false">
            <ol class="divide-y divide-line/70">
              <li v-for="(o, i) in p.objectives" :key="i" class="flex items-start gap-3 px-4 py-3.5">
                <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums', o.met === true ? 'bg-success-soft text-success-fg' : o.met === false ? 'bg-danger-soft text-danger-fg' : 'bg-surface-muted text-fg-muted']" aria-hidden="true">
                  <Check v-if="o.met === true" :size="15" :stroke-width="3" />
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-fg">{{ o.title }}</p>
                  <p v-if="o.measure" class="text-xs text-fg-muted">Measure: {{ o.measure }}</p>
                </div>
                <AppBadge v-if="o.met !== null" :tone="o.met ? 'success' : 'danger'" size="sm" dot>{{ o.met ? 'Met' : 'Not met' }}</AppBadge>
              </li>
            </ol>
          </AppCard>

          <AppCard title="Check-ins" :icon="MessagesSquare" :description="checkIns.length ? `${plural(checkIns.length, 'conversation')} recorded · newest first` : 'Progress conversations between the employee and the owner'">
            <template v-if="p.permissions.manage && p.status === 'ACTIVE'" #actions><AppButton size="sm" variant="secondary" :icon="CalendarPlus" @click="openCheckIn">Add check-in</AppButton></template>
            <div v-if="!checkIns.length" class="flex flex-col items-center py-6 text-center">
              <span class="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent-fg" aria-hidden="true"><MessagesSquare :size="20" /></span>
              <p class="text-sm font-medium text-fg">No check-ins yet</p>
              <p class="mt-1 max-w-sm text-sm text-fg-muted">{{ p.permissions.manage ? 'Record each conversation: progress against the objectives, evidence and next steps.' : 'Your check-ins with your manager appear here.' }}</p>
            </div>
            <ol v-else class="relative space-y-5 border-s border-line ps-6">
              <li v-for="c in [...checkIns].reverse()" :key="c.id" class="relative">
                <span :class="['absolute top-1 -start-[31px] h-3.5 w-3.5 rounded-full ring-4 ring-surface', PROGRESS_FILL[c.progress]]" aria-hidden="true" />
                <p class="flex flex-wrap items-center gap-2 text-sm">
                  <span class="font-medium text-fg">{{ formatDate(c.checkInDate) }}</span>
                  <AppBadge size="sm" :tone="pipProgressTone[c.progress]" dot>{{ PIP_PROGRESS_LABELS[c.progress] }}</AppBadge>
                  <span class="text-xs text-fg-subtle">{{ relativeDay(c.checkInDate) }}</span>
                </p>
                <p class="mt-1.5 rounded-lg bg-surface-muted/50 px-3 py-2 text-sm whitespace-pre-line text-fg">{{ c.note }}</p>
                <p v-if="c.createdBy" class="mt-1 text-xs text-fg-subtle">Recorded by {{ c.createdBy }}</p>
              </li>
            </ol>
          </AppCard>
        </div>

        <aside class="space-y-4">
          <section v-if="p.status !== 'ACTIVE'" :class="['card overflow-hidden ring-1', p.status === 'SUCCESSFUL' ? 'ring-success/30' : p.status === 'UNSUCCESSFUL' ? 'ring-danger/30' : 'ring-line']" aria-labelledby="outcome-title">
            <div :class="['flex items-center gap-3 px-4 py-3', p.status === 'SUCCESSFUL' ? 'bg-success-soft/60' : p.status === 'UNSUCCESSFUL' ? 'bg-danger-soft/60' : 'bg-surface-muted/60']">
              <component :is="p.status === 'SUCCESSFUL' ? CheckCircle2 : p.status === 'UNSUCCESSFUL' ? XCircle : CircleSlash" :size="20" :class="p.status === 'SUCCESSFUL' ? 'text-success-fg' : p.status === 'UNSUCCESSFUL' ? 'text-danger-fg' : 'text-fg-muted'" aria-hidden="true" />
              <div class="min-w-0">
                <p class="text-2xs font-semibold tracking-wide text-fg-muted uppercase" id="outcome-title">Outcome</p>
                <p class="font-semibold text-fg">{{ PIP_STATUS_LABELS[p.status] }}</p>
              </div>
            </div>
            <div class="p-4">
              <p class="text-sm whitespace-pre-line text-fg">{{ p.outcomeNote }}</p>
              <p class="mt-2 text-xs text-fg-subtle">{{ p.closedBy }} · {{ p.closedAt ? formatDate(p.closedAt) : '' }}</p>
            </div>
          </section>

          <AppCard title="People" :icon="UsersRound">
            <ul class="space-y-3">
              <li class="flex items-center gap-3">
                <AppAvatar :name="p.employee.name" size="md" />
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-fg">{{ p.employee.name }}</p>
                  <p class="truncate text-xs text-fg-muted">Employee · {{ p.employee.department ?? p.employee.employeeCode }}</p>
                </div>
              </li>
              <li class="flex items-center gap-3">
                <AppAvatar :name="p.owner?.name ?? p.createdBy ?? '?'" size="md" />
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-fg">{{ p.owner?.name ?? p.createdBy ?? '—' }}</p>
                  <p class="truncate text-xs text-fg-muted">Plan owner · runs the check-ins</p>
                </div>
              </li>
            </ul>
            <p v-if="p.createdBy && p.createdBy !== p.owner?.name" class="mt-3 text-xs text-fg-subtle">Opened by {{ p.createdBy }} on {{ formatDate(p.createdAt) }}</p>
            <AppButton v-if="p.reviewId" class="mt-3" size="sm" variant="link" :icon="LifeBuoy" :to="inHr ? `/hr/performance/reviews/${p.reviewId}` : `/me/performance/reviews/${p.reviewId}`">Open the related review</AppButton>
          </AppCard>

          <AppCard title="Acknowledgement" :icon="ClipboardCheck">
            <div v-if="!p.acknowledgedAt" class="flex items-start gap-2.5">
              <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning-fg" aria-hidden="true"><Hourglass :size="13" /></span>
              <p class="text-sm text-fg-muted">Not acknowledged yet. {{ inHr ? 'The employee is asked to read and acknowledge the plan.' : '' }}</p>
            </div>
            <template v-else>
              <p class="flex items-center gap-2 text-sm text-fg"><CheckCircle2 :size="16" class="text-success-fg" aria-hidden="true" />Acknowledged {{ formatDate(p.acknowledgedAt) }}</p>
              <figure v-if="p.employeeComment" class="mt-3 flex gap-2 rounded-lg bg-surface-muted/60 p-3">
                <Quote :size="14" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                <blockquote class="text-sm text-fg">{{ p.employeeComment }}</blockquote>
              </figure>
            </template>
          </AppCard>
        </aside>
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
