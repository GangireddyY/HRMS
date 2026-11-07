<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { CalendarClock, ChevronLeft, ChevronRight, ExternalLink, Plane, Tags, UserRound, Users, X } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { leaveApi } from '@/modules/leave/api/leave.api';
import LeaveFilterMenu from '@/modules/leave/components/LeaveFilterMenu.vue';
import LeaveTimeline from '@/modules/leave/components/LeaveTimeline.vue';
import LeaveWeekRows from '@/modules/leave/components/LeaveWeekRows.vue';
import type { LeaveCalendar } from '@/modules/leave/types';
import { addDays, daysBetween, formatIso, mondayOf, monthGrid } from '@/modules/leave/utils/calendar-dates';
import { formatDays, formatLeaveRange, LEAVE_STATUS_LABELS, leaveStatusTone, todayIso } from '@/modules/leave/utils/leave-format';
import { monthLabel, shiftMonth } from '@/modules/attendance/utils/attendance-format';
import { employeesApi, structureApi } from '@/modules/people/api/people.api';
import { AppAvatar, AppBadge, AppButton, AppEmptyState, AppErrorState, AppSearchInput, AppSegmented, AppSelect, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useDevice } from '@/shared/composables/use-device';
import { useFloating, useOutsideClose } from '@/shared/composables/use-floating';

type Entry = LeaveCalendar['entries'][number];
type View = 'month' | 'week' | 'schedule' | 'timeline';

/**
 * Team leave laid out like a calendar app: a side panel with a small month, the people in scope and the leave types
 * (untick one to hide it), and the calendar in month, week, schedule or timeline view. Selecting a leave opens its
 * details. The API serves whole months, so a view that crosses a month end loads each month it touches.
 */
const VIEWS: { value: View; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'timeline', label: 'Timeline' },
];
const VIEW_KEY = 'hrms.leave-calendar.view.v2';
const auth = useAuthStore();
const { isDesktop } = useDevice();
const today = todayIso();
const stored = localStorage.getItem(VIEW_KEY);
const view = ref<View>(VIEWS.some((v) => v.value === stored) ? (stored as View) : 'month');
watch(view, (v) => localStorage.setItem(VIEW_KEY, v));
const anchor = ref(today);
const departmentId = ref<string | null>(null);

const anchorMonth = computed(() => anchor.value.slice(0, 7));
const range = computed(() => {
  if (view.value === 'month') return monthGrid(anchorMonth.value);
  if (view.value === 'week') return { from: mondayOf(anchor.value), to: addDays(mondayOf(anchor.value), 6) };
  return { from: `${anchorMonth.value}-01`, to: addDays(`${shiftMonth(anchorMonth.value, 1)}-01`, -1) };
});
const months = computed(() => {
  const out: string[] = [];
  for (let m = range.value.from.slice(0, 7); m <= range.value.to.slice(0, 7); m = shiftMonth(m, 1)) out.push(m);
  return out;
});
const weeks = computed(() => daysBetween(range.value.from, range.value.to).filter((_, i) => i % 7 === 0));

const calendar = useAsync(async () => {
  const parts = await Promise.all(months.value.map((m) => leaveApi.calendar(m, departmentId.value ?? undefined)));
  const seen = new Set<string>();
  return { holidays: parts.flatMap((p) => p.holidays), entries: parts.flatMap((p) => p.entries).filter((e) => !seen.has(e.id) && !!seen.add(e.id)) };
});
watch([() => months.value.join(), departmentId], () => void calendar.run());
const departments = useAsync(() => structureApi.departments());
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const canListPeople = computed(() => auth.can('employee.view', 'TEAM'));
const staff = useAsync(() =>
  canListPeople.value ? employeesApi.list({ page: 1, pageSize: 100, status: 'ACTIVE', sort: 'name:asc', departmentId: departmentId.value ?? undefined }) : Promise.resolve(null),
);
watch(departmentId, () => void staff.run());

function shift(step: -1 | 1) {
  anchor.value = view.value === 'week' ? addDays(anchor.value, step * 7) : `${shiftMonth(anchorMonth.value, step)}-01`;
}
const title = computed(() => {
  if (view.value !== 'week') return monthLabel(anchorMonth.value);
  const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return fmt.formatRange(new Date(`${range.value.from}T00:00:00Z`), new Date(`${range.value.to}T00:00:00Z`));
});
const showsToday = computed(() => (view.value === 'week' ? range.value.from <= today && today <= range.value.to : anchorMonth.value === today.slice(0, 7)));

const holidays = computed(() => new Map((calendar.data.value?.holidays ?? []).filter((h) => !h.isOptional).map((h) => [h.date, h.name])));
const inRange = computed(() => (calendar.data.value?.entries ?? []).filter((e) => e.startDate <= range.value.to && e.endDate >= range.value.from));

// ---- Side panel filters --------------------------------------------------------------------------
const hidden = reactive({ people: new Set<string>(), types: new Set<string>() });
const toggle = (set: Set<string>, id: string) => (set.has(id) ? set.delete(id) : set.add(id));
const visible = computed(() => inRange.value.filter((e) => !hidden.people.has(e.employee.id) && !hidden.types.has(e.leaveType.id)));

const types = computed(() => {
  const m = new Map<string, Entry['leaveType'] & { count: number }>();
  for (const e of inRange.value) m.set(e.leaveType.id, { ...e.leaveType, count: (m.get(e.leaveType.id)?.count ?? 0) + 1 });
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
});
const peopleSearch = ref('');
const people = computed(() => {
  const away = new Map<string, { id: string; name: string; department: string | null; avatarUrl: string | null; count: number; outToday: boolean }>();
  for (const e of inRange.value) {
    const p = away.get(e.employee.id) ?? { id: e.employee.id, name: e.employee.name, department: e.employee.department, avatarUrl: null, count: 0, outToday: false };
    p.count++;
    if (e.status === 'APPROVED' && e.startDate <= today && e.endDate >= today) p.outToday = true;
    away.set(e.employee.id, p);
  }
  const others = (staff.data.value?.items ?? []).filter((s) => !away.has(s.id)).map((s) => ({ id: s.id, name: s.fullName, department: s.department?.name ?? null, avatarUrl: s.avatarUrl, count: 0, outToday: false }));
  for (const s of staff.data.value?.items ?? []) if (away.has(s.id)) away.get(s.id)!.avatarUrl = s.avatarUrl;
  const q = peopleSearch.value.trim().toLowerCase();
  const all = [...[...away.values()].sort((a, b) => a.name.localeCompare(b.name)), ...others];
  return q ? all.filter((p) => p.name.toLowerCase().includes(q) || p.department?.toLowerCase().includes(q)) : all;
});
const awayCount = computed(() => new Set(inRange.value.map((e) => e.employee.id)).size);
const allPeopleShown = computed(() => people.value.every((p) => !hidden.people.has(p.id)));
function toggleAllPeople() {
  if (allPeopleShown.value) for (const p of people.value) hidden.people.add(p.id);
  else for (const p of people.value) hidden.people.delete(p.id);
}
const peopleShown = computed(() => people.value.filter((p) => !hidden.people.has(p.id)).length);
function clearFilters() {
  hidden.people.clear();
  hidden.types.clear();
  departmentId.value = null;
}
const pending = computed(() => inRange.value.filter((e) => e.status === 'PENDING').length);

function goTo(iso: string, asWeek = false) {
  anchor.value = iso;
  if (asWeek) view.value = 'week';
}

// ---- Schedule ----------------------------------------------------------------------------------
const schedule = computed(() => {
  const by = new Map<string, Entry[]>();
  for (const e of [...visible.value].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.employee.name.localeCompare(b.employee.name))) {
    const d = e.startDate < range.value.from ? range.value.from : e.startDate;
    by.set(d, [...(by.get(d) ?? []), e]);
  }
  for (const d of holidays.value.keys()) if (d >= range.value.from && d <= range.value.to && !by.has(d)) by.set(d, []);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
});
const sessionLabel = (e: Entry) => {
  if (e.startDate === e.endDate) return e.startSession === 'FIRST_HALF' ? 'Morning' : e.startSession === 'SECOND_HALF' ? 'Afternoon' : 'All day';
  return `${formatIso(e.startDate, { day: 'numeric', month: 'short' })} – ${formatIso(e.endDate, { day: 'numeric', month: 'short' })}`;
};

// ---- Event details -----------------------------------------------------------------------------
const active = ref<Entry | null>(null);
const popOpen = ref(false);
const trigger = ref<HTMLElement | null>(null);
const pop = ref<HTMLElement | null>(null);
const floating = useFloating(trigger, popOpen, { width: 320, maxHeight: 360 });
useOutsideClose([pop], popOpen, () => (popOpen.value = false));
function open(e: Entry, el: HTMLElement) {
  active.value = e;
  trigger.value = el;
  popOpen.value = true;
}
</script>

<template>
  <div class="flex flex-col lg:h-full" @keydown.esc="popOpen = false">
    <h1 class="sr-only">Team leave calendar</h1>

    <!-- Calendar -->
    <section class="card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label="Calendar">
      <div class="shrink-0 border-b border-line">
        <div class="flex flex-wrap items-center gap-2 px-3 pt-2.5 pb-2 sm:px-4">
          <AppButton size="sm" variant="secondary" :disabled="showsToday" @click="anchor = today">Today</AppButton>
          <div class="flex items-center">
            <AppButton size="sm" variant="ghost" :icon="ChevronLeft" :aria-label="view === 'week' ? 'Previous week' : 'Previous month'" @click="shift(-1)" />
            <AppButton size="sm" variant="ghost" :icon="ChevronRight" :aria-label="view === 'week' ? 'Next week' : 'Next month'" @click="shift(1)" />
          </div>
          <h2 class="me-auto text-lg font-normal text-fg sm:text-[22px]" aria-live="polite">{{ title }}</h2>
          <AppSegmented v-model="view" :options="VIEWS" label="Calendar view" size="sm" />
          <AppButton size="sm" :icon="CalendarClock" to="/hr/leave/requests">
            Leave requests
            <span v-if="pending" class="ms-0.5 rounded-full bg-white/25 px-1.5 text-2xs font-semibold tabular-nums">{{ pending }}</span>
          </AppButton>
        </div>

        <!-- Filters -->
        <div class="flex flex-wrap items-center gap-2 px-3 pb-2.5 sm:px-4" role="group" aria-label="Filters">
          <AppSelect v-model="departmentId" class="w-48 max-sm:flex-1" size="sm" :options="departmentOptions" placeholder="All departments" aria-label="Filter by department" />

          <LeaveFilterMenu label="People" :icon="Users" :active="hidden.people.size > 0" :summary="hidden.people.size ? `${peopleShown}` : undefined">
            <div class="border-b border-line p-2"><AppSearchInput v-model="peopleSearch" placeholder="Search for people" aria-label="Search for people" /></div>
            <label class="flex cursor-pointer items-center gap-2.5 border-b border-line/70 px-3 py-2 text-xs font-medium text-fg-muted hover:bg-surface-muted/60">
              <input type="checkbox" class="h-4 w-4 rounded accent-brand-600" :checked="allPeopleShown" @change="toggleAllPeople" />
              Show everyone
              <span class="ms-auto text-2xs text-fg-subtle">{{ awayCount }} away</span>
            </label>
            <ul class="min-h-0 flex-1 overflow-y-auto py-1" aria-label="People">
              <li v-for="p in people" :key="p.id">
                <label class="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-surface-muted/60">
                  <input type="checkbox" class="h-4 w-4 shrink-0 rounded accent-brand-600" :checked="!hidden.people.has(p.id)" :aria-label="`Show ${p.name}`" @change="toggle(hidden.people, p.id)" />
                  <span class="relative shrink-0">
                    <AppAvatar :name="p.name" :src="p.avatarUrl" size="xs" />
                    <span v-if="p.outToday" class="absolute -end-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-surface-raised" title="Out today" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span :class="['block truncate text-sm', p.count ? 'font-medium text-fg' : 'text-fg-muted']">{{ p.name }}</span>
                    <span v-if="p.department" class="block truncate text-2xs text-fg-subtle">{{ p.department }}</span>
                  </span>
                  <span v-if="p.count" class="shrink-0 rounded-full bg-brand-50 px-1.5 text-2xs font-semibold text-brand-700 tabular-nums dark:bg-brand-500/15 dark:text-brand-200">{{ p.count }}</span>
                </label>
              </li>
              <li v-if="!people.length" class="px-3 py-3 text-xs text-fg-muted">{{ peopleSearch ? 'No one matches.' : 'No one in view.' }}</li>
            </ul>
          </LeaveFilterMenu>

          <LeaveFilterMenu label="Leave types" :icon="Tags" :active="hidden.types.size > 0" :summary="hidden.types.size ? `${types.length - hidden.types.size}` : undefined" :width="240">
            <ul class="py-1" aria-label="Leave types">
              <li v-for="t in types" :key="t.id">
                <label class="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-fg hover:bg-surface-muted/60">
                  <input type="checkbox" class="h-4 w-4 shrink-0 rounded" :style="{ accentColor: t.color }" :checked="!hidden.types.has(t.id)" :aria-label="`Show ${t.name}`" @change="toggle(hidden.types, t.id)" />
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: t.color }" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate">{{ t.name }}</span>
                  <span class="text-2xs text-fg-subtle tabular-nums">{{ t.count }}</span>
                </label>
              </li>
              <li v-if="!types.length" class="px-3 py-3 text-xs text-fg-muted">No leave in view.</li>
            </ul>
          </LeaveFilterMenu>

          <button v-if="hidden.people.size || hidden.types.size || departmentId" type="button" class="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300" @click="clearFilters">Clear filters</button>

          <ul class="ms-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted max-md:hidden" aria-label="Legend">
            <li v-for="t in types.filter((x) => !hidden.types.has(x.id))" :key="t.id" class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" :style="{ backgroundColor: t.color }" aria-hidden="true" />{{ t.name }}</li>
            <li class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full ring-[1.5px] ring-fg-muted ring-inset" aria-hidden="true" />Pending</li>
            <li class="inline-flex items-center gap-1.5"><span class="text-fg-subtle">AM / PM</span>Half day</li>
            <li v-if="holidays.size" class="inline-flex items-center gap-1.5"><span class="h-2 w-3 rounded-sm bg-violet-500/25" aria-hidden="true" />Holiday</li>
          </ul>
        </div>
      </div>

      <AppSkeleton v-if="calendar.loading.value && !calendar.data.value" class="p-4" :lines="8" />
      <AppErrorState v-else-if="calendar.error.value" :error="calendar.error.value" title="Could not load the calendar" @retry="calendar.run" />
      <div
        v-else
        :class="[
          'min-h-0 flex-1',
          (view === 'month' || view === 'timeline') && isDesktop ? 'overflow-hidden' : 'overflow-y-auto',
          view === 'schedule' && 'p-3 sm:p-4',
          calendar.loading.value && 'opacity-60 transition-opacity',
        ]"
      >
        <LeaveWeekRows
          v-if="view === 'month' || view === 'week'"
          :weeks="weeks"
          :entries="visible"
          :holidays="holidays"
          :today="today"
          :month="view === 'month' ? anchorMonth : undefined"
          :mode="view"
          :fit="isDesktop"
          @open="open"
          @day="(d) => goTo(d, true)"
        />

        <template v-else-if="view === 'schedule'">
          <AppEmptyState v-if="!schedule.length" :icon="Plane" :title="`No leave in ${monthLabel(anchorMonth)}`" description="Approved and pending leave of the people shown appears here." />
          <ol v-else class="divide-y divide-line/70 overflow-hidden rounded-md border border-line">
            <li v-for="[d, list] in schedule" :key="d" class="flex gap-3 px-3 py-3 sm:gap-6 sm:px-4">
              <button type="button" class="flex w-16 shrink-0 items-start gap-2 text-start sm:w-28" :aria-label="`Week of ${formatIso(d, { day: 'numeric', month: 'long' })}`" @click="goTo(d, true)">
                <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-medium tabular-nums', d === today ? 'bg-brand-600 text-white dark:bg-brand-500' : 'text-fg']">{{ Number(d.slice(8)) }}</span>
                <span class="mt-1 text-2xs font-semibold text-fg-muted uppercase max-sm:hidden">{{ formatIso(d, { month: 'short', weekday: 'short' }) }}</span>
              </button>
              <ul class="min-w-0 flex-1 space-y-1">
                <li v-if="holidays.get(d)" class="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm">
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full bg-violet-500" aria-hidden="true" />
                  <span class="w-28 shrink-0 text-xs text-fg-muted max-sm:hidden">All day</span>
                  <span class="font-medium text-violet-700 dark:text-violet-300">{{ holidays.get(d) }}</span>
                </li>
                <li v-for="e in list" :key="e.id">
                  <button type="button" class="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-start text-sm transition hover:bg-surface-muted" @click="(ev: MouseEvent) => open(e, ev.currentTarget as HTMLElement)">
                    <span :class="['h-2.5 w-2.5 shrink-0 rounded-full', e.status === 'PENDING' && 'ring-2 ring-current ring-offset-1 ring-offset-surface']" :style="{ backgroundColor: e.leaveType.color, color: e.leaveType.color }" aria-hidden="true" />
                    <span class="w-28 shrink-0 text-xs text-fg-muted tabular-nums max-sm:hidden">{{ sessionLabel(e) }}</span>
                    <span class="min-w-0 flex-1 truncate">
                      <span class="font-medium text-fg">{{ e.employee.name }}</span>
                      <span class="text-fg-muted"> · {{ e.leaveType.name }} · {{ formatDays(e.days) }}</span>
                    </span>
                    <AppBadge v-if="e.status === 'PENDING'" tone="warning" size="sm">Pending</AppBadge>
                  </button>
                </li>
              </ul>
            </li>
          </ol>
        </template>

        <template v-else>
          <AppEmptyState v-if="!visible.length" :icon="Plane" :title="`No leave in ${monthLabel(anchorMonth)}`" description="Approved and pending leave of the people shown appears here." />
          <LeaveTimeline v-else :days="daysBetween(range.from, range.to)" :entries="visible" :holidays="holidays" :today="today" @open="open" />
        </template>
      </div>
    </section>

    <!-- Leave details -->
    <Teleport to="body">
      <Transition enter-active-class="transition duration-150 ease-out" enter-from-class="opacity-0 scale-[0.98]" leave-active-class="transition duration-100" leave-to-class="opacity-0">
        <div v-if="popOpen && active" ref="pop" role="dialog" :aria-label="`${active.employee.name}, ${active.leaveType.name}`" :style="floating.style.value" class="z-[70] overflow-hidden rounded-lg border border-line bg-surface-raised shadow-pop">
          <div class="h-1.5" :style="{ backgroundColor: active.leaveType.color }" aria-hidden="true" />
          <div class="p-4">
            <div class="flex items-start gap-3">
              <span class="mt-1 h-3 w-3 shrink-0 rounded-[3px]" :style="{ backgroundColor: active.leaveType.color }" aria-hidden="true" />
              <div class="min-w-0 flex-1">
                <p class="text-base font-semibold text-fg">{{ active.employee.name }}</p>
                <p class="text-sm text-fg-muted">{{ active.leaveType.name }}</p>
              </div>
              <button type="button" class="-me-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-full text-fg-muted hover:bg-surface-muted hover:text-fg" aria-label="Close" @click="popOpen = false"><X class="h-4 w-4" /></button>
            </div>
            <dl class="mt-3 space-y-1.5 ps-6 text-sm">
              <div class="text-fg">{{ formatLeaveRange(active) }}</div>
              <div class="text-fg-muted">{{ formatDays(active.days) }}{{ active.employee.department ? ` · ${active.employee.department}` : '' }}</div>
              <div><AppBadge :tone="leaveStatusTone[active.status]" size="sm" dot>{{ LEAVE_STATUS_LABELS[active.status] }}</AppBadge></div>
            </dl>
            <div class="mt-4 flex flex-wrap gap-2 ps-6">
              <AppButton size="sm" variant="secondary" :icon="UserRound" :to="`/hr/employees/${active.employee.id}`">Profile</AppButton>
              <AppButton v-if="active.status === 'PENDING'" size="sm" :icon="ExternalLink" to="/hr/leave/requests">Review</AppButton>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
