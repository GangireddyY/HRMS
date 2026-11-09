<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Archive, CalendarDays, ChevronRight, Eye, FileClock, Globe, ListChecks, MailCheck, MapPin, Pencil, Pin, Plus, Send, Target, Trash2, Users } from '@lucide/vue';
import { ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_STATUSES, type AnnouncementCategory, type AnnouncementStatus } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import AnnouncementFormModal from '@/modules/engagement/components/AnnouncementFormModal.vue';
import type { Announcement, Tracking } from '@/modules/engagement/types';
import { ANNOUNCEMENT_VISUALS } from '@/modules/engagement/utils/admin-visuals';
import { ANNOUNCEMENT_STATUS_LABELS, CATEGORY_LABELS, RSVP_LABELS, announcementTone, eventWhen } from '@/modules/engagement/utils/engagement-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppEmptyState, AppModal, AppPageHeader, AppSearchInput, AppSegmented, AppSelect, AppSkeleton, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Announcements and events for HR: status summary, reach and acknowledgement rates, and what needs following up. */
const feedback = useFeedbackStore();
const table = useTable((q) => engagementApi.announcements({ ...q, manage: true }), { filters: { status: undefined as AnnouncementStatus | undefined, category: undefined as AnnouncementCategory | undefined } });
const statusOptions = ANNOUNCEMENT_STATUSES.map((s) => ({ value: s, label: ANNOUNCEMENT_STATUS_LABELS[s] }));
const categoryOptions = ANNOUNCEMENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));
const formOpen = ref(false);
const editing = ref<Announcement | null>(null);
function openForm(a: Announcement | null) {
  editing.value = a;
  formOpen.value = true;
}
async function reload() {
  reach.value = {};
  await Promise.all([table.load(), summary.run()]);
}
async function onSaved() {
  formOpen.value = false;
  feedback.success('Announcement saved');
  await reload();
}
async function act(fn: () => Promise<unknown>, success: string, description?: string) {
  try {
    await fn();
    feedback.success(success, description);
    await reload();
  } catch (e) {
    feedback.error('Could not complete the action', e);
  }
}
async function publish(a: Announcement) {
  if (!(await feedback.confirm({ title: `Publish "${a.title}"?`, message: a.requiresAck || a.category === 'ALERT' || a.category === 'EVENT' ? 'It appears in the feed and everyone in the audience is notified.' : 'It appears in the feed of everyone in the audience.', confirmLabel: 'Publish' }))) return;
  await act(() => engagementApi.publish(a.id), 'Published');
}
async function remove(a: Announcement) {
  if (!(await feedback.confirm({ title: `Delete "${a.title}"?`, message: 'The draft is deleted.', confirmLabel: 'Delete', danger: true }))) return;
  await act(() => engagementApi.removeAnnouncement(a.id), 'Draft deleted');
}
const trackingFor = ref<Announcement | null>(null);
const tracking = ref<Tracking | null>(null);
async function openTracking(a: Announcement) {
  trackingFor.value = a;
  tracking.value = reach.value[a.id] ?? null;
  peopleFilter.value = 'all';
  try {
    tracking.value = await engagementApi.tracking(a.id);
    reach.value = { ...reach.value, [a.id]: tracking.value };
  } catch (e) {
    trackingFor.value = null;
    feedback.error('Could not load responses', e);
  }
}
const columns: TableColumn<Announcement>[] = [
  { key: 'title', label: 'Announcement' },
  { key: 'status', label: 'Status' },
  { key: 'responses', label: 'Reach & responses', class: 'w-64' },
  { key: 'actions', label: '', align: 'right' },
];

// ---- Summary -------------------------------------------------------------------------------------------------------
const summary = useAsync(() => fetchAllPages((page, pageSize) => engagementApi.announcements({ manage: true, page, pageSize })));
const everything = computed(() => summary.data.value ?? []);
const now = Date.now();
const isExpired = (a: Announcement) => !!a.expiresAt && new Date(a.expiresAt).getTime() < now;
const isUpcomingEvent = (a: Announcement) => a.category === 'EVENT' && !!a.eventStartsAt && new Date(a.eventStartsAt).getTime() > now;
const ofStatus = (s: AnnouncementStatus) => everything.value.filter((a) => a.status === s);
const live = computed(() => ofStatus('PUBLISHED').filter((a) => !isExpired(a)));
const stripItems = computed<StripItem[]>(() => [
  { key: 'PUBLISHED', label: 'Published', value: ofStatus('PUBLISHED').length, tone: 'success', hint: `${live.value.filter((a) => a.pinned).length} pinned · ${live.value.filter(isUpcomingEvent).length} upcoming event${live.value.filter(isUpcomingEvent).length === 1 ? '' : 's'}` },
  { key: 'DRAFT', label: 'Drafts', value: ofStatus('DRAFT').length, tone: 'neutral', hint: ofStatus('DRAFT').length ? 'Not visible to anyone yet' : 'Nothing waiting' },
  { key: 'ARCHIVED', label: 'Archived', value: ofStatus('ARCHIVED').length, tone: 'warning', hint: 'Out of the feed' },
  { key: 'ack', label: 'Acknowledgement rate', value: ackRate.value === null ? '—' : `${ackRate.value}%`, tone: 'info', hint: ackItems.value.length ? `Across ${ackItems.value.length} live policy notice${ackItems.value.length === 1 ? '' : 's'}` : 'No notice needs acknowledging' },
]);
/** The rate metric is a figure, not a filter. */
const selectStrip = (key: string | null) => {
  if (key === 'ack') return;
  table.filters.status = (key ?? undefined) as AnnouncementStatus | undefined;
};

// ---- Reach (audience and responses per announcement; the existing tracking read, cached per row) -----------------------
const reach = ref<Record<string, Tracking>>({});
const pending = new Set<string>();
async function loadReach(list: Announcement[]) {
  const todo = list.filter((a) => a.status !== 'DRAFT' && !reach.value[a.id] && !pending.has(a.id));
  todo.forEach((a) => pending.add(a.id));
  await Promise.all(
    todo.map(async (a) => {
      try {
        const t = await engagementApi.tracking(a.id);
        reach.value = { ...reach.value, [a.id]: t };
      } catch {
        // The row falls back to its plain counts.
      } finally {
        pending.delete(a.id);
      }
    }),
  );
}
watch(() => table.rows.value, (rows) => void loadReach(rows), { immediate: true });
const ackItems = computed(() => live.value.filter((a) => a.requiresAck));
watch(ackItems, (items) => void loadReach([...items, ...live.value.filter(isUpcomingEvent)]));
const ackRate = computed(() => {
  const known = ackItems.value.filter((a) => reach.value[a.id]?.audience);
  if (!known.length) return null;
  const audience = known.reduce((n, a) => n + reach.value[a.id]!.audience, 0);
  const acked = known.reduce((n, a) => n + (a.counts?.acknowledged ?? 0), 0);
  return Math.round((acked / audience) * 100);
});
const share = (n: number, a: Announcement) => {
  const audience = reach.value[a.id]?.audience;
  return audience ? Math.min(100, Math.round((n / audience) * 100)) : null;
};
const ackTone = (rate: number) => (rate >= 80 ? 'bg-success' : rate >= 50 ? 'bg-brand-500' : 'bg-warning');

// ---- Needs attention -------------------------------------------------------------------------------------------------
const attention = computed(() => {
  const out: { id: string; a: Announcement | null; icon: typeof Pin; tone: string; title: string; text: string; action: string; run: () => void }[] = [];
  for (const a of ackItems.value) {
    const rate = share(a.counts?.acknowledged ?? 0, a);
    if (rate !== null && rate < 80)
      out.push({ id: `ack${a.id}`, a, icon: MailCheck, tone: rate < 50 ? 'bg-warning-soft text-warning-fg' : 'bg-info-soft text-info-fg', title: a.title, text: `${a.counts?.acknowledged ?? 0} of ${reach.value[a.id]!.audience} acknowledged (${rate}%) · published ${timeAgo(a.publishedAt)}`, action: 'Who hasn’t', run: () => void openTracking(a) });
  }
  for (const a of live.value.filter(isUpcomingEvent)) {
    const days = Math.ceil((new Date(a.eventStartsAt!).getTime() - now) / 86_400_000);
    if (days <= 21) out.push({ id: `ev${a.id}`, a, icon: CalendarDays, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300', title: a.title, text: `In ${days} day${days === 1 ? '' : 's'} · ${a.counts?.going ?? 0} going, ${a.counts?.maybe ?? 0} maybe${reach.value[a.id] ? ` of ${reach.value[a.id]!.audience} invited` : ''}`, action: 'RSVPs', run: () => void openTracking(a) });
  }
  const drafts = ofStatus('DRAFT').length;
  if (drafts) out.push({ id: 'drafts', a: null, icon: FileClock, tone: 'bg-surface-muted text-fg-muted', title: `${drafts} draft${drafts === 1 ? '' : 's'} not published`, text: 'Review and publish, or delete what you no longer need', action: 'Show drafts', run: () => (table.filters.status = 'DRAFT') });
  return out;
});

// ---- Tracking modal ----------------------------------------------------------------------------------------------------
type PeopleFilter = 'all' | 'acked' | 'pending' | 'GOING' | 'MAYBE' | 'NOT_GOING' | 'none';
const peopleFilter = ref<PeopleFilter>('all');
const peopleOptions = computed(() => {
  const t = tracking.value;
  const a = trackingFor.value;
  if (!t || !a) return [];
  const n = (f: (p: Tracking['people'][number]) => boolean) => t.people.filter(f).length;
  return [
    { value: 'all' as const, label: `Everyone ${t.people.length}` },
    ...(a.requiresAck ? [{ value: 'pending' as const, label: `Not yet ${n((p) => !p.acknowledgedAt)}` }, { value: 'acked' as const, label: `Acknowledged ${n((p) => !!p.acknowledgedAt)}` }] : []),
    ...(a.category === 'EVENT'
      ? [
          { value: 'GOING' as const, label: `Going ${n((p) => p.rsvp === 'GOING')}` },
          { value: 'MAYBE' as const, label: `Maybe ${n((p) => p.rsvp === 'MAYBE')}` },
          { value: 'none' as const, label: `No reply ${n((p) => !p.rsvp)}` },
        ]
      : []),
  ];
});
const people = computed(() => {
  const list = tracking.value?.people ?? [];
  const f = peopleFilter.value;
  if (f === 'all') return list;
  if (f === 'acked') return list.filter((p) => p.acknowledgedAt);
  if (f === 'pending') return list.filter((p) => !p.acknowledgedAt);
  if (f === 'none') return list.filter((p) => !p.rsvp);
  return list.filter((p) => p.rsvp === f);
});
const trackingStats = computed(() => {
  const t = tracking.value;
  if (!t) return null;
  const acked = t.people.filter((p) => p.acknowledgedAt).length;
  const going = t.people.filter((p) => p.rsvp === 'GOING').length;
  const maybe = t.people.filter((p) => p.rsvp === 'MAYBE').length;
  const notGoing = t.people.filter((p) => p.rsvp === 'NOT_GOING').length;
  const pctOf = (n: number) => (t.audience ? Math.round((n / t.audience) * 100) : 0);
  return { acked, ackPct: pctOf(acked), going, maybe, notGoing, goingPct: pctOf(going), maybePct: pctOf(maybe), notGoingPct: pctOf(notGoing) };
});
const tile = (iso: string) => {
  const d = new Date(iso);
  return { day: d.getDate(), month: d.toLocaleDateString(appLocale(), { month: 'short' }) };
};
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Announcements" description="News, policy updates and events for everyone or for specific departments and locations.">
      <template #actions><AppButton :icon="Plus" @click="openForm(null)">New announcement</AppButton></template>
    </AppPageHeader>

    <AppStatStrip :items="stripItems" :loading="summary.loading.value && !summary.data.value" selectable :selected="table.filters.status ?? null" label="Announcements by status — select to filter" @select="selectStrip" />

    <AppCard v-if="attention.length" title="Needs follow-up" :icon="ListChecks" :description="`${attention.length} thing${attention.length === 1 ? '' : 's'} to check on`" :padded="false">
      <ul class="grid gap-px bg-line/70 md:grid-cols-2">
        <li v-for="it in attention" :key="it.id" class="flex items-center gap-3 bg-surface px-4 py-3 md:last:odd:col-span-2">
          <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', it.tone]" aria-hidden="true"><component :is="it.icon" :size="16" /></span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-fg">{{ it.title }}</p>
            <p class="truncate text-xs text-fg-muted">{{ it.text }}</p>
          </div>
          <AppButton size="sm" variant="secondary" :icon-right="ChevronRight" @click="it.run">{{ it.action }}</AppButton>
        </li>
      </ul>
    </AppCard>

    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_180px_180px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search announcements" aria-label="Search announcements" />
        <AppSelect v-model="table.filters.category" :options="categoryOptions" placeholder="All categories" aria-label="Filter by category" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" caption="Announcements" empty-title="No announcements yet" empty-description="Share news, a policy people must acknowledge, or an event they can RSVP to." @page="table.setPage" @retry="table.load" :filtered="table.isFiltered.value" @clear="table.clearFilters()">
        <template #empty><AppButton :icon="Plus" @click="openForm(null)">New announcement</AppButton></template>
        <template #cell-title="{ row }">
          <div class="flex min-w-0 items-start gap-3">
            <div v-if="row.category === 'EVENT' && row.eventStartsAt" :class="['flex w-10 shrink-0 flex-col items-center rounded-lg py-1', ANNOUNCEMENT_VISUALS.EVENT.tile]" :title="CATEGORY_LABELS.EVENT">
              <span class="text-2xs leading-3 font-semibold uppercase">{{ tile(row.eventStartsAt).month }}</span>
              <span class="text-base leading-5 font-semibold tabular-nums">{{ tile(row.eventStartsAt).day }}</span>
            </div>
            <span v-else :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', ANNOUNCEMENT_VISUALS[row.category].tile]" :title="CATEGORY_LABELS[row.category]" aria-hidden="true">
              <component :is="ANNOUNCEMENT_VISUALS[row.category].icon" :size="18" />
            </span>
            <div class="min-w-0">
              <p class="flex flex-wrap items-center gap-1.5 font-medium text-fg">
                <Pin v-if="row.pinned" :size="13" class="shrink-0 rotate-45 fill-current text-brand-600 dark:text-brand-400" aria-label="Pinned" />
                <span class="truncate">{{ row.title }}</span>
                <AppBadge v-if="row.requiresAck" size="sm" tone="info">Acknowledge</AppBadge>
              </p>
              <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                <span>{{ CATEGORY_LABELS[row.category] }}</span>
                <span aria-hidden="true">·</span>
                <span v-if="row.category === 'EVENT' && row.eventStartsAt">{{ eventWhen(row) }}<template v-if="isUpcomingEvent(row)"> · {{ timeAgo(row.eventStartsAt) }}</template></span>
                <span v-else>{{ row.publishedAt ? `Published ${timeAgo(row.publishedAt)}` : `Drafted ${timeAgo(row.createdAt)}` }}</span>
                <span v-if="row.eventLocation" class="inline-flex items-center gap-0.5"><MapPin :size="11" aria-hidden="true" />{{ row.eventLocation }}</span>
              </p>
              <p v-if="row.expiresAt || (row.category === 'EVENT' && row.eventStartsAt && !isUpcomingEvent(row))" class="mt-1 flex flex-wrap gap-1.5">
                <span v-if="row.expiresAt" :class="['inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium', isExpired(row) ? 'bg-surface-muted text-fg-subtle' : 'bg-warning-soft text-warning-fg']">{{ isExpired(row) ? `Expired ${formatDate(row.expiresAt)}` : `Shown until ${formatDate(row.expiresAt)}` }}</span>
                <span v-if="row.category === 'EVENT' && row.eventStartsAt && !isUpcomingEvent(row)" class="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-subtle">Event has taken place</span>
              </p>
            </div>
          </div>
        </template>
        <template #cell-status="{ row }">
          <AppBadge :tone="announcementTone[row.status]" dot>{{ ANNOUNCEMENT_STATUS_LABELS[row.status] }}</AppBadge>
          <p class="mt-1 flex items-center gap-1 text-2xs text-fg-subtle">
            <component :is="row.departmentIds?.length || row.locationIds?.length ? Target : Globe" :size="11" aria-hidden="true" />{{ row.departmentIds?.length || row.locationIds?.length ? 'Targeted' : 'Everyone' }}
          </p>
        </template>
        <template #cell-responses="{ row }">
          <div class="min-w-48 space-y-1.5 text-xs">
            <p v-if="row.status === 'DRAFT'" class="text-fg-subtle">Not published yet</p>
            <p v-else class="flex items-center gap-1 text-fg-muted">
              <Users :size="12" aria-hidden="true" />
              <template v-if="reach[row.id]">Reaches <span class="font-medium text-fg tabular-nums">{{ reach[row.id]!.audience }}</span> {{ reach[row.id]!.audience === 1 ? 'person' : 'people' }}</template>
              <span v-else class="skeleton h-3 w-20 rounded-full" />
            </p>
            <div v-if="row.requiresAck && row.status !== 'DRAFT'">
              <p class="flex justify-between gap-2">
                <span class="text-fg-muted"><span class="font-medium text-fg tabular-nums">{{ row.counts?.acknowledged ?? 0 }}</span> acknowledged</span>
                <span v-if="share(row.counts?.acknowledged ?? 0, row) !== null" class="font-medium text-fg tabular-nums">{{ share(row.counts?.acknowledged ?? 0, row) }}%</span>
              </p>
              <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <div :class="['h-full rounded-full', ackTone(share(row.counts?.acknowledged ?? 0, row) ?? 0)]" :style="{ width: `${share(row.counts?.acknowledged ?? 0, row) ?? 0}%` }" />
              </div>
            </div>
            <div v-if="row.category === 'EVENT' && row.status !== 'DRAFT'">
              <p class="text-fg-muted"><span class="font-medium text-fg tabular-nums">{{ row.counts?.going ?? 0 }}</span> going · <span class="tabular-nums">{{ row.counts?.maybe ?? 0 }}</span> maybe<template v-if="row.counts?.notGoing"> · <span class="tabular-nums">{{ row.counts.notGoing }}</span> can't go</template></p>
              <div class="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                <span class="h-full bg-success" :style="{ width: `${share(row.counts?.going ?? 0, row) ?? 0}%` }" />
                <span class="h-full bg-warning" :style="{ width: `${share(row.counts?.maybe ?? 0, row) ?? 0}%` }" />
                <span class="h-full bg-danger/60" :style="{ width: `${share(row.counts?.notGoing ?? 0, row) ?? 0}%` }" />
              </div>
            </div>
          </div>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1">
            <AppButton v-if="row.status !== 'DRAFT' && (row.requiresAck || row.category === 'EVENT')" size="sm" variant="ghost" :icon="Eye" :aria-label="`Responses to ${row.title}`" @click="openTracking(row)" />
            <AppButton v-if="row.status !== 'ARCHIVED'" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.title}`" @click="openForm(row)" />
            <AppButton v-if="row.status === 'DRAFT'" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.title}`" @click="remove(row)" />
            <AppButton v-if="row.status === 'PUBLISHED'" size="sm" variant="ghost" :icon="Archive" :aria-label="`Archive ${row.title}`" @click="act(() => engagementApi.archive(row.id), 'Archived')" />
            <AppButton v-if="row.status === 'DRAFT'" size="sm" :icon="Send" @click="publish(row)">Publish</AppButton>
          </div>
        </template>
      </AppDataTable>
    </AppCard>
    <AnnouncementFormModal :open="formOpen" :announcement="editing" @close="formOpen = false" @saved="onSaved" />
    <AppModal :open="!!trackingFor" :title="trackingFor ? `Responses · ${trackingFor.title}` : ''" :description="trackingFor ? `${CATEGORY_LABELS[trackingFor.category]}${trackingFor.publishedAt ? ` · published ${formatDate(trackingFor.publishedAt)}` : ''}` : undefined" size="lg" :guide="false" :guard-changes="false" @close="trackingFor = null">
      <AppSkeleton v-if="!tracking" :lines="5" />
      <template v-else>
        <div v-if="trackingStats" :class="['mb-4 grid gap-3', trackingFor?.requiresAck && trackingFor?.category === 'EVENT' && 'sm:grid-cols-2']">
          <div v-if="trackingFor?.requiresAck" class="rounded-xl p-4 ring-1 ring-line">
            <p class="text-xs font-medium text-fg-muted">Acknowledged</p>
            <p class="mt-1 text-2xl font-semibold text-fg tabular-nums">{{ trackingStats.ackPct }}% <span class="text-sm font-normal text-fg-muted">{{ trackingStats.acked }} of {{ tracking.audience }}</span></p>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true"><div :class="['h-full rounded-full', ackTone(trackingStats.ackPct)]" :style="{ width: `${trackingStats.ackPct}%` }" /></div>
          </div>
          <div v-if="trackingFor?.category === 'EVENT'" class="rounded-xl p-4 ring-1 ring-line">
            <p class="text-xs font-medium text-fg-muted">RSVPs</p>
            <p class="mt-1 text-2xl font-semibold text-fg tabular-nums">{{ trackingStats.going }} <span class="text-sm font-normal text-fg-muted">going of {{ tracking.audience }} invited</span></p>
            <div class="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              <span class="h-full bg-success" :style="{ width: `${trackingStats.goingPct}%` }" />
              <span class="h-full bg-warning" :style="{ width: `${trackingStats.maybePct}%` }" />
              <span class="h-full bg-danger/60" :style="{ width: `${trackingStats.notGoingPct}%` }" />
            </div>
            <p class="mt-2 flex flex-wrap gap-x-3 text-2xs text-fg-muted">
              <span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full bg-success" aria-hidden="true" />Going {{ trackingStats.going }}</span>
              <span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />Maybe {{ trackingStats.maybe }}</span>
              <span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full bg-danger/60" aria-hidden="true" />Can't go {{ trackingStats.notGoing }}</span>
            </p>
          </div>
        </div>
        <AppSegmented v-if="peopleOptions.length > 1" v-model="peopleFilter" class="mb-3" size="sm" :options="peopleOptions" label="Show people" />
        <AppEmptyState v-if="!people.length" compact :icon="Users" title="Nobody here" description="No one in the audience matches this filter." />
        <ul v-else class="max-h-[60vh] divide-y divide-line overflow-y-auto">
          <li v-for="p in people" :key="p.employee.id" class="flex items-center gap-3 py-2 text-sm">
            <AppAvatar :name="p.employee.name" size="sm" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-fg">{{ p.employee.name }}</span>
              <span class="block truncate text-xs text-fg-muted">{{ p.employee.department ?? p.employee.employeeCode }}</span>
            </span>
            <span class="flex shrink-0 items-center gap-2">
              <AppBadge v-if="p.rsvp" size="sm" :tone="p.rsvp === 'GOING' ? 'success' : p.rsvp === 'MAYBE' ? 'warning' : 'neutral'" dot>{{ RSVP_LABELS[p.rsvp] }}</AppBadge>
              <AppBadge v-if="trackingFor?.requiresAck" size="sm" :tone="p.acknowledgedAt ? 'success' : 'warning'" dot>{{ p.acknowledgedAt ? `Acknowledged ${timeAgo(p.acknowledgedAt)}` : 'Not yet' }}</AppBadge>
            </span>
          </li>
        </ul>
      </template>
    </AppModal>
  </div>
</template>
