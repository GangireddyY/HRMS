<script setup lang="ts">
import { computed, reactive, ref, type Component } from 'vue';
import { AlertTriangle, Briefcase, CalendarClock, Clock, ExternalLink, Eye, MapPin, MessageSquareText, Phone, Star, ThumbsDown, ThumbsUp, Video } from '@lucide/vue';
import { FEEDBACK_RECOMMENDATIONS, type FeedbackRecommendation, type InterviewMode } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import type { MyInterview } from '@/modules/recruitment/types';
import { MODE_LABELS, RECOMMENDATION_LABELS, recommendationTone } from '@/modules/recruitment/utils/recruitment-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSkeleton, AppStatStrip, AppTextarea, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime } from '@/shared/utils/format';

/** Interviews where you are on the panel: candidate summary, resume and your feedback (given once). */
const toast = useFeedbackStore();
const list = useAsync(() => recruitmentApi.myInterviews());
const now = Date.now();
const HOUR = 3_600_000;
/** Feedback is expected within a day of the interview. */
const FEEDBACK_SLA_HOURS = 24;

const at = (i: MyInterview) => new Date(i.scheduledAt).getTime();
const all = computed(() => list.data.value ?? []);
const toReview = computed(() => all.value.filter((i) => !i.myFeedback && i.status !== 'CANCELLED' && at(i) <= now).sort((a, b) => at(a) - at(b)));
const upcoming = computed(() => all.value.filter((i) => i.status === 'SCHEDULED' && at(i) > now).sort((a, b) => at(a) - at(b)));
const done = computed(() => all.value.filter((i) => i.myFeedback).sort((a, b) => at(b) - at(a)));
const isToday = (t: number) => new Date(t).toDateString() === new Date(now).toDateString();
const lateFeedback = (i: MyInterview) => now - at(i) > FEEDBACK_SLA_HOURS * HOUR;
const nextUp = computed(() => upcoming.value[0] ?? null);

type View = 'due' | 'today' | 'upcoming' | 'done';
const view = ref<View | null>(null);
const strip = computed<StripItem[]>(() => [
  { key: 'due', label: 'Feedback due', value: toReview.value.length, hint: toReview.value.some(lateFeedback) ? `${toReview.value.filter(lateFeedback).length} past 24 hours` : 'Within a day of each interview', tone: toReview.value.some(lateFeedback) ? 'danger' : 'warning' },
  { key: 'today', label: 'Today', value: upcoming.value.filter((i) => isToday(at(i))).length, hint: 'Interviews still to come today', tone: 'brand' },
  { key: 'upcoming', label: 'Upcoming', value: upcoming.value.length, hint: nextUp.value ? `Next ${relative(at(nextUp.value))}` : 'Nothing scheduled', tone: 'info' },
  { key: 'done', label: 'Feedback given', value: done.value.length, hint: done.value.length ? `${done.value.filter((i) => i.myFeedback!.recommendation === 'HIRE' || i.myFeedback!.recommendation === 'STRONG_HIRE').length} recommended to hire` : undefined, tone: 'success' },
]);
const show = (v: View) => !view.value || view.value === v || (view.value === 'today' && v === 'upcoming');

/** Upcoming interviews grouped by day: Today, Tomorrow, then dates. */
const upcomingDays = computed(() => {
  const list = view.value === 'today' ? upcoming.value.filter((i) => isToday(at(i))) : upcoming.value;
  const groups: { key: string; label: string; items: MyInterview[] }[] = [];
  for (const i of list) {
    const d = new Date(at(i));
    const key = d.toDateString();
    const tomorrow = new Date(now + 86_400_000).toDateString();
    const label = key === new Date(now).toDateString() ? 'Today' : key === tomorrow ? 'Tomorrow' : d.toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
    if (groups.at(-1)?.key !== key) groups.push({ key, label, items: [] });
    groups.at(-1)!.items.push(i);
  }
  return groups;
});

// ---- Formatting ------------------------------------------------------------------------------------------------
const time = (t: number) => new Date(t).toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' });
const timeRange = (i: MyInterview) => `${time(at(i))} – ${time(at(i) + i.durationMinutes * 60_000)}`;
const tile = (t: number) => {
  const d = new Date(t);
  return { weekday: d.toLocaleDateString(appLocale(), { weekday: 'short' }), day: d.getDate(), month: d.toLocaleDateString(appLocale(), { month: 'short' }) };
};
function relative(t: number): string {
  const diff = t - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(appLocale(), { numeric: 'auto' });
  if (abs < HOUR) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 24 * HOUR) return rtf.format(Math.round(diff / HOUR), 'hour');
  return rtf.format(Math.round(diff / (24 * HOUR)), 'day');
}
const MODE_ICON: Record<InterviewMode, Component> = { VIDEO: Video, PHONE: Phone, IN_PERSON: MapPin };
const isLink = (s: string | null) => !!s && /^https?:\/\//i.test(s);
const openLink = (url: string) => window.open(url, '_blank', 'noopener');
const background = (i: MyInterview) =>
  [[i.candidate.currentTitle, i.candidate.currentCompany].filter(Boolean).join(' at '), i.candidate.experienceYears !== null ? `${i.candidate.experienceYears} yrs experience` : null].filter(Boolean).join(' · ');

async function resume(i: MyInterview) {
  const tab = window.open('', '_blank');
  try {
    const blob = await recruitmentApi.interviewResumeBlob(i.id);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    toast.error('Could not open the resume', e);
  }
}

// ---- Feedback scorecard ----------------------------------------------------------------------------------------
const reviewing = ref<MyInterview | null>(null);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ rating: 0, recommendation: null as FeedbackRecommendation | null, feedback: '' });
const hoverRating = ref(0);
const RATING_LABELS = ['', 'Poor', 'Below the bar', 'Meets the bar', 'Strong', 'Exceptional'];
const saving = ref(false);
function open(i: MyInterview) {
  reset();
  Object.assign(form, { rating: 0, recommendation: null, feedback: '' });
  reviewing.value = i;
}
const REC_STYLE: Record<FeedbackRecommendation, { icon: Component; on: string }> = {
  STRONG_NO_HIRE: { icon: ThumbsDown, on: 'bg-danger-soft text-danger-fg ring-danger/50' },
  NO_HIRE: { icon: ThumbsDown, on: 'bg-danger-soft/70 text-danger-fg ring-danger/35' },
  HIRE: { icon: ThumbsUp, on: 'bg-success-soft/70 text-success-fg ring-success/35' },
  STRONG_HIRE: { icon: ThumbsUp, on: 'bg-success-soft text-success-fg ring-success/50' },
};
const REC_ORDER: FeedbackRecommendation[] = ['STRONG_NO_HIRE', 'NO_HIRE', 'HIRE', 'STRONG_HIRE'];
const recOrder = [...FEEDBACK_RECOMMENDATIONS].sort((a, b) => REC_ORDER.indexOf(a) - REC_ORDER.indexOf(b));
const canSubmit = computed(() => form.rating > 0 && !!form.recommendation && form.feedback.trim().length >= 10);
async function submit() {
  reset();
  saving.value = true;
  try {
    await recruitmentApi.submitFeedback(reviewing.value!.id, { rating: form.rating, recommendation: form.recommendation!, feedback: form.feedback });
    reviewing.value = null;
    toast.success('Feedback submitted', 'Thanks — the recruiter has been notified.');
    await list.run();
  } catch (e) {
    handle(e, 'Could not submit your feedback');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="My interviews" description="Candidates you are interviewing. Your feedback is final once submitted, and you see colleagues' feedback only in the hiring team's view." />
    <AppSkeleton v-if="list.loading.value && !list.data.value" :lines="6" />
    <AppErrorState v-else-if="list.error.value" :error="list.error.value" @retry="list.run" />
    <div v-else-if="!all.length" class="card"><AppEmptyState :icon="CalendarClock" title="No interviews yet" description="When a recruiter adds you to an interview panel, it appears here with the candidate's details and resume." /></div>
    <template v-else>
      <AppStatStrip :items="strip" selectable :selected="view" label="Interview summary" @select="(k) => (view = k as View | null)" />

      <!-- Up next -->
      <section v-if="nextUp && (!view || view === 'upcoming' || view === 'today')" class="card overflow-hidden" aria-label="Next interview">
        <div class="flex flex-wrap items-center gap-5 bg-gradient-to-r from-brand-500/10 via-transparent to-sky-500/10 p-5">
          <div class="flex w-20 shrink-0 flex-col items-center rounded-xl bg-surface py-2 shadow-xs ring-1 ring-line">
            <span class="text-2xs font-semibold tracking-wide text-accent-fg uppercase">{{ tile(at(nextUp)).weekday }}</span>
            <span class="text-3xl leading-9 font-semibold text-fg tabular-nums">{{ tile(at(nextUp)).day }}</span>
            <span class="text-2xs text-fg-muted">{{ tile(at(nextUp)).month }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <p class="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-fg"><Clock :size="13" aria-hidden="true" />Up next · {{ relative(at(nextUp)) }}</p>
            <div class="mt-2 flex items-center gap-3">
              <AppAvatar :name="nextUp.candidate.name" size="lg" />
              <div class="min-w-0">
                <p class="truncate text-lg font-semibold text-fg">{{ nextUp.candidate.name }}</p>
                <p class="truncate text-sm text-fg-muted">{{ background(nextUp) || 'No background on file' }}</p>
              </div>
            </div>
            <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-muted">
              <li class="inline-flex items-center gap-1.5"><Briefcase :size="13" aria-hidden="true" /><span class="font-medium text-fg">{{ nextUp.job.title }}</span> · {{ nextUp.roundName }}</li>
              <li class="inline-flex items-center gap-1.5"><CalendarClock :size="13" aria-hidden="true" />{{ timeRange(nextUp) }} · {{ nextUp.durationMinutes }} min</li>
              <li class="inline-flex items-center gap-1.5">
                <component :is="MODE_ICON[nextUp.mode]" :size="13" aria-hidden="true" />{{ MODE_LABELS[nextUp.mode] }}<template v-if="nextUp.location && !isLink(nextUp.location)"> · {{ nextUp.location }}</template>
              </li>
            </ul>
          </div>
          <div class="flex flex-wrap gap-2">
            <AppButton v-if="nextUp.candidate.hasResume" variant="secondary" :icon="Eye" @click="resume(nextUp)">Resume</AppButton>
            <AppButton v-if="isLink(nextUp.location)" :icon="ExternalLink" @click="openLink(nextUp.location!)">Join call</AppButton>
          </div>
        </div>
      </section>

      <!-- Feedback due -->
      <section v-if="show('due') && toReview.length" class="card" aria-labelledby="due-title">
        <header class="flex items-center gap-2 border-b border-line/70 px-4 py-3">
          <MessageSquareText :size="16" class="text-warning-fg" aria-hidden="true" />
          <h2 id="due-title" class="text-sm font-semibold text-fg">Waiting for your feedback</h2>
          <AppBadge size="sm" tone="warning">{{ toReview.length }}</AppBadge>
          <span class="ms-auto text-xs text-fg-muted">Fresh feedback is the most accurate — aim for the same day.</span>
        </header>
        <ul class="divide-y divide-line/70">
          <li v-for="i in toReview" :key="i.id" :class="['relative flex flex-wrap items-center gap-4 px-4 py-3.5', lateFeedback(i) && 'bg-danger-soft/25']">
            <span v-if="lateFeedback(i)" class="absolute inset-y-0 start-0 w-1 bg-danger" aria-hidden="true" />
            <div class="flex w-14 shrink-0 flex-col items-center rounded-lg bg-surface-muted py-1.5">
              <span class="text-2xs font-semibold text-fg-muted uppercase">{{ tile(at(i)).month }}</span>
              <span class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ tile(at(i)).day }}</span>
            </div>
            <AppAvatar :name="i.candidate.name" size="md" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-fg">{{ i.candidate.name }} <span class="font-normal text-fg-muted">· {{ i.job.title }}</span></p>
              <p class="truncate text-xs text-fg-muted">{{ i.roundName }} · {{ MODE_LABELS[i.mode] }} · interviewed {{ relative(at(i)) }}</p>
            </div>
            <span v-if="lateFeedback(i)" class="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger-fg"><AlertTriangle :size="12" aria-hidden="true" />Past 24 hours</span>
            <AppButton v-if="i.candidate.hasResume" size="sm" variant="ghost" :icon="Eye" :aria-label="`Resume of ${i.candidate.name}`" @click="resume(i)" />
            <AppButton size="sm" :icon="MessageSquareText" @click="open(i)">Give feedback</AppButton>
          </li>
        </ul>
      </section>

      <!-- Upcoming, by day -->
      <section v-if="show('upcoming') && upcomingDays.length" class="card" aria-labelledby="upcoming-title">
        <header class="flex items-center gap-2 border-b border-line/70 px-4 py-3">
          <CalendarClock :size="16" class="text-accent-fg" aria-hidden="true" />
          <h2 id="upcoming-title" class="text-sm font-semibold text-fg">{{ view === 'today' ? 'Today' : 'Upcoming' }}</h2>
        </header>
        <div v-for="g in upcomingDays" :key="g.key">
          <h3 class="border-b border-line/60 bg-surface-muted/50 px-4 py-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase">{{ g.label }}</h3>
          <ul class="divide-y divide-line/70">
            <li v-for="i in g.items" :key="i.id" class="flex flex-wrap items-center gap-4 px-4 py-3.5">
              <div class="w-24 shrink-0">
                <p class="text-sm font-semibold text-fg tabular-nums">{{ time(at(i)) }}</p>
                <p class="text-2xs text-fg-muted">{{ i.durationMinutes }} min · {{ relative(at(i)) }}</p>
              </div>
              <AppAvatar :name="i.candidate.name" size="md" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-fg">{{ i.candidate.name }} <span class="font-normal text-fg-muted">· {{ i.job.title }}</span></p>
                <p class="truncate text-xs text-fg-muted">{{ i.roundName }}<template v-if="background(i)"> · {{ background(i) }}</template></p>
              </div>
              <span class="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs text-fg-muted">
                <component :is="MODE_ICON[i.mode]" :size="12" aria-hidden="true" />{{ MODE_LABELS[i.mode] }}<template v-if="i.location && !isLink(i.location)"> · {{ i.location }}</template>
              </span>
              <AppButton v-if="isLink(i.location)" size="sm" variant="secondary" :icon="ExternalLink" @click="openLink(i.location!)">Join</AppButton>
              <AppButton v-if="i.candidate.hasResume" size="sm" variant="secondary" :icon="Eye" @click="resume(i)">Resume</AppButton>
            </li>
          </ul>
        </div>
      </section>

      <!-- Feedback given -->
      <section v-if="show('done') && done.length" class="card" aria-labelledby="done-title">
        <header class="flex items-center gap-2 border-b border-line/70 px-4 py-3">
          <ThumbsUp :size="16" class="text-success-fg" aria-hidden="true" />
          <h2 id="done-title" class="text-sm font-semibold text-fg">Feedback given</h2>
        </header>
        <ul class="divide-y divide-line/70">
          <li v-for="i in done" :key="i.id" class="flex flex-wrap items-start gap-4 px-4 py-3.5">
            <AppAvatar :name="i.candidate.name" size="md" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-fg">{{ i.candidate.name }} <span class="font-normal text-fg-muted">· {{ i.job.title }}</span></p>
              <p class="text-xs text-fg-muted">{{ i.roundName }} · {{ formatDateTime(i.scheduledAt) }} · submitted {{ relative(new Date(i.myFeedback!.submittedAt).getTime()) }}</p>
              <p class="mt-1.5 line-clamp-2 text-sm text-fg-muted">“{{ i.myFeedback!.feedback }}”</p>
            </div>
            <div class="flex flex-col items-end gap-1.5">
              <AppBadge :tone="recommendationTone[i.myFeedback!.recommendation]" dot>{{ RECOMMENDATION_LABELS[i.myFeedback!.recommendation] }}</AppBadge>
              <span class="flex items-center gap-0.5" :aria-label="`${i.myFeedback!.rating} of 5 stars`">
                <Star v-for="n in 5" :key="n" :size="13" :class="n <= i.myFeedback!.rating ? 'fill-warning text-warning' : 'text-line-strong'" aria-hidden="true" />
              </span>
            </div>
          </li>
        </ul>
      </section>

      <div v-if="view && !((view === 'due' && toReview.length) || ((view === 'upcoming' || view === 'today') && upcomingDays.length) || (view === 'done' && done.length))" class="card">
        <AppEmptyState compact :icon="CalendarClock" title="Nothing here" description="Pick another figure above, or clear the filter.">
          <AppButton size="sm" variant="secondary" @click="view = null">Show everything</AppButton>
        </AppEmptyState>
      </div>
    </template>

    <!-- Scorecard -->
    <AppModal :open="!!reviewing" :title="reviewing ? `Scorecard · ${reviewing.candidate.name}` : ''" :description="reviewing ? `${reviewing.roundName} for ${reviewing.job.title} · ${formatDateTime(reviewing.scheduledAt)}` : undefined" :guide="false" @close="reviewing = null">
      <form v-if="reviewing" id="feedback-form" class="space-y-6" novalidate @submit.prevent="submit">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <div class="flex items-center gap-3 rounded-lg bg-surface-muted/60 p-3">
          <AppAvatar :name="reviewing.candidate.name" size="lg" />
          <div class="min-w-0 flex-1">
            <p class="truncate font-semibold text-fg">{{ reviewing.candidate.name }}</p>
            <p class="truncate text-xs text-fg-muted">{{ background(reviewing) || 'No background on file' }}</p>
          </div>
          <AppButton v-if="reviewing.candidate.hasResume" size="sm" variant="secondary" :icon="Eye" @click="resume(reviewing)">Resume</AppButton>
        </div>

        <fieldset>
          <legend class="label">Overall rating <span class="text-danger">*</span></legend>
          <div class="flex flex-wrap items-center gap-3">
            <div class="flex gap-1" role="radiogroup" aria-label="Overall rating" @mouseleave="hoverRating = 0">
              <button
                v-for="n in 5"
                :key="n"
                type="button"
                role="radio"
                :aria-checked="form.rating === n"
                :aria-label="`${n} of 5, ${RATING_LABELS[n]}`"
                class="rounded-md p-0.5 transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                @mouseenter="hoverRating = n"
                @click="form.rating = n"
              >
                <Star :size="30" :class="n <= (hoverRating || form.rating) ? 'fill-warning text-warning' : 'text-line-strong'" aria-hidden="true" />
              </button>
            </div>
            <span class="text-sm font-medium" :class="hoverRating || form.rating ? 'text-fg' : 'text-fg-subtle'">{{ RATING_LABELS[hoverRating || form.rating] || 'Choose a rating' }}</span>
          </div>
        </fieldset>

        <fieldset>
          <legend class="label">Recommendation <span class="text-danger">*</span></legend>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Recommendation">
            <button
              v-for="r in recOrder"
              :key="r"
              type="button"
              role="radio"
              :aria-checked="form.recommendation === r"
              :class="[
                'flex flex-col items-center gap-1.5 rounded-xl px-3 py-3 text-sm font-medium ring-1 transition ring-inset focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
                form.recommendation === r ? REC_STYLE[r].on : 'text-fg-muted ring-line hover:bg-surface-muted',
              ]"
              @click="form.recommendation = r"
            >
              <span class="flex">
                <component :is="REC_STYLE[r].icon" :size="18" aria-hidden="true" />
                <component :is="REC_STYLE[r].icon" v-if="r.startsWith('STRONG')" :size="18" class="-ms-1.5" aria-hidden="true" />
              </span>
              {{ RECOMMENDATION_LABELS[r] }}
            </button>
          </div>
          <p v-if="fieldErrors.recommendation" class="mt-1 text-xs text-danger-fg">{{ fieldErrors.recommendation }}</p>
        </fieldset>

        <AppTextarea
          v-model="form.feedback"
          label="Feedback"
          required
          :rows="7"
          :maxlength="4000"
          placeholder="Strengths — what did they do well, with examples?&#10;Concerns — where did they fall short?&#10;Evidence — questions asked and how they answered."
          help="Focus on job-related evidence. At least 10 characters."
          :error="fieldErrors.feedback"
        />
        <AppAlert tone="warning">Feedback is final once submitted and is shared only with the hiring team.</AppAlert>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="reviewing = null">Cancel</AppButton>
        <AppButton type="submit" form="feedback-form" :icon="MessageSquareText" :loading="saving" :disabled="!canSubmit">Submit feedback</AppButton>
      </template>
    </AppModal>
  </div>
</template>
