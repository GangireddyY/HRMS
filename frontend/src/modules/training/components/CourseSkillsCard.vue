<script setup lang="ts">
import { computed, ref } from 'vue';
import { Pencil, Plus, Sparkles, X } from '@lucide/vue';
import { SKILL_LEVEL_LABELS } from '@contracts';
import { skillsApi } from '@/modules/training/api/skills.api';
import SkillLevel from '@/modules/training/components/SkillLevel.vue';
import { AppButton, AppCard, AppModal, AppSelect } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Skills a course teaches; completing it verifies them at these levels. Editable with `training.manage`. */
const props = defineProps<{ courseId: string; editable: boolean }>();
const feedback = useFeedbackStore();
const taught = useAsync(() => skillsApi.courseSkills(props.courseId));
const catalog = useAsync(() => skillsApi.list(), { immediate: false });
const editing = ref(false);
const rows = ref<{ skillId: string | null; level: number }[]>([]);
function edit() {
  rows.value = (taught.data.value ?? []).map((s) => ({ skillId: s.skillId, level: s.level }));
  if (!rows.value.length) rows.value.push({ skillId: null, level: 3 });
  void catalog.run();
  editing.value = true;
}
const options = computed(() => (catalog.data.value ?? []).map((s) => ({ value: s.id, label: s.name })));
const busy = ref(false);
async function save() {
  busy.value = true;
  try {
    taught.data.value = await skillsApi.setCourseSkills(props.courseId, rows.value.filter((r) => r.skillId).map((r) => ({ skillId: r.skillId!, level: r.level })));
    feedback.success('Skills saved');
    editing.value = false;
  } catch (e) {
    feedback.error('Could not save the skills', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppCard title="Skills you build" :icon="Sparkles">
    <template v-if="editable" #actions><AppButton size="sm" variant="ghost" :icon="Pencil" aria-label="Edit skills" @click="edit" /></template>
    <p v-if="!taught.data.value?.length" class="text-sm text-fg-muted">{{ editable ? 'Add the skills this course teaches; completing it verifies them.' : 'No skills listed.' }}</p>
    <ul v-else class="space-y-2">
      <li v-for="s in taught.data.value" :key="s.skillId" class="flex items-center justify-between gap-3 text-sm">
        <span class="text-fg">{{ s.name }}</span>
        <span class="flex items-center gap-2 text-xs text-fg-muted">{{ SKILL_LEVEL_LABELS[s.level] }} <SkillLevel :model-value="s.level" size="sm" :label="s.name" /></span>
      </li>
    </ul>
    <AppModal :open="editing" title="Skills this course teaches" description="Learners who complete it are verified at these levels (a higher level they already have is kept)." @close="editing = false">
      <ol class="space-y-3">
        <li v-for="(r, i) in rows" :key="i" class="flex flex-wrap items-center gap-3">
          <AppSelect v-model="r.skillId" class="min-w-48 flex-1" :options="options" placeholder="Choose a skill" searchable :aria-label="`Skill ${i + 1}`" />
          <SkillLevel v-model="r.level" editable :label="`Level for skill ${i + 1}`" />
          <AppButton variant="ghost" :icon="X" :aria-label="`Remove skill ${i + 1}`" @click="rows.splice(i, 1)" />
        </li>
      </ol>
      <AppButton class="mt-3" size="sm" variant="secondary" :icon="Plus" @click="rows.push({ skillId: null, level: 3 })">Add skill</AppButton>
      <template #footer>
        <AppButton variant="secondary" @click="editing = false">Cancel</AppButton>
        <AppButton :loading="busy" @click="save">Save</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
