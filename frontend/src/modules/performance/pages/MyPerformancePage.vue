<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ChevronRight, MessageSquareText, Target } from '@lucide/vue';
import { DEFAULT_RATING_LABELS } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import RatingInput from '@/modules/performance/components/RatingInput.vue';
import type { FeedbackRequest } from '@/modules/performance/types';
import { PIP_STATUS_LABELS, STAGE_LABELS, pipTone, stageTone } from '@/modules/performance/utils/performance-format';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const auth = useAuthStore();
const toast = useFeedbackStore();
const reviews = useAsync(() => performanceApi.reviews({ view: 'mine', pageSize: 50 }));
const canGive = computed(() => auth.can('performance.feedback.give'));
const requests = useAsync(() => performanceApi.myFeedback(), { immediate: canGive.value });
const pips = useAsync(() => performanceApi.pips({ view: 'mine', pageSize: 20 }));
const open = computed(() => (requests.data.value ?? []).filter((r) => r.open));
const past = computed(() => (requests.data.value ?? []).filter((r) => !r.open));
const today = new Date().toISOString().slice(0, 10);

const giving = ref<FeedbackRequest | null>(null);
const form = reactive({ rating: null as number | null, strengths: '', improvements: '' });
const busy = ref(false);
function openGive(r: FeedbackRequest) {
  giving.value = r;
  Object.assign(form, { rating: null, strengths: '', improvements: '' });
}
async function give() {
  busy.value = true;
  try {
    await performanceApi.giveFeedback(giving.value!.id, { ...form });
    toast.success('Feedback sent', `Thanks — ${giving.value!.subject.name} will see it anonymously.`);
    giving.value = null;
    await requests.run();
  } catch (e) {
    toast.error('Could not send the feedback', e);
  } finally {
    busy.value = false;
  }
}
async function decline(r: FeedbackRequest) {
  if (!(await toast.confirm({ title: `Decline feedback on ${r.subject.name}?`, message: 'For example if you have not worked together enough.', confirmLabel: 'Decline' }))) return;
  try {
    await performanceApi.declineFeedback(r.id);
    toast.success('Request declined');
    await requests.run();
  } catch (e) {
    toast.error('Could not decline the request', e);
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Performance" description="Your goals and reviews, feedback colleagues asked you for, and any improvement plan." />

    <AppCard title="My reviews" :padded="false">
      <AppSkeleton v-if="reviews.loading.value && !reviews.data.value" class="p-4" :lines="3" />
      <AppErrorState v-else-if="reviews.error.value" :error="reviews.error.value" @retry="reviews.run" />
      <AppEmptyState v-else-if="!reviews.data.value?.items.length" :icon="Target" title="No reviews yet" description="When HR starts a review cycle you'll set your goals here." compact />
      <ul v-else class="divide-y divide-line">
        <li v-for="r in reviews.data.value.items" :key="r.id">
          <RouterLink :to="`/me/performance/reviews/${r.id}`" class="flex flex-wrap items-center gap-3 px-4 py-4 hover:bg-surface-muted/50">
            <div class="min-w-0 flex-1">
              <p class="font-medium text-fg">{{ r.cycle.name }}</p>
              <p class="text-xs text-fg-muted">{{ r.goals }} goal{{ r.goals === 1 ? '' : 's' }} · reviewer {{ r.reviewer?.name ?? 'not assigned yet' }}<template v-if="r.due"> · <span :class="r.due < today && 'text-red-600 dark:text-red-400'">due {{ formatDate(r.due) }}</span></template></p>
            </div>
            <span v-if="r.finalRating" class="text-sm font-semibold text-fg">Rating {{ r.finalRating }}</span>
            <AppBadge :tone="stageTone[r.stage]" dot>{{ STAGE_LABELS[r.stage] }}</AppBadge>
            <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
          </RouterLink>
        </li>
      </ul>
    </AppCard>

    <AppCard v-if="canGive" title="Feedback requests" :description="open.length ? `${open.length} waiting for you` : undefined" :padded="false">
      <AppSkeleton v-if="requests.loading.value && !requests.data.value" class="p-4" :lines="2" />
      <AppErrorState v-else-if="requests.error.value" :error="requests.error.value" @retry="requests.run" />
      <AppEmptyState v-else-if="!requests.data.value?.length" :icon="MessageSquareText" title="No feedback requests" description="Colleagues can ask you for feedback during a review cycle." compact />
      <ul v-else class="divide-y divide-line">
        <li v-for="f in [...open, ...past]" :key="f.id" class="flex flex-wrap items-center gap-3 px-4 py-4">
          <div class="min-w-0 flex-1">
            <p class="font-medium text-fg">{{ f.subject.name }}</p>
            <p class="text-xs text-fg-muted">{{ f.cycle.name }} · asked {{ formatDate(f.createdAt) }}</p>
          </div>
          <template v-if="f.open">
            <AppButton size="sm" variant="ghost" @click="decline(f)">Decline</AppButton>
            <AppButton size="sm" @click="openGive(f)">Give feedback</AppButton>
          </template>
          <AppBadge v-else size="sm" :tone="f.status === 'SUBMITTED' ? 'success' : 'neutral'">{{ f.status === 'SUBMITTED' ? 'Given' : f.status === 'DECLINED' ? 'Declined' : 'Closed' }}</AppBadge>
        </li>
      </ul>
    </AppCard>

    <AppCard v-if="pips.data.value?.items.length" title="Improvement plans" :padded="false">
      <ul class="divide-y divide-line">
        <li v-for="p in pips.data.value.items" :key="p.id">
          <RouterLink :to="`/me/performance/pips/${p.id}`" class="flex flex-wrap items-center gap-3 px-4 py-4 hover:bg-surface-muted/50">
            <div class="min-w-0 flex-1">
              <p class="font-medium text-fg">{{ formatDate(p.startDate) }} – {{ formatDate(p.endDate) }}</p>
              <p class="text-xs text-fg-muted">{{ p.objectivesCount }} objective{{ p.objectivesCount === 1 ? '' : 's' }} · with {{ p.owner?.name ?? 'your manager' }}{{ p.acknowledged ? '' : ' · not acknowledged yet' }}</p>
            </div>
            <AppBadge :tone="pipTone[p.status]" dot>{{ PIP_STATUS_LABELS[p.status] }}</AppBadge>
            <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
          </RouterLink>
        </li>
      </ul>
    </AppCard>

    <AppModal :open="!!giving" :title="giving ? `Feedback for ${giving.subject.name}` : ''" description="Be specific and kind. The employee sees it without your name; their reviewer and HR see who wrote it." @close="giving = null">
      <div class="space-y-4">
        <div>
          <p class="label">Overall (optional)</p>
          <RatingInput v-model="form.rating" :labels="DEFAULT_RATING_LABELS" label="Overall rating" />
        </div>
        <AppTextarea v-model="form.strengths" label="What they do well" required :rows="3" :maxlength="2000" />
        <AppTextarea v-model="form.improvements" label="What they could do better" required :rows="3" :maxlength="2000" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="giving = null">Cancel</AppButton>
        <AppButton :loading="busy" :disabled="form.strengths.trim().length < 10 || form.improvements.trim().length < 10" @click="give">Send feedback</AppButton>
      </template>
    </AppModal>
  </div>
</template>
