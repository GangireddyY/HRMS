<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Bell } from '@lucide/vue';
import { notificationsApi } from '@/modules/notifications/api/notifications.api';
import type { NotificationRow } from '@/modules/notifications/types';
import { AppDropdown } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

const POLL_MS = 60_000;
const router = useRouter();
const feedback = useFeedbackStore();
const unread = ref(0);
const items = ref<NotificationRow[]>([]);
const loading = ref(false);
const loadError = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

async function refreshCount() {
  try {
    unread.value = (await notificationsApi.unreadCount()).count;
  } catch {
    // The badge is non-critical; the next poll retries. Session errors are handled globally.
  }
}

async function loadLatest() {
  loading.value = true;
  loadError.value = false;
  try {
    items.value = (await notificationsApi.list({ page: 1, pageSize: 8 })).items;
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function open(item: NotificationRow) {
  try {
    if (!item.readAt) {
      await notificationsApi.markRead(item.id);
      item.readAt = new Date().toISOString();
      unread.value = Math.max(0, unread.value - 1);
    }
    if (item.link) await router.push(item.link);
  } catch (e) {
    feedback.error('Could not update notification', e);
  }
}

async function markAll() {
  try {
    await notificationsApi.markAllRead();
    items.value = items.value.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() }));
    unread.value = 0;
  } catch (e) {
    feedback.error('Could not mark notifications as read', e);
  }
}

onMounted(() => {
  void refreshCount();
  timer = setInterval(() => void refreshCount(), POLL_MS);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <AppDropdown width="w-80" label="Notifications">
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-muted hover:text-fg"
        :aria-label="unread ? `Notifications, ${unread} unread` : 'Notifications'"
        @click="toggle(), loadLatest()"
      >
        <Bell :size="18" />
        <span
          v-if="unread"
          class="absolute top-1 end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-b from-red-500 to-red-600 px-1 text-2xs font-semibold text-white ring-2 ring-canvas"
        >
          {{ unread > 9 ? '9+' : unread }}
        </span>
      </button>
    </template>
    <div class="flex items-center justify-between px-3 pt-1 pb-2" @click.stop>
      <p class="text-sm font-semibold text-fg">Notifications</p>
      <button v-if="unread" type="button" class="rounded-md px-2 py-0.5 text-xs font-medium text-accent-fg transition hover:bg-accent-soft" @click="markAll">
        Mark all read
      </button>
    </div>
    <div class="max-h-80 overflow-y-auto">
      <div v-if="loading" class="space-y-2 p-3"><div v-for="i in 3" :key="i" class="h-11 animate-pulse rounded-lg bg-surface-muted" /></div>
      <p v-else-if="loadError" class="px-3 py-8 text-center text-sm text-danger-fg">Could not load notifications.</p>
      <div v-else-if="!items.length" class="flex flex-col items-center px-3 py-8 text-center">
        <span class="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted text-fg-subtle"><Bell :size="18" aria-hidden="true" /></span>
        <p class="text-sm font-medium text-fg">You're all caught up</p>
        <p class="text-xs text-fg-muted">New notifications will appear here.</p>
      </div>
      <button
        v-for="n in items"
        v-else
        :key="n.id"
        type="button"
        role="menuitem"
        class="flex w-full gap-3 rounded-lg px-3 py-2 text-start transition-colors hover:bg-surface-muted"
        @click="open(n)"
      >
        <span :class="['mt-2 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-500 ring-4 ring-brand-500/15']" aria-hidden="true" />
        <span class="min-w-0">
          <span :class="['block truncate text-sm', n.readAt ? 'text-fg-muted' : 'font-medium text-fg']">{{ n.title }}</span>
          <span class="block text-xs text-fg-subtle">{{ timeAgo(n.createdAt) }}</span>
        </span>
      </button>
    </div>
    <RouterLink
      to="/me/notifications"
      class="mt-1 block rounded-lg border-t border-line px-3 pt-3 pb-2 text-center text-xs font-medium text-accent-fg transition hover:text-brand-700"
    >
      View all notifications
    </RouterLink>
  </AppDropdown>
</template>
