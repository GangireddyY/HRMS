<script setup lang="ts">
import { computed, reactive, ref, type Component } from 'vue';
import { Clock, Moon, Pencil, Plus, Star, Sun, Sunrise, Sunset, Trash2, Users } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { Shift } from '@/modules/attendance/types';
import { WEEKDAY_SHORT, formatMinutes } from '@/modules/attendance/utils/attendance-format';
import { clockMinutes } from '@/modules/attendance/utils/attendance-ops';
import { AppAddTile, AppAlert, AppBadge, AppButton, AppEmptyState, AppErrorState, AppInput, AppModal, AppPageHeader, AppStatStrip, AppSwitch, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Working hours, late rules and weekly offs per shift, each drawn on a 24-hour timeline. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('attendance.configure'));
const shifts = useAsync(() => attendanceApi.shifts());

const open = ref(false);
const editing = ref<Shift | null>(null);
const saving = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ name: '', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480, weeklyOffs: [0, 6] as number[], overtimeEnabled: false, overtimeAfterMinutes: 540 as number | string, overtimeMinMinutes: 30 as number | string, isDefault: false, isActive: true });

function edit(shift: Shift | null) {
  reset();
  editing.value = shift;
  Object.assign(form, shift ? { ...shift, weeklyOffs: [...shift.weeklyOffs] } : { name: '', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480, weeklyOffs: [0, 6], overtimeEnabled: false, overtimeAfterMinutes: 540, overtimeMinMinutes: 30, isDefault: false, isActive: true });
  open.value = true;
}
function toggleOff(day: number) {
  form.weeklyOffs = form.weeklyOffs.includes(day) ? form.weeklyOffs.filter((d) => d !== day) : [...form.weeklyOffs, day].sort();
}

async function save() {
  reset();
  saving.value = true;
  const body = { ...form, breakMinutes: Number(form.breakMinutes), graceMinutes: Number(form.graceMinutes), halfDayMinutes: Number(form.halfDayMinutes), fullDayMinutes: Number(form.fullDayMinutes), overtimeAfterMinutes: Number(form.overtimeAfterMinutes), overtimeMinMinutes: Number(form.overtimeMinMinutes) };
  try {
    if (editing.value) await attendanceApi.updateShift(editing.value.id, body);
    else await attendanceApi.createShift(body);
    open.value = false;
    feedback.success(editing.value ? 'Shift updated' : 'Shift created');
    await shifts.run();
  } catch (e) {
    handle(e, 'Could not save shift');
  } finally {
    saving.value = false;
  }
}

async function remove(shift: Shift) {
  if (!(await feedback.confirm({ title: `Delete "${shift.name}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await attendanceApi.removeShift(shift.id);
    feedback.success('Shift deleted');
    await shifts.run();
  } catch (e) {
    feedback.error('Could not delete shift', e);
  }
}

const crossesMidnight = computed(() => form.endTime <= form.startTime);

// ---- Presentation ------------------------------------------------------------------------------------------------
const list = computed(() => shifts.data.value ?? []);
const headcount = computed(() => list.value.reduce((n, s) => n + s.employeeCount, 0));
const overnight = (s: Pick<Shift, 'startTime' | 'endTime'>) => s.endTime <= s.startTime;
const strip = computed<StripItem[]>(() => [
  { key: 'active', label: 'Active shifts', value: list.value.filter((s) => s.isActive).length, tone: 'brand', hint: `${list.value.length} in total` },
  { key: 'people', label: 'Employees assigned', value: headcount.value, tone: 'success' },
  { key: 'night', label: 'Overnight shifts', value: list.value.filter(overnight).length, tone: 'violet', hint: 'End the next day' },
  { key: 'ot', label: 'Counting overtime', value: list.value.filter((s) => s.overtimeEnabled).length, tone: 'orange' },
]);

const spanOf = (s: Pick<Shift, 'startTime' | 'endTime'>) => {
  const d = clockMinutes(s.endTime) - clockMinutes(s.startTime);
  return d <= 0 ? d + 1440 : d;
};
/** Bar segments as percentages of the day; an overnight shift wraps to the start of the bar. */
function segments(s: Pick<Shift, 'startTime' | 'endTime'>): { left: number; width: number }[] {
  const start = clockMinutes(s.startTime);
  const end = start + spanOf(s);
  const pct = (m: number) => (m / 1440) * 100;
  return end <= 1440 ? [{ left: pct(start), width: pct(end - start) }] : [{ left: pct(start), width: pct(1440 - start) }, { left: 0, width: pct(end - 1440) }];
}
const graceAt = (s: Shift) => (((clockMinutes(s.startTime) + s.graceMinutes) % 1440) / 1440) * 100;
function period(s: Pick<Shift, 'startTime' | 'endTime'>): { icon: Component; tone: string; label: string } {
  const h = clockMinutes(s.startTime) / 60;
  if (overnight(s) || h >= 19) return { icon: Moon, tone: 'bg-special-soft text-special-fg', label: 'Night' };
  if (h < 8) return { icon: Sunrise, tone: 'bg-warning-soft text-warning-fg', label: 'Early' };
  if (h >= 12) return { icon: Sunset, tone: 'bg-caution-soft text-caution-fg', label: 'Afternoon' };
  return { icon: Sun, tone: 'bg-info-soft text-info-fg', label: 'Day' };
}
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const ticks = [0, 6, 12, 18, 24];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Shifts" description="Working hours, late rules and weekly offs. Employees without an assigned shift follow the default.">
      <template v-if="canManage" #actions><AppButton :icon="Plus" @click="edit(null)">New shift</AppButton></template>
    </AppPageHeader>
    <AppAlert v-if="shifts.data.value && !shifts.data.value.length" tone="info">
      No shifts yet, so everyone follows the built-in schedule (09:00–18:00, Saturday and Sunday off). Create a shift to set your own hours.
    </AppAlert>

    <AppErrorState v-if="shifts.error.value" :error="shifts.error.value" @retry="shifts.run" />
    <template v-else>
      <AppStatStrip v-if="list.length || shifts.loading.value" label="Shifts summary" :items="strip" :loading="shifts.loading.value && !shifts.data.value" />

      <ul v-if="shifts.loading.value && !shifts.data.value" class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Loading shifts">
        <li v-for="i in 3" :key="i" class="card space-y-4 p-4">
          <div class="skeleton h-5 w-1/2 rounded-full" />
          <div class="skeleton h-3 w-full rounded-full" />
          <div class="skeleton h-8 w-full rounded-md" />
        </li>
      </ul>
      <div v-else-if="!list.length" class="card">
        <AppEmptyState :icon="Clock" title="No shifts" description="Shifts set working hours, the late threshold and weekly offs for the people on them.">
          <AppButton v-if="canManage" :icon="Plus" @click="edit(null)">New shift</AppButton>
        </AppEmptyState>
      </div>
      <ul v-else class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Shifts">
        <li v-for="s in list" :key="s.id" :class="['card flex flex-col', !s.isActive && 'opacity-75']">
          <div class="flex items-start gap-3 px-4 pt-4">
            <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', period(s).tone]" :title="`${period(s).label} shift`" aria-hidden="true"><component :is="period(s).icon" :size="18" /></span>
            <div class="min-w-0 flex-1">
              <h2 class="flex flex-wrap items-center gap-2 font-semibold text-fg">
                {{ s.name }}
                <AppBadge v-if="s.isDefault" tone="brand" size="sm"><Star :size="10" class="-ms-0.5" aria-hidden="true" />Default</AppBadge>
                <AppBadge v-if="!s.isActive" size="sm">Inactive</AppBadge>
              </h2>
              <p class="mt-0.5 text-xl font-semibold tracking-tight text-fg tabular-nums">
                {{ s.startTime }} – {{ s.endTime }}<span v-if="overnight(s)" class="ms-1.5 align-middle text-xs font-medium text-special-fg">next day</span>
              </p>
              <p class="text-xs text-fg-muted tabular-nums">{{ formatMinutes(spanOf(s)) }} span · {{ s.breakMinutes }} min break · {{ formatMinutes(Math.max(0, spanOf(s) - s.breakMinutes)) }} net</p>
            </div>
            <div v-if="canManage" class="-me-1 flex shrink-0 gap-0.5">
              <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${s.name}`" @click="edit(s)" />
              <AppButton v-if="!s.isDefault" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${s.name}`" @click="remove(s)" />
            </div>
          </div>

          <!-- 24-hour timeline -->
          <div class="px-4 pt-4" role="img" :aria-label="`Works ${s.startTime} to ${s.endTime}${overnight(s) ? ' the next day' : ''}`">
            <div class="relative h-3 rounded-full bg-surface-muted ring-1 ring-line/60 ring-inset">
              <span v-for="(seg, i) in segments(s)" :key="i" class="absolute inset-y-0 rounded-full bg-brand-500/80 dark:bg-brand-400/70" :style="{ left: `${seg.left}%`, width: `${seg.width}%` }" />
              <span class="absolute -inset-y-1 w-0.5 rounded-full bg-caution" :style="{ left: `${graceAt(s)}%` }" :title="`Late after ${s.graceMinutes} min`" />
            </div>
            <div class="relative mt-1 h-3.5 text-2xs text-fg-subtle tabular-nums" aria-hidden="true">
              <span v-for="t in ticks" :key="t" class="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full" :style="{ left: `${(t / 24) * 100}%` }">{{ String(t).padStart(2, '0') }}:00</span>
            </div>
          </div>

          <div class="px-4 pt-3">
            <p class="sr-only">Weekly off: {{ s.weeklyOffs.map((d) => WEEKDAY_SHORT[d]).join(', ') || 'None' }}</p>
            <ul class="grid grid-cols-7 gap-1" aria-hidden="true">
              <li
                v-for="d in WEEK"
                :key="d"
                :class="['rounded-md py-1 text-center text-2xs font-semibold', s.weeklyOffs.includes(d) ? 'bg-surface-muted text-fg-subtle line-through decoration-fg-subtle/50' : 'bg-accent-soft text-accent-fg']"
              >
                {{ WEEKDAY_SHORT[d] }}
              </li>
            </ul>
          </div>

          <dl class="mx-4 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-surface-muted/60 p-3 text-xs">
            <div class="flex justify-between gap-2"><dt class="text-fg-muted">Late after</dt><dd class="font-medium text-fg tabular-nums">{{ s.graceMinutes }} min</dd></div>
            <div class="flex justify-between gap-2"><dt class="text-fg-muted">Half day from</dt><dd class="font-medium text-fg tabular-nums">{{ formatMinutes(s.halfDayMinutes) }}</dd></div>
            <div class="flex justify-between gap-2"><dt class="text-fg-muted">Full day from</dt><dd class="font-medium text-fg tabular-nums">{{ formatMinutes(s.fullDayMinutes) }}</dd></div>
            <div class="flex justify-between gap-2">
              <dt class="text-fg-muted">Overtime</dt>
              <dd :class="['font-medium tabular-nums', s.overtimeEnabled ? 'text-fg' : 'text-fg-subtle']" :title="s.overtimeEnabled ? `Ignored under ${s.overtimeMinMinutes} min` : undefined">{{ s.overtimeEnabled ? `after ${formatMinutes(s.overtimeAfterMinutes)}` : 'Off' }}</dd>
            </div>
          </dl>

          <footer class="mt-auto flex items-center gap-3 px-4 pt-3 pb-4">
            <Users :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />
            <span class="text-sm font-medium text-fg tabular-nums">{{ s.employeeCount }} <span class="font-normal text-fg-muted">{{ s.employeeCount === 1 ? 'employee' : 'employees' }}</span></span>
            <div v-if="headcount" class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${Math.round((s.employeeCount / headcount) * 100)}% of assigned employees`">
              <span class="block h-full rounded-full bg-success" :style="{ width: `${(s.employeeCount / headcount) * 100}%` }" />
            </div>
            <span v-if="headcount" class="text-2xs text-fg-subtle tabular-nums">{{ Math.round((s.employeeCount / headcount) * 100) }}%</span>
          </footer>
        </li>
        <li v-if="canManage"><AppAddTile class="h-full" title="New shift" description="Different hours, a night shift or another weekly off pattern." @click="edit(null)" /></li>
      </ul>
    </template>

    <AppModal :open="open" :title="editing ? `Edit ${editing.name}` : 'New shift'" @close="open = false">
      <form id="shift-form" class="space-y-4" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppInput v-model="form.name" label="Name" required placeholder="e.g. General, Night" :error="fieldErrors.name" />
        <div class="grid grid-cols-2 gap-3">
          <AppInput v-model="form.startTime" type="time" label="Starts" required :error="fieldErrors.startTime" />
          <AppInput v-model="form.endTime" type="time" label="Ends" required :help="crossesMidnight ? 'Ends the next day' : undefined" :error="fieldErrors.endTime" />
        </div>
        <div v-if="form.startTime && form.endTime" class="relative h-2.5 rounded-full bg-surface-muted ring-1 ring-line/60 ring-inset" role="img" :aria-label="`Preview: ${form.startTime} to ${form.endTime}`">
          <span v-for="(seg, i) in segments(form)" :key="i" class="absolute inset-y-0 rounded-full bg-brand-500/80 dark:bg-brand-400/70" :style="{ left: `${seg.left}%`, width: `${seg.width}%` }" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <AppInput v-model="form.graceMinutes" type="number" label="Late after (min)" :min="0" :max="240" :error="fieldErrors.graceMinutes" />
          <AppInput v-model="form.breakMinutes" type="number" label="Break (min)" :min="0" :max="240" :error="fieldErrors.breakMinutes" />
          <AppInput v-model="form.halfDayMinutes" type="number" label="Half day from (min)" :min="0" :max="1440" :error="fieldErrors.halfDayMinutes" />
          <AppInput v-model="form.fullDayMinutes" type="number" label="Full day from (min)" :min="1" :max="1440" :error="fieldErrors.fullDayMinutes" />
        </div>
        <fieldset>
          <legend class="mb-2 text-sm font-medium text-fg">Weekly off</legend>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="(d, i) in WEEKDAY_SHORT"
              :key="d"
              type="button"
              :aria-pressed="form.weeklyOffs.includes(i)"
              :class="['rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition', form.weeklyOffs.includes(i) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-surface text-fg-muted ring-line hover:text-fg']"
              @click="toggleOff(i)"
            >
              {{ d }}
            </button>
          </div>
        </fieldset>
        <AppSwitch v-model="form.overtimeEnabled" label="Count overtime" description="Time worked beyond the threshold (and everything worked on a day off) goes to the manager for approval and is paid with payroll." />
        <div v-if="form.overtimeEnabled" class="grid grid-cols-2 gap-3">
          <AppInput v-model="form.overtimeAfterMinutes" type="number" label="Overtime after (min worked)" :min="1" :max="1440" :error="fieldErrors.overtimeAfterMinutes" />
          <AppInput v-model="form.overtimeMinMinutes" type="number" label="Ignore overtime under (min)" :min="0" :max="480" :error="fieldErrors.overtimeMinMinutes" />
        </div>
        <AppSwitch v-model="form.isDefault" label="Default shift" description="Used for employees without an assigned shift." :disabled="editing?.isDefault" />
        <AppSwitch v-model="form.isActive" label="Active" :disabled="editing?.isDefault" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton type="submit" form="shift-form" :loading="saving" :disabled="form.name.trim().length < 2">{{ editing ? 'Save changes' : 'Create shift' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
