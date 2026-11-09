<script setup lang="ts">
import { appLocale } from '@/core/locale/locale';
import { computed, ref, watch } from 'vue';
import { AlertTriangle, CalendarClock, CalendarDays, CalendarSync, CheckCircle2, ChevronLeft, ChevronRight, Download, List, ListChecks, ListPlus, Pencil, Plus, Trash2, Undo2 } from '@lucide/vue';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import FilingModal from '@/modules/compliance/components/FilingModal.vue';
import ObligationFormModal from '@/modules/compliance/components/ObligationFormModal.vue';
import type { CalendarItem, Obligation } from '@/modules/compliance/types';
import { FILING_STATE_LABELS, OBLIGATION_CATEGORY_LABELS, filingTone, localIso, scheduleLabel } from '@/modules/compliance/utils/compliance-format';
import { OBLIGATION_VISUALS, daysFromToday } from '@/modules/compliance/utils/compliance-visuals';
import { AppAvatar, AppBadge, AppButton, AppCalendarEvent, AppCard, AppEmptyState, AppErrorState, AppMonthCalendar, AppPageHeader, AppSegmented, AppSkeleton, AppStatStrip, AppTabs, type StripItem } from '@/shared/components';
import type { FilingState } from '@contracts';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Statutory due dates three months at a time (plus anything still overdue), and the obligations behind them. */
const feedback = useFeedbackStore();
const tab = ref('dates');
/** Month: a calendar grid of one month. List: three months at a time, grouped by month. */
const view = ref<'month' | 'list'>('month');
const viewOptions = [
  { value: 'month' as const, label: 'Month', icon: CalendarDays },
  { value: 'list' as const, label: 'List', icon: List },
];
const thisMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const start = ref(thisMonth());
const span = computed(() => (view.value === 'month' ? 1 : 3));
const range = computed(() => ({ from: localIso(start.value), to: localIso(new Date(start.value.getFullYear(), start.value.getMonth() + span.value, 0)) }));
const monthKey = computed(() => range.value.from.slice(0, 7));
const rangeLabel = computed(() => {
  const f = new Intl.DateTimeFormat(appLocale(), { month: 'short', year: 'numeric' });
  return `${f.format(start.value)} – ${f.format(new Date(start.value.getFullYear(), start.value.getMonth() + 2, 1))}`;
});
const calendar = useAsync(() => complianceApi.calendar({ ...range.value, overdue: true }));
watch(range, () => void calendar.run());
function shift(months: number) {
  start.value = new Date(start.value.getFullYear(), start.value.getMonth() + months, 1);
}

/** Everything overdue or due within the next week, whatever period the calendar shows. */
const today = localIso(new Date());
const weekAhead = localIso(new Date(Date.now() + 7 * 86_400_000));
const soon = useAsync(() => complianceApi.calendar({ from: today, to: weekAhead, overdue: true }));
const actionItems = computed(() =>
  (soon.data.value?.items ?? []).filter((i) => i.state === 'OVERDUE' || i.state === 'DUE_SOON').sort((a, b) => Number(b.state === 'OVERDUE') - Number(a.state === 'OVERDUE') || a.dueOn.localeCompare(b.dueOn)),
);
const refresh = () => Promise.all([calendar.run(), soon.run()]);

// ---- State filter (the summary strip) --------------------------------------------------------------------------
const stateFilter = ref<FilingState | null>(null);
const items = computed(() => calendar.data.value?.items ?? []);
const visible = computed(() => (stateFilter.value ? items.value.filter((i) => i.state === stateFilter.value) : items.value));
const strip = computed<StripItem[]>(() => {
  const c = calendar.data.value?.counts;
  const upcoming = items.value.filter((i) => i.state === 'UPCOMING').length;
  return [
    { key: 'OVERDUE', label: 'Overdue', value: c?.overdue, hint: c?.overdue ? 'File these first' : 'Nothing overdue', tone: 'danger' },
    { key: 'DUE_SOON', label: 'Due in the next 7 days', value: c?.dueSoon, hint: c?.dueSoon ? 'Prepare the filings now' : 'Nothing due this week', tone: 'warning' },
    { key: 'UPCOMING', label: 'Upcoming', value: calendar.data.value ? upcoming : null, hint: view.value === 'month' ? 'Later this month' : 'In these three months', tone: 'brand' },
    { key: 'DONE', label: 'Filed', value: c?.done, hint: 'With proof on record', tone: 'success' },
  ];
});

const byDay = computed(() => {
  const m = new Map<string, CalendarItem[]>();
  for (const i of visible.value) if (i.dueOn >= range.value.from) m.set(i.dueOn, [...(m.get(i.dueOn) ?? []), i]);
  return m;
});
const STATE_DOT: Record<FilingState, string> = { OVERDUE: 'bg-danger', DUE_SOON: 'bg-warning', UPCOMING: 'bg-brand-500', DONE: 'bg-success' };
const overdueEarlier = computed(() => visible.value.filter((i) => i.dueOn < range.value.from));
const groups = computed(() => {
  const overdue = visible.value.filter((i) => i.dueOn < range.value.from);
  const byMonth = new Map<string, CalendarItem[]>();
  for (const i of visible.value.filter((x) => x.dueOn >= range.value.from)) byMonth.set(i.dueOn.slice(0, 7), [...(byMonth.get(i.dueOn.slice(0, 7)) ?? []), i]);
  const f = new Intl.DateTimeFormat(appLocale(), { month: 'long', year: 'numeric' });
  return [
    ...(overdue.length ? [{ key: 'overdue', title: 'Overdue from earlier months', items: overdue }] : []),
    ...[...byMonth.entries()].map(([k, v]) => ({ key: k, title: f.format(new Date(Number(k.slice(0, 4)), Number(k.slice(5)) - 1, 1)), items: v })),
  ];
});

const dayFmt = new Intl.DateTimeFormat(appLocale(), { day: 'numeric' });
const monFmt = new Intl.DateTimeFormat(appLocale(), { month: 'short' });
const asDate = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
function dueText(i: CalendarItem): string {
  const d = daysFromToday(i.dueOn);
  if (i.filing) return `Filed ${formatDate(i.filing.completedOn)}${i.filing.late ? ' (late)' : ''}`;
  if (d < 0) return `${-d} day${d === -1 ? '' : 's'} overdue`;
  return d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `Due in ${d} days`;
}
const DUE_TEXT: Record<FilingState, string> = { OVERDUE: 'text-danger-fg', DUE_SOON: 'text-warning-fg', UPCOMING: 'text-fg-muted', DONE: 'text-success-fg' };

const filing = ref<CalendarItem | null>(null);
async function onFiled() {
  filing.value = null;
  feedback.success('Filing recorded');
  await refresh();
}
async function undo(i: CalendarItem) {
  if (!(await feedback.confirm({ title: 'Remove this filing?', message: 'The due date shows as not filed again.', confirmLabel: 'Remove', danger: true }))) return;
  try {
    await complianceApi.unfile(i.filing!.id);
    feedback.success('Filing removed');
    await refresh();
  } catch (e) {
    feedback.error('Could not remove the filing', e);
  }
}
async function receipt(i: CalendarItem) {
  try {
    await complianceApi.downloadFiling(i.filing!.id, i.filing!.file!.name);
  } catch (e) {
    feedback.error('Could not download the receipt', e);
  }
}

const obligations = useAsync(() => complianceApi.obligations(), { immediate: false });
watch(tab, (t) => {
  if (t === 'obligations' && !obligations.data.value) void obligations.run();
});
const tabs = computed(() => [
  { key: 'dates', label: 'Due dates', icon: CalendarClock },
  { key: 'obligations', label: 'Obligations', icon: ListChecks, count: obligations.data.value?.length ?? null },
]);
const editing = ref<Obligation | null>(null);
const formOpen = ref(false);
function openForm(o: Obligation | null) {
  editing.value = o;
  formOpen.value = true;
}
async function onSaved() {
  formOpen.value = false;
  feedback.success('Obligation saved');
  await Promise.all([obligations.run(), refresh()]);
}
async function remove(o: Obligation) {
  if (!(await feedback.confirm({ title: `Delete ${o.title}?`, message: 'It is removed from the calendar.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await complianceApi.removeObligation(o.id);
    feedback.success('Obligation deleted');
    await Promise.all([obligations.run(), refresh()]);
  } catch (e) {
    feedback.error('Could not delete it', e);
  }
}
async function recommended() {
  if (!(await feedback.confirm({ title: 'Add the recommended obligations?', message: 'PF, ESI, TDS deposits and returns, Form 16, professional tax and the POSH annual report, tracked from today. Check the state-specific dates afterwards.', confirmLabel: 'Add' }))) return;
  try {
    const r = await complianceApi.addRecommended();
    feedback.success(r.added ? `${r.added} obligation${r.added === 1 ? '' : 's'} added` : 'Everything recommended is already in the calendar');
    await Promise.all([obligations.run(), refresh()]);
  } catch (e) {
    feedback.error('Could not add them', e);
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Statutory calendar" description="Filings and payments due to authorities, and proof that they were made." back="/hr/compliance/policies" back-label="Policies">
      <template #actions>
        <AppButton variant="secondary" :icon="ListPlus" @click="recommended">Add recommended</AppButton>
        <AppButton :icon="Plus" @click="openForm(null)">New obligation</AppButton>
      </template>
    </AppPageHeader>
    <AppTabs v-model="tab" :tabs="tabs">
      <div v-if="tab === 'dates'" class="space-y-4">
        <AppStatStrip :items="strip" selectable :selected="stateFilter" :loading="calendar.loading.value && !calendar.data.value" label="Due dates by state" @select="(k) => (stateFilter = k as FilingState | null)" />

        <!-- Action needed: overdue first, then the coming week -->
        <section class="card overflow-hidden" aria-labelledby="action-title">
          <header class="flex min-h-12 items-center gap-3 border-b border-line/70 px-4 py-2">
            <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-md', actionItems.some((i) => i.state === 'OVERDUE') ? 'bg-danger-soft text-danger-fg' : actionItems.length ? 'bg-warning-soft text-warning-fg' : 'bg-success-soft text-success-fg']" aria-hidden="true">
              <component :is="actionItems.length ? AlertTriangle : CheckCircle2" :size="16" />
            </span>
            <div class="min-w-0 flex-1">
              <h2 id="action-title" class="text-sm font-semibold text-fg">Action needed</h2>
              <p class="text-xs text-fg-muted">Overdue filings and anything due in the next 7 days, whatever period you are viewing.</p>
            </div>
          </header>
          <div v-if="soon.loading.value && !soon.data.value" class="space-y-3 p-4">
            <div v-for="i in 2" :key="i" class="skeleton h-10 rounded-md" />
          </div>
          <p v-else-if="soon.error.value" class="px-4 py-3 text-sm text-fg-muted">Could not load what is due. <button type="button" class="font-medium text-accent-fg underline" @click="soon.run">Try again</button></p>
          <p v-else-if="!actionItems.length" class="px-4 py-3 text-sm text-fg-muted">You're on track: nothing is overdue and nothing is due in the next 7 days.</p>
          <ul v-else class="divide-y divide-line/70">
            <li v-for="i in actionItems" :key="`${i.obligation.id}-${i.dueOn}`" :class="['relative flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3', i.state === 'OVERDUE' && 'bg-danger-soft/20']">
              <span :class="['absolute inset-y-0 start-0 w-1', i.state === 'OVERDUE' ? 'bg-danger' : 'bg-warning']" aria-hidden="true" />
              <span :class="['flex w-12 shrink-0 flex-col items-center rounded-md py-1 ring-1 ring-inset', i.state === 'OVERDUE' ? 'bg-danger-soft text-danger-fg ring-danger/20' : 'bg-warning-soft text-warning-fg ring-warning/25']">
                <span class="text-2xs font-semibold uppercase">{{ monFmt.format(asDate(i.dueOn)) }}</span>
                <span class="text-lg leading-5 font-semibold tabular-nums">{{ dayFmt.format(asDate(i.dueOn)) }}</span>
              </span>
              <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', OBLIGATION_VISUALS[i.obligation.category].tile]" aria-hidden="true">
                <component :is="OBLIGATION_VISUALS[i.obligation.category].icon" :size="16" />
              </span>
              <div class="min-w-0 flex-1 basis-56">
                <p class="truncate font-medium text-fg">{{ i.obligation.title }}</p>
                <p class="truncate text-xs text-fg-muted">{{ OBLIGATION_CATEGORY_LABELS[i.obligation.category] }}{{ i.obligation.authority ? ` · ${i.obligation.authority}` : '' }}</p>
              </div>
              <span v-if="i.obligation.owner" class="inline-flex items-center gap-1.5 text-xs text-fg-muted max-sm:hidden"><AppAvatar :name="i.obligation.owner.name" size="xs" />{{ i.obligation.owner.name }}</span>
              <span :class="['w-28 text-end text-xs font-semibold tabular-nums', DUE_TEXT[i.state]]">{{ dueText(i) }}</span>
              <AppButton size="sm" :variant="i.state === 'OVERDUE' ? 'primary' : 'secondary'" :icon="CheckCircle2" :aria-label="`Mark filed: ${i.obligation.title}, due ${formatDate(i.dueOn)}`" @click="filing = i">Mark filed</AppButton>
            </li>
          </ul>
        </section>

        <AppSkeleton v-if="calendar.loading.value && !calendar.data.value" :lines="8" />
        <AppErrorState v-else-if="calendar.error.value" :error="calendar.error.value" @retry="calendar.run" />
        <AppCard v-else-if="view === 'month'">
          <AppMonthCalendar
            :month="monthKey"
            navigable
            aria-label="Statutory due dates"
            @prev="shift(-1)"
            @next="shift(1)"
            @today="start = thisMonth()"
          >
            <template #toolbar>
              <AppBadge v-if="stateFilter" tone="brand">{{ FILING_STATE_LABELS[stateFilter] }} only <button type="button" class="ms-0.5 font-semibold underline-offset-2 hover:underline" @click="stateFilter = null">Show all</button></AppBadge>
              <AppSegmented v-model="view" class="sm:w-44" :options="viewOptions" label="Calendar view" size="sm" />
            </template>
            <template #day="{ date, inMonth }">
              <template v-if="inMonth">
                <span v-if="byDay.get(date)?.length" class="flex justify-center gap-0.5 sm:hidden" aria-hidden="true">
                  <span v-for="i in byDay.get(date)!.slice(0, 3)" :key="i.obligation.id" class="h-1.5 w-1.5 rounded-full" :class="STATE_DOT[i.state]" />
                </span>
                <button
                  v-for="i in byDay.get(date) ?? []"
                  :key="i.obligation.id"
                  type="button"
                  class="min-h-6 min-w-0 rounded-[4px] text-start focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none max-sm:sr-only"
                  :aria-label="`${i.obligation.title}, due ${formatDate(i.dueOn)}, ${FILING_STATE_LABELS[i.state]}${i.filing ? '' : '. Mark filed'}`"
                  @click="!i.filing && (filing = i)"
                >
                  <AppCalendarEvent :tone="filingTone[i.state] === 'neutral' ? 'brand' : filingTone[i.state]" :variant="i.state === 'UPCOMING' ? 'outline' : 'fill'" :icon="i.filing ? CheckCircle2 : OBLIGATION_VISUALS[i.obligation.category].icon" :label="i.obligation.title" />
                </button>
              </template>
            </template>
            <template #legend>
              <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-muted">
                <ul class="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legend">
                  <li v-for="s in (['OVERDUE', 'DUE_SOON', 'UPCOMING', 'DONE'] as const)" :key="s" class="inline-flex items-center gap-1.5">
                    <span class="h-2 w-2 rounded-full" :class="STATE_DOT[s]" aria-hidden="true" />{{ FILING_STATE_LABELS[s] }}
                  </li>
                </ul>
                <span class="text-fg-subtle">Select a due date to record its filing.</span>
                <span v-if="overdueEarlier.length" class="ms-auto inline-flex items-center gap-1 font-medium text-danger-fg"><AlertTriangle :size="12" aria-hidden="true" />{{ overdueEarlier.length }} overdue from earlier months — listed under Action needed</span>
              </div>
            </template>
          </AppMonthCalendar>
        </AppCard>
        <template v-else>
          <div class="flex flex-wrap items-center gap-2">
            <AppButton size="sm" variant="ghost" :icon="ChevronLeft" aria-label="Earlier months" @click="shift(-3)" />
            <span class="min-w-48 text-center text-sm font-semibold text-fg">{{ rangeLabel }}</span>
            <AppButton size="sm" variant="ghost" :icon="ChevronRight" aria-label="Later months" @click="shift(3)" />
            <AppBadge v-if="stateFilter" tone="brand">{{ FILING_STATE_LABELS[stateFilter] }} only <button type="button" class="ms-0.5 font-semibold underline-offset-2 hover:underline" @click="stateFilter = null">Show all</button></AppBadge>
            <AppSegmented v-model="view" class="ms-auto sm:w-44" :options="viewOptions" label="Calendar view" size="sm" />
          </div>
          <AppCard v-if="!groups.length">
            <AppEmptyState :icon="ListPlus" :title="stateFilter ? 'Nothing here' : 'Nothing due'" :description="stateFilter ? 'No due dates in this period match the filter.' : 'Add the recommended statutory obligations or your own.'">
              <AppButton v-if="stateFilter" size="sm" variant="secondary" @click="stateFilter = null">Show all due dates</AppButton>
              <div v-else class="flex flex-wrap justify-center gap-2">
                <AppButton size="sm" variant="secondary" :icon="ListPlus" @click="recommended">Add recommended</AppButton>
                <AppButton size="sm" :icon="Plus" @click="openForm(null)">New obligation</AppButton>
              </div>
            </AppEmptyState>
          </AppCard>
          <section v-for="g in groups" v-else :key="g.key" class="card overflow-hidden" :aria-label="g.title">
            <h3 :class="['flex items-center gap-2 border-b border-line/70 px-4 py-2 text-xs font-semibold tracking-wide uppercase', g.key === 'overdue' ? 'bg-danger-soft/40 text-danger-fg' : 'bg-surface-muted/50 text-fg-muted']">
              <AlertTriangle v-if="g.key === 'overdue'" :size="13" aria-hidden="true" />{{ g.title }} <span class="font-normal tabular-nums">· {{ g.items.length }}</span>
            </h3>
            <ul class="divide-y divide-line/70">
              <li v-for="i in g.items" :key="`${i.obligation.id}-${i.dueOn}`" class="relative flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm transition hover:bg-surface-muted/30">
                <span v-if="i.state === 'OVERDUE'" class="absolute inset-y-0 start-0 w-1 bg-danger" aria-hidden="true" />
                <span class="flex w-12 shrink-0 flex-col items-center rounded-md bg-surface-muted/70 py-1 text-fg ring-1 ring-line ring-inset">
                  <span class="text-2xs font-semibold text-fg-muted uppercase">{{ monFmt.format(asDate(i.dueOn)) }}</span>
                  <span class="text-lg leading-5 font-semibold tabular-nums">{{ dayFmt.format(asDate(i.dueOn)) }}</span>
                </span>
                <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', OBLIGATION_VISUALS[i.obligation.category].tile]" aria-hidden="true">
                  <component :is="OBLIGATION_VISUALS[i.obligation.category].icon" :size="16" />
                </span>
                <div class="min-w-0 flex-1 basis-56">
                  <p class="font-medium text-fg">{{ i.obligation.title }}</p>
                  <p class="text-xs text-fg-muted">
                    {{ OBLIGATION_CATEGORY_LABELS[i.obligation.category] }}{{ i.obligation.authority ? ` · ${i.obligation.authority}` : '' }}{{ i.obligation.owner ? ` · ${i.obligation.owner.name}` : '' }}
                    <template v-if="i.filing">{{ i.filing.reference ? ` · ref ${i.filing.reference}` : '' }}{{ i.filing.completedBy ? ` · by ${i.filing.completedBy}` : '' }}</template>
                  </p>
                </div>
                <span :class="['text-xs font-medium tabular-nums', DUE_TEXT[i.state]]">{{ dueText(i) }}</span>
                <AppBadge :tone="filingTone[i.state]" dot>{{ FILING_STATE_LABELS[i.state] }}</AppBadge>
                <div class="flex gap-1">
                  <template v-if="i.filing">
                    <AppButton v-if="i.filing.file" size="sm" variant="ghost" :icon="Download" :aria-label="`Receipt for ${i.obligation.title} due ${i.dueOn}`" @click="receipt(i)" />
                    <AppButton size="sm" variant="ghost" :icon="Undo2" :aria-label="`Remove the filing of ${i.obligation.title} due ${i.dueOn}`" @click="undo(i)" />
                  </template>
                  <AppButton v-else size="sm" variant="secondary" :icon="CheckCircle2" @click="filing = i">Mark filed</AppButton>
                </div>
              </li>
            </ul>
          </section>
        </template>
      </div>

      <template v-else>
        <AppSkeleton v-if="obligations.loading.value && !obligations.data.value" :lines="6" />
        <AppErrorState v-else-if="obligations.error.value" :error="obligations.error.value" @retry="obligations.run" />
        <AppCard v-else-if="!obligations.data.value?.length">
          <AppEmptyState :icon="ListPlus" title="No obligations yet" description="Add the recommended statutory obligations or your own.">
            <div class="flex flex-wrap justify-center gap-2">
              <AppButton size="sm" variant="secondary" :icon="ListPlus" @click="recommended">Add recommended</AppButton>
              <AppButton size="sm" :icon="Plus" @click="openForm(null)">New obligation</AppButton>
            </div>
          </AppEmptyState>
        </AppCard>
        <section v-else class="card overflow-hidden" aria-labelledby="obligations-title">
          <header class="flex min-h-12 items-center gap-3 border-b border-line/70 px-4 py-2">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><ListChecks :size="16" /></span>
            <div class="min-w-0 flex-1">
              <h2 id="obligations-title" class="text-sm font-semibold text-fg">Obligations</h2>
              <p class="text-xs text-fg-muted">What is due to which authority and when. Each creates the due dates on the calendar.</p>
            </div>
          </header>
          <ul class="divide-y divide-line/70">
            <li v-for="o in obligations.data.value" :key="o.id" :class="['flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm', !o.active && 'opacity-70']">
              <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', OBLIGATION_VISUALS[o.category].tile]" aria-hidden="true">
                <component :is="OBLIGATION_VISUALS[o.category].icon" :size="16" />
              </span>
              <div class="min-w-0 flex-1 basis-64">
                <p class="flex flex-wrap items-center gap-2 font-medium text-fg">{{ o.title }} <AppBadge v-if="!o.active" size="sm">Inactive</AppBadge></p>
                <p class="text-xs text-fg-muted">{{ OBLIGATION_CATEGORY_LABELS[o.category] }}{{ o.authority ? ` · ${o.authority}` : '' }} · from {{ formatDate(o.startsOn) }}{{ o.endsOn ? ` to ${formatDate(o.endsOn)}` : '' }}</p>
                <p v-if="o.description" class="mt-0.5 text-xs text-fg-subtle">{{ o.description }}</p>
              </div>
              <span class="inline-flex items-center gap-1.5 text-xs text-fg-muted md:w-56"><CalendarSync :size="13" class="shrink-0" aria-hidden="true" /><span class="truncate" :title="`Due ${scheduleLabel(o.dueDates)}`">Due {{ scheduleLabel(o.dueDates) }}</span></span>
              <span class="inline-flex items-center gap-1.5 text-xs text-fg-muted max-md:hidden md:w-36">
                <template v-if="o.owner"><AppAvatar :name="o.owner.name" size="xs" /><span class="truncate">{{ o.owner.name }}</span></template>
                <span v-else class="text-fg-subtle">No owner</span>
              </span>
              <span class="w-20 text-end text-xs text-fg-muted tabular-nums">{{ o.filings ?? 0 }} filing{{ o.filings === 1 ? '' : 's' }}</span>
              <div class="flex gap-1">
                <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${o.title}`" @click="openForm(o)" />
                <AppButton v-if="!o.filings" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${o.title}`" @click="remove(o)" />
              </div>
            </li>
          </ul>
        </section>
      </template>
    </AppTabs>
    <FilingModal :item="filing" @close="filing = null" @saved="onFiled" />
    <ObligationFormModal :open="formOpen" :obligation="editing" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
