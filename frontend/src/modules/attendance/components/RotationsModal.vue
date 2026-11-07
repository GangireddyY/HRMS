<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Pencil, Plus, Trash2, X } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { Rotation, Shift } from '@/modules/attendance/types';
import { AppAlert, AppBadge, AppButton, AppEmptyState, AppInput, AppModal, AppSelect, AppSwitch } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Rotation patterns: a repeating cycle of shifts and days off. */
const props = defineProps<{ open: boolean; rotations: Rotation[]; shifts: Shift[] }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const feedback = useFeedbackStore();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const editing = ref<Rotation | 'new' | null>(null);
const form = reactive({ name: '', isActive: true, pattern: [] as { shiftId: string | null; days: number | string }[] });
watch(
  () => props.open,
  (o) => {
    if (o) editing.value = null;
  },
);
const shiftOptions = computed(() => [{ value: '__off', label: 'Day off' }, ...props.shifts.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.name} (${s.startTime}–${s.endTime})` }))]);
const cycle = computed(() => form.pattern.reduce((n, s) => n + (Number(s.days) || 0), 0));
function edit(r: Rotation | null) {
  reset();
  editing.value = r ?? 'new';
  Object.assign(form, r ? { name: r.name, isActive: r.isActive, pattern: r.pattern.map((s) => ({ shiftId: s.shiftId, days: s.days })) } : { name: '', isActive: true, pattern: [{ shiftId: props.shifts.find((s) => s.isActive)?.id ?? null, days: 5 }, { shiftId: null, days: 2 }] });
}
const busy = ref(false);
async function save() {
  reset();
  busy.value = true;
  const body = { name: form.name, isActive: form.isActive, pattern: form.pattern.map((s) => ({ shiftId: s.shiftId, days: Number(s.days) })) };
  try {
    if (editing.value === 'new') await attendanceApi.createRotation(body);
    else await attendanceApi.updateRotation((editing.value as Rotation).id, body);
    feedback.success('Rotation saved');
    editing.value = null;
    emit('changed');
  } catch (e) {
    handle(e, 'Could not save the rotation');
  } finally {
    busy.value = false;
  }
}
async function remove(r: Rotation) {
  if (!(await feedback.confirm({ title: `Delete "${r.name}"?`, message: 'Rotations used in the roster can only be deactivated.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await attendanceApi.removeRotation(r.id);
    feedback.success('Rotation deleted');
    emit('changed');
  } catch (e) {
    feedback.error('Could not delete the rotation', e);
  }
}
const stepValue = (s: { shiftId: string | null }) => s.shiftId ?? '__off';
const setStep = (s: { shiftId: string | null }, v: string | null) => (s.shiftId = !v || v === '__off' ? null : v);
</script>

<template>
  <AppModal :open="open" title="Rotations" description="Repeating cycles, e.g. five mornings, two days off, five nights, two days off." size="lg" @close="emit('close')">
    <template v-if="!editing">
      <AppEmptyState v-if="!rotations.length" compact title="No rotations yet" description="Create one to roster teams that change shifts." />
      <ul v-else class="divide-y divide-line">
        <li v-for="r in rotations" :key="r.id" class="flex flex-wrap items-center justify-between gap-3 py-3">
          <div class="min-w-0">
            <p class="font-medium text-fg">{{ r.name }} <AppBadge v-if="!r.isActive" size="sm">Inactive</AppBadge></p>
            <p class="mt-1 flex flex-wrap gap-1 text-xs">
              <span v-for="(s, i) in r.pattern" :key="i" :class="['rounded-md px-1.5 py-0.5 ring-1 ring-inset', s.shiftId ? 'bg-brand-500/10 text-brand-700 ring-brand-500/25 dark:text-brand-300' : 'bg-surface-muted text-fg-muted ring-line']">{{ s.days }} × {{ s.shiftName ?? 'off' }}</span>
              <span class="text-fg-subtle">· {{ r.cycleDays }}-day cycle</span>
            </p>
          </div>
          <div class="flex gap-1">
            <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${r.name}`" @click="edit(r)" />
            <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${r.name}`" @click="remove(r)" />
          </div>
        </li>
      </ul>
    </template>
    <form v-else id="rotation-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppInput v-model="form.name" label="Name" required :maxlength="80" placeholder="e.g. Two-shift rotation" :error="fieldErrors.name" />
      <div>
        <p class="label">Cycle</p>
        <ol class="space-y-2">
          <li v-for="(s, i) in form.pattern" :key="i" class="flex items-end gap-2">
            <AppSelect class="flex-1" :model-value="stepValue(s)" :aria-label="`Step ${i + 1} shift`" :options="shiftOptions" :clearable="false" @update:model-value="(v: string | null | undefined) => setStep(s, v ?? null)" />
            <AppInput v-model="s.days" class="w-32" type="number" :min="1" :max="28" suffix="days" :aria-label="`Step ${i + 1} days`" />
            <AppButton variant="ghost" :icon="X" :aria-label="`Remove step ${i + 1}`" :disabled="form.pattern.length === 1" @click="form.pattern.splice(i, 1)" />
          </li>
        </ol>
        <div class="mt-2 flex items-center justify-between gap-3">
          <AppButton size="sm" variant="secondary" :icon="Plus" :disabled="form.pattern.length >= 20" @click="form.pattern.push({ shiftId: null, days: 1 })">Add step</AppButton>
          <span class="text-xs text-fg-muted">{{ cycle }}-day cycle</span>
        </div>
        <p v-if="fieldErrors.pattern" class="error-text" role="alert">{{ fieldErrors.pattern }}</p>
      </div>
      <AppSwitch v-model="form.isActive" label="Active" />
    </form>
    <template #footer>
      <template v-if="editing">
        <AppButton variant="secondary" @click="editing = null">Back</AppButton>
        <AppButton type="submit" form="rotation-form" :loading="busy" :disabled="form.name.trim().length < 2 || !cycle">Save rotation</AppButton>
      </template>
      <template v-else>
        <AppButton variant="secondary" @click="emit('close')">Close</AppButton>
        <AppButton :icon="Plus" @click="edit(null)">New rotation</AppButton>
      </template>
    </template>
  </AppModal>
</template>
