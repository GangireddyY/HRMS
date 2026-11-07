<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowRight, ClipboardCheck, PartyPopper, Users } from '@lucide/vue';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import ChecklistTasks from '@/modules/onboarding/components/ChecklistTasks.vue';
import RecommendModal from '@/modules/onboarding/components/RecommendModal.vue';
import type { CaseDetail, ProbationDue } from '@/modules/onboarding/types';
import { RECOMMENDATION_LABELS, REVIEW_STATUS_LABELS, reviewStatusTone } from '@/modules/onboarding/utils/onboarding-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Self-service onboarding: your own checklist, plus what managers owe their new team members. */
const feedback = useFeedbackStore();
const mine = useAsync(() => onboardingApi.mine());
const team = useAsync(() => onboardingApi.teamTasks());
const probation = useAsync(async () => (await onboardingApi.probationDue(60)).filter((d) => d.isDirectReport));
const myReviews = useAsync(() => onboardingApi.reviews({ view: 'mine', pageSize: 10 }));

const pct = computed(() => (mine.data.value?.progress.total ? Math.round((mine.data.value.progress.done / mine.data.value.progress.total) * 100) : 0));
function onUpdated(next: CaseDetail) {
  mine.data.value = next;
}
const recommendFor = ref<ProbationDue | null>(null);
async function onSubmitted() {
  recommendFor.value = null;
  feedback.success('Recommendation submitted', 'HR will make the decision.');
  await Promise.all([probation.run(), myReviews.run()]);
}
const nothing = computed(() => !mine.loading.value && !mine.data.value && !team.data.value?.length && !probation.data.value?.length && !myReviews.data.value?.items.length);
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Onboarding" description="Your joining checklist, and onboarding tasks for people joining your team." />

    <AppSkeleton v-if="mine.loading.value && !mine.data.value" :lines="5" />
    <AppErrorState v-else-if="mine.error.value" :error="mine.error.value" @retry="mine.run" />
    <AppCard v-else-if="mine.data.value" :title="mine.data.value.status === 'COMPLETED' ? 'Your onboarding is complete' : 'Your joining checklist'" :icon="mine.data.value.status === 'COMPLETED' ? PartyPopper : ClipboardCheck">
      <template #actions>
        <span class="text-sm text-fg-muted tabular-nums">{{ mine.data.value.progress.done }} of {{ mine.data.value.progress.total }} done</span>
      </template>
      <div class="mb-4 h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true"><div class="h-full rounded-full bg-emerald-500 transition-all" :style="{ width: `${pct}%` }" /></div>
      <p v-if="mine.data.value.buddy" class="mb-4 text-sm text-fg-muted">Your buddy is <span class="font-medium text-fg">{{ mine.data.value.buddy.name }}</span> — reach out with any questions.</p>
      <ChecklistTasks :detail="mine.data.value" @updated="onUpdated" />
    </AppCard>

    <AppCard v-if="team.data.value?.length" title="New members of your team" :icon="Users" description="Tasks you own in their onboarding.">
      <ul class="divide-y divide-line">
        <li v-for="t in team.data.value" :key="t.caseId" class="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
          <AppAvatar :name="t.employee.name" size="sm" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-fg">{{ t.employee.name }}</p>
            <p class="text-xs text-fg-muted">Joins {{ formatDate(t.joiningDate) }} · {{ t.tasks.filter((x) => x.state === 'PENDING').length }} of your {{ t.tasks.length }} tasks open</p>
          </div>
          <AppBadge v-if="t.tasks.some((x) => x.overdue)" tone="danger" size="sm">Overdue</AppBadge>
          <AppButton size="sm" variant="secondary" :icon-right="ArrowRight" :to="`/me/onboarding/cases/${t.caseId}`">Open checklist</AppButton>
        </li>
      </ul>
    </AppCard>

    <AppCard v-if="probation.data.value?.length" title="Probation reviews for your team" :icon="ClipboardCheck" description="Recommend confirming or extending; HR makes the decision.">
      <ul class="divide-y divide-line">
        <li v-for="p in probation.data.value" :key="p.employee.id" class="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
          <AppAvatar :name="p.employee.name" size="sm" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-fg">{{ p.employee.name }}</p>
            <p class="text-xs" :class="p.daysLeft < 0 ? 'font-medium text-red-600 dark:text-red-400' : 'text-fg-muted'">Probation ends {{ formatDate(p.probationEndDate) }}{{ p.daysLeft < 0 ? ` · ${-p.daysLeft} days overdue` : '' }}</p>
          </div>
          <AppBadge v-if="p.pendingReview" tone="warning" size="sm">{{ RECOMMENDATION_LABELS[p.pendingReview.recommendation] }} · awaiting decision</AppBadge>
          <AppButton v-else size="sm" variant="secondary" @click="recommendFor = p">Review</AppButton>
        </li>
      </ul>
    </AppCard>

    <AppCard v-if="myReviews.data.value?.items.length" title="Your recommendations" :padded="false">
      <ul class="divide-y divide-line">
        <li v-for="r in myReviews.data.value.items" :key="r.id" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <span class="text-fg">{{ r.employee?.name }} · {{ RECOMMENDATION_LABELS[r.recommendation] }}{{ r.extendTo ? ` until ${formatDate(r.extendTo)}` : '' }}</span>
          <span class="flex items-center gap-2">
            <span v-if="r.reviewNote" class="max-w-xs truncate text-xs text-fg-muted" :title="r.reviewNote">“{{ r.reviewNote }}”</span>
            <AppBadge :tone="reviewStatusTone[r.status]" dot>{{ REVIEW_STATUS_LABELS[r.status] }}</AppBadge>
          </span>
        </li>
      </ul>
    </AppCard>

    <AppCard v-if="nothing">
      <AppEmptyState :icon="ClipboardCheck" title="Nothing to do here" description="Your joining checklist and onboarding tasks for new team members will appear here." />
    </AppCard>

    <RecommendModal :open="!!recommendFor" :due="recommendFor" @close="recommendFor = null" @submitted="onSubmitted" />
  </div>
</template>
