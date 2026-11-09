<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, Award, CalendarCheck2, CalendarClock, CalendarDays, ChevronRight, Hourglass, Star, UserPlus, UserRoundCheck } from '@lucide/vue';
import type { Enrollment } from '@/modules/training/types';
import { COURSE_VISUALS, daysUntil, overdueBy, relativeDay } from '@/modules/training/utils/course-visuals';
import { CERTIFICATION_LABELS, ENROLLMENT_STATUS_LABELS, certificationTone, enrollmentTone } from '@/modules/training/utils/training-format';
import { AppAvatar, AppBadge } from '@/shared/components';
import { formatDate, formatDateTime } from '@/shared/utils/format';

/** One person's enrolment in the team-training grid: who, which course, how far they've got and what's due or expiring. */
const props = defineProps<{ enrollment: Enrollment; certView: boolean }>();

const e = computed(() => props.enrollment);
const STEPS = ['Enrolled', 'Started', 'Completed'];
const progress = computed(() => {
  const x = e.value;
  switch (x.status) {
    case 'COMPLETED':
      return { reached: 3, bar: 'bg-success', text: x.completedOn ? `Completed ${formatDate(x.completedOn)}` : 'Completed' };
    case 'IN_PROGRESS':
      return { reached: 2, bar: 'bg-info', text: x.startedAt ? `Started ${formatDate(x.startedAt)}` : 'In progress' };
    case 'FAILED':
      return { reached: 2, bar: 'bg-danger', text: 'Assessment not passed' };
    case 'NO_SHOW':
      return { reached: 1, bar: 'bg-warning', text: 'Missed the session' };
    case 'CANCELLED':
      return { reached: 0, bar: 'bg-line-strong', text: 'Enrolment cancelled' };
    default:
      return { reached: 1, bar: 'bg-info', text: 'Not started yet' };
  }
});
const score = computed(() => (e.value.bestScore !== null ? `Best ${e.value.bestScore}% · ${e.value.attempts} attempt${e.value.attempts === 1 ? '' : 's'}` : null));
const due = computed(() => {
  const x = e.value;
  if (!x.dueDate || x.status === 'COMPLETED' || x.status === 'CANCELLED') return null;
  if (x.overdue) return { text: overdueBy(x.dueDate), tone: 'bg-danger-soft text-danger-fg', icon: AlertTriangle };
  return { text: `Due ${relativeDay(x.dueDate)}`, tone: daysUntil(x.dueDate) <= 7 ? 'bg-warning-soft text-warning-fg' : 'bg-surface-muted text-fg-muted', icon: CalendarClock };
});
const certAlert = computed(() => {
  const x = e.value;
  if (!x.expiresOn || (x.certification !== 'EXPIRED' && x.certification !== 'EXPIRING')) return null;
  return x.certification === 'EXPIRED' ? { text: `Certificate expired ${relativeDay(x.expiresOn)}`, tone: 'bg-danger-soft text-danger-fg' } : { text: `Certificate expires ${relativeDay(x.expiresOn)}`, tone: 'bg-warning-soft text-warning-fg' };
});
const upcomingSession = computed(() => (e.value.session && e.value.status !== 'COMPLETED' && e.value.status !== 'CANCELLED' && daysUntil(e.value.session.startsAt) >= 0 ? e.value.session : null));
const expiryTone = computed(() => (e.value.certification === 'EXPIRED' ? 'border-danger/30 bg-danger-soft' : e.value.certification === 'EXPIRING' ? 'border-warning/30 bg-warning-soft' : 'border-line/70 bg-surface-muted/50'));
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <AppAvatar :name="e.employee.name" size="md" />
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm font-semibold text-fg">{{ e.employee.name }}</h3>
        <p class="truncate text-xs text-fg-muted">{{ e.employee.department ?? e.employee.employeeCode }}</p>
      </div>
      <AppBadge v-if="certView && e.certification" class="shrink-0" :tone="certificationTone[e.certification]" size="sm" dot>{{ CERTIFICATION_LABELS[e.certification] }}</AppBadge>
      <AppBadge v-else-if="!certView" class="shrink-0" :tone="enrollmentTone[e.status]" size="sm" dot>{{ ENROLLMENT_STATUS_LABELS[e.status] }}</AppBadge>
    </div>

    <div class="flex items-start gap-3 rounded-lg bg-surface-muted/50 px-3 py-2.5">
      <span :class="['grid h-9 w-9 shrink-0 place-items-center rounded-lg', COURSE_VISUALS[e.course.category].tile]" aria-hidden="true"><component :is="COURSE_VISUALS[e.course.category].icon" :size="17" /></span>
      <div class="min-w-0 flex-1">
        <p class="line-clamp-2 text-xs leading-snug font-medium text-fg">{{ e.course.title }}</p>
        <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-muted">
          <span class="font-mono">{{ e.course.code }}</span>
          <span class="inline-flex items-center gap-1"><component :is="e.source === 'ASSIGNED' ? UserRoundCheck : UserPlus" :size="11" class="text-fg-subtle" aria-hidden="true" />{{ e.source === 'ASSIGNED' ? 'Assigned' : 'Self-enrolled' }}</span>
          <span v-if="e.course.mandatory" class="inline-flex items-center gap-1 rounded bg-special-soft px-1 font-medium text-special-fg"><Star :size="10" aria-hidden="true" />Mandatory</span>
        </p>
      </div>
    </div>

    <!-- Certificate view: the renewal is the point -->
    <div v-if="certView" :class="['rounded-lg border px-3 py-2.5', expiryTone]">
      <p class="flex items-center gap-1.5 text-2xs text-fg-subtle"><Hourglass :size="11" aria-hidden="true" />{{ e.certification === 'EXPIRED' ? 'Expired on' : 'Expires on' }}</p>
      <p class="mt-0.5 text-sm font-semibold text-fg">
        {{ e.expiresOn ? formatDate(e.expiresOn) : '—' }}
        <span v-if="e.expiresOn" :class="['ms-1 text-xs font-medium', e.certification === 'EXPIRED' ? 'text-danger-fg' : 'text-warning-fg']">{{ relativeDay(e.expiresOn) }}</span>
      </p>
      <p v-if="e.certificateNumber" class="mt-1 flex items-center gap-1 text-2xs text-fg-muted"><Award :size="11" aria-hidden="true" /><span class="font-mono">{{ e.certificateNumber }}</span></p>
    </div>

    <div v-else>
      <ol class="grid grid-cols-3 gap-1" :aria-label="`Progress: ${ENROLLMENT_STATUS_LABELS[e.status]}`">
        <li v-for="(step, i) in STEPS" :key="step">
          <span :class="['block h-1.5 rounded-full', i < progress.reached ? progress.bar : 'bg-surface-muted']" aria-hidden="true" />
          <span :class="['mt-1 block text-2xs', i < progress.reached ? 'text-fg-muted' : 'text-fg-subtle']">{{ step }}<span class="sr-only">{{ i < progress.reached ? ' (done)' : '' }}</span></span>
        </li>
      </ol>
      <p class="mt-1.5 flex items-center justify-between gap-2 text-xs">
        <span class="truncate text-fg-muted">{{ progress.text }}</span>
        <span v-if="score" class="shrink-0 text-2xs text-fg-subtle tabular-nums">{{ score }}</span>
      </p>
    </div>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <template v-if="certView">
        <span v-if="e.completedOn" class="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-fg-muted"><CalendarCheck2 :size="13" class="shrink-0" aria-hidden="true" />Certified {{ formatDate(e.completedOn) }}</span>
        <span v-else class="flex-1" />
      </template>
      <template v-else>
        <span v-if="due" :class="['inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium', due.tone]"><component :is="due.icon" :size="11" aria-hidden="true" />{{ due.text }}</span>
        <span v-else-if="certAlert" :class="['inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium', certAlert.tone]"><Hourglass :size="11" aria-hidden="true" />{{ certAlert.text }}</span>
        <span v-if="upcomingSession" class="flex min-w-0 flex-1 items-center gap-1 truncate text-2xs text-fg-muted" :title="`Session ${formatDateTime(upcomingSession.startsAt)}`">
          <CalendarDays :size="11" class="shrink-0 text-fg-subtle" aria-hidden="true" /><span class="truncate">Session {{ formatDate(upcomingSession.startsAt) }}</span>
        </span>
        <span v-else-if="due" class="min-w-0 flex-1 truncate text-2xs text-fg-subtle">{{ formatDate(e.dueDate) }}</span>
        <span v-else-if="e.certificateNumber" class="flex min-w-0 flex-1 items-center gap-1 truncate text-2xs text-fg-muted" :title="e.expiresOn ? `Valid until ${formatDate(e.expiresOn)}` : 'Does not expire'">
          <Award :size="12" :class="['shrink-0', certAlert ? 'text-fg-subtle' : 'text-success-fg']" aria-hidden="true" /><span class="truncate font-mono">{{ e.certificateNumber }}</span>
        </span>
        <span v-else class="min-w-0 flex-1 truncate text-xs text-fg-subtle">{{ e.dueDate ? `Due ${formatDate(e.dueDate)}` : e.status === 'COMPLETED' ? 'No certificate' : 'No due date' }}</span>
      </template>
      <ChevronRight :size="16" class="shrink-0 text-fg-subtle transition group-hover/card:translate-x-0.5 group-hover/card:text-fg-muted rtl:rotate-180" aria-hidden="true" />
    </div>
  </div>
</template>
