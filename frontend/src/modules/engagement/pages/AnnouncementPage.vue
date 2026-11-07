<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Megaphone } from '@lucide/vue';
import type { RsvpResponse } from '@contracts';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import AnnouncementCard from '@/modules/engagement/components/AnnouncementCard.vue';
import type { Announcement } from '@/modules/engagement/types';
import { CATEGORY_LABELS, categoryTone } from '@/modules/engagement/utils/engagement-format';
import { AppBadge, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton, AppSplit } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { employeesApi } from '@/modules/people/api/people.api';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

const route = useRoute();
const me = useAsync(() => employeesApi.me());
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const item = useAsync(() => engagementApi.announcement(id.value));
const recent = useAsync(() => engagementApi.announcements({ pageSize: 8 }));
watch(id, () => void item.run());
const others = computed(() => (recent.data.value?.items ?? []).filter((a) => a.id !== id.value).slice(0, 6));
const busy = ref(false);
async function respond(fn: () => Promise<Announcement>, success: string) {
  busy.value = true;
  try {
    item.data.value = await fn();
    feedback.success(success);
  } catch (e) {
    feedback.error('Could not save your response', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Announcement" back="/me/engagement" back-label="Company" />
    <AppSkeleton v-if="item.loading.value && !item.data.value" :lines="6" />
    <AppErrorState v-else-if="item.error.value" :error="item.error.value" title="This announcement isn't available" @retry="item.run" />
    <AppSplit v-else-if="item.data.value">
      <AnnouncementCard
        :announcement="item.data.value"
        :busy="busy"
        :can-respond="!!me.data.value"
        @acknowledge="respond(() => engagementApi.acknowledge(id), 'Thanks for confirming')"
        @rsvp="(r: RsvpResponse) => respond(() => engagementApi.rsvp(id, r), 'RSVP saved')"
      />
      <template #aside>
        <AppCard title="More from the company" :padded="false">
          <AppEmptyState v-if="!recent.loading.value && !others.length" :icon="Megaphone" title="Nothing else right now" compact />
          <ul v-else class="divide-y divide-line/70">
            <li v-for="a in others" :key="a.id">
              <RouterLink :to="`/me/engagement/announcements/${a.id}`" class="block px-4 py-2.5 transition hover:bg-surface-muted/60">
                <p class="line-clamp-2 text-[13px] font-medium text-fg">{{ a.title }}</p>
                <p class="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
                  <AppBadge :tone="categoryTone[a.category]" size="sm">{{ CATEGORY_LABELS[a.category] }}</AppBadge>
                  {{ a.publishedAt ? timeAgo(a.publishedAt) : '' }}
                </p>
              </RouterLink>
            </li>
          </ul>
        </AppCard>
      </template>
    </AppSplit>
  </div>
</template>
