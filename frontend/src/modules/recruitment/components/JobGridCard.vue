<script setup lang="ts">
import { computed } from 'vue';
import { BriefcaseBusiness, CalendarClock, Clock, Globe, Lock, MapPin } from '@lucide/vue';
import type { ApplicationStage } from '@contracts';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import type { Job } from '@/modules/recruitment/types';
import { JOB_STATUS_LABELS, STAGE_LABELS, jobTone, stageAccent } from '@/modules/recruitment/utils/recruitment-format';
import { daysUntil, dueText, dueTone } from '@/modules/recruitment/utils/recruitment-ui';
import { AppAvatar, AppBadge } from '@/shared/components';
import { timeAgo } from '@/shared/utils/format';

/** A job in the Jobs grid: what and where, the live pipeline by stage, who hires, and how many seats are filled. */
const props = defineProps<{ job: Job }>();

const ACTIVE: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
const inPipeline = computed(() => ACTIVE.reduce((n, s) => n + (props.job.pipeline[s] ?? 0), 0));
const hired = computed(() => props.job.requisition.hiredCount);
const openings = computed(() => Math.max(1, props.job.requisition.openings));
/** Seats-filled ring: circumference of r=15. */
const C = 2 * Math.PI * 15;
const dash = computed(() => `${(Math.min(hired.value, openings.value) / openings.value) * C} ${C}`);

const timeline = computed(() => {
  const j = props.job;
  if (j.status === 'CLOSED') return { text: 'Closed', tone: 'text-fg-subtle' };
  if (j.closesOn) {
    const n = daysUntil(j.closesOn);
    return { text: n < 0 ? 'Closing date passed' : `Closes ${dueText(j.closesOn).toLowerCase()}`, tone: dueTone(j.closesOn) };
  }
  return { text: j.openedAt ? `Opened ${timeAgo(j.openedAt)}` : `Created ${timeAgo(j.createdAt)}`, tone: 'text-fg-muted' };
});
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-fg" aria-hidden="true"><BriefcaseBusiness :size="19" /></span>
      <div class="min-w-0 flex-1">
        <h3 class="line-clamp-2 text-sm leading-snug font-semibold text-fg">{{ job.title }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">
          <span class="font-mono">{{ job.requisition.code }}</span><template v-if="job.requisition.department"> · {{ job.requisition.department.name }}</template>
        </p>
      </div>
      <AppBadge class="shrink-0" :tone="jobTone[job.status]" size="sm" dot>{{ JOB_STATUS_LABELS[job.status] }}</AppBadge>
    </div>

    <ul class="flex flex-wrap gap-1.5 text-xs" aria-label="Job details">
      <li v-if="job.requisition.location" class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-fg-muted"><MapPin :size="12" aria-hidden="true" />{{ job.requisition.location.name }}</li>
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-fg-muted"><Clock :size="12" aria-hidden="true" />{{ EMPLOYMENT_TYPE_LABELS[job.requisition.employmentType] }}</li>
      <li :class="['inline-flex items-center gap-1 rounded-md px-2 py-1', job.isPublic ? 'bg-info-soft text-info-fg' : 'bg-surface-muted text-fg-muted']">
        <component :is="job.isPublic ? Globe : Lock" :size="12" aria-hidden="true" />{{ job.isPublic ? 'Careers page' : 'Internal' }}
      </li>
    </ul>

    <div>
      <div class="mb-2 flex items-baseline justify-between text-xs">
        <span class="font-medium text-fg-muted">Pipeline</span>
        <span class="text-fg-subtle"><span class="font-semibold text-fg tabular-nums">{{ inPipeline }}</span> active</span>
      </div>
      <ol class="grid grid-cols-4 gap-1.5" :aria-label="`Pipeline: ${ACTIVE.map((s) => `${STAGE_LABELS[s]} ${job.pipeline[s] ?? 0}`).join(', ')}`">
        <li v-for="s in ACTIVE" :key="s" :class="['rounded-lg px-2 py-1.5', job.pipeline[s] ? 'bg-surface-muted' : 'bg-surface-muted/40']">
          <p :class="['text-base leading-6 font-semibold tabular-nums', job.pipeline[s] ? 'text-fg' : 'text-fg-subtle']">{{ job.pipeline[s] ?? 0 }}</p>
          <p class="flex items-center gap-1 truncate text-2xs text-fg-muted">
            <span :class="['h-1.5 w-1.5 shrink-0 rounded-full', job.pipeline[s] ? stageAccent[s] : 'bg-line-strong']" aria-hidden="true" />{{ STAGE_LABELS[s] }}
          </p>
        </li>
      </ol>
    </div>

    <div class="mt-auto flex items-center gap-3 border-t border-line/60 pt-3">
      <template v-if="job.requisition.hiringManager">
        <AppAvatar :name="job.requisition.hiringManager.name" size="sm" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-medium text-fg">{{ job.requisition.hiringManager.name }}</p>
          <p :class="['flex items-center gap-1 truncate text-2xs', timeline.tone]"><CalendarClock :size="11" class="shrink-0" aria-hidden="true" />{{ timeline.text }}</p>
        </div>
      </template>
      <p v-else :class="['flex flex-1 items-center gap-1 text-xs', timeline.tone]"><CalendarClock :size="12" aria-hidden="true" />{{ timeline.text }}</p>
      <div class="flex shrink-0 items-center gap-2" :title="`${hired} of ${job.requisition.openings} hired`">
        <svg viewBox="0 0 36 36" class="h-9 w-9 -rotate-90" aria-hidden="true">
          <circle cx="18" cy="18" r="15" fill="none" class="stroke-surface-muted" stroke-width="4" />
          <circle cx="18" cy="18" r="15" fill="none" class="stroke-success transition-all" stroke-width="4" :stroke-linecap="hired ? 'round' : 'butt'" :stroke-dasharray="dash" />
        </svg>
        <div class="text-end leading-tight">
          <p class="text-sm font-semibold text-fg tabular-nums">{{ hired }}<span class="font-normal text-fg-muted">/{{ job.requisition.openings }}</span></p>
          <p class="text-2xs text-fg-subtle">hired</p>
        </div>
      </div>
    </div>
  </div>
</template>
