<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Save } from '@lucide/vue';
import type { EmploymentType, Gender } from '@contracts';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import { employeesApi, structureApi } from '@/modules/people/api/people.api';
import type { EmployeeInput } from '@/modules/people/types';
import { employmentTypeOptions, genderOptions } from '@/modules/people/utils/labels';
import { AppAlert, AppButton, AppCard, AppDatePicker, AppErrorState, AppInput, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => (route.params.id ? String(route.params.id) : null));
const isEdit = computed(() => !!id.value);

const existing = useAsync(() => employeesApi.get(id.value!), { immediate: isEdit.value });
const departments = useAsync(() => structureApi.departments());
const designations = useAsync(() => structureApi.designations());
const locations = useAsync(() => structureApi.locations());
const managers = useAsync(() => employeesApi.list({ status: 'ACTIVE', pageSize: 100, sort: 'name:asc' }));
const linkable = useAsync(() => (auth.can('employee.create') ? employeesApi.linkableMembers() : Promise.resolve([])));
const shifts = useAsync(() => (auth.hasFeature('attendance') ? attendanceApi.shifts() : Promise.resolve([])));

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const form = reactive({
  employeeCode: '',
  firstName: '',
  lastName: '',
  workEmail: '',
  personalEmail: '',
  phone: '',
  dateOfBirth: undefined as string | undefined,
  gender: null as Gender | null,
  dateOfJoining: new Date().toISOString().slice(0, 10) as string | undefined,
  employmentType: 'FULL_TIME' as EmploymentType,
  probationEndDate: undefined as string | undefined,
  departmentId: null as string | null,
  designationId: null as string | null,
  locationId: null as string | null,
  managerId: null as string | null,
  shiftId: null as string | null,
  membershipId: null as string | null,
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
});

watch(existing.data, (e) => {
  if (!e) return;
  Object.assign(form, {
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    workEmail: e.workEmail ?? '',
    personalEmail: e.personalEmail ?? '',
    phone: e.phone ?? '',
    dateOfBirth: e.dateOfBirth ?? undefined,
    gender: e.gender,
    dateOfJoining: e.dateOfJoining,
    employmentType: e.employmentType,
    probationEndDate: e.probationEndDate ?? undefined,
    membershipId: e.account?.membershipId ?? null,
    shiftId: e.shift?.id ?? null,
    address: e.address ?? '',
    emergencyContactName: e.emergencyContactName ?? '',
    emergencyContactPhone: e.emergencyContactPhone ?? '',
  });
});

// Picking a user account fills in the name and work email when they are still empty.
watch(
  () => form.membershipId,
  (mid) => {
    const m = linkable.data.value?.find((x) => x.membershipId === mid);
    if (!m) return;
    if (!form.firstName) form.firstName = m.firstName;
    if (!form.lastName) form.lastName = m.lastName;
    if (!form.workEmail) form.workEmail = m.email;
  },
);

const active = <T extends { isActive: boolean; id: string; name: string }>(rows: T[] | null) => (rows ?? []).filter((r) => r.isActive).map((r) => ({ value: r.id, label: r.name }));
const departmentOptions = computed(() => active(departments.data.value));
const designationOptions = computed(() => active(designations.data.value));
const locationOptions = computed(() => active(locations.data.value));
const shiftOptions = computed(() => (shifts.data.value ?? []).filter((s) => s.isActive || s.id === form.shiftId).map((s) => ({ value: s.id, label: s.name, description: `${s.startTime}–${s.endTime}` })));
const defaultShift = computed(() => shifts.data.value?.find((s) => s.isDefault));
const managerOptions = computed(() => (managers.data.value?.items ?? []).filter((m) => m.id !== id.value).map((m) => ({ value: m.id, label: `${m.fullName} (${m.employeeCode})`, description: m.designation?.name })));
const accountOptions = computed(() => {
  const rows = (linkable.data.value ?? []).map((m) => ({ value: m.membershipId, label: `${m.firstName} ${m.lastName}`, description: m.email }));
  const linked = existing.data.value?.account;
  if (linked && !rows.some((r) => r.value === linked.membershipId)) rows.unshift({ value: linked.membershipId, label: existing.data.value!.fullName, description: linked.email ?? '' });
  return rows;
});

function body(): EmployeeInput {
  const b: EmployeeInput = {
    employeeCode: form.employeeCode || null,
    firstName: form.firstName,
    lastName: form.lastName,
    workEmail: form.workEmail || null,
    personalEmail: form.personalEmail || null,
    phone: form.phone || null,
    dateOfBirth: form.dateOfBirth ?? null,
    gender: form.gender,
    dateOfJoining: form.dateOfJoining ?? '',
    employmentType: form.employmentType,
    probationEndDate: form.probationEndDate ?? null,
    membershipId: form.membershipId,
    ...(auth.hasFeature('attendance') ? { shiftId: form.shiftId } : {}),
    address: form.address || null,
    emergencyContactName: form.emergencyContactName || null,
    emergencyContactPhone: form.emergencyContactPhone || null,
  };
  if (!isEdit.value) Object.assign(b, { departmentId: form.departmentId, designationId: form.designationId, locationId: form.locationId, managerId: form.managerId });
  return b;
}

async function save() {
  reset();
  saving.value = true;
  try {
    const saved = isEdit.value ? await employeesApi.update(id.value!, body()) : await employeesApi.create(body());
    feedback.success(isEdit.value ? 'Employee updated' : 'Employee added', isEdit.value ? undefined : `${saved.fullName} · ${saved.employeeCode}`);
    await router.push(`/hr/employees/${saved.id}`);
  } catch (e) {
    handle(e, 'Could not save employee');
  } finally {
    saving.value = false;
  }
}

const today = new Date().toISOString().slice(0, 10);
</script>

<template>
  <div>
    <AppPageHeader
      :title="isEdit ? `Edit ${existing.data.value?.fullName ?? 'employee'}` : 'Add employee'"
      :description="isEdit ? 'Department, designation, location, manager and status changes are recorded from the employee page as lifecycle actions.' : 'Create the employee record. Link a user account so they can sign in and use self-service.'"
      :back="isEdit ? `/hr/employees/${id}` : '/hr/employees'"
      :back-label="isEdit ? 'Back to employee' : 'All employees'"
    />
    <AppSkeleton v-if="isEdit && existing.loading.value && !existing.data.value" :lines="10" />
    <AppErrorState v-else-if="existing.error.value" :error="existing.error.value" title="Could not load employee" @retry="existing.run" />
    <form v-else class="space-y-6" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>

      <AppCard title="Personal details">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AppInput v-model="form.firstName" label="First name" required autocomplete="off" :error="fieldErrors.firstName" />
          <AppInput v-model="form.lastName" label="Last name" required autocomplete="off" :error="fieldErrors.lastName" />
          <AppDatePicker v-model="form.dateOfBirth" label="Date of birth" :max="today" :error="fieldErrors.dateOfBirth" />
          <AppSelect v-model="form.gender" label="Gender" placeholder="Not specified" :options="genderOptions" :error="fieldErrors.gender" />
        </div>
      </AppCard>

      <AppCard title="Employment">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AppInput v-model="form.employeeCode" label="Employee code" :placeholder="isEdit ? undefined : 'Generated, e.g. EMP-0001'" :error="fieldErrors.employeeCode" />
          <AppDatePicker v-model="form.dateOfJoining" label="Date of joining" required :error="fieldErrors.dateOfJoining" />
          <AppSelect v-model="form.employmentType" label="Employment type" :options="employmentTypeOptions" :clearable="false" :error="fieldErrors.employmentType" />
          <AppDatePicker v-model="form.probationEndDate" label="Probation ends" :min="form.dateOfJoining" :error="fieldErrors.probationEndDate" />
          <AppSelect
            v-if="auth.hasFeature('attendance')"
            v-model="form.shiftId"
            label="Shift"
            :placeholder="defaultShift ? `Default (${defaultShift.name})` : 'Default shift'"
            :options="shiftOptions"
            :error="fieldErrors.shiftId"
          />
        </div>
        <div v-if="!isEdit" class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AppSelect v-model="form.departmentId" label="Department" placeholder="None" :options="departmentOptions" :error="fieldErrors.departmentId" />
          <AppSelect v-model="form.designationId" label="Designation" placeholder="None" :options="designationOptions" :error="fieldErrors.designationId" />
          <AppSelect v-model="form.locationId" label="Location" placeholder="None" :options="locationOptions" :error="fieldErrors.locationId" />
          <AppSelect v-model="form.managerId" label="Reports to" placeholder="No manager" :options="managerOptions" searchable :error="fieldErrors.managerId" />
        </div>
        <p v-if="!isEdit && !departmentOptions.length && auth.can('organization.structure.manage')" class="mt-3 text-xs text-fg-muted">
          No departments yet. <RouterLink to="/admin/structure" class="font-medium text-brand-600 hover:underline dark:text-brand-400">Set up the organization structure</RouterLink>.
        </p>
      </AppCard>

      <AppCard title="Contact">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AppInput v-model="form.workEmail" label="Work email" type="email" :error="fieldErrors.workEmail" />
          <AppInput v-model="form.personalEmail" label="Personal email" type="email" :error="fieldErrors.personalEmail" />
          <AppInput v-model="form.phone" label="Phone" type="tel" placeholder="+91 98765 43210" :error="fieldErrors.phone" />
          <AppTextarea v-model="form.address" class="sm:col-span-2 xl:col-span-3" label="Address" :rows="2" :maxlength="500" :error="fieldErrors.address" />
          <AppInput v-model="form.emergencyContactName" label="Emergency contact" :error="fieldErrors.emergencyContactName" />
          <AppInput v-model="form.emergencyContactPhone" label="Emergency contact phone" type="tel" :error="fieldErrors.emergencyContactPhone" />
        </div>
      </AppCard>

      <AppCard title="User account" description="Link the person's sign-in account so attendance, leave and self-service work for them.">
        <AppSelect
          v-model="form.membershipId"
          class="max-w-md"
          label="Linked user"
          placeholder="Not linked"
          :options="accountOptions"
          searchable
          :error="fieldErrors.membershipId"
          :help="accountOptions.length ? undefined : 'Everyone with an account already has an employee record. Invite the person from Users first.'"
        />
      </AppCard>

      <div class="flex justify-end gap-3">
        <AppButton variant="secondary" :to="isEdit ? `/hr/employees/${id}` : '/hr/employees'">Cancel</AppButton>
        <AppButton type="submit" :icon="Save" :loading="saving" :disabled="!form.firstName.trim() || !form.lastName.trim() || !form.dateOfJoining">
          {{ isEdit ? 'Save changes' : 'Add employee' }}
        </AppButton>
      </div>
    </form>
  </div>
</template>
