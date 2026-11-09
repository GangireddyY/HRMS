<script setup lang="ts">
import { computed } from 'vue';
import { CalendarClock, FileText, Hourglass, Star } from '@lucide/vue';
import type { ApplicationCard } from '@/modules/recruitment/types';
import { SOURCE_LABELS } from '@/modules/recruitment/utils/recruitment-format';
import { SOURCE_ICON, ageClass, shortDay, stageAge, timeOfDay } from '@/modules/recruitment/utils/recruitment-ui';
import { AppAvatar } from '@/shared/components';
import { timeAgo } from '@/shared/utils/format';

/** One candidate on the job's pipeline board: who they are, where they came from, and how long they have waited. */
const props = defineProps<{ app: ApplicationCard }>();
defineEmits<{ open: [] }>();
const background = computed(() => [props.app.candidate.currentTitle, props.app.candidate.currentCompany].filter(Boolean).join(' at '));
const closed = computed(() => ['HIRED', 'REJECTED', 'WITHDRAWN'].includes(props.app.stage));
const age = computed(() => stageAge(props.app.stageChangedAt));
// `nextInterviewAt` is the earliest interview still marked scheduled: in the past it was held and awaits feedback.
const interview = computed(() => {
  const at = props.app.nextInterviewAt;
  if (!at) return null;
  const since = Date.now() - new Date(at).getTime();
  return { at, held: since >= 0, late: since > 24 * 3_600_000 };
});
const stalled = computed(() => !closed.value && (age.value.tone !== 'fresh' || !!interview.value?.late));
</script>

<template>
  <button
    type="button"
    :class="[
      'group relative w-full overflow-hidden card p-3 text-start transition hover:-translate-y-px hover:border-brand-400 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none',
      closed && 'opacity-80',
    ]"
    @click="$emit('open')"
  >
    <span v-if="stalled" :class="['absolute inset-y-0 start-0 w-0.5', age.tone === 'stuck' ? 'bg-danger' : 'bg-warning']" aria-hidden="true" />
    <span class="flex items-start gap-2.5">
      <AppAvatar :name="app.candidate.name" size="sm" />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold text-fg group-hover:text-accent-fg">{{ app.candidate.name }}</span>
        <span class="block truncate text-xs text-fg-muted">{{ background || app.candidate.email }}</span>
      </span>
      <span
        :class="['shrink-0 rounded-full px-1.5 py-px text-2xs font-semibold tabular-nums', closed ? 'bg-surface-muted text-fg-muted' : ageClass[age.tone]]"
        :title="`In this stage ${age.days === 0 ? 'since today' : `for ${age.days} day${age.days === 1 ? '' : 's'}`}`"
      >
        {{ age.label }}<span class="sr-only"> in this stage{{ stalled ? ', needs attention' : '' }}</span>
      </span>
    </span>
    <span class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
      <span class="inline-flex items-center gap-1" :title="`Source: ${SOURCE_LABELS[app.source]}`"><component :is="SOURCE_ICON[app.source]" :size="12" aria-hidden="true" />{{ SOURCE_LABELS[app.source] }}</span>
      <span v-if="app.candidate.experienceYears !== null" class="tabular-nums">{{ app.candidate.experienceYears }} yrs exp</span>
      <span v-if="app.candidate.hasResume" class="inline-flex items-center gap-0.5"><FileText :size="12" aria-hidden="true" />CV</span>
      <span v-if="app.averageRating !== null" class="inline-flex items-center gap-0.5 font-medium text-warning-fg" :title="`${app.feedbackCount} scorecard${app.feedbackCount === 1 ? '' : 's'}`">
        <Star :size="12" class="fill-warning text-warning" aria-hidden="true" />{{ app.averageRating }}<span class="sr-only"> average rating from {{ app.feedbackCount }} scorecards</span>
      </span>
    </span>
    <span
      v-if="interview"
      :class="[
        'mt-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium',
        !interview.held ? 'bg-special-soft/60 text-special-fg' : interview.late ? 'bg-danger-soft/70 text-danger-fg' : 'bg-warning-soft/70 text-warning-fg',
      ]"
    >
      <component :is="interview.held ? Hourglass : CalendarClock" :size="12" aria-hidden="true" />
      <template v-if="interview.held">Feedback {{ interview.late ? 'overdue' : 'due' }}<span class="font-normal opacity-80"> · {{ timeAgo(interview.at) }}</span></template>
      <template v-else>Interview {{ shortDay(interview.at) }}, {{ timeOfDay(interview.at) }}</template>
    </span>
  </button>
</template>
