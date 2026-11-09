<script setup lang="ts">
import { computed, ref } from 'vue';
import { CalendarClock, Check, CircleCheck, CircleDashed, Copy, ExternalLink, Globe, Lock, Pencil } from '@lucide/vue';
import type { CandidateSource } from '@contracts';
import JobDescription from '@/modules/recruitment/components/JobDescription.vue';
import type { ApplicationCard, JobDetail } from '@/modules/recruitment/types';
import { SOURCE_LABELS } from '@/modules/recruitment/utils/recruitment-format';
import { SOURCE_ICON, daysUntil, dueText } from '@/modules/recruitment/utils/recruitment-ui';
import { AppButton } from '@/shared/components';
import { formatDate } from '@/shared/utils/format';

/** The "Job posting" tab: the copy as candidates read it, how complete the posting is, its link, and where applicants come from. */
const props = defineProps<{ job: JobDetail; applications: ApplicationCard[]; publicUrl: string | null; canManage: boolean }>();
const emit = defineEmits<{ edit: [] }>();

const checks = computed(() => {
  const j = props.job;
  return [
    { label: 'Detailed description', hint: 'At least a few sentences on the work and the team', done: j.description.trim().length >= 280 },
    { label: 'Requirements listed', hint: 'Skills and experience you look for', done: !!j.requirements?.trim() },
    { label: 'Experience range', hint: 'Helps people judge the level', done: j.experienceMin !== null || j.experienceMax !== null },
    { label: 'Location', hint: 'Set on the requisition', done: !!j.requisition.location },
    { label: 'On the careers page', hint: 'Anyone can apply with a resume', done: j.isPublic },
  ];
});
const score = computed(() => checks.value.filter((c) => c.done).length);
const scoreTone = computed(() => (score.value === checks.value.length ? 'bg-success' : score.value >= 3 ? 'bg-warning' : 'bg-danger'));

const fullUrl = computed(() => (props.publicUrl ? `${window.location.origin}${props.publicUrl}` : null));
const copied = ref(false);
async function copy() {
  if (!fullUrl.value) return;
  try {
    await navigator.clipboard.writeText(fullUrl.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // Clipboard blocked: the link stays selectable.
  }
}

const closing = computed(() => {
  const d = props.job.closesOn;
  if (!d) return { text: 'Open until filled', tone: 'text-fg-muted' };
  const n = daysUntil(d);
  return { text: n < 0 ? `Closed for applications on ${formatDate(d)}` : `Closes ${dueText(d).toLowerCase()} · ${formatDate(d)}`, tone: n < 0 ? 'text-danger-fg' : n <= 7 ? 'text-warning-fg' : 'text-fg-muted' };
});

const sources = computed(() => {
  const m = new Map<CandidateSource, number>();
  for (const a of props.applications) m.set(a.source, (m.get(a.source) ?? 0) + 1);
  const max = Math.max(1, ...m.values());
  return [...m].sort((a, b) => b[1] - a[1]).map(([source, n]) => ({ source, n, pct: Math.round((n / max) * 100) }));
});
</script>

<template>
  <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
    <article class="card p-6">
      <div class="flex flex-wrap items-center gap-2 border-b border-line/70 pb-4">
        <span :class="['inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', job.isPublic ? 'bg-info-soft text-info-fg' : 'bg-surface-muted text-fg-muted']">
          <component :is="job.isPublic ? Globe : Lock" :size="12" aria-hidden="true" />{{ job.isPublic ? 'Public posting' : 'Internal only' }}
        </span>
        <span :class="['inline-flex items-center gap-1.5 text-xs', closing.tone]"><CalendarClock :size="13" aria-hidden="true" />{{ closing.text }}</span>
        <AppButton v-if="canManage" class="ms-auto" size="sm" variant="ghost" :icon="Pencil" @click="emit('edit')">Edit posting</AppButton>
      </div>
      <h2 class="mt-5 text-base font-semibold text-fg">About the role</h2>
      <JobDescription class="mt-2" :text="job.description" />
      <template v-if="job.requirements">
        <h2 class="mt-7 text-base font-semibold text-fg">What we're looking for</h2>
        <JobDescription class="mt-2" :text="job.requirements" />
      </template>
    </article>

    <aside class="space-y-4">
      <section class="card p-5" aria-labelledby="quality-title">
        <div class="flex items-baseline justify-between gap-2">
          <h2 id="quality-title" class="text-sm font-semibold text-fg">Posting quality</h2>
          <span class="text-sm font-semibold text-fg tabular-nums">{{ score }}/{{ checks.length }}</span>
        </div>
        <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="score" aria-valuemin="0" :aria-valuemax="checks.length" aria-label="Posting quality">
          <div :class="['h-full rounded-full transition-all', scoreTone]" :style="{ width: `${(score / checks.length) * 100}%` }" />
        </div>
        <ul class="mt-4 space-y-3">
          <li v-for="c in checks" :key="c.label" class="flex items-start gap-2.5">
            <component :is="c.done ? CircleCheck : CircleDashed" :size="16" :class="['mt-0.5 shrink-0', c.done ? 'text-success' : 'text-fg-subtle']" aria-hidden="true" />
            <div class="min-w-0">
              <p :class="['text-sm', c.done ? 'text-fg' : 'font-medium text-fg']">{{ c.label }}<span class="sr-only">{{ c.done ? ' (done)' : ' (to do)' }}</span></p>
              <p v-if="!c.done" class="text-xs text-fg-muted">{{ c.hint }}</p>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="fullUrl" class="card p-5" aria-labelledby="share-title">
        <h2 id="share-title" class="text-sm font-semibold text-fg">Share the posting</h2>
        <p class="mt-1 text-xs text-fg-muted">Send this link to candidates or post it on job boards and social media.</p>
        <div class="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface-muted/50 p-1.5 ps-3">
          <span class="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted" :title="fullUrl">{{ fullUrl }}</span>
          <AppButton size="xs" variant="secondary" :icon="copied ? Check : Copy" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</AppButton>
        </div>
        <AppButton class="mt-3" size="sm" variant="ghost" :icon="ExternalLink" :to="publicUrl!">Open as a candidate sees it</AppButton>
      </section>

      <section class="card p-5" aria-labelledby="sources-title">
        <h2 id="sources-title" class="text-sm font-semibold text-fg">Where applicants come from</h2>
        <p v-if="!sources.length" class="mt-2 text-sm text-fg-muted">No applicants yet.</p>
        <ul v-else class="mt-4 space-y-3">
          <li v-for="s in sources" :key="s.source">
            <div class="flex items-center gap-2 text-sm">
              <component :is="SOURCE_ICON[s.source]" :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-fg">{{ SOURCE_LABELS[s.source] }}</span>
              <span class="font-medium text-fg tabular-nums">{{ s.n }}</span>
            </div>
            <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              <div class="h-full rounded-full bg-brand-500" :style="{ width: `${s.pct}%` }" />
            </div>
          </li>
        </ul>
      </section>
    </aside>
  </div>
</template>
