<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { RsvpResponse } from '@contracts';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import AnnouncementCard from '@/modules/engagement/components/AnnouncementCard.vue';
import type { Announcement } from '@/modules/engagement/types';
import { AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { employeesApi } from '@/modules/people/api/people.api';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const route = useRoute();
const me = useAsync(() => employeesApi.me());
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const item = useAsync(() => engagementApi.announcement(id.value));
watch(id, () => void item.run());
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
  <div class="mx-auto max-w-3xl">
    <AppPageHeader title="Announcement" back="/me/engagement" back-label="Company" />
    <AppSkeleton v-if="item.loading.value && !item.data.value" :lines="6" />
    <AppErrorState v-else-if="item.error.value" :error="item.error.value" title="This announcement isn't available" @retry="item.run" />
    <AnnouncementCard
      v-else-if="item.data.value"
      :announcement="item.data.value"
      :busy="busy"
      :can-respond="!!me.data.value"
      @acknowledge="respond(() => engagementApi.acknowledge(id), 'Thanks for confirming')"
      @rsvp="(r: RsvpResponse) => respond(() => engagementApi.rsvp(id, r), 'RSVP saved')"
    />
  </div>
</template>
