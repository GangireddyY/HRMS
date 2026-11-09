<script setup lang="ts">
import { computed } from 'vue';
import { Archive, CalendarClock, Eye, Globe, MailCheck, MapPin, Pencil, Pin, Send, Target, Trash2, Users } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import type { Announcement, Tracking } from '@/modules/engagement/types';
import { ANNOUNCEMENT_VISUALS } from '@/modules/engagement/utils/admin-visuals';
import { ANNOUNCEMENT_STATUS_LABELS, CATEGORY_LABELS, announcementTone, eventWhen } from '@/modules/engagement/utils/engagement-format';
import { AppBadge, AppButton } from '@/shared/components';
import { formatDate, formatDateTime, timeAgo } from '@/shared/utils/format';

/** An announcement in the HR grid: what and for whom, a preview, its reach, acknowledgements or RSVPs, and the next step. */
const props = defineProps<{ announcement: Announcement; reach?: Tracking }>();
const emit = defineEmits<{ responses: []; edit: []; remove: []; archive: []; publish: [] }>();

const a = computed(() => props.announcement);
const visual = computed(() => ANNOUNCEMENT_VISUALS[a.value.category]);
const now = Date.now();
const expired = computed(() => !!a.value.expiresAt && new Date(a.value.expiresAt).getTime() < now);
const event = computed(() => a.value.category === 'EVENT' && !!a.value.eventStartsAt);
const upcoming = computed(() => event.value && new Date(a.value.eventStartsAt!).getTime() > now);
const day = computed(() => {
  const d = new Date(a.value.eventStartsAt ?? a.value.createdAt);
  return { day: d.getDate(), month: d.toLocaleDateString(appLocale(), { month: 'short' }) };
});
const live = computed(() => a.value.status !== 'DRAFT');
const targeted = computed(() => !!(a.value.departmentIds?.length || a.value.locationIds?.length));
const share = (n: number) => (props.reach?.audience ? Math.min(100, Math.round((n / props.reach.audience) * 100)) : null);
const acked = computed(() => a.value.counts?.acknowledged ?? 0);
const ackPct = computed(() => share(acked.value));
const ackBar = computed(() => ((ackPct.value ?? 0) >= 80 ? 'bg-success' : (ackPct.value ?? 0) >= 50 ? 'bg-brand-500' : 'bg-warning'));
const rsvp = computed(() => ({ going: a.value.counts?.going ?? 0, maybe: a.value.counts?.maybe ?? 0, notGoing: a.value.counts?.notGoing ?? 0 }));
const when = computed(() =>
  a.value.publishedAt ? { text: `Published ${timeAgo(a.value.publishedAt)}`, title: formatDateTime(a.value.publishedAt) } : { text: `Drafted ${timeAgo(a.value.createdAt)}`, title: formatDateTime(a.value.createdAt) },
);
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <span v-if="event" :class="['flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl', visual.tile]" aria-hidden="true">
        <span class="text-2xs leading-3 font-semibold uppercase">{{ day.month }}</span>
        <span class="text-base leading-5 font-semibold tabular-nums">{{ day.day }}</span>
      </span>
      <span v-else :class="['grid h-11 w-11 shrink-0 place-items-center rounded-xl', visual.tile]" aria-hidden="true"><component :is="visual.icon" :size="19" /></span>
      <div class="min-w-0 flex-1">
        <h3 class="line-clamp-2 text-sm leading-snug font-semibold text-fg">{{ a.title }}</h3>
        <p class="mt-0.5 truncate text-xs text-fg-muted">{{ CATEGORY_LABELS[a.category] }}<template v-if="upcoming"> · {{ timeAgo(a.eventStartsAt) }}</template></p>
      </div>
      <AppBadge class="shrink-0" :tone="announcementTone[a.status]" size="sm" dot>{{ ANNOUNCEMENT_STATUS_LABELS[a.status] }}</AppBadge>
    </div>

    <ul class="-mt-1 flex flex-wrap gap-1.5 text-2xs" aria-label="Announcement details">
      <li v-if="a.pinned" class="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 font-medium text-accent-fg"><Pin :size="11" class="rotate-45" aria-hidden="true" />Pinned</li>
      <li v-if="a.requiresAck" class="inline-flex items-center gap-1 rounded-md bg-info-soft px-1.5 py-0.5 font-medium text-info-fg"><MailCheck :size="11" aria-hidden="true" />Must acknowledge</li>
      <li class="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-fg-muted"><component :is="targeted ? Target : Globe" :size="11" aria-hidden="true" />{{ targeted ? 'Targeted' : 'Everyone' }}</li>
      <li v-if="a.expiresAt" :class="['inline-flex items-center rounded-md px-1.5 py-0.5', expired ? 'bg-surface-muted text-fg-subtle' : 'bg-warning-soft font-medium text-warning-fg']">
        {{ expired ? `Expired ${formatDate(a.expiresAt)}` : `Until ${formatDate(a.expiresAt)}` }}
      </li>
      <li v-if="event && !upcoming" class="inline-flex items-center rounded-md bg-surface-muted px-1.5 py-0.5 text-fg-subtle">Event has taken place</li>
    </ul>

    <p class="line-clamp-2 text-xs leading-relaxed text-fg-muted" :title="a.body">{{ a.body }}</p>

    <div v-if="event" class="space-y-1 rounded-lg border border-line/70 px-3 py-2 text-xs">
      <p class="flex items-center gap-1.5 text-fg"><CalendarClock :size="12" class="shrink-0 text-fg-subtle" aria-hidden="true" /><span class="truncate">{{ eventWhen(a) }}</span></p>
      <p v-if="a.eventLocation" class="flex items-center gap-1.5 text-fg-muted"><MapPin :size="12" class="shrink-0 text-fg-subtle" aria-hidden="true" /><span class="truncate">{{ a.eventLocation }}</span></p>
    </div>

    <div v-if="live" class="space-y-2.5 rounded-lg bg-surface-muted/50 px-3 py-2.5 text-xs">
      <p class="flex items-center gap-1.5 text-fg-muted">
        <Users :size="12" class="shrink-0" aria-hidden="true" />
        <template v-if="reach">Reaches <span class="font-semibold text-fg tabular-nums">{{ reach.audience }}</span> {{ reach.audience === 1 ? 'person' : 'people' }}</template>
        <span v-else class="skeleton h-3 w-24 rounded-full" aria-hidden="true" />
      </p>
      <div v-if="a.requiresAck">
        <p class="flex justify-between gap-2">
          <span class="text-fg-muted"><span class="font-semibold text-fg tabular-nums">{{ acked }}</span><template v-if="reach"> of <span class="tabular-nums">{{ reach.audience }}</span></template> acknowledged</span>
          <span v-if="ackPct !== null" class="font-semibold text-fg tabular-nums">{{ ackPct }}%</span>
        </p>
        <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-line/60" aria-hidden="true"><div :class="['h-full rounded-full', ackBar]" :style="{ width: `${ackPct ?? 0}%` }" /></div>
      </div>
      <div v-if="a.category === 'EVENT'">
        <p class="text-fg-muted">
          <span class="font-semibold text-fg tabular-nums">{{ rsvp.going }}</span> going · <span class="tabular-nums">{{ rsvp.maybe }}</span> maybe<template v-if="rsvp.notGoing"> · <span class="tabular-nums">{{ rsvp.notGoing }}</span> can't go</template>
        </p>
        <div class="mt-1 flex h-1.5 overflow-hidden rounded-full bg-line/60" aria-hidden="true">
          <span class="h-full bg-success" :style="{ width: `${share(rsvp.going) ?? 0}%` }" />
          <span class="h-full bg-warning" :style="{ width: `${share(rsvp.maybe) ?? 0}%` }" />
          <span class="h-full bg-danger/60" :style="{ width: `${share(rsvp.notGoing) ?? 0}%` }" />
        </div>
      </div>
    </div>
    <p v-else class="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-fg-subtle">Not published yet — nobody can see it.</p>

    <div class="mt-auto flex items-center gap-2 border-t border-line/60 pt-3">
      <p class="min-w-0 flex-1 truncate text-xs text-fg-muted" :title="when.title">{{ when.text }}</p>
      <AppButton v-if="live && (a.requiresAck || a.category === 'EVENT')" size="xs" variant="ghost" :icon="Eye" :aria-label="`Responses to ${a.title}`" title="Responses" @click.stop="emit('responses')" />
      <AppButton v-if="a.status !== 'ARCHIVED'" size="xs" variant="ghost" :icon="Pencil" :aria-label="`Edit ${a.title}`" title="Edit" @click.stop="emit('edit')" />
      <AppButton v-if="a.status === 'DRAFT'" size="xs" variant="ghost" :icon="Trash2" :aria-label="`Delete ${a.title}`" title="Delete" @click.stop="emit('remove')" />
      <AppButton v-if="a.status === 'PUBLISHED'" size="xs" variant="ghost" :icon="Archive" :aria-label="`Archive ${a.title}`" title="Archive" @click.stop="emit('archive')" />
      <AppButton v-if="a.status === 'DRAFT'" size="xs" :icon="Send" @click.stop="emit('publish')">Publish</AppButton>
    </div>
  </div>
</template>
