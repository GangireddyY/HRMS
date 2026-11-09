<script setup lang="ts">
import type { ApplicationStage } from '@contracts';
import { Briefcase, CalendarClock, UserPlus } from '@lucide/vue';
import { daysUntil } from '@/modules/insights/approvals';
import type { Job } from '@/modules/recruitment/types';
import { STAGE_LABELS, stageAccent } from '@/modules/recruitment/utils/recruitment-format';
import { AppBadge, AppButton, AppCard, AppEmptyState } from '@/shared/components';

/** Open roles with their candidates by stage (a stacked bar), openings filled and closing date, plus stage totals. */
defineProps<{ jobs: Job[]; total: number; loading?: boolean; canPost?: boolean }>();

const ACTIVE: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
const count = (j: Job, s: ApplicationStage) => j.pipeline[s] ?? 0;
const active = (j: Job) => ACTIVE.reduce((n, s) => n + count(j, s), 0);
function closing(iso: string | null) {
  if (!iso) return null;
  const n = daysUntil(iso.slice(0, 10));
  if (n < 0) return { text: `Closed ${-n} day${n === -1 ? '' : 's'} ago`, late: true };
  return { text: n === 0 ? 'Closes today' : `Closes in ${n} day${n === 1 ? '' : 's'}`, late: n <= 7 };
}
</script>

<template>
  <AppCard :icon="Briefcase" title="Hiring pipeline" :description="`${total} open role${total === 1 ? '' : 's'} and where their candidates are`" :padded="false" fill>
    <template #actions><AppButton size="sm" variant="ghost" to="/hr/recruitment/jobs">All jobs</AppButton></template>
    <div v-if="loading" class="space-y-3 p-4">
      <div v-for="i in 3" :key="i" class="skeleton h-12 rounded-md" />
    </div>
    <AppEmptyState v-else-if="!jobs.length" class="flex-1" compact :icon="Briefcase" title="No open roles" description="Published jobs and their candidates appear here.">
      <AppButton v-if="canPost" size="sm" variant="secondary" :icon="UserPlus" to="/hr/recruitment/jobs">Post a job</AppButton>
    </AppEmptyState>
    <template v-else>
      <ul class="divide-y divide-line/60">
        <li v-for="j in jobs" :key="j.id">
          <RouterLink :to="`/hr/recruitment/jobs/${j.id}`" class="grid gap-x-6 gap-y-2 px-4 py-3 transition hover:bg-surface-muted/50 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-fg">{{ j.title }}</p>
              <p class="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                <span class="truncate">{{ [j.requisition.department?.name, j.requisition.location?.name].filter(Boolean).join(' · ') || j.requisition.code }}</span>
                <span class="tabular-nums">· {{ j.requisition.hiredCount }}/{{ j.requisition.openings }} filled</span>
                <span v-if="closing(j.closesOn)" :class="['inline-flex items-center gap-1', closing(j.closesOn)!.late ? 'text-warning-fg' : '']">
                  <CalendarClock :size="12" aria-hidden="true" />{{ closing(j.closesOn)!.text }}
                </span>
              </p>
            </div>
            <div class="min-w-0">
              <template v-if="active(j)">
                <div class="flex h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                  <span v-for="s in ACTIVE" v-show="count(j, s)" :key="s" :class="['h-full border-e-2 border-surface last:border-e-0', stageAccent[s]]" :style="{ width: `${(count(j, s) / active(j)) * 100}%` }" />
                </div>
                <p class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-fg-muted">
                  <span v-for="s in ACTIVE" v-show="count(j, s)" :key="s" class="inline-flex items-center gap-1">
                    <span :class="['h-1.5 w-1.5 rounded-full', stageAccent[s]]" aria-hidden="true" />{{ STAGE_LABELS[s] }} <span class="font-semibold text-fg tabular-nums">{{ count(j, s) }}</span>
                  </span>
                </p>
              </template>
              <AppBadge v-else tone="warning" size="sm" dot>No applicants yet</AppBadge>
            </div>
          </RouterLink>
        </li>
      </ul>
      <dl aria-label="Candidates by stage across the roles shown" class="mt-auto grid grid-cols-3 gap-px border-t border-line/70 bg-line/70 sm:grid-cols-5">
        <div v-for="s in ACTIVE" :key="s" class="bg-surface px-4 py-3">
          <dt class="flex items-center gap-1.5 text-2xs font-medium text-fg-muted"><span :class="['h-1.5 w-1.5 rounded-full', stageAccent[s]]" aria-hidden="true" />{{ STAGE_LABELS[s] }}</dt>
          <dd class="mt-0.5 text-lg font-semibold text-fg tabular-nums">{{ jobs.reduce((n, j) => n + count(j, s), 0) }}</dd>
        </div>
      </dl>
    </template>
  </AppCard>
</template>
