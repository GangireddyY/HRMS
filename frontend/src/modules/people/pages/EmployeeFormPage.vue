<script setup lang="ts">
import { computed, reactive, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Briefcase, Building2, Check, CircleAlert, HeartPulse, Info, KeyRound, MapPinHouse, Phone, Save, UserRound } from '@lucide/vue';
import type { BloodGroup, EmploymentType, Gender, MaritalStatus } from '@contracts';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import { employeesApi, structureApi } from '@/modules/people/api/people.api';
import type { EmployeeInput } from '@/modules/people/types';
import { relativeDays } from '@/modules/people/utils/dates';
import { EMPLOYMENT_TYPE_LABELS, bloodGroupOptions, employmentTypeOptions, genderOptions, maritalStatusOptions } from '@/modules/people/utils/labels';
import { COUNTRY_OPTIONS } from '@/shared/utils/options';
import { AppAlert, AppAvatar, AppButton, AppCard, AppCheckbox, AppDatePicker, AppErrorState, AppInput, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Add or edit an employee record: grouped sections, a live preview with what's still missing, and a sticky save bar. */
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
const grades = useAsync(() => structureApi.grades());
const costCenters = useAsync(() => structureApi.costCenters());
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
  permanentAddress: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  gradeId: null as string | null,
  costCenterId: null as string | null,
  maritalStatus: null as MaritalStatus | null,
  bloodGroup: null as BloodGroup | null,
  nationality: null as string | null,
  noticePeriodDays: '' as string | number,
});
/** An empty permanent address means "the same as the current one". */
const sameAddress = ref(true);
watch(sameAddress, (same) => same && (form.permanentAddress = ''));

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
    permanentAddress: e.permanentAddress ?? '',
    emergencyContactName: e.emergencyContactName ?? '',
    emergencyContactPhone: e.emergencyContactPhone ?? '',
    maritalStatus: e.maritalStatus,
    bloodGroup: e.bloodGroup,
    nationality: e.nationality,
    noticePeriodDays: e.noticePeriodDays ?? '',
  });
  sameAddress.value = !e.permanentAddress;
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
const gradeOptions = computed(() => active(grades.data.value));
const costCenterOptions = computed(() => (costCenters.data.value ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.code} – ${c.name}` })));
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
    permanentAddress: form.permanentAddress || null,
    emergencyContactName: form.emergencyContactName || null,
    emergencyContactPhone: form.emergencyContactPhone || null,
    maritalStatus: form.maritalStatus,
    bloodGroup: form.bloodGroup,
    nationality: form.nationality,
    // The number field reports a cleared value as null.
    noticePeriodDays: form.noticePeriodDays === '' || form.noticePeriodDays === null ? null : Number(form.noticePeriodDays),
  };
  if (!isEdit.value) {
    Object.assign(b, { departmentId: form.departmentId, designationId: form.designationId, locationId: form.locationId, managerId: form.managerId, gradeId: form.gradeId, costCenterId: form.costCenterId });
  }
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
const canSave = computed(() => !!form.firstName.trim() && !!form.lastName.trim() && !!form.dateOfJoining);

// ---- Helpers shown beside the fields -------------------------------------------------------------------------
/** Probation end `months` after joining, the day before the same date (3 months from 1 Jan ends 31 Mar). */
function probationAfter(months: number) {
  if (!form.dateOfJoining) return;
  const [y, m, d] = form.dateOfJoining.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1 + months, d - 1));
  form.probationEndDate = end.toISOString().slice(0, 10);
}
const age = computed(() => {
  if (!form.dateOfBirth) return null;
  const [y, m, d] = form.dateOfBirth.split('-').map(Number);
  const now = new Date();
  return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
});
const joiningHint = computed(() => (form.dateOfJoining && form.dateOfJoining !== today ? `${form.dateOfJoining > today ? 'Starts' : 'Joined'} ${relativeDays(form.dateOfJoining)}` : undefined));
const labelOf = (opts: { value: string; label: string }[], v: string | null) => (v ? opts.find((o) => o.value === v)?.label : undefined);

// ---- Sections, preview and what's missing --------------------------------------------------------------------
interface Section {
  key: string;
  title: string;
  icon: Component;
  filled: number;
  total: number;
}
const filled = (...values: unknown[]) => values.filter((v) => v !== null && v !== undefined && v !== '').length;
const sections = computed<Section[]>(() => [
  { key: 'personal', title: 'Personal details', icon: UserRound, filled: filled(form.firstName.trim(), form.lastName.trim(), form.dateOfBirth, form.gender, form.maritalStatus, form.bloodGroup, form.nationality), total: 7 },
  { key: 'job', title: 'Job & terms', icon: Briefcase, filled: filled(form.dateOfJoining, form.employmentType, form.probationEndDate, form.noticePeriodDays), total: 4 },
  ...(isEdit.value
    ? []
    : [{ key: 'placement', title: 'Placement', icon: Building2, filled: filled(form.departmentId, form.designationId, form.locationId, form.managerId, form.gradeId, form.costCenterId), total: 6 }]),
  { key: 'contact', title: 'Contact & emergency', icon: Phone, filled: filled(form.workEmail, form.personalEmail, form.phone, form.emergencyContactName, form.emergencyContactPhone), total: 5 },
  { key: 'address', title: 'Address', icon: MapPinHouse, filled: filled(form.address), total: 1 },
  { key: 'account', title: 'Sign-in account', icon: KeyRound, filled: filled(form.membershipId), total: 1 },
]);
function jump(key: string) {
  document.getElementById(`section-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const required = computed(() => [
  { label: 'First name', done: !!form.firstName.trim(), section: 'personal' },
  { label: 'Last name', done: !!form.lastName.trim(), section: 'personal' },
  { label: 'Date of joining', done: !!form.dateOfJoining, section: 'job' },
]);
const recommended = computed(() => [
  { label: 'Work email', done: !!form.workEmail, section: 'contact' },
  { label: 'Phone number', done: !!form.phone, section: 'contact' },
  ...(isEdit.value
    ? []
    : [
        { label: 'Department & designation', done: !!(form.departmentId && form.designationId), section: 'placement' },
        { label: 'Reporting manager', done: !!form.managerId, section: 'placement' },
      ]),
  { label: 'Emergency contact', done: !!(form.emergencyContactName && form.emergencyContactPhone), section: 'contact' },
  { label: 'Linked sign-in account', done: !!form.membershipId, section: 'account' },
]);
const previewName = computed(() => `${form.firstName} ${form.lastName}`.trim());
const previewRole = computed(() => {
  if (isEdit.value) return [existing.data.value?.designation?.name, existing.data.value?.department?.name].filter(Boolean).join(' · ');
  return [labelOf(designationOptions.value, form.designationId), labelOf(departmentOptions.value, form.departmentId)].filter(Boolean).join(' · ');
});
</script>

<template>
  <div>
    <AppPageHeader
      :title="isEdit ? `Edit ${existing.data.value?.fullName ?? 'employee'}` : 'Add employee'"
      :description="isEdit ? 'Update personal, contact and job terms. Department, designation, location, manager and status changes are recorded from the employee page as lifecycle actions.' : 'Create the employee record. Link a user account so they can sign in and use self-service.'"
      :back="isEdit ? `/hr/employees/${id}` : '/hr/employees'"
      :back-label="isEdit ? 'Back to employee' : 'All employees'"
    />
    <AppSkeleton v-if="isEdit && existing.loading.value && !existing.data.value" :lines="10" />
    <AppErrorState v-else-if="existing.error.value" :error="existing.error.value" title="Could not load employee" @retry="existing.run" />
    <div v-else class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <form id="employee-form" class="min-w-0 space-y-4" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <p class="flex items-center gap-1.5 text-xs text-fg-muted"><span class="text-danger" aria-hidden="true">*</span>Required fields. Everything else can be added later.</p>

        <AppCard id="section-personal" class="scroll-mt-4" title="Personal details" :icon="UserRound" description="Legal name as it appears on ID documents.">
          <div class="grid gap-4 sm:grid-cols-2">
            <AppInput v-model="form.firstName" label="First name" required autocomplete="off" :error="fieldErrors.firstName" />
            <AppInput v-model="form.lastName" label="Last name" required autocomplete="off" :error="fieldErrors.lastName" />
          </div>
          <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AppDatePicker v-model="form.dateOfBirth" label="Date of birth" :max="today" :help="age !== null ? `${age} years old` : undefined" :error="fieldErrors.dateOfBirth" />
            <AppSelect v-model="form.gender" label="Gender" placeholder="Not specified" :options="genderOptions" :error="fieldErrors.gender" />
            <AppSelect v-model="form.maritalStatus" label="Marital status" placeholder="Not specified" :options="maritalStatusOptions" :error="fieldErrors.maritalStatus" />
            <AppSelect v-model="form.bloodGroup" label="Blood group" placeholder="Not specified" :options="bloodGroupOptions" help="Shared with first aiders in an emergency." :error="fieldErrors.bloodGroup" />
            <AppSelect v-model="form.nationality" label="Nationality" placeholder="Not specified" :options="COUNTRY_OPTIONS" searchable :error="fieldErrors.nationality" />
          </div>
        </AppCard>

        <AppCard id="section-job" class="scroll-mt-4" title="Job & terms" :icon="Briefcase" description="Employment type, joining date, probation and notice.">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AppInput
              v-model="form.employeeCode"
              label="Employee code"
              :placeholder="isEdit ? undefined : 'Generated, e.g. EMP-0001'"
              :help="isEdit ? undefined : 'Leave empty to generate it.'"
              :error="fieldErrors.employeeCode"
            />
            <AppDatePicker v-model="form.dateOfJoining" label="Date of joining" required :help="joiningHint" :error="fieldErrors.dateOfJoining" />
            <AppSelect v-model="form.employmentType" label="Employment type" :options="employmentTypeOptions" :clearable="false" :error="fieldErrors.employmentType" />
            <div>
              <AppDatePicker v-model="form.probationEndDate" label="Probation ends" :min="form.dateOfJoining" :error="fieldErrors.probationEndDate" />
              <div v-if="form.dateOfJoining && !fieldErrors.probationEndDate" class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                <span>Joining +</span>
                <button
                  v-for="m in [3, 6]"
                  :key="m"
                  type="button"
                  class="rounded-full border border-line px-2 py-0.5 font-medium text-fg hover:border-brand-500/50 hover:bg-accent-soft hover:text-accent-fg"
                  :aria-label="`Set probation to end ${m} months after joining`"
                  @click="probationAfter(m)"
                >
                  {{ m }} months
                </button>
              </div>
            </div>
            <AppInput v-model="form.noticePeriodDays" label="Notice period" type="number" :min="0" :max="365" suffix="days" help="To serve after resigning." :error="fieldErrors.noticePeriodDays" />
            <AppSelect
              v-if="auth.hasFeature('attendance')"
              v-model="form.shiftId"
              label="Shift"
              :placeholder="defaultShift ? `Default (${defaultShift.name})` : 'Default shift'"
              :options="shiftOptions"
              help="Working hours used for attendance."
              :error="fieldErrors.shiftId"
            />
          </div>
        </AppCard>

        <AppCard v-if="!isEdit" id="section-placement" class="scroll-mt-4" title="Placement" :icon="Building2" description="Where they sit in the organization and who they report to.">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AppSelect v-model="form.departmentId" label="Department" placeholder="None" :options="departmentOptions" :error="fieldErrors.departmentId" />
            <AppSelect v-model="form.designationId" label="Designation" placeholder="None" :options="designationOptions" :error="fieldErrors.designationId" />
            <AppSelect v-model="form.locationId" label="Location" placeholder="None" :options="locationOptions" :error="fieldErrors.locationId" />
            <AppSelect v-model="form.managerId" label="Reports to" placeholder="No manager" :options="managerOptions" searchable help="Their direct line manager." :error="fieldErrors.managerId" />
            <AppSelect v-model="form.gradeId" label="Grade" placeholder="None" :options="gradeOptions" :error="fieldErrors.gradeId" />
            <AppSelect v-model="form.costCenterId" label="Cost center" placeholder="None" :options="costCenterOptions" searchable :error="fieldErrors.costCenterId" />
          </div>
          <p v-if="!departmentOptions.length && auth.can('organization.structure.manage')" class="mt-3 text-xs text-fg-muted">
            No departments yet. <RouterLink to="/admin/structure" class="font-medium text-accent-fg hover:underline">Set up the organization structure</RouterLink>.
          </p>
        </AppCard>
        <section v-else-if="existing.data.value" class="card flex flex-wrap items-start gap-3 px-4 py-3">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-info-soft text-info-fg" aria-hidden="true"><Info :size="16" /></span>
          <div class="min-w-0 flex-1 text-sm">
            <p class="font-medium text-fg">Placement is changed with lifecycle actions</p>
            <p class="mt-0.5 text-fg-muted">
              {{ [existing.data.value.department?.name ?? 'No department', existing.data.value.designation?.name ?? 'No designation', existing.data.value.location?.name ?? 'No location'].join(' · ') }}
              · Reports to {{ existing.data.value.manager?.name ?? 'no one' }}
            </p>
          </div>
          <AppButton size="sm" variant="secondary" :to="`/hr/employees/${id}`">Open employee page</AppButton>
        </section>

        <AppCard id="section-contact" class="scroll-mt-4" title="Contact & emergency" :icon="Phone" description="How HR and the team reach them, and who to call in an emergency.">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AppInput v-model="form.workEmail" label="Work email" type="email" placeholder="name@company.com" help="Used for sign-in invitations and notifications." :error="fieldErrors.workEmail" />
            <AppInput v-model="form.personalEmail" label="Personal email" type="email" placeholder="name@example.com" :error="fieldErrors.personalEmail" />
            <AppInput v-model="form.phone" label="Phone" type="tel" placeholder="+91 98765 43210" :error="fieldErrors.phone" />
          </div>
          <fieldset class="mt-5 space-y-3 border-t border-line/70 pt-4">
            <legend class="sr-only">Emergency contact</legend>
            <p class="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-muted uppercase" aria-hidden="true"><HeartPulse :size="13" />Emergency contact</p>
            <div class="grid gap-4 sm:grid-cols-2">
              <AppInput v-model="form.emergencyContactName" label="Name and relationship" placeholder="e.g. Rahul Patel (spouse)" :error="fieldErrors.emergencyContactName" />
              <AppInput v-model="form.emergencyContactPhone" label="Emergency contact phone" type="tel" placeholder="+91 98765 43210" :error="fieldErrors.emergencyContactPhone" />
            </div>
          </fieldset>
        </AppCard>

        <AppCard id="section-address" class="scroll-mt-4" title="Address" :icon="MapPinHouse">
          <div class="space-y-3">
            <AppTextarea v-model="form.address" label="Current address" placeholder="House / flat, street, area, city, state, PIN code" :rows="2" :maxlength="500" :error="fieldErrors.address" />
            <AppCheckbox v-model="sameAddress" label="Permanent address is the same as the current address" />
            <AppTextarea v-if="!sameAddress" v-model="form.permanentAddress" label="Permanent address" :rows="2" :maxlength="500" :error="fieldErrors.permanentAddress" />
          </div>
        </AppCard>

        <AppCard id="section-account" class="scroll-mt-4" title="Sign-in account" :icon="KeyRound" description="Link the person's sign-in account so attendance, leave and self-service work for them.">
          <AppSelect
            v-model="form.membershipId"
            class="max-w-md"
            label="Linked user"
            placeholder="Not linked"
            :options="accountOptions"
            searchable
            :error="fieldErrors.membershipId"
            :help="accountOptions.length ? 'Picking a user fills in an empty name and work email.' : 'Everyone with an account already has an employee record. Invite the person from Users first.'"
          />
        </AppCard>

        <!-- Stays in view at the bottom of the scrolling page. -->
        <div class="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-lift backdrop-blur">
          <span class="me-auto inline-flex items-center gap-2 text-sm text-fg-muted">
            <template v-if="canSave"><Check :size="15" class="text-success-fg" aria-hidden="true" />Ready to save</template>
            <template v-else><CircleAlert :size="15" class="text-warning-fg" aria-hidden="true" />{{ required.filter((r) => !r.done).length }} required field{{ required.filter((r) => !r.done).length === 1 ? '' : 's' }} left</template>
          </span>
          <AppButton variant="secondary" :to="isEdit ? `/hr/employees/${id}` : '/hr/employees'">Cancel</AppButton>
          <AppButton type="submit" :icon="Save" :loading="saving" :disabled="!canSave">
            {{ isEdit ? 'Save changes' : 'Add employee' }}
          </AppButton>
        </div>
      </form>

      <aside class="min-w-0 space-y-4 xl:sticky xl:top-0" aria-label="Form summary">
        <section class="card overflow-hidden">
          <div class="h-12 bg-gradient-to-r from-brand-700 via-brand-500 to-sky-400" aria-hidden="true" />
          <div class="flex flex-col items-center px-4 pb-4 text-center">
            <div class="-mt-8 rounded-full bg-surface p-1 shadow-xs">
              <AppAvatar v-if="previewName" :name="previewName" :src="existing.data.value?.avatarUrl" size="xl" />
              <span v-else class="flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-fg-subtle" aria-hidden="true"><UserRound :size="24" /></span>
            </div>
            <p :class="['mt-2 w-full truncate text-base font-semibold', previewName ? 'text-fg' : 'text-fg-subtle']">{{ previewName || (isEdit ? 'Employee' : 'New employee') }}</p>
            <p class="w-full truncate text-sm text-fg-muted">{{ previewRole || 'No designation yet' }}</p>
            <div class="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              <span>{{ EMPLOYMENT_TYPE_LABELS[form.employmentType] }}</span>
              <span v-if="form.dateOfJoining">· {{ form.dateOfJoining >= today ? 'Starts' : 'Joined' }} {{ formatDate(form.dateOfJoining) }}</span>
            </div>
          </div>
          <div class="border-t border-line/70 px-4 py-3">
            <p class="mb-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">Required</p>
            <ul class="space-y-1">
              <li v-for="r in required" :key="r.label">
                <button type="button" class="flex w-full items-center gap-2.5 rounded-md py-0.5 text-start text-sm hover:text-accent-fg" @click="jump(r.section)">
                  <span v-if="r.done" class="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-fg" aria-hidden="true"><Check :size="11" :stroke-width="3" /></span>
                  <span v-else class="h-4.5 w-4.5 shrink-0 rounded-full border-2 border-danger/60" aria-hidden="true" />
                  <span :class="r.done ? 'text-fg-muted' : 'font-medium text-fg'">{{ r.label }}</span>
                  <span class="sr-only">{{ r.done ? '(done)' : '(missing)' }}</span>
                </button>
              </li>
            </ul>
            <p class="mt-3 mb-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">Recommended</p>
            <ul class="space-y-1">
              <li v-for="r in recommended" :key="r.label">
                <button type="button" class="flex w-full items-center gap-2.5 rounded-md py-0.5 text-start text-sm hover:text-accent-fg" @click="jump(r.section)">
                  <span v-if="r.done" class="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-fg" aria-hidden="true"><Check :size="11" :stroke-width="3" /></span>
                  <span v-else class="h-4.5 w-4.5 shrink-0 rounded-full border-2 border-dashed border-line-strong" aria-hidden="true" />
                  <span :class="r.done ? 'text-fg-muted' : 'text-fg'">{{ r.label }}</span>
                  <span class="sr-only">{{ r.done ? '(done)' : '(not filled)' }}</span>
                </button>
              </li>
            </ul>
          </div>
        </section>

        <nav class="card p-2" aria-label="Form sections">
          <ul>
            <li v-for="s in sections" :key="s.key">
              <button type="button" class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start text-sm hover:bg-surface-muted" @click="jump(s.key)">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><component :is="s.icon" :size="14" /></span>
                <span class="min-w-0 flex-1 truncate font-medium text-fg">{{ s.title }}</span>
                <span :class="['text-xs tabular-nums', s.filled === s.total ? 'text-success-fg' : 'text-fg-subtle']">{{ s.filled }}/{{ s.total }}</span>
              </button>
            </li>
          </ul>
        </nav>
      </aside>
    </div>
  </div>
</template>
