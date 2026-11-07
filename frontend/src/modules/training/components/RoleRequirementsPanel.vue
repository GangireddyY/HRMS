<script setup lang="ts">
import { computed, ref } from 'vue';
import { Pencil, Plus, X } from '@lucide/vue';
import { SKILL_LEVEL_LABELS } from '@contracts';
import { skillsApi } from '@/modules/training/api/skills.api';
import SkillLevel from '@/modules/training/components/SkillLevel.vue';
import type { RoleRequirements } from '@/modules/training/types';
import { AppButton, AppCard, AppEmptyState, AppErrorState, AppModal, AppSelect, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** The skills each designation needs, at a minimum level (`training.manage`). */
const feedback = useFeedbackStore();
const roles = useAsync(() => skillsApi.requirements());
const catalog = useAsync(() => skillsApi.list());
const options = computed(() => (catalog.data.value ?? []).map((s) => ({ value: s.id, label: s.name })));
const editing = ref<RoleRequirements | null>(null);
const rows = ref<{ skillId: string | null; level: number }[]>([]);
function edit(r: RoleRequirements) {
  editing.value = r;
  rows.value = r.skills.map((s) => ({ skillId: s.skillId, level: s.requiredLevel }));
  if (!rows.value.length) rows.value.push({ skillId: null, level: 3 });
}
const busy = ref(false);
async function save() {
  busy.value = true;
  try {
    await skillsApi.setRequirements(editing.value!.designation.id, rows.value.filter((r) => r.skillId).map((r) => ({ skillId: r.skillId!, level: r.level })));
    feedback.success('Saved');
    editing.value = null;
    await roles.run();
  } catch (e) {
    feedback.error('Could not save', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <AppSkeleton v-if="roles.loading.value && !roles.data.value" :lines="5" />
    <AppErrorState v-else-if="roles.error.value" :error="roles.error.value" @retry="roles.run" />
    <AppCard v-else-if="!roles.data.value?.length"><AppEmptyState compact title="No designations yet" description="Add designations under Administration → Structure first." /></AppCard>
    <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <AppCard v-for="r in roles.data.value" :key="r.designation.id" :title="r.designation.name">
        <template #actions><AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit skills for ${r.designation.name}`" @click="edit(r)" /></template>
        <p v-if="!r.skills.length" class="text-sm text-fg-muted">No skills set.</p>
        <ul v-else class="space-y-2 text-sm">
          <li v-for="s in r.skills" :key="s.skillId" class="flex items-center justify-between gap-3">
            <span class="text-fg">{{ s.name }}</span>
            <span class="flex items-center gap-2 text-xs text-fg-muted">{{ SKILL_LEVEL_LABELS[s.requiredLevel] }} <SkillLevel :model-value="s.requiredLevel" size="sm" :label="s.name" /></span>
          </li>
        </ul>
      </AppCard>
    </div>
    <AppModal :open="!!editing" :title="`Skills for ${editing?.designation.name}`" description="People in this role are measured against these levels." @close="editing = null">
      <ol class="space-y-3">
        <li v-for="(r, i) in rows" :key="i" class="flex flex-wrap items-center gap-3">
          <AppSelect v-model="r.skillId" class="min-w-48 flex-1" :options="options" placeholder="Choose a skill" searchable :aria-label="`Skill ${i + 1}`" />
          <SkillLevel v-model="r.level" editable :label="`Required level for skill ${i + 1}`" />
          <AppButton variant="ghost" :icon="X" :aria-label="`Remove skill ${i + 1}`" @click="rows.splice(i, 1)" />
        </li>
      </ol>
      <AppButton class="mt-3" size="sm" variant="secondary" :icon="Plus" @click="rows.push({ skillId: null, level: 3 })">Add skill</AppButton>
      <template #footer>
        <AppButton variant="secondary" @click="editing = null">Cancel</AppButton>
        <AppButton :loading="busy" @click="save">Save</AppButton>
      </template>
    </AppModal>
  </div>
</template>
