<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Pencil, Plus, Star, Trash2 } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { Shift } from '@/modules/attendance/types';
import { WEEKDAY_SHORT, formatMinutes } from '@/modules/attendance/utils/attendance-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppDataTable, AppInput, AppModal, AppPageHeader, AppSwitch, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('attendance.configure'));
const shifts = useAsync(() => attendanceApi.shifts());

const columns = computed<TableColumn<Shift>[]>(() => [
  { key: 'name', label: 'Shift' },
  { key: 'hours', label: 'Hours' },
  { key: 'rules', label: 'Rules' },
  { key: 'offs', label: 'Weekly off' },
  { key: 'employeeCount', label: 'Employees', align: 'right' },
  ...(canManage.value ? [{ key: 'actions', label: '', align: 'right' as const }] : []),
]);

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
</script>

<template>
  <div>
    <AppPageHeader title="Shifts" description="Working hours, late rules and weekly offs. Employees without an assigned shift follow the default.">
      <template v-if="canManage" #actions><AppButton :icon="Plus" @click="edit(null)">New shift</AppButton></template>
    </AppPageHeader>
    <AppAlert v-if="shifts.data.value && !shifts.data.value.length" tone="info" class="mb-4">
      No shifts yet, so everyone follows the built-in schedule (09:00–18:00, Saturday and Sunday off). Create a shift to set your own hours.
    </AppAlert>
    <AppCard :padded="false">
      <AppDataTable :columns="columns" :rows="shifts.data.value ?? []" :loading="shifts.loading.value" :error="shifts.error.value" caption="Shifts" empty-title="No shifts" @retry="shifts.run">
        <template #cell-name="{ row }">
          <p class="flex items-center gap-2 font-medium text-fg">{{ row.name }} <AppBadge v-if="row.isDefault" tone="brand"><Star :size="11" /> Default</AppBadge><AppBadge v-if="!row.isActive">Inactive</AppBadge></p>
        </template>
        <template #cell-hours="{ row }"><span class="tabular-nums">{{ row.startTime }}–{{ row.endTime }}</span><span v-if="row.endTime <= row.startTime" class="ms-1 text-xs text-fg-muted">(next day)</span></template>
        <template #cell-rules="{ row }"><span class="text-xs text-fg-muted">Late after {{ row.graceMinutes }}m · half day {{ formatMinutes(row.halfDayMinutes) }} · full day {{ formatMinutes(row.fullDayMinutes) }}</span></template>
        <template #cell-offs="{ row }"><span class="text-fg-muted">{{ row.weeklyOffs.map((d: number) => WEEKDAY_SHORT[d]).join(', ') || 'None' }}</span></template>
        <template #cell-employeeCount="{ row }"><span class="tabular-nums">{{ row.employeeCount }}</span></template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1">
            <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.name}`" @click="edit(row)" />
            <AppButton v-if="!row.isDefault" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.name}`" @click="remove(row)" />
          </div>
        </template>
      </AppDataTable>
    </AppCard>

    <AppModal :open="open" :title="editing ? `Edit ${editing.name}` : 'New shift'" @close="open = false">
      <form id="shift-form" class="space-y-4" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppInput v-model="form.name" label="Name" required placeholder="e.g. General, Night" :error="fieldErrors.name" />
        <div class="grid grid-cols-2 gap-3">
          <AppInput v-model="form.startTime" type="time" label="Starts" required :error="fieldErrors.startTime" />
          <AppInput v-model="form.endTime" type="time" label="Ends" required :help="crossesMidnight ? 'Ends the next day' : undefined" :error="fieldErrors.endTime" />
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
