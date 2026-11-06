<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ArrowDown, ArrowUp, Plus, Trash2 } from '@lucide/vue';
import { ONBOARDING_ASSIGNEES } from '@contracts';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import type { ChecklistTemplate, TemplateTask } from '@/modules/onboarding/types';
import { ASSIGNEE_LABELS, offsetLabel } from '@/modules/onboarding/utils/onboarding-format';
import { documentCategoryOptions } from '@/modules/people/utils/labels';
import { AppAlert, AppButton, AppCheckbox, AppInput, AppModal, AppSelect, AppSwitch, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Create or edit a checklist template and its tasks (saved as a whole). */
const props = defineProps<{ open: boolean; template: ChecklistTemplate | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const form = reactive({ name: '', description: '', isDefault: false, isActive: true });
const tasks = ref<(TemplateTask & { key: number })[]>([]);
let key = 0;
const blankTask = (): TemplateTask & { key: number } => ({ key: key++, title: '', description: null, assignee: 'HR', documentCategory: null, dueOffsetDays: 0, isRequired: true });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const t = props.template;
    Object.assign(form, { name: t?.name ?? '', description: t?.description ?? '', isDefault: t?.isDefault ?? false, isActive: t?.isActive ?? true });
    tasks.value = t ? t.tasks.map((x) => ({ ...x, key: key++ })) : [blankTask()];
  },
  { immediate: true },
);

const assigneeOptions = ONBOARDING_ASSIGNEES.map((a) => ({ value: a, label: ASSIGNEE_LABELS[a] }));
function move(i: number, by: number) {
  const list = [...tasks.value];
  const [item] = list.splice(i, 1);
  list.splice(i + by, 0, item!);
  tasks.value = list;
}
const canSave = computed(() => form.name.trim().length >= 2 && tasks.value.every((t) => t.title.trim().length >= 2));

async function save() {
  reset();
  saving.value = true;
  const body = {
    name: form.name,
    description: form.description || null,
    isDefault: form.isDefault,
    isActive: form.isActive,
    tasks: tasks.value.map(({ key: _k, id: _id, ...t }) => ({ ...t, documentCategory: t.assignee === 'EMPLOYEE' ? t.documentCategory : null, dueOffsetDays: Number(t.dueOffsetDays) || 0 })),
  };
  try {
    if (props.template) await onboardingApi.updateTemplate(props.template.id, body);
    else await onboardingApi.createTemplate(body);
    emit('saved');
  } catch (e) {
    handle(e, 'Could not save the checklist');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="template ? `Edit ${template.name}` : 'New checklist'" size="xl" @close="emit('close')">
    <form id="template-form" class="space-y-5" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.name" label="Name" required placeholder="e.g. Engineering joiners" :error="fieldErrors.name" />
        <AppInput v-model="form.description" label="Description" :maxlength="500" />
      </div>
      <div class="flex flex-wrap gap-x-8 gap-y-3">
        <AppSwitch v-model="form.isDefault" label="Default checklist" description="Used when onboarding starts without choosing one." />
        <AppSwitch v-if="template" v-model="form.isActive" label="Active" />
      </div>

      <div>
        <h3 class="mb-2 text-sm font-semibold text-fg">Tasks</h3>
        <ol class="space-y-3">
          <li v-for="(t, i) in tasks" :key="t.key" class="rounded-xl p-3 ring-1 ring-line">
            <div class="grid gap-3 lg:grid-cols-[1fr_150px_120px]">
              <AppInput v-model="t.title" :label="`Task ${i + 1}`" required :error="fieldErrors[`tasks.${i}.title`]" />
              <AppSelect v-model="t.assignee" label="Done by" :options="assigneeOptions" :clearable="false" :error="fieldErrors[`tasks.${i}.assignee`]" />
              <AppInput v-model="t.dueOffsetDays" label="Due (days)" type="number" :min="-180" :max="365" :help="offsetLabel(Number(t.dueOffsetDays) || 0)" />
            </div>
            <div class="mt-3 grid gap-3 lg:grid-cols-[1fr_260px]">
              <AppTextarea v-model="t.description" label="Details" :rows="1" :maxlength="1000" />
              <AppSelect v-if="t.assignee === 'EMPLOYEE'" v-model="t.documentCategory" label="Asks for a document" placeholder="No" :options="documentCategoryOptions" />
            </div>
            <div class="mt-2 flex items-center justify-between gap-2">
              <AppCheckbox v-model="t.isRequired" label="Required" />
              <div class="flex gap-1">
                <AppButton size="sm" variant="ghost" :icon="ArrowUp" aria-label="Move up" :disabled="i === 0" @click="move(i, -1)" />
                <AppButton size="sm" variant="ghost" :icon="ArrowDown" aria-label="Move down" :disabled="i === tasks.length - 1" @click="move(i, 1)" />
                <AppButton size="sm" variant="ghost" :icon="Trash2" aria-label="Remove task" @click="tasks.splice(i, 1)" />
              </div>
            </div>
          </li>
        </ol>
        <AppButton class="mt-3" size="sm" variant="secondary" :icon="Plus" @click="tasks.push(blankTask())">Add task</AppButton>
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="template-form" :loading="saving" :disabled="!canSave">{{ template ? 'Save changes' : 'Create checklist' }}</AppButton>
    </template>
  </AppModal>
</template>
