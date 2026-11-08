<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { ManualLedgerKind } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { Balance } from '@/modules/leave/types';
import { formatDays } from '@/modules/leave/utils/leave-format';
import { AppAlert, AppButton, AppInput, AppModal, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** HR grants, corrects or encashes leave for one employee (current leave year; audited; the employee is notified). */
const props = defineProps<{ open: boolean; employee: { id: string; name: string } | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const balances = ref<Balance[] | null>(null);
const form = reactive({ leaveTypeId: null as string | null, kind: 'GRANT' as ManualLedgerKind, direction: 'add' as 'add' | 'remove', days: '' as string | number, note: '' });

watch(
  () => [props.open, props.employee?.id],
  async ([open]) => {
    if (!open || !props.employee) return;
    reset();
    Object.assign(form, { leaveTypeId: null, kind: 'GRANT', direction: 'add', days: '', note: '' });
    balances.value = null;
    try {
      balances.value = (await leaveApi.balances(props.employee.id)).balances.filter((b) => !b.leaveType.unlimited);
    } catch (e) {
      handle(e, 'Could not load balances');
    }
  },
  { immediate: true },
);

const selected = computed(() => balances.value?.find((b) => b.leaveType.id === form.leaveTypeId) ?? null);
const typeOptions = computed(() => (balances.value ?? []).map((b) => ({ value: b.leaveType.id, label: `${b.leaveType.name} (${b.leaveType.code})`, description: `${formatDays(b.available)} available` })));
const kindOptions = computed(() => [
  { value: 'GRANT' as const, label: 'Grant days', description: 'e.g. compensatory off, special leave' },
  { value: 'ADJUSTMENT' as const, label: 'Correct the balance', description: 'Add or remove days to fix an error' },
  ...(selected.value?.leaveType.encashable || !selected.value ? [{ value: 'ENCASHMENT' as const, label: 'Encash days', description: 'Paid out in payroll; reduces the balance' }] : []),
]);
const signed = computed(() => {
  const n = Number(form.days) || 0;
  if (form.kind === 'ENCASHMENT') return -n;
  if (form.kind === 'ADJUSTMENT' && form.direction === 'remove') return -n;
  return n;
});
const after = computed(() => (selected.value?.available === null || !selected.value ? null : Math.round((selected.value.available! + signed.value) * 100) / 100));
const canSave = computed(() => !!form.leaveTypeId && Number(form.days) > 0 && form.note.trim().length >= 3);

async function save() {
  reset();
  saving.value = true;
  try {
    await leaveApi.adjust({ employeeId: props.employee!.id, leaveTypeId: form.leaveTypeId!, kind: form.kind, days: signed.value, note: form.note });
    emit('saved');
  } catch (e) {
    handle(e, 'Could not update the balance');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Adjust leave balance" :description="employee?.name" @close="emit('close')">
    <AppSkeleton v-if="!balances && !formError" :lines="4" />
    <form v-else id="adjust-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppSelect v-model="form.leaveTypeId" label="Leave type" required :options="typeOptions" :clearable="false" placeholder="Choose a leave type" :error="fieldErrors.leaveTypeId" />
      <AppSelect v-model="form.kind" label="What to do" :options="kindOptions" :clearable="false" :error="fieldErrors.kind" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect
          v-if="form.kind === 'ADJUSTMENT'"
          v-model="form.direction"
          label="Direction"
          :options="[{ value: 'add', label: 'Add days' }, { value: 'remove', label: 'Remove days' }]"
          :clearable="false"
        />
        <AppInput v-model="form.days" label="Days" type="number" :min="0.5" :max="366" :step="0.5" required :error="fieldErrors.days" />
      </div>
      <p v-if="after !== null && Number(form.days) > 0" class="text-sm text-fg-muted">
        Available: {{ formatDays(selected!.available) }} → <span class="font-medium" :class="after < 0 ? 'text-danger-fg' : 'text-fg'">{{ formatDays(after) }}</span>
      </p>
      <AppTextarea v-model="form.note" label="Reason" required :rows="2" :maxlength="500" placeholder="Shown to the employee and kept in the audit log" :error="fieldErrors.note" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="adjust-form" :loading="saving" :disabled="!canSave">Save</AppButton>
    </template>
  </AppModal>
</template>
