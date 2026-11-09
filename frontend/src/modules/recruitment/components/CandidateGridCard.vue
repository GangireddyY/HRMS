<script setup lang="ts">
import { computed } from 'vue';
import { BriefcaseBusiness, FileText, GraduationCap, Hourglass, MapPin } from '@lucide/vue';
import type { Candidate } from '@/modules/recruitment/types';
import { SOURCE_LABELS, STAGE_LABELS } from '@/modules/recruitment/utils/recruitment-format';
import { SOURCE_ICON, STAGE_ICON, stageSoft } from '@/modules/recruitment/utils/recruitment-ui';
import { AppAvatar } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';
import { profileCover } from '@/shared/utils/profile-cover';

/** A candidate in the talent-pool grid, as a profile card: who they are now, key facts, skills and every pipeline they're in. */
const props = defineProps<{ candidate: Candidate }>();

const c = computed(() => props.candidate);
const headline = computed(() => [c.value.currentTitle, c.value.currentCompany].filter(Boolean).join(' at ') || 'No current role on file');
const STAGE_RANK = ['WITHDRAWN', 'REJECTED', 'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
const apps = computed(() => [...c.value.applications].sort((a, b) => STAGE_RANK.indexOf(b.stage) - STAGE_RANK.indexOf(a.stage)));
const facts = computed(() =>
  [
    c.value.experienceYears !== null && { icon: GraduationCap, text: `${c.value.experienceYears} yrs exp` },
    c.value.location && { icon: MapPin, text: c.value.location },
    c.value.noticePeriodDays !== null && { icon: Hourglass, text: c.value.noticePeriodDays === 0 ? 'Can join now' : `${c.value.noticePeriodDays}-day notice` },
  ].filter(Boolean) as { icon: typeof MapPin; text: string }[],
);
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="relative -mx-4 -mt-4 h-14 border-b border-line/50" :style="profileCover(c.email)" aria-hidden="true">
      <span class="absolute end-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-surface/90 px-2 py-0.5 text-2xs font-medium text-fg-muted shadow-xs backdrop-blur-sm">
        <component :is="SOURCE_ICON[c.source]" :size="11" />{{ SOURCE_LABELS[c.source] }}
      </span>
    </div>
    <div class="relative z-10 -mt-7 flex items-end justify-between gap-2">
      <span class="rounded-full bg-surface p-0.5"><AppAvatar :name="c.name" size="lg" /></span>
      <span v-if="c.resume" class="mb-1 inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-0.5 text-2xs font-medium text-danger-fg" :title="c.resume.fileName">
        <FileText :size="11" aria-hidden="true" />Resume
      </span>
    </div>

    <h3 class="mt-2 truncate text-sm font-semibold text-fg">{{ c.name }}</h3>
    <p class="truncate text-xs text-fg-muted">{{ headline }}</p>

    <ul v-if="facts.length" class="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-muted">
      <li v-for="f in facts" :key="f.text" class="inline-flex items-center gap-1"><component :is="f.icon" :size="11" class="text-fg-subtle" aria-hidden="true" />{{ f.text }}</li>
    </ul>

    <ul v-if="c.skills.length" class="mt-3 flex flex-wrap gap-1" aria-label="Skills">
      <li v-for="s in c.skills.slice(0, 4)" :key="s" class="rounded-md border border-line px-1.5 py-0.5 text-2xs text-fg-muted">{{ s }}</li>
      <li v-if="c.skills.length > 4" class="rounded-md px-1.5 py-0.5 text-2xs text-fg-subtle">+{{ c.skills.length - 4 }}</li>
    </ul>

    <div class="mt-3 space-y-1.5">
      <p v-if="!apps.length" class="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-fg-subtle">Not in a pipeline yet</p>
      <div v-for="a in apps.slice(0, 2)" :key="a.id" class="flex items-center gap-2 rounded-lg bg-surface-muted/50 px-2.5 py-1.5">
        <BriefcaseBusiness :size="12" class="shrink-0 text-fg-subtle" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-xs text-fg">{{ a.job.title }}</span>
        <span :class="['inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium', stageSoft[a.stage]]">
          <component :is="STAGE_ICON[a.stage]" :size="10" aria-hidden="true" />{{ STAGE_LABELS[a.stage] }}
        </span>
      </div>
      <p v-if="apps.length > 2" class="text-2xs text-fg-subtle">+{{ apps.length - 2 }} more {{ apps.length - 2 === 1 ? 'application' : 'applications' }}</p>
    </div>

    <div class="mt-auto pt-3">
      <p class="border-t border-line/60 pt-3 text-2xs text-fg-subtle" :title="formatDate(c.createdAt)">Added {{ timeAgo(c.createdAt) }}</p>
    </div>
  </div>
</template>
