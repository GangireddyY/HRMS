<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ARREARS_MAX_MONTHS } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import { formatDate } from '@/shared/utils/format';
import SalaryBreakdownTable from '@/modules/payroll/components/SalaryBreakdownTable.vue';
import type { EmployeeSalary, SalaryBreakdown, SalarySaveResult } from '@/modules/payroll/types';
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
const emit = defineEmits<{ close: []; saved: [s: SalarySaveResult] }>();

const structures = useAsync(() => payrollApi.structures(), { immediate: false });
/** Only for the approval hint; people who can revise but not view payroll settings just don't see it. */
const settings = useAsync(() => payrollApi.settings().catch(() => null), { immediate: false });
const threshold = computed(() => settings.data.value?.salaryApprovalThresholdPct ?? null);
const raisePct = computed(() => {
  const from = props.current?.annualCtc ?? 0;
  const to = Number(form.annualCtc);
  return from > 0 && to > 0 ? ((to - from) / from) * 100 : null;
});
const needsApproval = computed(() => threshold.value !== null && raisePct.value !== null && raisePct.value > threshold.value);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ structureId: null as string | null, annualCtc: '' as number | string, effectiveFrom: undefined as string | undefined, pfApplicable: true, reason: '' });
const saving = ref(false);

/** A first salary starts after the last processed month; a revision can go back ARREARS_MAX_MONTHS (paid as arrears). */
const minDate = computed(() => {
  if (!props.employee) return undefined;
  const lock = props.lockedThrough;
  let floor: string | null = null;
  if (lock && !props.current) floor = new Date(new Date(`${lock}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  else if (lock) {
    const [y, m] = lock.split('-').map(Number) as [number, number];
    const back = y * 12 + (m - 1) - (ARREARS_MAX_MONTHS - 1);
    floor = `${Math.floor(back / 12)}-${String((back % 12) + 1).padStart(2, '0')}-01`;
  }
  return floor && floor > props.employee.dateOfJoining ? floor : props.employee.dateOfJoining;
});
const backDated = computed(() => !!props.lockedThrough && !!form.effectiveFrom && form.effectiveFrom <= props.lockedThrough);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    preview.value = null;
    previewError.value = null;
    if (!structures.data.value) void structures.run();
    if (props.current && !settings.data.value) void settings.run();
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
      <AppAlert v-if="needsApproval" tone="info" title="Needs approval">
        A {{ raisePct!.toFixed(1) }}% raise is above your organization's {{ threshold }}% threshold, so it's sent to someone with approval rights and takes effect once they approve it.
      </AppAlert>
      <AppAlert v-if="backDated" tone="info" title="Back-dated: arrears are paid automatically">
        Payroll is processed up to {{ formatDate(lockedThrough) }}. The difference for the months already paid is worked out and paid as "Salary arrears" in the next payroll run.
      </AppAlert>
      <p v-else-if="lockedThrough" class="text-xs text-fg-muted">Payroll is processed up to {{ formatDate(lockedThrough) }}.{{ current ? ` A revision can be back-dated up to ${ARREARS_MAX_MONTHS} months; arrears are paid in the next run.` : '' }}</p>
      <div class="rounded-xl bg-surface-muted/40 p-4 ring-1 ring-line">
        <p class="mb-2 text-sm font-medium text-fg">Breakdown</p>
        <AppSkeleton v-if="previewing && !preview" :lines="4" />
        <p v-else-if="previewError" class="text-sm text-danger-fg" role="alert">{{ previewError }}</p>
        <SalaryBreakdownTable v-else-if="preview" v-bind="preview" />
        <p v-else class="text-sm text-fg-muted">Choose a structure and enter the CTC to see the monthly split.</p>
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="salary-form" :loading="saving" :disabled="!canSave">{{ needsApproval ? 'Send for approval' : 'Save salary' }}</AppButton>
    </template>
  </AppModal>
</template>
