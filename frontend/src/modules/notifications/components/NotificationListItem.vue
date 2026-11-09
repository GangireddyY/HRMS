<script setup lang="ts">
import { computed } from 'vue';
import { Check, ChevronRight } from '@lucide/vue';
import type { NotificationRow } from '@/modules/notifications/types';
import { TONE_TILE, needsAction, notificationTime, notificationVisual } from '@/modules/notifications/utils/notification-visuals';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

const props = defineProps<{ notification: NotificationRow }>();
defineEmits<{ open: []; read: [] }>();
const v = computed(() => notificationVisual(props.notification));
const unread = computed(() => !props.notification.readAt);
</script>

<template>
  <li class="group/row relative">
    <span v-if="unread" class="absolute inset-y-2 start-0 w-0.5 rounded-full bg-brand-600 dark:bg-brand-400" aria-hidden="true" />
    <button
      type="button"
      :class="[
        'flex w-full items-start gap-3.5 px-4 py-3.5 text-start transition-colors hover:bg-surface-muted/60 focus-visible:bg-surface-muted/60 focus-visible:outline-none sm:gap-4 sm:px-5',
        unread && 'bg-accent-soft/40',
      ]"
      @click="$emit('open')"
    >
      <span :class="['relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', TONE_TILE[v.tone]]" aria-hidden="true">
        <component :is="v.icon" :size="18" />
        <span v-if="unread" class="absolute -top-0.5 -end-0.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-surface" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-subtle">
          <span class="font-medium text-fg-muted">{{ v.label }}</span>
          <span aria-hidden="true">·</span>
          <time :datetime="notification.createdAt" :title="formatDateTime(notification.createdAt)">{{ timeAgo(notification.createdAt) }}</time>
          <span v-if="needsAction(notification)" class="rounded-full bg-warning-soft px-1.5 py-px text-2xs font-semibold text-warning-fg">Action needed</span>
        </span>
        <span :class="['mt-0.5 block text-sm leading-snug', unread ? 'font-semibold text-fg' : 'text-fg']">{{ notification.title }}</span>
        <span v-if="notification.body" class="mt-0.5 line-clamp-2 block text-sm text-fg-muted">{{ notification.body }}</span>
      </span>
      <span class="flex shrink-0 items-center gap-1 self-center ps-2 text-xs text-fg-subtle tabular-nums">
        <span class="max-sm:hidden" :class="unread && 'sm:group-hover/row:invisible sm:group-focus-within/row:invisible'">{{ notificationTime(notification.createdAt) }}</span>
        <ChevronRight v-if="notification.link" :size="16" class="text-fg-subtle transition-transform group-hover/row:translate-x-0.5" aria-hidden="true" />
      </span>
    </button>
    <button
      v-if="unread"
      type="button"
      class="absolute end-10 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs font-medium text-fg-muted opacity-0 shadow-xs ring-1 ring-line transition hover:text-fg focus-visible:opacity-100 group-hover/row:opacity-100 max-sm:hidden"
      :aria-label="`Mark “${notification.title}” as read`"
      @click="$emit('read')"
    >
      <Check :size="13" aria-hidden="true" />Mark read
    </button>
  </li>
</template>
