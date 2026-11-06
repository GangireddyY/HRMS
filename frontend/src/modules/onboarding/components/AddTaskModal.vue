<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { ONBOARDING_ASSIGNEES, type DocumentCategory, type OnboardingAssignee } from '@contracts';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import type { CaseDetail } from '@/modules/onboarding/types';
import { ASSIGNEE_LABELS } from '@/modules/onboarding/utils/onboarding-format';
import { documentCategoryOptions } from '@/modules/people/utils/labels';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect, AppSwitch, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

const props = defineProps<{ open: boolean; caseId: string; joiningDate: string }>();
const emit = defineEmits<{ close: []; saved: [detail: CaseDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const form = reactive({ title: '', description: '', assignee: 'HR' as OnboardingAssignee, documentCategory: null as DocumentCategory | null, dueDate: undefined as string | undefined, isRequired: true });
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, { title: '', description: '', assignee: 'HR', documentCategory: null, dueDate: props.joiningDate, isRequired: true });
  },
);
watch(
  () => form.assignee,
  (a) => {
    if (a !== 'EMPLOYEE') form.documentCategory = null;
  },
);
const assigneeOptions = ONBOARDING_ASSIGNEES.map((a) => ({ value: a, label: ASSIGNEE_LABELS[a] }));

async function save() {
  reset();
  saving.value = true;
  try {
    emit('saved', await onboardingApi.addTask(props.caseId, { ...form, description: form.description || null, dueDate: form.dueDate ?? '' }));
  } catch (e) {
    handle(e, 'Could not add the task');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Add task" @close="emit('close')">
    <form id="add-task-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppInput v-model="form.title" label="Task" required autofocus :error="fieldErrors.title" />
      <AppTextarea v-model="form.description" label="Details" :rows="2" :maxlength="1000" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect v-model="form.assignee" label="Done by" :options="assigneeOptions" :clearable="false" :error="fieldErrors.assignee" />
        <AppDatePicker v-model="form.dueDate" label="Due" required :error="fieldErrors.dueDate" />
      </div>
      <AppSelect v-if="form.assignee === 'EMPLOYEE'" v-model="form.documentCategory" label="Asks for a document" placeholder="No – a regular task" :options="documentCategoryOptions" help="Completed when HR verifies the uploaded document." />
      <AppSwitch v-model="form.isRequired" label="Required" description="Onboarding can't be completed while required tasks are open." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="add-task-form" :loading="saving" :disabled="form.title.trim().length < 2 || !form.dueDate">Add task</AppButton>
    </template>
  </AppModal>
</template>
