<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight, Check } from '@lucide/vue';
import type { NotificationRow } from '@/modules/notifications/types';
import { TONE_TILE, needsAction, notificationTime, notificationVisual } from '@/modules/notifications/utils/notification-visuals';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

const props = defineProps<{ notification: NotificationRow }>();
defineEmits<{ open: []; read: [] }>();
const v = computed(() => notificationVisual(props.notification));
const unread = computed(() => !props.notification.readAt);
</script>

<template>
  <article
    :class="[
      'group/card relative flex h-full flex-col overflow-hidden rounded-xl bg-surface ring-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-card focus-within:shadow-card',
      unread ? 'ring-brand-600/25 dark:ring-brand-400/30' : 'ring-line',
    ]"
  >
    <span v-if="unread" class="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-500 to-brand-300" aria-hidden="true" />
    <button type="button" class="flex flex-1 flex-col gap-3 p-4 text-start focus-visible:outline-none" @click="$emit('open')">
      <span class="flex w-full items-center gap-3">
        <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', TONE_TILE[v.tone]]" aria-hidden="true">
          <component :is="v.icon" :size="18" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-xs font-semibold text-fg-muted">{{ v.label }}</span>
          <time class="block text-xs text-fg-subtle" :datetime="notification.createdAt" :title="formatDateTime(notification.createdAt)">{{ timeAgo(notification.createdAt) }}</time>
        </span>
        <span v-if="unread" class="h-2 w-2 shrink-0 rounded-full bg-brand-500 ring-4 ring-brand-500/15" aria-label="Unread" />
      </span>
      <span class="min-w-0">
        <span :class="['line-clamp-2 text-sm leading-snug', unread ? 'font-semibold text-fg' : 'font-medium text-fg']">{{ notification.title }}</span>
        <span v-if="notification.body" class="mt-1 line-clamp-2 block text-sm text-fg-muted">{{ notification.body }}</span>
      </span>
      <span v-if="needsAction(notification)" class="inline-flex w-fit items-center rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-semibold text-warning-fg">Action needed</span>
    </button>
    <footer class="mt-auto flex items-center gap-2 border-t border-line/60 px-4 py-2.5 text-xs">
      <span class="text-fg-subtle tabular-nums">{{ notificationTime(notification.createdAt) }}</span>
      <button
        v-if="unread"
        type="button"
        class="ms-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-fg-muted transition hover:bg-surface-muted hover:text-fg"
        :aria-label="`Mark “${notification.title}” as read`"
        @click="$emit('read')"
      >
        <Check :size="13" aria-hidden="true" />Mark read
      </button>
      <button
        v-if="notification.link"
        type="button"
        :class="['inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-accent-fg transition hover:bg-accent-soft', !unread && 'ms-auto']"
        tabindex="-1"
        aria-hidden="true"
        @click="$emit('open')"
      >
        Open<ArrowRight :size="13" class="transition-transform group-hover/card:translate-x-0.5" />
      </button>
    </footer>
  </article>
</template>
