<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ClipboardList, Lightbulb, Megaphone, PartyPopper, Trash2 } from '@lucide/vue';
import type { RsvpResponse } from '@contracts';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import { employeesApi } from '@/modules/people/api/people.api';
import AnnouncementCard from '@/modules/engagement/components/AnnouncementCard.vue';
import BadgeIcon from '@/modules/engagement/components/BadgeIcon.vue';
import RecognizeModal from '@/modules/engagement/components/RecognizeModal.vue';
import type { Announcement } from '@/modules/engagement/types';
import { BADGE_LABELS } from '@/modules/engagement/utils/engagement-format';
import { AppAvatar, AppButton, AppCard, AppEmptyState, AppErrorState, AppPagination, AppPageHeader, AppSkeleton, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** Company hub: announcements and events, the recognition wall, and surveys waiting for an answer. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const me = useAsync(() => employeesApi.me());
const tab = ref('feed');
const surveys = useAsync(() => engagementApi.surveys({ pageSize: 50 }));
const pendingSurveys = computed(() => (surveys.data.value?.items ?? []).filter((s) => !s.responded));
const tabs = computed(() => [
  { key: 'feed', label: 'Announcements' },
  { key: 'wall', label: 'Recognition' },
  { key: 'surveys', label: pendingSurveys.value.length ? `Surveys (${pendingSurveys.value.length})` : 'Surveys' },
]);

const feed = useTable((q) => engagementApi.announcements(q), { pageSize: 10 });
const busy = ref<string | null>(null);
async function respond(a: Announcement, fn: () => Promise<Announcement>, success: string) {
  busy.value = a.id;
  try {
    const next = await fn();
    feed.rows.value = feed.rows.value.map((x) => (x.id === a.id ? next : x));
    feedback.success(success);
  } catch (e) {
    feedback.error('Could not save your response', e);
  } finally {
    busy.value = null;
  }
}
const ack = (a: Announcement) => respond(a, () => engagementApi.acknowledge(a.id), 'Thanks for confirming');
const rsvp = (a: Announcement, r: RsvpResponse) => respond(a, () => engagementApi.rsvp(a.id, r), 'RSVP saved');

const wall = useTable((q) => engagementApi.recognitions(q), { pageSize: 10, immediate: false });
const stats = useAsync(() => engagementApi.recognitionStats(), { immediate: false });
watch(tab, (t) => {
  if (t === 'wall' && !wall.rows.value.length) {
    void wall.load();
    void stats.run();
  }
});
const recognizeOpen = ref(false);
async function onRecognized() {
  recognizeOpen.value = false;
  feedback.success('Recognition posted', 'Your colleagues have been notified.');
  tab.value = 'wall';
  await Promise.all([wall.load(), stats.run()]);
}
async function removeRecognition(id: string) {
  if (!(await feedback.confirm({ title: 'Remove this recognition?', message: 'It disappears from the wall.', confirmLabel: 'Remove', danger: true }))) return;
  try {
    await engagementApi.removeRecognition(id);
    feedback.success('Recognition removed');
    await Promise.all([wall.load(), stats.run()]);
  } catch (e) {
    feedback.error('Could not remove it', e);
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Company" description="News, events and recognition from across the organization.">
      <template #actions>
        <AppButton variant="secondary" :icon="Lightbulb" to="/me/engagement/suggestions">Suggestions</AppButton>
        <AppButton v-if="auth.can('engagement.recognition.give') && me.data.value" :icon="PartyPopper" @click="recognizeOpen = true">Recognise someone</AppButton>
      </template>
    </AppPageHeader>
    <AppTabs v-model="tab" :tabs="tabs">
      <template v-if="tab === 'feed'">
        <AppSkeleton v-if="feed.loading.value && !feed.rows.value.length" :lines="6" />
        <AppErrorState v-else-if="feed.error.value" :error="feed.error.value" @retry="feed.load" />
        <AppCard v-else-if="!feed.rows.value.length"><AppEmptyState :icon="Megaphone" title="No announcements" description="News from your organization appears here." /></AppCard>
        <div v-else class="space-y-4">
          <AnnouncementCard v-for="a in feed.rows.value" :key="a.id" :announcement="a" clamp :busy="busy === a.id" :can-respond="!!me.data.value" @acknowledge="ack(a)" @rsvp="(r) => rsvp(a, r)" />
          <AppPagination v-if="feed.meta.value && feed.meta.value.totalPages > 1" :meta="feed.meta.value" @page="feed.setPage" />
        </div>
      </template>

      <div v-else-if="tab === 'wall'" class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div class="space-y-4">
          <AppSkeleton v-if="wall.loading.value && !wall.rows.value.length" :lines="6" />
          <AppErrorState v-else-if="wall.error.value" :error="wall.error.value" @retry="wall.load" />
          <AppCard v-else-if="!wall.rows.value.length"><AppEmptyState :icon="PartyPopper" title="No recognition yet" description="Be the first to thank a colleague." /></AppCard>
          <article v-for="r in wall.rows.value" :key="r.id" class="flex gap-4 rounded-2xl bg-surface p-4 ring-1 ring-line">
            <BadgeIcon :badge="r.badge" />
            <div class="min-w-0 flex-1">
              <p class="text-sm text-fg">
                <span class="font-semibold">{{ r.giver?.name ?? 'Someone' }}</span> recognised
                <span class="font-semibold">{{ r.recipients.map((x) => x.name).join(', ') }}</span>
                for <span class="font-medium text-amber-700 dark:text-amber-400">{{ BADGE_LABELS[r.badge] }}</span>
              </p>
              <p class="mt-1 text-sm whitespace-pre-line text-fg-muted">{{ r.message }}</p>
              <p class="mt-2 text-xs text-fg-subtle" :title="formatDateTime(r.createdAt)">{{ timeAgo(r.createdAt) }}</p>
            </div>
            <AppButton v-if="r.canDelete" size="sm" variant="ghost" :icon="Trash2" aria-label="Remove recognition" @click="removeRecognition(r.id)" />
          </article>
          <AppPagination v-if="wall.meta.value && wall.meta.value.totalPages > 1" :meta="wall.meta.value" @page="wall.setPage" />
        </div>
        <div class="space-y-4">
          <AppCard title="This month" :description="stats.data.value ? `${stats.data.value.thisMonth} recognition${stats.data.value.thisMonth === 1 ? '' : 's'}` : undefined">
            <p v-if="!stats.data.value?.topRecipients.length" class="text-sm text-fg-muted">Nobody yet.</p>
            <ol v-else class="space-y-2">
              <li v-for="t in stats.data.value.topRecipients" :key="t.employee.id" class="flex items-center gap-3 text-sm">
                <AppAvatar :name="t.employee.name" size="sm" />
                <span class="min-w-0 flex-1 truncate text-fg">{{ t.employee.name }}</span>
                <span class="tabular-nums text-fg-muted">{{ t.count }}</span>
              </li>
            </ol>
          </AppCard>
          <AppCard v-if="stats.data.value?.mine" title="You">
            <p class="text-sm text-fg-muted">Received {{ stats.data.value.mine.received }} · given {{ stats.data.value.mine.given }}</p>
          </AppCard>
        </div>
      </div>

      <template v-else>
        <AppSkeleton v-if="surveys.loading.value && !surveys.data.value" :lines="4" />
        <AppErrorState v-else-if="surveys.error.value" :error="surveys.error.value" @retry="surveys.run" />
        <AppCard v-else-if="!surveys.data.value?.items.length"><AppEmptyState :icon="ClipboardList" title="No open surveys" description="When HR asks for your views, the survey appears here." /></AppCard>
        <AppCard v-else :padded="false">
          <ul class="divide-y divide-line">
            <li v-for="s in surveys.data.value.items" :key="s.id" class="flex flex-wrap items-center gap-3 px-4 py-4">
              <div class="min-w-0 flex-1">
                <p class="font-medium text-fg">{{ s.title }}</p>
                <p class="text-xs text-fg-muted">{{ s.questions }} question{{ s.questions === 1 ? '' : 's' }} · {{ s.anonymous ? 'anonymous' : 'your name is recorded' }}{{ s.closesAt ? ` · closes ${formatDateTime(s.closesAt)}` : '' }}</p>
              </div>
              <span v-if="s.responded" class="text-sm text-emerald-600 dark:text-emerald-400">Answered — thank you</span>
              <AppButton v-else size="sm" :to="`/me/engagement/surveys/${s.id}`">Answer</AppButton>
            </li>
          </ul>
        </AppCard>
      </template>
    </AppTabs>
    <RecognizeModal :open="recognizeOpen" @close="recognizeOpen = false" @saved="onRecognized" />
  </div>
</template>
