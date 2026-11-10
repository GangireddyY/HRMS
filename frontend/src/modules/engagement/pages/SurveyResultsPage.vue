<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CalendarClock, Gauge, Hash, ListChecks, Lock, MessageSquareQuote, Quote, ShieldCheck, Star, Users } from '@lucide/vue';
import type { SurveyQuestionType } from '@contracts';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import type { QuestionResult } from '@/modules/engagement/types';
import { QUESTION_TYPE_LABELS, SURVEY_STATUS_LABELS, surveyTone } from '@/modules/engagement/utils/engagement-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime, timeAgo } from '@/shared/utils/format';

/** Survey results: response rate, headline scores and a visual breakdown of every question (ratings, eNPS, choices, comments). */
const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const results = useAsync(() => engagementApi.results(id.value));
watch(id, () => void results.run());
const r = computed(() => results.data.value);
const bars = (q: QuestionResult) => {
  const entries = Object.entries(q.distribution ?? {}).map(([k, v]) => ({ key: Number(k), label: q.type === 'CHOICE' ? (q.options?.[Number(k)] ?? k) : k, count: v }));
  const max = Math.max(1, ...entries.map((e) => e.count));
  return entries.map((e) => ({ ...e, pct: (e.count / max) * 100, share: q.answered ? Math.round((e.count / q.answered) * 100) : 0 }));
};

const closing = ref(false);
async function closeSurvey() {
  const s = r.value!.survey;
  if (!(await feedback.confirm({ title: `Close "${s.title}"?`, message: 'No more answers are accepted.', confirmLabel: 'Close survey' }))) return;
  closing.value = true;
  try {
    await engagementApi.closeSurvey(s.id);
    feedback.success('Survey closed');
    await results.run();
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    closing.value = false;
  }
}

// ---- Visual helpers ----------------------------------------------------------------------------------------------
const TYPE_ICON: Record<SurveyQuestionType, typeof Star> = { RATING: Star, NPS: Gauge, CHOICE: ListChecks, TEXT: MessageSquareQuote };
const RATING_COLOR = ['bg-red-500', 'bg-orange-400', 'bg-amber-400', 'bg-lime-500', 'bg-emerald-500'];
const RATE_CIRC = 2 * Math.PI * 42;
/** Rating questions as unfavourable (1–2), neutral (3) and favourable (4–5) shares. */
function favourability(q: QuestionResult) {
  const d = q.distribution ?? {};
  const n = q.answered || 1;
  const low = (d[1] ?? 0) + (d[2] ?? 0);
  const mid = d[3] ?? 0;
  const high = (d[4] ?? 0) + (d[5] ?? 0);
  return { low: Math.round((low / n) * 100), mid: Math.round((mid / n) * 100), high: Math.round((high / n) * 100) };
}
const ratingRows = (q: QuestionResult) => bars(q).sort((a, b) => b.key - a.key);
const choiceRows = (q: QuestionResult) => {
  const rows = bars(q).sort((a, b) => b.count - a.count);
  const max = rows[0]?.count ?? 0;
  return rows.map((row) => ({ ...row, top: max > 0 && row.count === max }));
};
/** eNPS groups for the 0–10 scale. */
const npsGroup = (k: number) => (k >= 9 ? 'promoter' : k >= 7 ? 'passive' : 'detractor');
const NPS_BAR = { promoter: 'bg-emerald-500', passive: 'bg-amber-400', detractor: 'bg-red-500' } as const;
const npsShare = (q: QuestionResult, n: number) => (q.answered ? Math.round((n / q.answered) * 100) : 0);
const npsTone = (score: number | null) => (score === null ? 'text-fg-muted' : score < 0 ? 'text-danger-fg' : score < 20 ? 'text-warning-fg' : score < 50 ? 'text-accent-fg' : 'text-success-fg');
const npsStroke = (score: number | null) => (score === null ? 'stroke-line' : score < 0 ? 'stroke-danger' : score < 20 ? 'stroke-warning' : score < 50 ? 'stroke-brand-500' : 'stroke-success');
const npsVerdict = (score: number | null) => (score === null ? 'Not enough answers' : score < 0 ? 'Needs work' : score < 20 ? 'Fair' : score < 50 ? 'Good' : 'Excellent');
/** Half-circle gauge for −100…100: arc length of the filled part. */
const GAUGE_LEN = Math.PI * 50;
const gaugeFill = (score: number | null) => (score === null ? 0 : ((Math.max(-100, Math.min(100, score)) + 100) / 200) * GAUGE_LEN);
const npsMax = (q: QuestionResult) => Math.max(1, ...Object.values(q.distribution ?? {}));

// ---- Headlines ---------------------------------------------------------------------------------------------------
const headlines = computed(() => {
  if (!r.value || r.value.hidden) return [];
  const out: { key: string; label: string; value: string; hint: string; tone: string; icon: typeof Star }[] = [];
  const nps = r.value.questions.find((q) => q.type === 'NPS' && q.nps);
  if (nps?.nps) out.push({ key: 'nps', label: 'eNPS', value: nps.nps.score === null ? '—' : `${nps.nps.score > 0 ? '+' : ''}${nps.nps.score}`, hint: npsVerdict(nps.nps.score), tone: npsTone(nps.nps.score), icon: Gauge });
  const ratings = r.value.questions.filter((q) => q.type === 'RATING' && q.answered);
  if (ratings.length) {
    const avg = ratings.reduce((n, q) => n + (q.average ?? 0), 0) / ratings.length;
    const fav = Math.round(ratings.reduce((n, q) => n + favourability(q).high, 0) / ratings.length);
    out.push({ key: 'avg', label: ratings.length === 1 ? 'Average rating' : 'Average across ratings', value: `${avg.toFixed(1)} / 5`, hint: `${fav}% favourable (4–5)`, tone: avg >= 4 ? 'text-success-fg' : avg >= 3 ? 'text-accent-fg' : 'text-warning-fg', icon: Star });
  }
  const comments = r.value.questions.filter((q) => q.type === 'TEXT').reduce((n, q) => n + (q.texts?.length ?? 0), 0);
  if (r.value.questions.some((q) => q.type === 'TEXT')) out.push({ key: 'text', label: 'Comments', value: String(comments), hint: 'Free-text answers', tone: 'text-fg', icon: MessageSquareQuote });
  return out;
});
const rateTone = computed(() => {
  const rate = r.value?.responseRate ?? 0;
  return rate >= 70 ? 'stroke-success' : rate >= 40 ? 'stroke-brand-500' : 'stroke-warning';
});
const jump = (qid: string) => document.getElementById(`q-${qid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
const showAllTexts = ref<Record<string, boolean>>({});
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
        <template v-if="r.survey.status === 'OPEN'" #actions>
          <AppButton variant="secondary" :icon="Lock" :loading="closing" @click="closeSurvey">Close survey</AppButton>
        </template>
      </AppPageHeader>

      <!-- Summary -->
      <section class="card mb-4 overflow-hidden" aria-label="Response summary">
        <div class="flex flex-wrap items-center gap-6 px-5 py-5">
          <div class="flex items-center gap-4">
            <div class="relative h-28 w-28 shrink-0">
              <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" class="stroke-surface-muted" />
                <circle cx="50" cy="50" r="42" fill="none" stroke-width="9" stroke-linecap="round" :class="['transition-[stroke-dashoffset] duration-700', rateTone]" :stroke-dasharray="RATE_CIRC" :stroke-dashoffset="RATE_CIRC * (1 - Math.min(100, r.responseRate ?? 0) / 100)" />
              </svg>
              <div class="absolute inset-0 flex flex-col items-center justify-center">
                <span class="text-2xl font-semibold text-fg tabular-nums">{{ r.responseRate === null ? '—' : `${r.responseRate}%` }}</span>
                <span class="text-2xs text-fg-muted">response rate</span>
              </div>
            </div>
            <div>
              <p class="text-2xl font-semibold text-fg tabular-nums">{{ r.responses }}<span class="text-base font-normal text-fg-muted"> / {{ r.audience }}</span></p>
              <p class="text-sm text-fg-muted">people responded</p>
              <p class="mt-1 text-xs text-fg-subtle">{{ Math.max(0, r.audience - r.responses) }} yet to answer</p>
            </div>
          </div>
          <div v-if="headlines.length" class="grid min-w-0 flex-1 basis-96 gap-3 sm:grid-cols-3">
            <div v-for="h in headlines" :key="h.key" class="rounded-xl bg-surface-muted/60 px-4 py-3 ring-1 ring-line/60">
              <p class="flex items-center gap-1.5 text-xs font-medium text-fg-muted"><component :is="h.icon" :size="13" aria-hidden="true" />{{ h.label }}</p>
              <p :class="['mt-1 text-2xl font-semibold tabular-nums', h.tone]">{{ h.value }}</p>
              <p class="truncate text-2xs text-fg-subtle">{{ h.hint }}</p>
            </div>
          </div>
        </div>
        <dl class="grid grid-cols-2 gap-px border-t border-line/70 bg-line/70 text-xs sm:grid-cols-4">
          <div class="bg-surface px-5 py-2.5"><dt class="text-fg-subtle">Opened</dt><dd class="mt-0.5 font-medium text-fg">{{ r.survey.openedAt ? `${formatDate(r.survey.openedAt)} · ${timeAgo(r.survey.openedAt)}` : '—' }}</dd></div>
          <div class="bg-surface px-5 py-2.5"><dt class="text-fg-subtle">{{ r.survey.closedAt ? 'Closed' : 'Closes' }}</dt><dd class="mt-0.5 font-medium text-fg">{{ r.survey.closedAt ? formatDateTime(r.survey.closedAt) : r.survey.closesAt ? formatDateTime(r.survey.closesAt) : 'When you close it' }}</dd></div>
          <div class="bg-surface px-5 py-2.5"><dt class="text-fg-subtle">Audience</dt><dd class="mt-0.5 font-medium text-fg">{{ r.survey.departmentIds?.length ? `${r.survey.departmentIds.length} department${r.survey.departmentIds.length === 1 ? '' : 's'}` : 'Everyone' }} · {{ r.audience }} people</dd></div>
          <div class="bg-surface px-5 py-2.5"><dt class="text-fg-subtle">Privacy</dt><dd class="mt-0.5 font-medium text-fg">{{ r.survey.anonymous ? `Anonymous · shown from ${r.threshold} answers` : 'Named responses' }}</dd></div>
        </dl>
      </section>

      <AppAlert v-if="r.hidden" tone="info" title="Not enough responses yet">
        <span class="inline-flex items-start gap-2"><ShieldCheck :size="16" class="mt-0.5 shrink-0" aria-hidden="true" />To protect anonymity, results appear once at least {{ r.threshold }} people have answered.</span>
      </AppAlert>
      <div v-else class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div class="min-w-0 space-y-4">
          <AppEmptyState v-if="!r.questions.length" class="card" title="No questions" description="This survey has no questions to report on." />
          <section v-for="(q, i) in r.questions" :id="`q-${q.questionId}`" :key="q.questionId" class="card scroll-mt-4 overflow-hidden" :aria-labelledby="`qt-${q.questionId}`">
            <header class="flex items-start gap-3 border-b border-line/70 px-4 py-3">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-xs font-semibold text-accent-fg shadow-xs tabular-nums" aria-hidden="true">{{ i + 1 }}</span>
              <div class="min-w-0 flex-1">
                <h2 :id="`qt-${q.questionId}`" class="text-sm font-semibold text-fg"><span class="sr-only">Question {{ i + 1 }}: </span>{{ q.prompt }}</h2>
                <p class="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted"><component :is="TYPE_ICON[q.type]" :size="12" aria-hidden="true" />{{ QUESTION_TYPE_LABELS[q.type] }} · {{ q.answered }} answer{{ q.answered === 1 ? '' : 's' }}<template v-if="r.responses && q.answered < r.responses"> · {{ r.responses - q.answered }} skipped</template></p>
              </div>
            </header>

            <div class="p-4">
              <!-- Rating -->
              <div v-if="q.type === 'RATING'" class="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
                <div>
                  <p class="text-4xl font-semibold text-fg tabular-nums">{{ q.average == null ? '—' : q.average.toFixed(1) }}<span class="text-base font-normal text-fg-muted"> / 5</span></p>
                  <p class="mt-1 flex gap-0.5" :aria-label="`Average ${q.average ?? 'not available'} out of 5`">
                    <Star v-for="n in 5" :key="n" :size="16" :class="n <= Math.round(q.average ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-fg-subtle/40'" aria-hidden="true" />
                  </p>
                  <div class="mt-4">
                    <div class="flex h-2.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${favourability(q).high}% favourable, ${favourability(q).mid}% neutral, ${favourability(q).low}% unfavourable`">
                      <span class="h-full bg-emerald-500" :style="{ width: `${favourability(q).high}%` }" />
                      <span class="h-full bg-amber-400" :style="{ width: `${favourability(q).mid}%` }" />
                      <span class="h-full bg-red-500" :style="{ width: `${favourability(q).low}%` }" />
                    </div>
                    <dl class="mt-2 grid grid-cols-3 gap-1 text-2xs">
                      <div><dt class="text-fg-subtle">Favourable</dt><dd class="font-semibold text-success-fg tabular-nums">{{ favourability(q).high }}%</dd></div>
                      <div><dt class="text-fg-subtle">Neutral</dt><dd class="font-semibold text-warning-fg tabular-nums">{{ favourability(q).mid }}%</dd></div>
                      <div><dt class="text-fg-subtle">Unfavourable</dt><dd class="font-semibold text-danger-fg tabular-nums">{{ favourability(q).low }}%</dd></div>
                    </dl>
                  </div>
                </div>
                <ul class="space-y-2 self-center" aria-label="Answers by rating">
                  <li v-for="b in ratingRows(q)" :key="b.key" class="grid grid-cols-[3rem_1fr_5rem] items-center gap-3 text-sm">
                    <span class="flex items-center gap-1 text-fg-muted tabular-nums">{{ b.label }}<Star :size="11" class="fill-current text-amber-400" aria-hidden="true" /></span>
                    <span class="h-2.5 rounded-full bg-surface-muted"><span :class="['block h-2.5 rounded-full transition-[width] duration-500', RATING_COLOR[b.key - 1] ?? 'bg-brand-500']" :style="{ width: `${b.pct}%` }" /></span>
                    <span class="text-end text-xs text-fg-muted tabular-nums"><span class="font-medium text-fg">{{ b.count }}</span> · {{ b.share }}%</span>
                  </li>
                </ul>
              </div>

              <!-- eNPS -->
              <div v-else-if="q.type === 'NPS' && q.nps" class="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
                <div class="flex flex-col items-center">
                  <svg viewBox="0 0 120 78" class="w-full max-w-52" role="img" :aria-label="`eNPS ${q.nps.score ?? 'not available'} on a scale from minus 100 to 100`">
                    <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke-width="11" stroke-linecap="round" class="stroke-surface-muted" />
                    <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke-width="11" stroke-linecap="round" :class="['transition-[stroke-dasharray] duration-700', npsStroke(q.nps.score)]" :stroke-dasharray="`${gaugeFill(q.nps.score)} ${GAUGE_LEN}`" />
                    <text x="60" y="54" text-anchor="middle" :class="['fill-current text-[22px] font-semibold', npsTone(q.nps.score)]">{{ q.nps.score === null ? '—' : `${q.nps.score > 0 ? '+' : ''}${q.nps.score}` }}</text>
                    <text x="12" y="76" text-anchor="middle" class="fill-current text-[7px] text-fg-subtle">−100</text>
                    <text x="60" y="76" text-anchor="middle" class="fill-current text-[7px] text-fg-subtle">0</text>
                    <text x="108" y="76" text-anchor="middle" class="fill-current text-[7px] text-fg-subtle">+100</text>
                  </svg>
                  <p :class="['text-sm font-semibold', npsTone(q.nps.score)]">{{ npsVerdict(q.nps.score) }}</p>
                  <p class="text-xs text-fg-muted">eNPS · average {{ q.average ?? '—' }} / 10</p>
                </div>
                <div class="min-w-0 space-y-4">
                  <div>
                    <div class="flex h-3 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${q.nps.promoters} promoters, ${q.nps.passives} passives, ${q.nps.detractors} detractors`">
                      <span class="h-full bg-red-500" :style="{ width: `${npsShare(q, q.nps.detractors)}%` }" />
                      <span class="h-full bg-amber-400" :style="{ width: `${npsShare(q, q.nps.passives)}%` }" />
                      <span class="h-full bg-emerald-500" :style="{ width: `${npsShare(q, q.nps.promoters)}%` }" />
                    </div>
                    <dl class="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div><dt class="flex items-center gap-1.5 text-fg-muted"><span class="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />Detractors 0–6</dt><dd class="mt-0.5 font-semibold text-fg tabular-nums">{{ q.nps.detractors }} <span class="font-normal text-fg-muted">· {{ npsShare(q, q.nps.detractors) }}%</span></dd></div>
                      <div><dt class="flex items-center gap-1.5 text-fg-muted"><span class="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />Passives 7–8</dt><dd class="mt-0.5 font-semibold text-fg tabular-nums">{{ q.nps.passives }} <span class="font-normal text-fg-muted">· {{ npsShare(q, q.nps.passives) }}%</span></dd></div>
                      <div><dt class="flex items-center gap-1.5 text-fg-muted"><span class="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />Promoters 9–10</dt><dd class="mt-0.5 font-semibold text-fg tabular-nums">{{ q.nps.promoters }} <span class="font-normal text-fg-muted">· {{ npsShare(q, q.nps.promoters) }}%</span></dd></div>
                    </dl>
                  </div>
                  <div>
                    <p class="mb-1.5 text-2xs font-medium text-fg-subtle uppercase">Answers on the 0–10 scale</p>
                    <ol class="flex h-24 items-end gap-1" aria-label="Answers by score">
                      <li v-for="b in bars(q)" :key="b.key" class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" :title="`${b.key}: ${b.count} (${b.share}%)`">
                        <span class="text-2xs text-fg-muted tabular-nums">{{ b.count || '' }}</span>
                        <span :class="['w-full rounded-t', b.count ? NPS_BAR[npsGroup(b.key)] : 'bg-surface-muted']" :style="{ height: b.count ? `${Math.max(6, (b.count / npsMax(q)) * 64)}px` : '3px' }" />
                        <span class="text-2xs text-fg-subtle tabular-nums"><span class="sr-only">Score </span>{{ b.key }}<span class="sr-only">: {{ b.count }} answers</span></span>
                      </li>
                    </ol>
                  </div>
                </div>
              </div>

              <!-- Choice -->
              <ul v-else-if="q.type === 'CHOICE'" class="space-y-3" aria-label="Answers by option">
                <li v-for="b in choiceRows(q)" :key="b.key">
                  <div class="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span :class="['truncate', b.top ? 'font-semibold text-fg' : 'text-fg']">{{ b.label }}<AppBadge v-if="b.top" class="ms-2" size="sm" tone="brand">Top answer</AppBadge></span>
                    <span class="shrink-0 text-xs text-fg-muted tabular-nums"><span class="font-medium text-fg">{{ b.share }}%</span> · {{ b.count }}</span>
                  </div>
                  <div class="h-2.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                    <div :class="['h-full rounded-full transition-[width] duration-500', b.top ? 'bg-brand-600' : 'bg-brand-500/45']" :style="{ width: `${b.share}%` }" />
                  </div>
                </li>
              </ul>

              <!-- Other scored types fall back to plain bars -->
              <ul v-else-if="q.type !== 'TEXT'" class="space-y-2">
                <li v-for="b in bars(q)" :key="b.key" class="grid grid-cols-[minmax(0,10rem)_1fr_4rem] items-center gap-3 text-sm">
                  <span class="truncate text-fg-muted">{{ b.label }}</span>
                  <span class="h-2 rounded-full bg-surface-muted"><span class="block h-2 rounded-full bg-brand-500" :style="{ width: `${b.pct}%` }" /></span>
                  <span class="text-end tabular-nums text-fg-muted">{{ b.count }} · {{ b.share }}%</span>
                </li>
              </ul>

              <!-- Text -->
              <template v-else>
                <AppEmptyState v-if="!q.texts?.length" compact :icon="MessageSquareQuote" title="No answers" description="Nobody wrote anything for this question yet." />
                <ul v-else class="grid gap-2 md:grid-cols-2">
                  <li v-for="(t, ti) in showAllTexts[q.questionId] ? q.texts : q.texts.slice(0, 8)" :key="ti" class="flex gap-2.5 rounded-lg bg-surface-muted/60 px-3 py-2.5 text-sm whitespace-pre-line text-fg ring-1 ring-line/50">
                    <Quote :size="14" class="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />{{ t }}
                  </li>
                </ul>
                <AppButton v-if="(q.texts?.length ?? 0) > 8" class="mt-3" size="sm" variant="ghost" @click="showAllTexts = { ...showAllTexts, [q.questionId]: !showAllTexts[q.questionId] }">{{ showAllTexts[q.questionId] ? 'Show fewer' : `Show all ${q.texts!.length} answers` }}</AppButton>
              </template>
            </div>
          </section>
        </div>

        <aside class="space-y-4 lg:sticky lg:top-4">
          <AppCard title="Questions" :icon="Hash" :padded="false">
            <ol class="divide-y divide-line/70">
              <li v-for="(q, i) in r.questions" :key="q.questionId">
                <button type="button" class="flex w-full items-center gap-3 px-4 py-2.5 text-start transition hover:bg-surface-muted/50 focus-visible:bg-surface-muted/50 focus-visible:outline-none" @click="jump(q.questionId)">
                  <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-2xs font-semibold text-fg-muted tabular-nums">{{ i + 1 }}</span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm text-fg">{{ q.prompt }}</span>
                    <span class="flex items-center gap-1 text-2xs text-fg-subtle"><component :is="TYPE_ICON[q.type]" :size="10" aria-hidden="true" />{{ QUESTION_TYPE_LABELS[q.type] }}</span>
                  </span>
                  <span v-if="q.type === 'RATING' && q.average !== null && q.average !== undefined" class="text-xs font-semibold text-fg tabular-nums">{{ q.average }}</span>
                  <span v-else-if="q.type === 'NPS' && q.nps" :class="['text-xs font-semibold tabular-nums', npsTone(q.nps.score)]">{{ q.nps.score ?? '—' }}</span>
                  <span v-else class="text-xs text-fg-subtle tabular-nums">{{ q.answered }}</span>
                </button>
              </li>
            </ol>
          </AppCard>
          <AppCard v-if="r.respondents" title="Respondents" :icon="Users" :description="`Named survey · ${r.respondents.length} responded`">
            <p class="text-sm text-fg-muted">{{ r.respondents.join(', ') || '—' }}</p>
          </AppCard>
          <section v-else-if="r.survey.anonymous" class="card overflow-hidden">
            <div class="bg-gradient-to-br from-violet-500/10 via-transparent to-brand-300/10 p-4">
              <p class="flex items-center gap-2 text-sm font-semibold text-fg"><ShieldCheck :size="15" class="text-violet-500" aria-hidden="true" />Anonymous survey</p>
              <p class="mt-1 text-xs text-fg-muted">Nobody, including HR, can see who answered what. Results only show once {{ r.threshold }} or more people have responded.</p>
            </div>
          </section>
          <p v-if="r.survey.status === 'OPEN' && r.survey.closesAt" class="flex items-center gap-1.5 px-1 text-xs text-fg-muted"><CalendarClock :size="13" aria-hidden="true" />Closes {{ timeAgo(r.survey.closesAt) }}</p>
        </aside>
      </div>
    </template>
  </div>
</template>
