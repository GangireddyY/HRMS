<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { BriefcaseBusiness, Save } from '@lucide/vue';
import { employeesApi } from '@/modules/people/api/people.api';
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, employeeStatusTone } from '@/modules/people/utils/labels';
import { AppAlert, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppInput, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** The signed-in person's employee record: job details (read-only) and their own contact details. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const me = useAsync(() => employeesApi.me());
const canEdit = computed(() => auth.can('self.profile.update'));
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const form = reactive({ personalEmail: '', phone: '', address: '', emergencyContactName: '', emergencyContactPhone: '' });

watch(me.data, (e) => {
  if (!e) return;
  Object.assign(form, { personalEmail: e.personalEmail ?? '', phone: e.phone ?? '', address: e.address ?? '', emergencyContactName: e.emergencyContactName ?? '', emergencyContactPhone: e.emergencyContactPhone ?? '' });
});
const dirty = computed(() => {
  const e = me.data.value;
  return !!e && (['personalEmail', 'phone', 'address', 'emergencyContactName', 'emergencyContactPhone'] as const).some((k) => form[k] !== (e[k] ?? ''));
});

async function save() {
  reset();
  saving.value = true;
  try {
    me.data.value = await employeesApi.updateMe({
      personalEmail: form.personalEmail || null,
      phone: form.phone || null,
      address: form.address || null,
      emergencyContactName: form.emergencyContactName || null,
      emergencyContactPhone: form.emergencyContactPhone || null,
    });
    feedback.success('Contact details updated');
  } catch (e) {
    handle(e, 'Could not update contact details');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppCard title="Employment" :icon="BriefcaseBusiness" description="Your job details are maintained by HR. You can keep your contact and emergency details up to date.">
    <AppSkeleton v-if="me.loading.value && !me.data.value" :lines="4" />
    <AppErrorState v-else-if="me.error.value" :error="me.error.value" @retry="me.run" />
    <AppEmptyState v-else-if="!me.data.value" compact title="No employee record yet" description="HR hasn't linked your account to an employee record. Contact your HR team." />
    <template v-else>
      <dl class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div><dt class="text-xs text-fg-muted">Employee code</dt><dd class="mt-0.5 font-mono text-fg">{{ me.data.value.employeeCode }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Designation</dt><dd class="mt-0.5 text-fg">{{ me.data.value.designation?.name ?? '—' }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Department</dt><dd class="mt-0.5 text-fg">{{ me.data.value.department?.name ?? '—' }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Reports to</dt><dd class="mt-0.5 text-fg">{{ me.data.value.manager?.name ?? '—' }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Location</dt><dd class="mt-0.5 text-fg">{{ me.data.value.location?.name ?? '—' }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Date of joining</dt><dd class="mt-0.5 text-fg">{{ formatDate(me.data.value.dateOfJoining) }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Employment type</dt><dd class="mt-0.5 text-fg">{{ EMPLOYMENT_TYPE_LABELS[me.data.value.employmentType] }}</dd></div>
        <div><dt class="text-xs text-fg-muted">Status</dt><dd class="mt-0.5"><AppBadge :tone="employeeStatusTone[me.data.value.status]" dot>{{ EMPLOYEE_STATUS_LABELS[me.data.value.status] }}</AppBadge></dd></div>
      </dl>

      <form v-if="canEdit" class="mt-6 space-y-4 border-t border-line/70 pt-5" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AppInput v-model="form.personalEmail" label="Personal email" type="email" :error="fieldErrors.personalEmail" />
          <AppInput v-model="form.phone" label="Phone" type="tel" :error="fieldErrors.phone" />
          <AppInput v-model="form.emergencyContactName" label="Emergency contact" :error="fieldErrors.emergencyContactName" />
          <AppInput v-model="form.emergencyContactPhone" label="Emergency contact phone" type="tel" :error="fieldErrors.emergencyContactPhone" />
          <AppTextarea v-model="form.address" class="sm:col-span-2" label="Address" :rows="2" :maxlength="500" :error="fieldErrors.address" />
        </div>
        <div class="flex justify-end">
          <AppButton type="submit" :icon="Save" :loading="saving" :disabled="!dirty">Save contact details</AppButton>
        </div>
      </form>
    </template>
  </AppCard>
</template>
