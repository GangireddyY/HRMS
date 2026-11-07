<script setup lang="ts">
import { CalendarDays, Check, MapPin, Pin } from '@lucide/vue';
import { RSVP_RESPONSES, type RsvpResponse } from '@contracts';
import type { Announcement } from '@/modules/engagement/types';
import { CATEGORY_LABELS, RSVP_LABELS, categoryTone, eventWhen } from '@/modules/engagement/utils/engagement-format';
import { AppBadge, AppButton } from '@/shared/components';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** An announcement in the feed, with acknowledgement and RSVP actions. */
const props = defineProps<{ announcement: Announcement; busy?: boolean; clamp?: boolean; canRespond?: boolean }>();
const emit = defineEmits<{ acknowledge: []; rsvp: [response: RsvpResponse] }>();
const eventOver = () => !!props.announcement.eventStartsAt && new Date(props.announcement.eventEndsAt ?? props.announcement.eventStartsAt) < new Date();
</script>

<template>
  <article class="card p-4" :class="announcement.pinned && 'border-brand-400/60'">
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <AppBadge :tone="categoryTone[announcement.category]" size="sm">{{ CATEGORY_LABELS[announcement.category] }}</AppBadge>
      <span v-if="announcement.pinned" class="inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400"><Pin :size="12" aria-hidden="true" />Pinned</span>
      <span class="text-xs text-fg-subtle">{{ announcement.publishedAt ? timeAgo(announcement.publishedAt) : 'Draft' }}</span>
    </div>
    <RouterLink v-if="clamp" :to="`/me/engagement/announcements/${announcement.id}`" class="text-lg font-semibold text-fg hover:underline">{{ announcement.title }}</RouterLink>
    <h2 v-else class="text-lg font-semibold text-fg">{{ announcement.title }}</h2>
    <p v-if="announcement.category === 'EVENT'" class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
      <span class="inline-flex items-center gap-1"><CalendarDays :size="14" aria-hidden="true" />{{ eventWhen(announcement) }}</span>
      <span v-if="announcement.eventLocation" class="inline-flex items-center gap-1"><MapPin :size="14" aria-hidden="true" />{{ announcement.eventLocation }}</span>
    </p>
    <p class="mt-2 text-sm whitespace-pre-line text-fg" :class="clamp && 'line-clamp-4'">{{ announcement.body }}</p>
    <p v-if="announcement.expiresAt" class="mt-2 text-xs text-fg-subtle">Until {{ formatDate(announcement.expiresAt) }}</p>
    <div v-if="canRespond !== false && (announcement.requiresAck || (announcement.category === 'EVENT' && !eventOver()))" class="mt-4 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
      <template v-if="announcement.requiresAck">
        <span v-if="announcement.mine.acknowledgedAt" class="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400"><Check :size="14" aria-hidden="true" />Acknowledged {{ timeAgo(announcement.mine.acknowledgedAt) }}</span>
        <AppButton v-else size="sm" :icon="Check" :loading="busy" @click="emit('acknowledge')">I've read this</AppButton>
      </template>
      <template v-if="announcement.category === 'EVENT' && !eventOver()">
        <span class="text-sm text-fg-muted">Will you attend?</span>
        <AppButton v-for="r in RSVP_RESPONSES" :key="r" size="sm" :variant="announcement.mine.rsvp === r ? 'primary' : 'secondary'" :aria-pressed="announcement.mine.rsvp === r" :disabled="busy" @click="emit('rsvp', r)">{{ RSVP_LABELS[r] }}</AppButton>
      </template>
    </div>
  </article>
</template>
