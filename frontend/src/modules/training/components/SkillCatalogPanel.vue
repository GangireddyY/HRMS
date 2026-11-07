<script setup lang="ts">
import { reactive, ref } from 'vue';
import { Pencil, Plus, Trash2 } from '@lucide/vue';
import { SKILL_CATEGORIES, type SkillCategory } from '@contracts';
import { SKILL_CATEGORY_LABELS, skillsApi } from '@/modules/training/api/skills.api';
import type { Skill } from '@/modules/training/types';
import { AppAlert, AppBadge, AppButton, AppCard, AppDataTable, AppInput, AppModal, AppSelect, AppSwitch, AppTextarea, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** The skills catalog (`training.manage`). */
const emit = defineEmits<{ changed: [] }>();
const feedback = useFeedbackStore();
const skills = useAsync(() => skillsApi.list({ includeInactive: true }));
const columns: TableColumn<Skill>[] = [
  { key: 'name', label: 'Skill' },
  { key: 'category', label: 'Category' },
  { key: 'people', label: 'People', align: 'right' },
  { key: 'actions', label: '', align: 'right' },
];
const categoryOptions = SKILL_CATEGORIES.map((c) => ({ value: c, label: SKILL_CATEGORY_LABELS[c] }));
const { fieldErrors, formError, handle, reset } = useFormErrors();
const editing = ref<Skill | 'new' | null>(null);
const form = reactive({ name: '', category: 'TECHNICAL' as SkillCategory, description: '', isActive: true });
function edit(s: Skill | null) {
  reset();
  editing.value = s ?? 'new';
  Object.assign(form, s ? { name: s.name, category: s.category, description: s.description ?? '', isActive: s.isActive } : { name: '', category: 'TECHNICAL', description: '', isActive: true });
}
const busy = ref(false);
async function save() {
  reset();
  busy.value = true;
  try {
    const body = { name: form.name, category: form.category, description: form.description || null, isActive: form.isActive };
    if (editing.value === 'new') await skillsApi.create(body);
    else await skillsApi.update((editing.value as Skill).id, body);
    feedback.success('Skill saved');
    editing.value = null;
    await skills.run();
    emit('changed');
  } catch (e) {
    handle(e, 'Could not save the skill');
  } finally {
    busy.value = false;
  }
}
async function remove(s: Skill) {
  if (!(await feedback.confirm({ title: `Delete ${s.name}?`, message: 'Skills in use can only be deactivated.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await skillsApi.remove(s.id);
    feedback.success('Skill deleted');
    await skills.run();
    emit('changed');
  } catch (e) {
    feedback.error('Could not delete the skill', e);
  }
}
</script>

<template>
  <AppCard :padded="false">
    <div class="flex justify-end border-b border-line p-4"><AppButton :icon="Plus" @click="edit(null)">Add skill</AppButton></div>
    <AppDataTable :columns="columns" :rows="skills.data.value ?? []" :loading="skills.loading.value" :error="skills.error.value" caption="Skills" empty-title="No skills yet" empty-description="Add the skills your organization cares about." @retry="skills.run">
      <template #cell-name="{ row }">
        <p class="font-medium text-fg">{{ row.name }} <AppBadge v-if="!row.isActive" size="sm">Inactive</AppBadge></p>
        <p v-if="row.description" class="max-w-md truncate text-xs text-fg-muted">{{ row.description }}</p>
      </template>
      <template #cell-category="{ row }">{{ SKILL_CATEGORY_LABELS[row.category as SkillCategory] }}</template>
      <template #cell-people="{ row }"><span class="tabular-nums">{{ row.people ?? 0 }}</span></template>
      <template #cell-actions="{ row }">
        <div class="flex justify-end gap-1">
          <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.name}`" @click="edit(row)" />
          <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.name}`" @click="remove(row)" />
        </div>
      </template>
    </AppDataTable>
    <AppModal :open="!!editing" :title="editing === 'new' ? 'Add skill' : 'Edit skill'" size="sm" @close="editing = null">
      <form id="skill-form" class="space-y-4" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppInput v-model="form.name" label="Name" required :maxlength="80" placeholder="e.g. TypeScript" :error="fieldErrors.name" />
        <AppSelect v-model="form.category" label="Category" :options="categoryOptions" :clearable="false" />
        <AppTextarea v-model="form.description" label="Description" :rows="2" :maxlength="500" />
        <AppSwitch v-if="editing !== 'new'" v-model="form.isActive" label="Active" description="Inactive skills stay on profiles but can't be added." />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="editing = null">Cancel</AppButton>
        <AppButton type="submit" form="skill-form" :loading="busy" :disabled="form.name.trim().length < 2">Save</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
