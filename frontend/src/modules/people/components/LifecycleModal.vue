<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { EmployeeStatus, LifecycleAction } from '@contracts';
import { employeesApi, structureApi } from '@/modules/people/api/people.api';
import type { EmployeeDetail, LifecycleInput } from '@/modules/people/types';
import { LIFECYCLE_LABELS, employeeStatusOptions } from '@/modules/people/utils/labels';
import { AppAlert, AppButton, AppDatePicker, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

const props = defineProps<{ open: boolean; employee: EmployeeDetail; action: LifecycleAction }>();
const emit = defineEmits<{ close: []; saved: [employee: EmployeeDetail] }>();

const departments = useAsync(() => structureApi.departments());
const designations = useAsync(() => structureApi.designations());
const locations = useAsync(() => structureApi.locations());
const grades = useAsync(() => structureApi.grades());
const costCenters = useAsync(() => structureApi.costCenters());
const managers = useAsync(() => employeesApi.list({ status: 'ACTIVE', pageSize: 100, sort: 'name:asc' }));

const today = new Date().toISOString().slice(0, 10);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const form = reactive({
  effectiveDate: today as string | undefined,
  departmentId: null as string | null,
  locationId: null as string | null,
  designationId: null as string | null,
  managerId: null as string | null,
  gradeId: null as string | null,
  costCenterId: null as string | null,
  status: null as EmployeeStatus | null,
  note: '',
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, {
      effectiveDate: today,
      departmentId: props.employee.department?.id ?? null,
      locationId: props.employee.location?.id ?? null,
      designationId: props.employee.designation?.id ?? null,
      managerId: props.employee.manager?.id ?? null,
      gradeId: props.employee.grade?.id ?? null,
      costCenterId: props.employee.costCenter?.id ?? null,
      status: null,
      note: '',
    });
  },
);

const options = <T extends { id: string; name: string; isActive: boolean }>(rows: T[] | null) => (rows ?? []).filter((r) => r.isActive).map((r) => ({ value: r.id, label: r.name }));
const managerOptions = computed(() => (managers.data.value?.items ?? []).filter((m) => m.id !== props.employee.id).map((m) => ({ value: m.id, label: `${m.fullName} (${m.employeeCode})`, description: m.designation?.name })));
const statusOptions = computed(() => employeeStatusOptions.filter((o) => o.value !== props.employee.status));
const costCenterOptions = computed(() => (costCenters.data.value ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} – ${c.name}` })));

const descriptions: Record<LifecycleAction, string> = {
  TRANSFER: 'Move the employee to another department, location or cost center.',
  PROMOTION: 'Change the employee’s designation and/or grade.',
  MANAGER_CHANGE: 'Change who the employee reports to. Approvals for their requests move to the new manager.',
  STATUS_CHANGE: 'Mark the employee as on notice, exited or active again.',
  CONFIRMATION: 'Confirm the employee after probation.',
};

async function save() {
  reset();
  saving.value = true;
  const body: LifecycleInput = { type: props.action, effectiveDate: form.effectiveDate ?? '', note: form.note || null };
  if (props.action === 'TRANSFER') Object.assign(body, { departmentId: form.departmentId, locationId: form.locationId, costCenterId: form.costCenterId });
  if (props.action === 'PROMOTION') {
    if (form.designationId) body.designationId = form.designationId;
    if (form.gradeId) body.gradeId = form.gradeId;
  }
  if (props.action === 'MANAGER_CHANGE') body.managerId = form.managerId;
  if (props.action === 'STATUS_CHANGE' && form.status) body.status = form.status;
  try {
    emit('saved', await employeesApi.lifecycle(props.employee.id, body));
  } catch (e) {
    handle(e, 'Could not record the change');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="`${LIFECYCLE_LABELS[action]} · ${employee.fullName}`" :description="descriptions[action]" @close="emit('close')">
    <form id="lifecycle-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <template v-if="action === 'TRANSFER'">
        <AppSelect v-model="form.departmentId" label="Department" placeholder="None" :options="options(departments.data.value)" :error="fieldErrors.departmentId" />
        <AppSelect v-model="form.locationId" label="Location" placeholder="None" :options="options(locations.data.value)" :error="fieldErrors.locationId" />
        <AppSelect v-model="form.costCenterId" label="Cost center" placeholder="None" :options="costCenterOptions" searchable :error="fieldErrors.costCenterId" />
      </template>
      <template v-else-if="action === 'PROMOTION'">
        <AppSelect v-model="form.designationId" label="New designation" :options="options(designations.data.value)" :error="fieldErrors.designationId" />
        <AppSelect v-model="form.gradeId" label="New grade" placeholder="Unchanged" :options="options(grades.data.value)" :error="fieldErrors.gradeId" />
      </template>
      <AppSelect v-else-if="action === 'MANAGER_CHANGE'" v-model="form.managerId" label="Reports to" placeholder="No manager" :options="managerOptions" searchable :error="fieldErrors.managerId" />
      <AppSelect v-else-if="action === 'STATUS_CHANGE'" v-model="form.status" label="New status" required :options="statusOptions" :error="fieldErrors.status" />
      <AppDatePicker
        v-model="form.effectiveDate"
        :label="action === 'STATUS_CHANGE' && form.status === 'EXITED' ? 'Last working day' : 'Effective date'"
        required
        :min="employee.dateOfJoining"
        :max="today"
        :error="fieldErrors.effectiveDate"
      />
      <AppTextarea v-model="form.note" label="Note" :rows="2" :maxlength="500" placeholder="Optional reason or reference" :error="fieldErrors.note" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="lifecycle-form" :variant="action === 'STATUS_CHANGE' && form.status === 'EXITED' ? 'danger' : 'primary'" :loading="saving">Record {{ LIFECYCLE_LABELS[action].toLowerCase() }}</AppButton>
    </template>
  </AppModal>
</template>
