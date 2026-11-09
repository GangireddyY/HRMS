<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { CalendarDays, CalendarOff, CalendarRange, ChevronLeft, ChevronRight, Eraser, Repeat, Users } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import RotationsModal from '@/modules/attendance/components/RotationsModal.vue';
import type { RosterDay } from '@/modules/attendance/types';
import { appLocale } from '@/core/locale/locale';
import { WEEKDAY_SHORT, addDays } from '@/modules/attendance/utils/attendance-format';
import { localToday, plural } from '@/modules/attendance/utils/attendance-ops';
import { structureApi } from '@/modules/people/api/people.api';
import { AppAlert, AppAvatar, AppButton, AppCard, AppCheckbox, AppDatePicker, AppEmptyState, AppErrorState, AppInput, AppModal, AppPagination, AppPageHeader, AppSearchInput, AppSegmented, AppSelect, AppSkeleton, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Who works which shift on each day; planners assign shifts, days off and rotations from today onwards. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canPlan = auth.can('attendance.configure');
const today = localToday();
const monday = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
const start = ref(monday(today));
const span = ref<7 | 14>(14);
const spanModel = computed({ get: () => (span.value === 7 ? '7' : '14'), set: (v: '7' | '14') => (span.value = v === '7' ? 7 : 14) });
const spanOptions = [
  { value: '7' as const, label: 'One week' },
  { value: '14' as const, label: 'Two weeks' },
];
const end = computed(() => addDays(start.value, span.value - 1));
const rangeLabel = computed(() => {
  const f = new Intl.DateTimeFormat(appLocale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return f.formatRange(new Date(`${start.value}T00:00:00Z`), new Date(`${end.value}T00:00:00Z`));
});
/** Two weeks leave too little room for the full hours; the cell's tooltip and the legend still give them. */
const cellTime = (d: RosterDay) => (span.value === 7 ? d.time : d.time.split(/[–-]/)[0]);
const isThisWeek = computed(() => start.value === monday(today));
const filters = reactive({ departmentId: undefined as string | undefined, search: '', page: 1 });
const roster = useAsync(() => attendanceApi.roster({ from: start.value, to: end.value, departmentId: filters.departmentId, search: filters.search || undefined, page: filters.page, pageSize: 25 }));
let timer: ReturnType<typeof setTimeout> | undefined;
watch([start, span, () => filters.departmentId, () => filters.page], () => void roster.run());
watch(
  () => filters.search,
  () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.page = 1;
      void roster.run();
    }, 300);
  },
);
const departments = useAsync(() => structureApi.departments());
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const rows = computed(() => roster.data.value?.page.items ?? []);

// Colours per shift, stable by its position in the list.
const palette = ['bg-info/15 text-info-fg ring-info/30', 'bg-special/15 text-special-fg ring-special/30', 'bg-warning/15 text-warning-fg ring-warning/30', 'bg-success/15 text-success-fg ring-success/30', 'bg-caution/15 text-caution-fg ring-caution/30', 'bg-away/15 text-away-fg ring-away/30'];
const colour = computed(() => new Map((roster.data.value?.shifts ?? []).map((s, i) => [s.id, palette[i % palette.length]!])));
function cell(d: RosterDay) {
  if (d.off) return 'bg-surface-muted text-fg-subtle ring-line';
  return d.rostered ? (colour.value.get(d.shiftId ?? '') ?? palette[0]) : 'bg-surface text-fg-muted ring-line';
}
const short = (name: string) => (name.length <= 8 ? name : `${name.slice(0, 7)}…`);
const dayHeader = (d: string) => {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
  return { wd: WEEKDAY_SHORT[wd], n: Number(d.slice(8)), weekend: wd === 0 || wd === 6 };
};

/** Legend: shifts used in this view (or all active ones), with how many planned days each has on screen. */
const legend = computed(() => {
  const used = new Map<string, number>();
  for (const r of rows.value) for (const d of r.days) if (d.rostered && !d.off && d.shiftId) used.set(d.shiftId, (used.get(d.shiftId) ?? 0) + 1);
  return (roster.data.value?.shifts ?? []).filter((s) => s.isActive || used.has(s.id)).map((s) => ({ ...s, cls: colour.value.get(s.id)!, planned: used.get(s.id) ?? 0 }));
});
const plannedDays = computed(() => rows.value.reduce((n, r) => n + r.days.filter((d) => d.rostered).length, 0));
const offToday = computed(() => rows.value.filter((r) => r.days.find((d) => d.date === today)?.off).length);

// Selection and planning.
const selected = ref<string[]>([]);
const allOnPage = computed({
  get: () => rows.value.length > 0 && rows.value.every((r) => selected.value.includes(r.employee.id)),
  set: (v: boolean) => (selected.value = v ? [...new Set([...selected.value, ...rows.value.map((r) => r.employee.id)])] : selected.value.filter((id) => !rows.value.some((r) => r.employee.id === id))),
});
const toggle = (id: string) => (selected.value = selected.value.includes(id) ? selected.value.filter((x) => x !== id) : [...selected.value, id]);
const planning = ref(false);
const mode = ref('shift');
const modes = [
  { key: 'shift', label: 'Shift or day off', icon: CalendarDays },
  { key: 'rotation', label: 'Rotation', icon: Repeat },
  { key: 'clear', label: 'Usual shift', icon: Eraser },
];
const plan = reactive({ from: today as string | undefined, to: addDays(today, 6) as string | undefined, shiftId: null as string | null, rotationId: null as string | null, offset: 0 as number | string });
const shifts = useAsync(() => attendanceApi.shifts(), { immediate: canPlan });
const rotations = useAsync(() => attendanceApi.rotations(), { immediate: canPlan });
const shiftOptions = computed(() => [{ value: '__off', label: 'Day off' }, ...(shifts.data.value ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.name} (${s.startTime}–${s.endTime})` }))]);
const rotationOptions = computed(() => (rotations.data.value ?? []).filter((r) => r.isActive).map((r) => ({ value: r.id, label: `${r.name} · ${r.cycleDays}-day cycle` })));
const { fieldErrors, formError, handle, reset } = useFormErrors();
function openPlan() {
  reset();
  Object.assign(plan, { from: start.value < today ? today : start.value, to: addDays(start.value < today ? today : start.value, 6), shiftId: shiftOptions.value[1]?.value ?? '__off', rotationId: rotationOptions.value[0]?.value ?? null, offset: 0 });
  planning.value = true;
}
const busy = ref(false);
async function apply() {
  reset();
  busy.value = true;
  const base = { employeeIds: selected.value, from: plan.from!, to: plan.to! };
  try {
    const res =
      mode.value === 'rotation'
        ? await attendanceApi.applyRotation({ ...base, rotationId: plan.rotationId!, offset: Number(plan.offset) || 0 })
        : mode.value === 'clear'
          ? await attendanceApi.clearRoster(base)
          : await attendanceApi.assignRoster({ ...base, shiftId: plan.shiftId === '__off' ? null : plan.shiftId });
    feedback.success('Roster updated', `${res.employees} employee${res.employees === 1 ? '' : 's'} from ${plan.from} to ${plan.to}.`);
    planning.value = false;
    await roster.run();
  } catch (e) {
    handle(e, 'Could not update the roster');
  } finally {
    busy.value = false;
  }
}
const managingRotations = ref(false);
</script>

<template>
  <div>
    <AppPageHeader title="Roster" description="The shift each person works on each day. Rostered days override the usual shift; plain cells follow it.">
      <template v-if="canPlan" #actions>
        <AppButton variant="secondary" :icon="Repeat" @click="managingRotations = true">Rotations</AppButton>
        <AppButton :icon="CalendarRange" :disabled="!selected.length" @click="openPlan">Plan{{ selected.length ? ` (${selected.length})` : '' }}</AppButton>
      </template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
        <div class="flex items-center gap-1">
          <AppButton size="sm" variant="ghost" :icon="ChevronLeft" aria-label="Earlier" @click="start = addDays(start, -7)" />
          <AppButton size="sm" variant="secondary" :disabled="isThisWeek" @click="start = monday(today)">This week</AppButton>
          <AppButton size="sm" variant="ghost" :icon="ChevronRight" aria-label="Later" @click="start = addDays(start, 7)" />
        </div>
        <p class="min-w-36 text-sm font-semibold text-fg tabular-nums" aria-live="polite">{{ rangeLabel }}</p>
        <AppSegmented v-model="spanModel" class="w-48" size="sm" :options="spanOptions" label="Days shown" />
        <AppSelect v-model="filters.departmentId" class="w-52" size="sm" :options="departmentOptions" placeholder="All departments" aria-label="Filter by department" />
        <AppSearchInput v-model="filters.search" class="min-w-48 flex-1" placeholder="Search by name or code" aria-label="Search employees" />
      </div>

      <!-- Legend and what's on screen -->
      <div v-if="roster.data.value" class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line/70 bg-surface-muted/40 px-4 py-2.5 text-xs">
        <span v-for="s in legend" :key="s.id" class="inline-flex items-center gap-1.5 text-fg-muted">
          <span :class="['h-3 w-3 rounded ring-1 ring-inset', s.cls]" aria-hidden="true" />
          <span class="font-medium text-fg">{{ s.name }}</span>
          <span class="tabular-nums">{{ s.startTime }}–{{ s.endTime }}</span>
        </span>
        <span class="inline-flex items-center gap-1.5 text-fg-muted"><span class="h-3 w-3 rounded bg-surface ring-1 ring-line ring-inset" aria-hidden="true" />Usual shift</span>
        <span class="inline-flex items-center gap-1.5 text-fg-muted"><span class="h-3 w-3 rounded bg-surface-muted ring-1 ring-line ring-inset" aria-hidden="true" />Day off</span>
        <span class="ms-auto inline-flex items-center gap-3 text-fg-muted">
          <span class="inline-flex items-center gap-1"><Users :size="12" aria-hidden="true" />{{ plural(roster.data.value.page.meta.total, 'person', 'people') }}</span>
          <span class="inline-flex items-center gap-1"><CalendarRange :size="12" aria-hidden="true" />{{ plural(plannedDays, 'rostered day') }}</span>
          <span v-if="today >= start && today <= end" class="inline-flex items-center gap-1"><CalendarOff :size="12" aria-hidden="true" />{{ offToday }} off today</span>
        </span>
      </div>

      <div v-if="canPlan && selected.length" class="flex flex-wrap items-center gap-2 border-b border-line bg-accent-soft px-4 py-2" role="region" aria-label="Selection">
        <p class="me-auto text-sm font-medium text-accent-fg" aria-live="polite">{{ selected.length }} selected</p>
        <AppButton size="sm" :icon="CalendarRange" @click="openPlan">Plan roster</AppButton>
        <AppButton size="sm" variant="ghost" @click="selected = []">Clear selection</AppButton>
      </div>

      <div class="p-4">
        <AppSkeleton v-if="roster.loading.value && !roster.data.value" :lines="8" />
        <AppErrorState v-else-if="roster.error.value" :error="roster.error.value" @retry="roster.run" />
        <AppEmptyState v-else-if="!rows.length" compact :icon="Users" title="Nobody to show" :description="filters.search || filters.departmentId ? 'Nobody matches this search or department.' : 'People in your scope appear here with their shifts.'" />
        <div v-else :class="['overflow-x-auto', roster.loading.value && 'opacity-60']">
          <table class="w-full border-separate border-spacing-1 text-xs">
            <caption class="sr-only">Roster {{ rangeLabel }}</caption>
            <thead>
              <tr>
                <th scope="col" class="sticky start-0 z-10 bg-surface text-start font-medium text-fg-muted">
                  <AppCheckbox v-if="canPlan" v-model="allOnPage" label="Employee" />
                  <span v-else>Employee</span>
                </th>
                <th
                  v-for="d in roster.data.value!.days"
                  :key="d"
                  scope="col"
                  :class="['min-w-16 rounded-t-md pt-1 pb-1 font-medium', d === today ? 'bg-accent-soft text-accent-fg' : dayHeader(d).weekend ? 'text-fg-subtle' : 'text-fg-muted']"
                  :aria-current="d === today ? 'date' : undefined"
                >
                  <span class="block text-2xs uppercase">{{ dayHeader(d).wd }}</span>
                  <span :class="['mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums', d === today ? 'bg-brand-600 text-white shadow-xs' : dayHeader(d).weekend ? 'text-fg-muted' : 'text-fg']">{{ dayHeader(d).n }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.employee.id" :class="selected.includes(r.employee.id) && '[&>th]:bg-accent-soft'">
                <th scope="row" class="sticky start-0 z-10 max-w-40 min-w-36 rounded-md bg-surface pe-2 text-start font-normal sm:max-w-none sm:min-w-56">
                  <label :class="['flex items-center gap-2.5 py-1', canPlan && 'cursor-pointer']">
                    <input v-if="canPlan" type="checkbox" class="h-4 w-4 shrink-0 rounded border-line accent-brand-600" :checked="selected.includes(r.employee.id)" :aria-label="`Select ${r.employee.name}`" @change="toggle(r.employee.id)" />
                    <AppAvatar :name="r.employee.name" size="sm" class="max-sm:hidden" />
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium text-fg">{{ r.employee.name }}</span>
                      <span class="block truncate text-fg-muted">{{ r.employee.employeeCode }} · usually {{ r.usualShift.name }}</span>
                    </span>
                  </label>
                </th>
                <td
                  v-for="d in r.days"
                  :key="d.date"
                  :class="['rounded-md px-1.5 py-2 text-center ring-1 ring-inset', cell(d), d.date < today && 'opacity-55', d.date === today && 'outline-2 outline-offset-1 outline-brand-500/40']"
                  :title="d.off ? 'Day off' : `${d.shiftName} ${d.time}${d.rostered ? ' (rostered)' : ''}`"
                >
                  <span class="block font-medium">{{ d.off ? 'Off' : short(d.shiftName) }}</span>
                  <span v-if="!d.off" class="block text-2xs whitespace-nowrap tabular-nums">{{ cellTime(d) }}</span>
                  <span v-if="d.rostered" class="sr-only">(rostered)</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="roster.data.value && roster.data.value.page.meta.totalPages > 1" class="border-t border-line p-3">
        <AppPagination :meta="roster.data.value.page.meta" @change="(p: number) => (filters.page = p)" />
      </div>
    </AppCard>

    <AppModal :open="planning" title="Plan the roster" :description="`${selected.length} employee${selected.length === 1 ? '' : 's'} selected. Planned days replace what was rostered before.`" @close="planning = false">
      <div class="space-y-4">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppDatePicker v-model="plan.from" label="From" required :min="today" :error="fieldErrors.from" />
          <AppDatePicker v-model="plan.to" label="To" required :min="plan.from" :max="plan.from ? addDays(plan.from, 91) : undefined" :error="fieldErrors.to" />
        </div>
        <AppTabs v-model="mode" :tabs="modes">
          <div class="space-y-4 pt-1">
            <AppSelect v-if="mode === 'shift'" v-model="plan.shiftId" label="Shift" :options="shiftOptions" :clearable="false" :error="fieldErrors.shiftId" />
            <template v-else-if="mode === 'rotation'">
              <AppAlert v-if="!rotationOptions.length" tone="info">Create a rotation first.</AppAlert>
              <AppSelect v-model="plan.rotationId" label="Rotation" :options="rotationOptions" :clearable="false" :error="fieldErrors.rotationId" />
              <AppInput v-model="plan.offset" label="Start this many days into the cycle" type="number" :min="0" :max="55" help="Stagger teams on the same rotation." :error="fieldErrors.offset" />
            </template>
            <p v-else class="text-sm text-fg-muted">The selected people go back to their usual shift for these days.</p>
          </div>
        </AppTabs>
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="planning = false">Cancel</AppButton>
        <AppButton :loading="busy" :disabled="!plan.from || !plan.to || (mode === 'rotation' && !plan.rotationId)" @click="apply">Apply</AppButton>
      </template>
    </AppModal>
    <RotationsModal :open="managingRotations" :rotations="rotations.data.value ?? []" :shifts="shifts.data.value ?? []" @close="managingRotations = false" @changed="rotations.run()" />
  </div>
</template>
