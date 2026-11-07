<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ArrowRight, BriefcaseBusiness, Save } from '@lucide/vue';
import type { BloodGroup, MaritalStatus } from '@contracts';
import { employeesApi } from '@/modules/people/api/people.api';
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, bloodGroupOptions, employeeStatusTone, maritalStatusOptions } from '@/modules/people/utils/labels';
import { AppAlert, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppInput, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** The signed-in person's employee record: job details (read-only) and the personal details they maintain themselves. */
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const auth = useAuthStore();
const feedback = useFeedbackStore();
const me = useAsync(() => employeesApi.me());
const canEdit = computed(() => !props.compact && auth.can('self.profile.update'));
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const FIELDS = ['personalEmail', 'phone', 'address', 'permanentAddress', 'emergencyContactName', 'emergencyContactPhone'] as const;
const form = reactive({
  personalEmail: '',
  phone: '',
  address: '',
  permanentAddress: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  maritalStatus: null as MaritalStatus | null,
  bloodGroup: null as BloodGroup | null,
});

watch(me.data, (e) => {
  if (!e) return;
  for (const k of FIELDS) form[k] = e[k] ?? '';
  form.maritalStatus = e.maritalStatus;
  form.bloodGroup = e.bloodGroup;
});
const dirty = computed(() => {
  const e = me.data.value;
  return !!e && (FIELDS.some((k) => form[k] !== (e[k] ?? '')) || form.maritalStatus !== e.maritalStatus || form.bloodGroup !== e.bloodGroup);
});

async function save() {
  reset();
  saving.value = true;
  try {
    me.data.value = await employeesApi.updateMe({
      ...Object.fromEntries(FIELDS.map((k) => [k, form[k] || null])),
      maritalStatus: form.maritalStatus,
      bloodGroup: form.bloodGroup,
    });
    feedback.success('Your details were updated');
  } catch (e) {
    handle(e, 'Could not update your details');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppCard title="Employment" :icon="BriefcaseBusiness" :description="compact ? undefined : 'Your job details are maintained by HR. Keep your contact, address and emergency details up to date.'">
    <template v-if="compact && me.data.value" #actions>
      <AppButton size="sm" variant="ghost" :icon-right="ArrowRight" to="/me/employment">Full profile</AppButton>
    </template>
    <AppSkeleton v-if="me.loading.value && !me.data.value" :lines="4" />
    <AppErrorState v-else-if="me.error.value" :error="me.error.value" @retry="me.run" />
    <AppEmptyState v-else-if="!me.data.value" compact title="No employee record yet" description="HR hasn't linked your account to an employee record. Contact your HR team." />
    <template v-else>
      <dl class="grid gap-x-4 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div><dt class="text-xs text-fg-muted">Employee code</dt><dd class="mt-0.5 font-mono text-fg">{{ me.data.value.employeeCode }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Designation</dt><dd class="mt-0.5 text-fg">{{ me.data.value.designation?.name ?? '—' }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Department</dt><dd class="mt-0.5 text-fg">{{ me.data.value.department?.name ?? '—' }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Reports to</dt><dd class="mt-0.5 text-fg">{{ me.data.value.manager?.name ?? '—' }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Location</dt><dd class="mt-0.5 text-fg">{{ me.data.value.location?.name ?? '—' }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Grade</dt><dd class="mt-0.5 text-fg">{{ me.data.value.grade?.name ?? '—' }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Date of joining</dt><dd class="mt-0.5 text-fg">{{ formatDate(me.data.value.dateOfJoining) }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Employment type</dt><dd class="mt-0.5 text-fg">{{ EMPLOYMENT_TYPE_LABELS[me.data.value.employmentType] }}</dd></div>
        <div v-if="!compact"><dt class="text-xs text-fg-muted">Probation ends</dt><dd class="mt-0.5 text-fg">{{ me.data.value.probationEndDate ? formatDate(me.data.value.probationEndDate) : '—' }}</dd></div>
        <div v-if="!compact"><dt class="text-xs text-fg-muted">Notice period</dt><dd class="mt-0.5 text-fg">{{ me.data.value.noticePeriodDays === null ? '—' : `${me.data.value.noticePeriodDays} days` }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Status</dt><dd class="mt-0.5"><AppBadge :tone="employeeStatusTone[me.data.value.status]" dot>{{ EMPLOYEE_STATUS_LABELS[me.data.value.status] }}</AppBadge></dd></div>
      </dl>

      <form v-if="canEdit" class="mt-4 space-y-4 border-t border-line/70 pt-4" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AppInput v-model="form.personalEmail" label="Personal email" type="email" :error="fieldErrors.personalEmail" />
          <AppInput v-model="form.phone" label="Phone" type="tel" :error="fieldErrors.phone" />
          <AppSelect v-model="form.maritalStatus" label="Marital status" placeholder="Not specified" :options="maritalStatusOptions" :error="fieldErrors.maritalStatus" />
          <AppSelect v-model="form.bloodGroup" label="Blood group" placeholder="Not specified" :options="bloodGroupOptions" :error="fieldErrors.bloodGroup" />
          <AppInput v-model="form.emergencyContactName" label="Emergency contact" :error="fieldErrors.emergencyContactName" />
          <AppInput v-model="form.emergencyContactPhone" label="Emergency contact phone" type="tel" :error="fieldErrors.emergencyContactPhone" />
          <AppTextarea v-model="form.address" class="sm:col-span-2 xl:col-span-4" label="Current address" :rows="2" :maxlength="500" :error="fieldErrors.address" />
          <AppTextarea v-model="form.permanentAddress" class="sm:col-span-2 xl:col-span-4" label="Permanent address" placeholder="Leave empty if the same as the current address" :rows="2" :maxlength="500" :error="fieldErrors.permanentAddress" />
        </div>
        <div class="flex justify-end">
          <AppButton type="submit" :icon="Save" :loading="saving" :disabled="!dirty">Save my details</AppButton>
        </div>
      </form>
    </template>
  </AppCard>
</template>
