<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { CalendarRange, ChevronLeft, ChevronRight, Repeat } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import RotationsModal from '@/modules/attendance/components/RotationsModal.vue';
import type { RosterDay } from '@/modules/attendance/types';
import { WEEKDAY_SHORT, addDays } from '@/modules/attendance/utils/attendance-format';
import { structureApi } from '@/modules/people/api/people.api';
import { AppAlert, AppButton, AppCard, AppCheckbox, AppDatePicker, AppEmptyState, AppErrorState, AppInput, AppModal, AppPagination, AppPageHeader, AppSearchInput, AppSelect, AppSkeleton, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Who works which shift on each day; planners assign shifts, days off and rotations from today onwards. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canPlan = auth.can('attendance.configure');
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = localIso(new Date());
const monday = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
const start = ref(monday(today));
const span = ref<7 | 14>(14);
const filters = reactive({ departmentId: undefined as string | undefined, search: '', page: 1 });
const roster = useAsync(() => attendanceApi.roster({ from: start.value, to: addDays(start.value, span.value - 1), departmentId: filters.departmentId, search: filters.search || undefined, page: filters.page, pageSize: 25 }));
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
const palette = ['bg-sky-500/15 text-sky-800 ring-sky-500/30 dark:text-sky-200', 'bg-violet-500/15 text-violet-800 ring-violet-500/30 dark:text-violet-200', 'bg-amber-500/15 text-amber-800 ring-amber-500/30 dark:text-amber-200', 'bg-emerald-500/15 text-emerald-800 ring-emerald-500/30 dark:text-emerald-200', 'bg-rose-500/15 text-rose-800 ring-rose-500/30 dark:text-rose-200', 'bg-cyan-500/15 text-cyan-800 ring-cyan-500/30 dark:text-cyan-200'];
const colour = computed(() => new Map((roster.data.value?.shifts ?? []).map((s, i) => [s.id, palette[i % palette.length]!])));
function cell(d: RosterDay) {
  if (d.off) return 'bg-surface-muted text-fg-subtle ring-line';
  return d.rostered ? (colour.value.get(d.shiftId ?? '') ?? palette[0]) : 'bg-surface text-fg-muted ring-line';
}
const short = (name: string) => (name.length <= 8 ? name : `${name.slice(0, 7)}…`);
const dayHeader = (d: string) => ({ wd: WEEKDAY_SHORT[new Date(`${d}T00:00:00Z`).getUTCDay()], n: Number(d.slice(8)) });

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
  { key: 'shift', label: 'Shift or day off' },
  { key: 'rotation', label: 'Rotation' },
  { key: 'clear', label: 'Usual shift' },
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
    <AppPageHeader title="Roster" description="The shift each person works on each day. Rostered days override the usual shift; muted cells follow it.">
      <template v-if="canPlan" #actions>
        <AppButton variant="secondary" :icon="Repeat" @click="managingRotations = true">Rotations</AppButton>
        <AppButton :icon="CalendarRange" :disabled="!selected.length" @click="openPlan">Plan{{ selected.length ? ` (${selected.length})` : '' }}</AppButton>
      </template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <div class="flex items-center gap-1">
          <AppButton size="sm" variant="ghost" :icon="ChevronLeft" aria-label="Earlier" @click="start = addDays(start, -7)" />
          <AppButton size="sm" variant="secondary" @click="start = monday(today)">This week</AppButton>
          <AppButton size="sm" variant="ghost" :icon="ChevronRight" aria-label="Later" @click="start = addDays(start, 7)" />
        </div>
        <AppSelect :model-value="String(span)" class="w-36" :options="[{ value: '7', label: 'One week' }, { value: '14', label: 'Two weeks' }]" :clearable="false" aria-label="Days shown" @update:model-value="(v: string | null | undefined) => (span = v === '7' ? 7 : 14)" />
        <AppSelect v-model="filters.departmentId" class="w-52" :options="departmentOptions" placeholder="All departments" aria-label="Filter by department" />
        <AppSearchInput v-model="filters.search" class="min-w-48 flex-1" placeholder="Search by name or code" aria-label="Search employees" />
      </div>
      <div class="p-4">
        <AppSkeleton v-if="roster.loading.value && !roster.data.value" :lines="8" />
        <AppErrorState v-else-if="roster.error.value" :error="roster.error.value" @retry="roster.run" />
        <AppEmptyState v-else-if="!rows.length" compact title="Nobody to show" />
        <div v-else class="overflow-x-auto">
          <table class="w-full border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th class="sticky left-0 z-10 bg-surface text-left font-medium text-fg-muted">
                  <AppCheckbox v-if="canPlan" v-model="allOnPage" label="Employee" />
                  <span v-else>Employee</span>
                </th>
                <th v-for="d in roster.data.value!.days" :key="d" :class="['min-w-16 font-medium', d === today ? 'text-brand-600 dark:text-brand-300' : 'text-fg-muted']">
                  <span class="block">{{ dayHeader(d).wd }}</span><span class="block tabular-nums">{{ dayHeader(d).n }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.employee.id">
                <th scope="row" class="sticky left-0 z-10 max-w-36 min-w-32 bg-surface pr-2 text-left font-normal sm:max-w-none sm:min-w-48">
                  <label class="flex items-center gap-2">
                    <input v-if="canPlan" type="checkbox" class="h-4 w-4 rounded border-line accent-brand-600" :checked="selected.includes(r.employee.id)" :aria-label="`Select ${r.employee.name}`" @change="toggle(r.employee.id)" />
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium text-fg">{{ r.employee.name }}</span>
                      <span class="block truncate text-fg-muted">{{ r.employee.employeeCode }} · usually {{ r.usualShift.name }}</span>
                    </span>
                  </label>
                </th>
                <td v-for="d in r.days" :key="d.date" :class="['rounded-md px-1.5 py-1.5 text-center ring-1 ring-inset', cell(d), d.date < today && 'opacity-60']" :title="d.off ? 'Day off' : `${d.shiftName} ${d.time}${d.rostered ? ' (rostered)' : ''}`">
                  <span class="block font-medium">{{ d.off ? 'Off' : short(d.shiftName) }}</span>
                  <span v-if="!d.off" class="block text-[10px] opacity-75 tabular-nums">{{ d.time }}</span>
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
