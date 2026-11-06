<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { CalendarClock, Eye, MessageSquareText } from '@lucide/vue';
import { FEEDBACK_RECOMMENDATIONS, type FeedbackRecommendation } from '@contracts';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import type { MyInterview } from '@/modules/recruitment/types';
import { MODE_LABELS, RECOMMENDATION_LABELS, recommendationTone } from '@/modules/recruitment/utils/recruitment-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime } from '@/shared/utils/format';

/** Interviews where you are on the panel: candidate summary, resume and your feedback (given once). */
const toast = useFeedbackStore();
const list = useAsync(() => recruitmentApi.myInterviews());
const now = Date.now();
const upcoming = computed(() => (list.data.value ?? []).filter((i) => i.status === 'SCHEDULED' && new Date(i.scheduledAt).getTime() > now).reverse());
const toReview = computed(() => (list.data.value ?? []).filter((i) => !i.myFeedback && new Date(i.scheduledAt).getTime() <= now));
const done = computed(() => (list.data.value ?? []).filter((i) => i.myFeedback));

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

const reviewing = ref<MyInterview | null>(null);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ rating: 3, recommendation: null as FeedbackRecommendation | null, feedback: '' });
const saving = ref(false);
function open(i: MyInterview) {
  reset();
  Object.assign(form, { rating: 3, recommendation: null, feedback: '' });
  reviewing.value = i;
}
const recommendationOptions = FEEDBACK_RECOMMENDATIONS.map((r) => ({ value: r, label: RECOMMENDATION_LABELS[r] }));
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
  <div class="space-y-6">
    <AppPageHeader title="My interviews" description="Candidates you are interviewing. Your feedback is final once submitted, and you see colleagues' feedback only in the hiring team's view." />
    <AppSkeleton v-if="list.loading.value && !list.data.value" :lines="5" />
    <AppErrorState v-else-if="list.error.value" :error="list.error.value" @retry="list.run" />
    <template v-else>
      <AppCard v-if="!list.data.value?.length"><AppEmptyState :icon="CalendarClock" title="No interviews" description="When a recruiter adds you to an interview panel, it appears here." /></AppCard>
      <AppCard v-for="section in [{ title: 'Waiting for your feedback', rows: toReview }, { title: 'Upcoming', rows: upcoming }, { title: 'Feedback given', rows: done }].filter((s) => s.rows.length)" :key="section.title" :title="section.title" :padded="false">
        <ul class="divide-y divide-line">
          <li v-for="i in section.rows" :key="i.id" class="flex flex-wrap items-center gap-3 px-5 py-4">
            <div class="min-w-0 flex-1">
              <p class="font-medium text-fg">{{ i.candidate.name }} <span class="font-normal text-fg-muted">· {{ i.job.title }}</span></p>
              <p class="text-xs text-fg-muted">{{ i.roundName }} · {{ formatDateTime(i.scheduledAt) }} · {{ i.durationMinutes }} min · {{ MODE_LABELS[i.mode] }}{{ i.location ? ` · ${i.location}` : '' }}</p>
              <p class="text-xs text-fg-subtle">{{ [i.candidate.currentTitle, i.candidate.currentCompany].filter(Boolean).join(' at ') }}{{ i.candidate.experienceYears !== null ? ` · ${i.candidate.experienceYears} yrs` : '' }}</p>
              <p v-if="i.myFeedback" class="mt-1 text-sm text-fg-muted">
                <AppBadge :tone="recommendationTone[i.myFeedback.recommendation]" size="sm">{{ RECOMMENDATION_LABELS[i.myFeedback.recommendation] }}</AppBadge>
                <span class="ml-2 text-amber-600 dark:text-amber-400">{{ '★'.repeat(i.myFeedback.rating) }}</span>
              </p>
            </div>
            <AppButton v-if="i.candidate.hasResume" size="sm" variant="secondary" :icon="Eye" @click="resume(i)">Resume</AppButton>
            <AppButton v-if="!i.myFeedback && new Date(i.scheduledAt).getTime() <= now" size="sm" :icon="MessageSquareText" @click="open(i)">Give feedback</AppButton>
          </li>
        </ul>
      </AppCard>
    </template>

    <AppModal :open="!!reviewing" :title="reviewing ? `Feedback · ${reviewing.candidate.name}` : ''" :description="reviewing ? `${reviewing.roundName} for ${reviewing.job.title}` : undefined" @close="reviewing = null">
      <form id="feedback-form" class="space-y-4" novalidate @submit.prevent="submit">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <div>
          <p class="mb-1.5 text-sm font-medium text-fg">Overall rating</p>
          <div class="flex gap-1" role="radiogroup" aria-label="Overall rating">
            <button v-for="n in 5" :key="n" type="button" role="radio" :aria-checked="form.rating === n" :aria-label="`${n} of 5`" class="text-2xl transition" :class="n <= form.rating ? 'text-amber-500' : 'text-fg-subtle/40 hover:text-amber-300'" @click="form.rating = n">★</button>
          </div>
        </div>
        <AppSelect v-model="form.recommendation" label="Recommendation" required :options="recommendationOptions" placeholder="Choose" :clearable="false" :error="fieldErrors.recommendation" />
        <AppTextarea v-model="form.feedback" label="Feedback" required :rows="5" :maxlength="4000" placeholder="Strengths, concerns and evidence from the interview" :error="fieldErrors.feedback" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="reviewing = null">Cancel</AppButton>
        <AppButton type="submit" form="feedback-form" :loading="saving" :disabled="!form.recommendation || form.feedback.trim().length < 10">Submit feedback</AppButton>
      </template>
    </AppModal>
  </div>
</template>
