<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronRight, LifeBuoy, MessageSquare, Plus } from '@lucide/vue';
import { HELPDESK_CATEGORY_LABELS, type HelpdeskStatus } from '@contracts';
import { helpdeskApi } from '@/modules/services/api/services.api';
import TicketFormModal from '@/modules/services/components/TicketFormModal.vue';
import type { TicketDetail } from '@/modules/services/types';
import { HELPDESK_STATUS_LABELS, helpdeskStatusTone } from '@/modules/services/utils/services-format';
import { AppBadge, AppButton, AppCard, AppErrorState, AppPageHeader, AppSegmented, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

/** Your questions to HR: open conversations first, then resolved and closed ones. */
const router = useRouter();
const feedback = useFeedbackStore();
const filter = ref<'ACTIVE' | 'all'>('ACTIVE');
const tickets = useAsync(() => helpdeskApi.list({ view: 'mine', page: 1, pageSize: 100 }));
const filters = [
  { value: 'ACTIVE' as const, label: 'Open' },
  { value: 'all' as const, label: 'All' },
];
const ACTIVE: HelpdeskStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING'];
const all = computed(() => tickets.data.value?.items ?? []);
const rows = computed(() => (filter.value === 'ACTIVE' ? all.value.filter((t) => ACTIVE.includes(t.status)) : all.value));
const waiting = computed(() => all.value.filter((t) => t.status === 'WAITING' || (t.status === 'RESOLVED' && t.rating === null)));
const STATUS_HINT: Partial<Record<HelpdeskStatus, string>> = { WAITING: 'HR needs something from you', RESOLVED: 'Resolved — rate it or reply if you still need help' };

const raising = ref(false);
async function onRaised(t: TicketDetail) {
  raising.value = false;
  feedback.success(`${t.reference} sent`, 'HR will reply here.');
  await router.push(`/me/helpdesk/${t.id}`);
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="HR helpdesk" description="Ask HR anything — pay, leave, letters, policies. Each question is a conversation you can follow here.">
      <template #actions><AppButton :icon="Plus" @click="raising = true">Ask HR</AppButton></template>
    </AppPageHeader>

    <section v-if="waiting.length" class="card overflow-hidden">
      <div class="flex items-center gap-3 border-b border-line/70 bg-warning-soft/50 px-4 py-2.5 text-sm font-medium text-warning-fg">
        <MessageSquare :size="16" aria-hidden="true" />{{ waiting.length === 1 ? 'One conversation needs you' : `${waiting.length} conversations need you` }}
      </div>
      <ul class="divide-y divide-line/70">
        <li v-for="t in waiting" :key="t.id">
          <RouterLink :to="`/me/helpdesk/${t.id}`" class="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-muted/50 focus-visible:bg-surface-muted/50 focus-visible:outline-none">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-fg">{{ t.subject }}</p>
              <p class="truncate text-xs text-fg-muted">{{ STATUS_HINT[t.status] }}</p>
            </div>
            <ChevronRight :size="16" class="text-fg-subtle rtl:rotate-180" aria-hidden="true" />
          </RouterLink>
        </li>
      </ul>
    </section>

    <AppCard :padded="false">
      <header class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
        <h2 class="min-w-0 flex-1 text-sm font-semibold text-fg">Your tickets</h2>
        <AppSegmented v-model="filter" :options="filters" label="Show" size="sm" />
      </header>
      <AppSkeleton v-if="tickets.loading.value && !tickets.data.value" :lines="4" class="p-4" />
      <AppErrorState v-else-if="tickets.error.value" :error="tickets.error.value" @retry="tickets.run" />
      <ul v-else-if="rows.length" class="divide-y divide-line/70">
        <li v-for="t in rows" :key="t.id">
          <RouterLink :to="`/me/helpdesk/${t.id}`" class="group flex flex-wrap items-center gap-3 px-4 py-3.5 transition hover:bg-accent-soft/40 focus-visible:bg-accent-soft/40 focus-visible:outline-none">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg" aria-hidden="true"><LifeBuoy :size="18" /></span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-fg">{{ t.subject }}</p>
              <p class="truncate text-xs text-fg-muted"><span class="font-mono">{{ t.reference }}</span> · {{ HELPDESK_CATEGORY_LABELS[t.category] }} · updated {{ timeAgo(t.lastActivityAt) }}</p>
            </div>
            <span v-if="t.assignee" class="hidden text-xs text-fg-muted md:inline">{{ t.assignee.name }}</span>
            <AppBadge :tone="helpdeskStatusTone[t.status]" size="sm" dot>{{ HELPDESK_STATUS_LABELS[t.status] }}</AppBadge>
            <ChevronRight :size="16" class="text-fg-subtle transition group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
          </RouterLink>
        </li>
      </ul>
      <div v-else class="px-4 py-10 text-center">
        <p class="text-sm font-medium text-fg">{{ filter === 'ACTIVE' ? 'No open questions' : 'No tickets yet' }}</p>
        <p class="mt-1 text-sm text-fg-muted">Ask HR when you need help; the conversation stays here.</p>
        <AppButton class="mt-3" variant="secondary" :icon="Plus" @click="raising = true">Ask HR</AppButton>
      </div>
    </AppCard>

    <TicketFormModal :open="raising" @close="raising = false" @saved="onRaised" />
  </div>
</template>
