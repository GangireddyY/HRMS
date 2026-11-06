<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import SalaryBreakdownTable from '@/modules/payroll/components/SalaryBreakdownTable.vue';
import type { EmployeeSalary, SalaryBreakdown } from '@/modules/payroll/types';
import { AppAlert, AppButton, AppCheckbox, AppDatePicker, AppInput, AppModal, AppSelect, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { errorMessage } from '@/core/http/http-client';

/** Set or revise an employee's salary from a date, with a live breakdown of the CTC on the chosen structure. */
const props = defineProps<{
  open: boolean;
  employee: { id: string; name: string; dateOfJoining: string } | null;
  current: EmployeeSalary | null;
  lockedThrough: string | null;
}>();
const emit = defineEmits<{ close: []; saved: [s: EmployeeSalary] }>();

const structures = useAsync(() => payrollApi.structures(), { immediate: false });
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ structureId: null as string | null, annualCtc: '' as number | string, effectiveFrom: undefined as string | undefined, pfApplicable: true, reason: '' });
const saving = ref(false);

const minDate = computed(() => {
  if (!props.employee) return undefined;
  const afterLock = props.lockedThrough ? new Date(new Date(`${props.lockedThrough}T00:00:00`).getTime() + 86_400_000).toISOString().slice(0, 10) : null;
  return afterLock && afterLock > props.employee.dateOfJoining ? afterLock : props.employee.dateOfJoining;
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    preview.value = null;
    previewError.value = null;
    if (!structures.data.value) void structures.run();
    Object.assign(form, {
      structureId: props.current?.structure.id ?? null,
      annualCtc: props.current?.annualCtc ?? '',
      effectiveFrom: undefined,
      pfApplicable: props.current?.pfApplicable ?? true,
      reason: props.current ? '' : 'Joining salary',
    });
  },
  { immediate: true },
);
watch(
  () => structures.data.value,
  (rows) => {
    const active = (rows ?? []).filter((s) => s.isActive);
    if (!form.structureId && active.length === 1) form.structureId = active[0]!.id;
  },
);
const structureOptions = computed(() => (structures.data.value ?? []).filter((s) => s.isActive || s.id === form.structureId).map((s) => ({ value: s.id, label: s.name, description: s.description ?? undefined })));

const preview = ref<SalaryBreakdown | null>(null);
const previewError = ref<string | null>(null);
const previewing = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => [form.structureId, form.annualCtc, form.pfApplicable],
  () => {
    clearTimeout(timer);
    const ctc = Number(form.annualCtc);
    if (!form.structureId || !(ctc > 0)) {
      preview.value = null;
      previewError.value = null;
      return;
    }
    timer = setTimeout(async () => {
      previewing.value = true;
      try {
        preview.value = await payrollApi.preview({ structureId: form.structureId!, annualCtc: ctc, pfApplicable: form.pfApplicable });
        previewError.value = null;
      } catch (e) {
        preview.value = null;
        previewError.value = errorMessage(e);
      } finally {
        previewing.value = false;
      }
    }, 350);
  },
);

const canSave = computed(() => !!form.structureId && Number(form.annualCtc) > 0 && !!form.effectiveFrom && !!preview.value);
async function save() {
  reset();
  saving.value = true;
  try {
    const s = await payrollApi.setSalary(props.employee!.id, {
      structureId: form.structureId!,
      annualCtc: Number(form.annualCtc),
      effectiveFrom: form.effectiveFrom!,
      pfApplicable: form.pfApplicable,
      reason: form.reason || null,
    });
    emit('saved', s);
  } catch (e) {
    handle(e, 'Could not save the salary');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="current ? `Revise salary · ${employee?.name}` : `Set salary · ${employee?.name}`" description="Earlier salaries stay in the history; payroll uses each one from its effective date." size="lg" @close="emit('close')">
    <form id="salary-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppAlert v-if="structures.data.value && !structures.data.value.some((s) => s.isActive)" tone="warning" title="No salary structure yet">
        Create one under Payroll setup first (a standard structure is available there).
      </AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect v-model="form.structureId" label="Salary structure" required :options="structureOptions" placeholder="Choose" :clearable="false" :error="fieldErrors.structureId" />
        <AppInput v-model="form.annualCtc" label="Annual CTC (₹)" type="number" :min="1" required :error="fieldErrors.annualCtc" />
        <AppDatePicker v-model="form.effectiveFrom" label="Effective from" required :min="minDate" :error="fieldErrors.effectiveFrom" />
        <AppInput v-model="form.reason" label="Reason" placeholder="e.g. Annual revision, promotion" :maxlength="300" />
      </div>
      <AppCheckbox v-model="form.pfApplicable" label="Member of provident fund (PF)" description="Untick only for employees excluded from PF (e.g. joined with Basic above ₹15,000 and never a PF member)." />
      <p v-if="lockedThrough" class="text-xs text-fg-muted">Payroll is processed up to {{ lockedThrough }}; pay any arrears before that as an adjustment in the next run.</p>
      <div class="rounded-xl bg-surface-muted/40 p-4 ring-1 ring-line">
        <p class="mb-2 text-sm font-medium text-fg">Breakdown</p>
        <AppSkeleton v-if="previewing && !preview" :lines="4" />
        <p v-else-if="previewError" class="text-sm text-red-600 dark:text-red-400" role="alert">{{ previewError }}</p>
        <SalaryBreakdownTable v-else-if="preview" v-bind="preview" />
        <p v-else class="text-sm text-fg-muted">Choose a structure and enter the CTC to see the monthly split.</p>
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="salary-form" :loading="saving" :disabled="!canSave">Save salary</AppButton>
    </template>
  </AppModal>
</template>
