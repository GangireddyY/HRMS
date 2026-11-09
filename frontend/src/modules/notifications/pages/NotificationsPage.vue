<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Bell, BellRing, CheckCheck, Inbox, LayoutGrid, Rows3 } from '@lucide/vue';
import { notificationsApi } from '@/modules/notifications/api/notifications.api';
import NotificationGridCard from '@/modules/notifications/components/NotificationGridCard.vue';
import NotificationListItem from '@/modules/notifications/components/NotificationListItem.vue';
import type { NotificationRow } from '@/modules/notifications/types';
import { groupByDay } from '@/modules/notifications/utils/notification-visuals';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppPagination, AppSegmented } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const router = useRouter();
const feedback = useFeedbackStore();
const table = useTable((q) => notificationsApi.list(q), { pageSize: 18, filters: { unreadOnly: false as boolean } });
const groups = computed(() => groupByDay(table.rows.value));

const unread = ref<number | null>(null);
async function refreshUnread() {
  try {
    unread.value = (await notificationsApi.unreadCount()).count;
  } catch {
    unread.value = null;
  }
}
onMounted(refreshUnread);

const show = computed({
  get: () => (table.filters.unreadOnly ? 'unread' : 'all'),
  set: (v: 'all' | 'unread') => (table.filters.unreadOnly = v === 'unread'),
});
const showOptions = computed(() => [
  { value: 'all' as const, label: 'All', icon: Inbox },
  { value: 'unread' as const, label: unread.value ? `Unread (${unread.value > 99 ? '99+' : unread.value})` : 'Unread', icon: BellRing },
]);

const LAYOUT_KEY = 'hrms.layout.notifications';
const readLayout = (): 'list' | 'grid' => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
};
const layout = ref(readLayout());
watch(layout, (v) => {
  try {
    localStorage.setItem(LAYOUT_KEY, v);
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
});
const layoutOptions = [
  { value: 'list' as const, label: 'List', icon: Rows3 },
  { value: 'grid' as const, label: 'Grid', icon: LayoutGrid },
];

async function markRead(n: NotificationRow) {
  if (n.readAt) return;
  await notificationsApi.markRead(n.id);
  n.readAt = new Date().toISOString();
  if (unread.value) unread.value -= 1;
}

async function open(n: NotificationRow) {
  try {
    await markRead(n);
    if (n.link) await router.push(n.link);
  } catch (e) {
    feedback.error('Could not update notification', e);
  }
}

async function read(n: NotificationRow) {
  try {
    await markRead(n);
  } catch (e) {
    feedback.error('Could not update notification', e);
  }
}

async function markAll() {
  try {
    const { updated } = await notificationsApi.markAllRead();
    feedback.success(updated ? `${updated} notification${updated === 1 ? '' : 's'} marked as read` : 'You’re all caught up');
    await Promise.all([table.load(), refreshUnread()]);
  } catch (e) {
    feedback.error('Could not mark notifications as read', e);
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Notifications" description="Account, security and workflow updates.">
      <template v-if="unread !== null" #badges>
        <AppBadge v-if="unread" tone="brand" dot>{{ unread }} unread</AppBadge>
        <AppBadge v-else tone="success" dot>All caught up</AppBadge>
      </template>
      <template #actions><AppButton variant="secondary" :icon="CheckCheck" :disabled="unread === 0" @click="markAll">Mark all as read</AppButton></template>
    </AppPageHeader>

    <AppCard :padded="false" class="overflow-hidden">
      <div class="flex items-center gap-2 border-b border-line px-4 py-3 sm:gap-3 sm:px-5">
        <AppSegmented v-model="show" class="sm:w-56" size="sm" :options="showOptions" label="Show" />
        <p v-if="table.meta.value" class="text-xs text-fg-muted max-sm:hidden" aria-live="polite">
          {{ table.meta.value.total }} {{ table.filters.unreadOnly ? 'unread' : '' }} notification{{ table.meta.value.total === 1 ? '' : 's' }}
        </p>
        <AppSegmented v-model="layout" class="ms-auto sm:w-40" size="sm" :options="layoutOptions" label="Notifications layout" />
      </div>

      <AppErrorState v-if="table.error.value" :error="table.error.value" @retry="table.load" />
      <template v-else-if="table.loading.value && !table.rows.value.length">
        <div v-if="layout === 'grid'" class="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
          <div v-for="i in 6" :key="i" class="h-44 animate-pulse rounded-xl bg-surface-muted" />
        </div>
        <div v-else class="space-y-1 p-4">
          <div v-for="i in 6" :key="i" class="flex items-center gap-4 py-2">
            <div class="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-surface-muted" />
            <div class="flex-1 space-y-2"><div class="h-3 w-1/4 animate-pulse rounded bg-surface-muted" /><div class="h-3.5 w-2/3 animate-pulse rounded bg-surface-muted" /></div>
          </div>
        </div>
      </template>
      <AppEmptyState
        v-else-if="!table.rows.value.length"
        :icon="table.filters.unreadOnly ? CheckCheck : Bell"
        :title="table.filters.unreadOnly ? 'You’re all caught up' : 'No notifications yet'"
        :description="table.filters.unreadOnly ? 'Nothing unread. New updates will show up here.' : 'Approvals, reminders and account alerts will show up here.'"
      />

      <div v-else :class="['transition-opacity', table.loading.value && 'opacity-60']">
        <section v-for="g in groups" :key="g.key" :aria-label="g.label">
          <h2 class="flex items-center gap-2 border-b border-line/60 bg-surface-muted/50 px-4 py-1.5 text-2xs font-semibold tracking-wide text-fg-subtle uppercase sm:px-5">
            {{ g.label }}<span class="font-medium tabular-nums">· {{ g.items.length }}</span>
          </h2>
          <ul v-if="layout === 'list'" class="divide-y divide-line/60 border-b border-line/60 last:border-b-0">
            <NotificationListItem v-for="n in g.items" :key="n.id" :notification="n" @open="open(n)" @read="read(n)" />
          </ul>
          <ul v-else class="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
            <li v-for="n in g.items" :key="n.id"><NotificationGridCard :notification="n" @open="open(n)" @read="read(n)" /></li>
          </ul>
        </section>
      </div>

      <AppPagination v-if="table.meta.value && table.meta.value.total > 0" class="border-t border-line" :meta="table.meta.value" @change="table.setPage" />
    </AppCard>
  </div>
</template>
