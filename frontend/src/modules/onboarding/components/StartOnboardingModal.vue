<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import type { CaseDetail, ChecklistTemplate, JoinerRef } from '@/modules/onboarding/types';
import { employeesApi } from '@/modules/people/api/people.api';
import { AppAlert, AppButton, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { formatDate } from '@/shared/utils/format';

const props = defineProps<{ open: boolean; employee: JoinerRef | null; templates: ChecklistTemplate[] }>();
const emit = defineEmits<{ close: []; started: [detail: CaseDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const colleagues = useAsync(() => employeesApi.list({ status: 'ACTIVE', pageSize: 100, sort: 'name:asc' }), { immediate: false });
const form = reactive({ templateId: '' as string, buddyId: null as string | null, notes: '' });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const def = props.templates.find((t) => t.isDefault && t.isActive);
    Object.assign(form, { templateId: def?.id ?? (props.templates.find((t) => t.isActive)?.id ?? 'none'), buddyId: null, notes: '' });
    if (!colleagues.data.value) void colleagues.run();
  },
  { immediate: true },
);

const templateOptions = computed(() => [
  ...props.templates.filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name, description: `${t.tasks.length} task${t.tasks.length === 1 ? '' : 's'}${t.isDefault ? ' · default' : ''}` })),
  { value: 'none', label: 'Empty checklist', description: 'Add tasks one by one' },
]);
const buddyOptions = computed(() => (colleagues.data.value?.items ?? []).filter((e) => e.id !== props.employee?.id).map((e) => ({ value: e.id, label: e.fullName, description: e.designation?.name ?? e.employeeCode })));

async function start() {
  reset();
  saving.value = true;
  try {
    emit('started', await onboardingApi.start({ employeeId: props.employee!.id, templateId: form.templateId === 'none' ? null : form.templateId, buddyId: form.buddyId, notes: form.notes || null }));
  } catch (e) {
    handle(e, 'Could not start onboarding');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Start onboarding" :description="employee ? `${employee.name} · joins ${formatDate(employee.dateOfJoining)}` : undefined" @close="emit('close')">
    <form id="start-onboarding-form" class="space-y-4" novalidate @submit.prevent="start">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppSelect v-model="form.templateId" label="Checklist" :options="templateOptions" :clearable="false" :error="fieldErrors.templateId" help="Due dates are set from the date of joining." />
      <AppSelect v-model="form.buddyId" label="Buddy" placeholder="No buddy" :options="buddyOptions" searchable :error="fieldErrors.buddyId" help="A colleague who helps them settle in; they are notified." />
      <AppTextarea v-model="form.notes" label="Notes for HR" :rows="2" :maxlength="1000" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="start-onboarding-form" :loading="saving">Start onboarding</AppButton>
    </template>
  </AppModal>
</template>
