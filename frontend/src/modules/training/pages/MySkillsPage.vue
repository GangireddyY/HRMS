<script setup lang="ts">
import { computed, ref } from 'vue';
import { BadgeCheck, GraduationCap, Plus, Sparkles, Trash2 } from '@lucide/vue';
import { SKILL_LEVEL_LABELS } from '@contracts';
import { SKILL_CATEGORY_LABELS, skillsApi } from '@/modules/training/api/skills.api';
import SkillLevel from '@/modules/training/components/SkillLevel.vue';
import type { SkillProfile } from '@/modules/training/types';
import { AppAlert, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppInput, AppModal, AppPageHeader, AppSelect, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** My skills: own ratings, verified levels, what my role needs and the courses that close the gaps. */
const feedback = useFeedbackStore();
const profile = useAsync(() => skillsApi.mine());
const catalog = useAsync(() => skillsApi.list());
const p = computed(() => profile.data.value);
const busy = ref<string | null>(null);
async function rate(skillId: string, level: number) {
  busy.value = skillId;
  try {
    profile.data.value = await skillsApi.setMine({ skillId, level });
  } catch (e) {
    feedback.error('Could not save the level', e);
  } finally {
    busy.value = null;
  }
}
async function remove(s: SkillProfile['skills'][number]) {
  if (!(await feedback.confirm({ title: `Remove ${s.name}?`, message: s.verifiedLevel ? 'Your own rating is removed; the verified level stays.' : 'It is removed from your skills.', confirmLabel: 'Remove' }))) return;
  try {
    profile.data.value = await skillsApi.removeMine(s.skillId);
  } catch (e) {
    feedback.error('Could not remove it', e);
  }
}
const adding = ref(false);
const draft = ref<{ skillId: string | null; level: number; notes: string }>({ skillId: null, level: 3, notes: '' });
const addable = computed(() => (catalog.data.value ?? []).filter((s) => !p.value?.skills.some((x) => x.skillId === s.id && x.level)).map((s) => ({ value: s.id, label: s.name, description: SKILL_CATEGORY_LABELS[s.category] })));
async function add() {
  busy.value = 'add';
  try {
    profile.data.value = await skillsApi.setMine({ skillId: draft.value.skillId!, level: draft.value.level, notes: draft.value.notes || null });
    feedback.success('Skill added');
    adding.value = false;
  } catch (e) {
    feedback.error('Could not add the skill', e);
  } finally {
    busy.value = null;
  }
}
function openAdd(skillId: string | null = null) {
  draft.value = { skillId, level: 3, notes: '' };
  adding.value = true;
}
</script>

<template>
  <div>
    <AppPageHeader title="My skills" description="Rate your skills, see what your role needs, and find courses that close the gaps. Verified levels come from your manager or completed courses.">
      <template #actions><AppButton :icon="Plus" :disabled="!p" @click="openAdd()">Add a skill</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="profile.loading.value && !p" :lines="6" />
    <AppErrorState v-else-if="profile.error.value" :error="profile.error.value" @retry="profile.run" />
    <AppAlert v-else-if="!p" tone="info">Your account isn't linked to an employee record yet.</AppAlert>
    <div v-else class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <AppCard title="Skills" :padded="!p.skills.length">
        <AppEmptyState v-if="!p.skills.length" compact :icon="Sparkles" title="No skills yet" description="Add the skills you use at work and rate yourself." />
        <ul v-else class="divide-y divide-line">
          <li v-for="s in p.skills" :key="s.skillId" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
              <p class="font-medium text-fg">{{ s.name }} <AppBadge v-if="s.required" size="sm" :tone="s.effectiveLevel >= s.required ? 'success' : 'warning'">Role needs {{ s.required }}</AppBadge></p>
              <p class="text-xs text-fg-muted">
                {{ s.category ? SKILL_CATEGORY_LABELS[s.category] : '' }}
                <template v-if="s.verifiedLevel">
                  · <BadgeCheck :size="12" class="inline text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> verified {{ SKILL_LEVEL_LABELS[s.verifiedLevel].toLowerCase() }}
                  {{ s.verifiedSource === 'TRAINING' ? 'by a course' : `by ${s.verifiedBy}` }}<template v-if="s.verifiedAt">, {{ formatDate(s.verifiedAt) }}</template>
                </template>
                <template v-if="s.notes"> · {{ s.notes }}</template>
              </p>
            </div>
            <div class="flex items-center gap-3">
              <SkillLevel :model-value="s.level" editable :label="`Your level in ${s.name}`" :required="s.required" @update:model-value="(v: number) => rate(s.skillId, v)" />
              <span class="w-24 text-xs text-fg-muted">{{ s.level ? SKILL_LEVEL_LABELS[s.level] : 'Not rated' }}</span>
              <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove ${s.name}`" :disabled="!s.level" @click="remove(s)" />
            </div>
          </li>
        </ul>
      </AppCard>

      <div class="space-y-4">
        <AppCard :title="p.designation ? `${p.designation.name}: what the role needs` : 'What your role needs'">
          <template v-if="p.requirements.length">
            <div class="mb-4 flex items-center gap-3">
              <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted" role="progressbar" :aria-valuenow="p.readiness" aria-valuemin="0" aria-valuemax="100" aria-label="Role readiness">
                <div class="h-full rounded-full bg-brand-500" :style="{ width: `${p.readiness}%` }" />
              </div>
              <span class="text-sm font-semibold text-fg tabular-nums">{{ p.readiness }}%</span>
            </div>
            <ul class="space-y-3 text-sm">
              <li v-for="r in p.requirements" :key="r.skillId" class="flex items-center justify-between gap-3">
                <span :class="r.current >= r.requiredLevel ? 'text-fg' : 'font-medium text-amber-700 dark:text-amber-300'">{{ r.name }}</span>
                <SkillLevel :model-value="r.current" :required="r.requiredLevel" size="sm" :label="r.name" />
              </li>
            </ul>
          </template>
          <p v-else class="text-sm text-fg-muted">{{ p.designation ? 'No skills have been set for your role yet.' : 'You have no designation yet.' }}</p>
        </AppCard>

        <AppCard v-if="p.gaps.length" title="Close the gaps" :icon="GraduationCap">
          <ul class="space-y-4 text-sm">
            <li v-for="g in p.gaps" :key="g.skillId">
              <p class="font-medium text-fg">{{ g.name }} <span class="font-normal text-fg-muted">— {{ g.current ? SKILL_LEVEL_LABELS[g.current].toLowerCase() : 'not rated' }}, needs {{ SKILL_LEVEL_LABELS[g.required].toLowerCase() }}</span></p>
              <ul v-if="g.courses.length" class="mt-1 space-y-1">
                <li v-for="c in g.courses" :key="c.id">
                  <RouterLink :to="`/me/training/courses/${c.id}`" class="text-brand-600 hover:underline dark:text-brand-400">{{ c.title }}</RouterLink>
                  <span class="text-xs text-fg-muted"> · up to {{ SKILL_LEVEL_LABELS[c.teachesLevel].toLowerCase() }}{{ c.durationHours ? ` · ${c.durationHours} h` : '' }}</span>
                </li>
              </ul>
              <p v-else class="mt-1 text-xs text-fg-muted">No course for this yet — talk to your manager.</p>
              <AppButton v-if="!p.skills.some((s) => s.skillId === g.skillId && s.level)" class="mt-1" size="xs" variant="link" @click="openAdd(g.skillId)">Rate yourself</AppButton>
            </li>
          </ul>
        </AppCard>
      </div>
    </div>

    <AppModal :open="adding" title="Add a skill" size="sm" @close="adding = false">
      <div class="space-y-4">
        <AppSelect v-model="draft.skillId" label="Skill" :options="addable" placeholder="Search the catalog" searchable :clearable="false" />
        <div>
          <p class="label">Your level</p>
          <div class="flex items-center gap-3">
            <SkillLevel v-model="draft.level" editable label="Your level" />
            <span class="text-sm text-fg-muted">{{ SKILL_LEVEL_LABELS[draft.level] }}</span>
          </div>
        </div>
        <AppInput v-model="draft.notes" label="Notes" :maxlength="500" placeholder="Where you've used it, certifications…" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="adding = false">Cancel</AppButton>
        <AppButton :loading="busy === 'add'" :disabled="!draft.skillId" @click="add">Add</AppButton>
      </template>
    </AppModal>
  </div>
</template>
