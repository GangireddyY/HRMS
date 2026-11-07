<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ShieldCheck } from '@lucide/vue';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import type { QuestionResult } from '@/modules/engagement/types';
import { SURVEY_STATUS_LABELS, surveyTone } from '@/modules/engagement/utils/engagement-format';
import { AppAlert, AppBadge, AppCard, AppErrorState, AppPageHeader, AppSkeleton, AppStatCard } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';

const route = useRoute();
const id = computed(() => String(route.params.id));
const results = useAsync(() => engagementApi.results(id.value));
watch(id, () => void results.run());
const r = computed(() => results.data.value);
const bars = (q: QuestionResult) => {
  const entries = Object.entries(q.distribution ?? {}).map(([k, v]) => ({ key: Number(k), label: q.type === 'CHOICE' ? (q.options?.[Number(k)] ?? k) : k, count: v }));
  const max = Math.max(1, ...entries.map((e) => e.count));
  return entries.map((e) => ({ ...e, pct: (e.count / max) * 100, share: q.answered ? Math.round((e.count / q.answered) * 100) : 0 }));
};
</script>

<template>
  <div>
    <AppSkeleton v-if="results.loading.value && !r" :lines="8" />
    <AppErrorState v-else-if="results.error.value" :error="results.error.value" @retry="results.run" />
    <template v-else-if="r">
      <AppPageHeader :title="r.survey.title" :description="r.survey.description ?? undefined" back="/hr/engagement/surveys" back-label="Surveys">
        <template #badges>
          <AppBadge :tone="surveyTone[r.survey.status]" dot>{{ SURVEY_STATUS_LABELS[r.survey.status] }}</AppBadge>
          <AppBadge v-if="r.survey.anonymous">Anonymous</AppBadge>
        </template>
      </AppPageHeader>
      <div class="mb-4 grid gap-4 sm:grid-cols-3">
        <AppStatCard label="Responses" :value="r.responses" />
        <AppStatCard label="Audience" :value="r.audience" tone="info" />
        <AppStatCard label="Response rate" :value="r.responseRate === null ? '—' : `${r.responseRate}%`" tone="success" />
      </div>
      <AppAlert v-if="r.hidden" tone="info" title="Not enough responses yet">
        <span class="inline-flex items-start gap-2"><ShieldCheck :size="16" class="mt-0.5 shrink-0" aria-hidden="true" />To protect anonymity, results appear once at least {{ r.threshold }} people have answered.</span>
      </AppAlert>
      <div v-else class="space-y-4">
        <AppCard v-for="(q, i) in r.questions" :key="q.questionId" :title="`${i + 1}. ${q.prompt}`" :description="`${q.answered} answer${q.answered === 1 ? '' : 's'}`">
          <template v-if="q.type === 'NPS' && q.nps">
            <div class="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p class="text-3xl font-semibold text-fg tabular-nums">{{ q.nps.score ?? '—' }}</p>
              <p class="text-sm text-fg-muted">eNPS · {{ q.nps.promoters }} promoters, {{ q.nps.passives }} passives, {{ q.nps.detractors }} detractors · average {{ q.average ?? '—' }}</p>
            </div>
          </template>
          <p v-else-if="q.type === 'RATING'" class="mb-4 text-sm text-fg-muted">Average <span class="text-2xl font-semibold text-fg tabular-nums">{{ q.average ?? '—' }}</span> / 5</p>
          <ul v-if="q.type !== 'TEXT'" class="space-y-1.5">
            <li v-for="b in bars(q)" :key="b.key" class="grid grid-cols-[minmax(0,10rem)_1fr_4rem] items-center gap-3 text-sm">
              <span class="truncate text-fg-muted">{{ b.label }}</span>
              <span class="h-2 rounded-full bg-surface-muted"><span class="block h-2 rounded-full bg-brand-500" :style="{ width: `${b.pct}%` }" /></span>
              <span class="text-right tabular-nums text-fg-muted">{{ b.count }} · {{ b.share }}%</span>
            </li>
          </ul>
          <ul v-else class="space-y-2">
            <li v-if="!q.texts?.length" class="text-sm text-fg-muted">No answers.</li>
            <li v-for="(t, ti) in q.texts" :key="ti" class="rounded-lg bg-surface-muted/60 px-3 py-2 text-sm whitespace-pre-line text-fg">{{ t }}</li>
          </ul>
        </AppCard>
        <AppCard v-if="r.respondents" title="Respondents" description="Named survey">
          <p class="text-sm text-fg-muted">{{ r.respondents.join(', ') || '—' }}</p>
        </AppCard>
      </div>
    </template>
  </div>
</template>
