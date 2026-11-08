<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Bell, CheckCheck } from '@lucide/vue';
import { notificationsApi } from '@/modules/notifications/api/notifications.api';
import type { NotificationRow } from '@/modules/notifications/types';
import { AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppPagination, AppSwitch } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime } from '@/shared/utils/format';

const router = useRouter();
const feedback = useFeedbackStore();
const table = useTable((q) => notificationsApi.list(q), { pageSize: 15, filters: { unreadOnly: false } });

async function open(n: NotificationRow) {
  try {
    if (!n.readAt) {
      await notificationsApi.markRead(n.id);
      n.readAt = new Date().toISOString();
    }
    if (n.link) await router.push(n.link);
  } catch (e) {
    feedback.error('Could not update notification', e);
  }
}

async function markAll() {
  try {
    const { updated } = await notificationsApi.markAllRead();
    feedback.success(`${updated} notification(s) marked as read`);
    await table.load();
  } catch (e) {
    feedback.error('Could not mark notifications as read', e);
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Notifications" description="Account, security and workflow updates.">
      <template #actions><AppButton variant="secondary" :icon="CheckCheck" @click="markAll">Mark all as read</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="border-b border-line px-4 py-3"><AppSwitch v-model="table.filters.unreadOnly" label="Unread only" /></div>
      <AppErrorState v-if="table.error.value" :error="table.error.value" @retry="table.load" />
      <div v-else-if="table.loading.value && !table.rows.value.length" class="space-y-3 p-4"><div v-for="i in 4" :key="i" class="h-14 animate-pulse rounded-xl bg-surface-muted" /></div>
      <AppEmptyState v-else-if="!table.rows.value.length" :icon="Bell" title="Nothing here" description="You have no notifications matching this filter." />
      <ul v-else class="divide-y divide-line/70">
        <li v-for="n in table.rows.value" :key="n.id">
          <button
            type="button"
            :class="['flex w-full items-start gap-4 px-4 py-4 text-start transition-colors hover:bg-surface-muted/60', !n.readAt && 'bg-accent-soft']"
            @click="open(n)"
          >
            <span class="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-fg-muted ring-1 ring-line ring-inset">
              <Bell :size="16" aria-hidden="true" />
              <span v-if="!n.readAt" class="absolute -top-0.5 -end-0.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-surface" aria-hidden="true" />
            </span>
            <span class="min-w-0 flex-1">
              <span :class="['block text-sm', n.readAt ? 'text-fg-muted' : 'font-semibold text-fg']">{{ n.title }}</span>
              <span v-if="n.body" class="mt-0.5 block text-sm text-fg-muted">{{ n.body }}</span>
            </span>
            <span class="shrink-0 pt-0.5 text-xs text-fg-subtle">{{ formatDateTime(n.createdAt) }}</span>
          </button>
        </li>
      </ul>
      <AppPagination v-if="table.meta.value && table.meta.value.total > 0" class="border-t border-line" :meta="table.meta.value" @change="table.setPage" />
    </AppCard>
  </div>
</template>
