<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { Holiday } from '@/modules/attendance/types';
import { WEEKDAY_SHORT } from '@/modules/attendance/utils/attendance-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppDataTable, AppDatePicker, AppInput, AppModal, AppPageHeader, AppSwitch, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('organization.calendar.manage'));
const year = ref(new Date().getFullYear());
const holidays = useAsync(() => attendanceApi.holidays(year.value));
watch(year, () => void holidays.run());

const columns = computed<TableColumn<Holiday>[]>(() => [
  { key: 'date', label: 'Date' },
  { key: 'name', label: 'Holiday' },
  { key: 'type', label: 'Type' },
  ...(canManage.value ? [{ key: 'actions', label: '', align: 'right' as const }] : []),
]);

const open = ref(false);
const editing = ref<Holiday | null>(null);
const saving = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ date: undefined as string | undefined, name: '', isOptional: false });

function edit(h: Holiday | null) {
  reset();
  editing.value = h;
  Object.assign(form, h ? { date: h.date, name: h.name, isOptional: h.isOptional } : { date: undefined, name: '', isOptional: false });
  open.value = true;
}

async function save() {
  reset();
  saving.value = true;
  try {
    const body = { date: form.date ?? '', name: form.name, isOptional: form.isOptional };
    if (editing.value) await attendanceApi.updateHoliday(editing.value.id, body);
    else await attendanceApi.createHoliday(body);
    open.value = false;
    feedback.success(editing.value ? 'Holiday updated' : 'Holiday added');
    await holidays.run();
  } catch (e) {
    handle(e, 'Could not save holiday');
  } finally {
    saving.value = false;
  }
}

async function remove(h: Holiday) {
  if (!(await feedback.confirm({ title: `Delete "${h.name}"?`, message: 'The day becomes a regular working day.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await attendanceApi.removeHoliday(h.id);
    feedback.success('Holiday deleted');
    await holidays.run();
  } catch (e) {
    feedback.error('Could not delete holiday', e);
  }
}

const weekdayOf = (date: string) => WEEKDAY_SHORT[new Date(`${date}T00:00:00Z`).getUTCDay()];
</script>

<template>
  <div>
    <AppPageHeader title="Holidays" description="Public holidays are non-working days in attendance; optional holidays are shown but remain working days.">
      <template #actions>
        <div class="flex items-center gap-1">
          <AppButton size="sm" variant="ghost" :icon="ChevronLeft" aria-label="Previous year" @click="year--" />
          <span class="w-14 text-center text-sm font-semibold tabular-nums">{{ year }}</span>
          <AppButton size="sm" variant="ghost" :icon="ChevronRight" aria-label="Next year" @click="year++" />
        </div>
        <AppButton v-if="canManage" :icon="Plus" @click="edit(null)">Add holiday</AppButton>
      </template>
    </AppPageHeader>
    <AppCard :padded="false">
      <AppDataTable :columns="columns" :rows="holidays.data.value ?? []" :loading="holidays.loading.value" :error="holidays.error.value" caption="Holidays" :empty-title="`No holidays in ${year}`" @retry="holidays.run">
        <template #cell-date="{ row }"><span class="tabular-nums">{{ formatDate(row.date) }}</span> <span class="text-xs text-fg-muted">{{ weekdayOf(row.date) }}</span></template>
        <template #cell-name="{ row }"><span class="font-medium text-fg">{{ row.name }}</span></template>
        <template #cell-type="{ row }"><AppBadge :tone="row.isOptional ? 'neutral' : 'violet'">{{ row.isOptional ? 'Optional' : 'Public holiday' }}</AppBadge></template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1">
            <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.name}`" @click="edit(row)" />
            <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.name}`" @click="remove(row)" />
          </div>
        </template>
      </AppDataTable>
    </AppCard>

    <AppModal :open="open" :title="editing ? 'Edit holiday' : 'Add holiday'" size="sm" @close="open = false">
      <form id="holiday-form" class="space-y-4" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppDatePicker v-model="form.date" label="Date" required :error="fieldErrors.date" />
        <AppInput v-model="form.name" label="Name" required placeholder="e.g. Independence Day" :error="fieldErrors.name" />
        <AppSwitch v-model="form.isOptional" label="Optional holiday" description="Shown on calendars but still a working day." />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton type="submit" form="holiday-form" :loading="saving" :disabled="!form.date || form.name.trim().length < 2">{{ editing ? 'Save changes' : 'Add holiday' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
