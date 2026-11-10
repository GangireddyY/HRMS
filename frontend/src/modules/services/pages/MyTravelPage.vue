<script setup lang="ts">
import { computed, ref } from 'vue';
import { Ban, CircleCheck, Luggage, Plus, Receipt } from '@lucide/vue';
import { travelApi } from '@/modules/services/api/services.api';
import TravelRequestModal from '@/modules/services/components/TravelRequestModal.vue';
import TripCard from '@/modules/services/components/TripCard.vue';
import type { Trip } from '@/modules/services/types';
import { AppButton, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Your business trips: upcoming and in review first, then past ones. */
const feedback = useFeedbackStore();
const trips = useAsync(() => travelApi.list({ view: 'mine', page: 1, pageSize: 100 }));
const all = computed(() => trips.data.value?.items ?? []);
const current = computed(() => all.value.filter((t) => t.status === 'PENDING' || t.status === 'APPROVED'));
const past = computed(() => all.value.filter((t) => t.status !== 'PENDING' && t.status !== 'APPROVED'));

const requesting = ref(false);
async function onSaved(t: Trip) {
  requesting.value = false;
  feedback.success(`${t.reference} sent`, 'Your manager has been asked to approve it.');
  await trips.run();
}
const busy = ref<string | null>(null);
async function act(t: Trip, kind: 'cancel' | 'complete') {
  if (kind === 'cancel' && !(await feedback.confirm({ title: `Cancel the trip to ${t.toCity}?`, message: 'Tell the travel desk if tickets were already booked.', confirmLabel: 'Cancel trip' }))) return;
  busy.value = t.id;
  try {
    await (kind === 'cancel' ? travelApi.cancel(t.id) : travelApi.complete(t.id));
    feedback.success(kind === 'cancel' ? 'Trip cancelled' : 'Trip completed', kind === 'complete' ? 'Claim your expenses under Reimbursements.' : undefined);
    await trips.run();
  } catch (e) {
    feedback.error('Could not update the trip', e);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Business travel" description="Ask to travel for work. After approval the travel desk books it; claim actual expenses under Reimbursements when you're back.">
      <template #actions><AppButton :icon="Plus" @click="requesting = true">Request travel</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="trips.loading.value && !trips.data.value" :lines="5" />
    <AppErrorState v-else-if="trips.error.value" :error="trips.error.value" @retry="trips.run" />
    <template v-else>
      <section v-if="current.length" aria-labelledby="current-trips" class="space-y-3">
        <h2 id="current-trips" class="text-sm font-semibold text-fg">Upcoming and in review</h2>
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TripCard v-for="t in current" :key="t.id" :trip="t">
            <template v-if="t.permissions.cancel || t.permissions.complete">
              <AppButton v-if="t.permissions.cancel" size="sm" variant="ghost" :icon="Ban" :loading="busy === t.id" @click="act(t, 'cancel')">Cancel</AppButton>
              <AppButton v-if="t.permissions.complete" size="sm" :icon="CircleCheck" :loading="busy === t.id" @click="act(t, 'complete')">I'm back</AppButton>
            </template>
          </TripCard>
        </div>
      </section>
      <section v-else class="card flex flex-wrap items-center gap-5 p-5">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg" aria-hidden="true"><Luggage :size="22" /></span>
        <div class="min-w-0 flex-1">
          <p class="text-lg font-semibold text-fg">No trips planned</p>
          <p class="text-sm text-fg-muted">Request travel for client visits, events or work at another office.</p>
        </div>
        <AppButton variant="secondary" :icon="Plus" @click="requesting = true">Request travel</AppButton>
      </section>

      <section v-if="past.length" aria-labelledby="past-trips" class="space-y-3">
        <div class="flex items-center gap-3">
          <h2 id="past-trips" class="flex-1 text-sm font-semibold text-fg">Past trips</h2>
          <AppButton size="sm" variant="ghost" :icon="Receipt" to="/me/reimbursements">Claim expenses</AppButton>
        </div>
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TripCard v-for="t in past" :key="t.id" :trip="t" />
        </div>
      </section>
    </template>
    <TravelRequestModal :open="requesting" @close="requesting = false" @saved="onSaved" />
  </div>
</template>
