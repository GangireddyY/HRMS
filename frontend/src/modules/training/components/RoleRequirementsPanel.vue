<script setup lang="ts">
import { computed, ref } from 'vue';
import { BadgeCheck, ClipboardCheck, Pencil, Plus, Users, X } from '@lucide/vue';
import { MAX_SKILLS_PER_ROLE, SKILL_LEVEL_LABELS } from '@contracts';
import { structureApi } from '@/modules/people/api/people.api';
import { SKILL_CATEGORY_LABELS, skillsApi } from '@/modules/training/api/skills.api';
import SkillLevel from '@/modules/training/components/SkillLevel.vue';
import type { RoleRequirements } from '@/modules/training/types';
import { CATEGORY_VISUALS } from '@/modules/training/utils/skill-visuals';
import { AppBadge, AppButton, AppEmptyState, AppErrorState, AppModal, AppSearchInput, AppSelect, AppStatStrip, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** The skills each designation needs, at a minimum level (`training.manage`). */
const feedback = useFeedbackStore();
const roles = useAsync(() => skillsApi.requirements());
const catalog = useAsync(() => skillsApi.list());
const designations = useAsync(() => structureApi.designations());
const infoOf = (id: string) => designations.data.value?.find((d) => d.id === id);
const categoryOf = (skillId: string) => catalog.data.value?.find((s) => s.id === skillId)?.category ?? 'OTHER';

type View = 'all' | 'setup' | 'missing';
const view = ref<View>('all');
const search = ref('');
const all = computed(() => roles.data.value ?? []);
const strip = computed<StripItem[]>(() => {
  const setUp = all.value.filter((r) => r.skills.length);
  const distinct = new Set(setUp.flatMap((r) => r.skills.map((s) => s.skillId))).size;
  const avg = setUp.length ? Math.round((setUp.reduce((n, r) => n + r.skills.length, 0) / setUp.length) * 10) / 10 : 0;
  return [
    { key: 'all', label: 'Roles', value: all.value.length, hint: 'Designations in your structure', tone: 'brand' },
    { key: 'setup', label: 'Set up', value: setUp.length, hint: all.value.length ? `${Math.round((setUp.length / all.value.length) * 100)}% of roles` : undefined, tone: 'success' },
    { key: 'missing', label: 'Not set up', value: all.value.length - setUp.length, hint: 'People there are not measured', tone: 'warning' },
    { key: 'skills', label: 'Skills required', value: distinct, hint: 'Distinct skills across roles', tone: 'violet' },
    { key: 'avg', label: 'Per role', value: avg, hint: 'Average skills per set-up role', tone: 'info' },
  ];
});
const shown = computed(() => {
  const q = search.value.trim().toLowerCase();
  return all.value
    .filter((r) => (view.value === 'setup' ? r.skills.length > 0 : view.value === 'missing' ? r.skills.length === 0 : true))
    .filter((r) => !q || r.designation.name.toLowerCase().includes(q) || r.skills.some((s) => s.name.toLowerCase().includes(q)))
    .sort((a, b) => (infoOf(a.designation.id)?.level ?? 99) - (infoOf(b.designation.id)?.level ?? 99) || a.designation.name.localeCompare(b.designation.name));
});
const PREVIEW = 6;

// ---- Editing ---------------------------------------------------------------------------------------------------
const editing = ref<RoleRequirements | null>(null);
const rows = ref<{ skillId: string | null; level: number }[]>([]);
const copyFrom = ref<string | null>(null);
function edit(r: RoleRequirements) {
  editing.value = r;
  copyFrom.value = null;
  rows.value = r.skills.map((s) => ({ skillId: s.skillId, level: s.requiredLevel }));
  if (!rows.value.length) rows.value.push({ skillId: null, level: 3 });
}
const copyOptions = computed(() =>
  all.value.filter((r) => r.skills.length && r.designation.id !== editing.value?.designation.id).map((r) => ({ value: r.designation.id, label: r.designation.name, description: `${r.skills.length} skills` })),
);
function applyCopy(id: string | null | undefined) {
  const source = all.value.find((r) => r.designation.id === id);
  if (!source) return;
  rows.value = source.skills.map((s) => ({ skillId: s.skillId, level: s.requiredLevel }));
  copyFrom.value = null;
  feedback.success('Copied', `${source.skills.length} skills from ${source.designation.name}. Adjust the levels, then save.`);
}
/** Each row offers the skills not already chosen in another row. */
const optionsFor = (i: number) => {
  const taken = new Set(rows.value.filter((_, j) => j !== i).map((r) => r.skillId));
  return (catalog.data.value ?? []).filter((s) => !taken.has(s.id)).map((s) => ({ value: s.id, label: s.name, description: SKILL_CATEGORY_LABELS[s.category] }));
};
const chosen = computed(() => rows.value.filter((r) => r.skillId).length);
const busy = ref(false);
async function save() {
  busy.value = true;
  try {
    await skillsApi.setRequirements(editing.value!.designation.id, rows.value.filter((r) => r.skillId).map((r) => ({ skillId: r.skillId!, level: r.level })));
    feedback.success('Requirements saved', `${editing.value!.designation.name}: ${chosen.value} skill${chosen.value === 1 ? '' : 's'}.`);
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
  <div class="space-y-4">
    <AppStatStrip
      :items="strip"
      selectable
      :selected="view === 'all' ? null : view"
      :loading="roles.loading.value && !roles.data.value"
      label="Role requirements summary"
      @select="(k) => (view = k === 'setup' || k === 'missing' ? k : 'all')"
    />

    <div class="flex flex-wrap items-center gap-3">
      <AppSearchInput v-model="search" class="w-full sm:w-72" placeholder="Search roles or skills" aria-label="Search roles or skills" />
      <p class="text-xs text-fg-muted">People in each role are measured against these levels in the matrix.</p>
    </div>

    <div v-if="roles.loading.value && !roles.data.value" class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      <div v-for="i in 6" :key="i" class="card space-y-3 p-4">
        <div class="flex items-center gap-3">
          <div class="skeleton h-10 w-10 rounded-lg" />
          <div class="flex-1 space-y-2"><div class="skeleton h-3.5 w-1/2 rounded-full" /><div class="skeleton h-3 w-1/3 rounded-full" /></div>
        </div>
        <div v-for="j in 3" :key="j" class="skeleton h-3 rounded-full" />
      </div>
    </div>
    <div v-else-if="roles.error.value" class="card"><AppErrorState :error="roles.error.value" @retry="roles.run" /></div>
    <div v-else-if="!all.length" class="card"><AppEmptyState :icon="ClipboardCheck" title="No designations yet" description="Add designations under Administration → Structure, then set the skills each one needs." /></div>
    <div v-else-if="!shown.length" class="card">
      <AppEmptyState compact title="No roles match" description="Try another search or summary filter.">
        <AppButton size="sm" variant="secondary" @click="(view = 'all'), (search = '')">Clear filters</AppButton>
      </AppEmptyState>
    </div>
    <ul v-else class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      <li v-for="r in shown" :key="r.designation.id">
        <article class="card flex h-full flex-col overflow-hidden">
          <div :class="['h-1', r.skills.length ? 'bg-gradient-to-r from-violet-400 to-violet-600' : 'bg-gradient-to-r from-amber-300 to-amber-500']" aria-hidden="true" />
          <header class="flex items-start gap-3 p-4 pb-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 ring-1 ring-violet-600/15 ring-inset dark:bg-violet-500/15 dark:text-violet-300" aria-hidden="true">
              <BadgeCheck :size="19" />
            </span>
            <div class="min-w-0 flex-1">
              <h3 class="truncate font-semibold text-fg" :title="r.designation.name">{{ r.designation.name }}</h3>
              <p class="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
                <Users :size="12" aria-hidden="true" />
                {{ infoOf(r.designation.id)?.employeeCount ?? 0 }} {{ infoOf(r.designation.id)?.employeeCount === 1 ? 'person' : 'people' }}
                <template v-if="infoOf(r.designation.id)?.level"> · Level {{ infoOf(r.designation.id)!.level }}</template>
              </p>
            </div>
            <AppBadge v-if="r.skills.length" size="sm" tone="violet">{{ r.skills.length }} skill{{ r.skills.length === 1 ? '' : 's' }}</AppBadge>
            <AppBadge v-else size="sm" tone="warning" dot>Not set up</AppBadge>
          </header>

          <div class="flex-1 px-4">
            <ul v-if="r.skills.length" class="divide-y divide-line/60">
              <li v-for="s in r.skills.slice(0, PREVIEW)" :key="s.skillId" class="flex items-center gap-3 py-2">
                <span :class="['flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset', CATEGORY_VISUALS[s.category ?? categoryOf(s.skillId)].tile]" aria-hidden="true">
                  <component :is="CATEGORY_VISUALS[s.category ?? categoryOf(s.skillId)].icon" :size="12" />
                </span>
                <span class="min-w-0 flex-1 truncate text-sm text-fg">{{ s.name }}</span>
                <span class="hidden w-20 text-end text-2xs text-fg-muted sm:block">{{ SKILL_LEVEL_LABELS[s.requiredLevel] }}</span>
                <SkillLevel :model-value="s.requiredLevel" size="sm" :label="`${s.name} required`" />
              </li>
              <li v-if="r.skills.length > PREVIEW" class="py-2 text-xs text-fg-muted">+{{ r.skills.length - PREVIEW }} more</li>
            </ul>
            <div v-else class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-6 text-center">
              <p class="text-sm text-fg-muted">No skills set — people in this role aren't measured yet.</p>
              <AppButton size="sm" :icon="Plus" @click="edit(r)">Set requirements</AppButton>
            </div>
          </div>

          <footer v-if="r.skills.length" class="mt-3 flex items-center justify-between gap-2 border-t border-line/70 px-4 py-2.5">
            <span class="text-xs text-fg-muted">Highest: {{ SKILL_LEVEL_LABELS[Math.max(...r.skills.map((s) => s.requiredLevel))] }}</span>
            <AppButton size="sm" variant="ghost" :icon="Pencil" @click="edit(r)">Edit</AppButton>
          </footer>
          <div v-else class="h-4" />
        </article>
      </li>
    </ul>

    <AppModal :open="!!editing" :title="`Skills for ${editing?.designation.name ?? ''}`" description="People in this role are measured against these minimum levels in the skill matrix." :guide="false" @close="editing = null">
      <div class="space-y-4">
        <AppSelect
          v-if="copyOptions.length"
          v-model="copyFrom"
          :options="copyOptions"
          label="Start from another role"
          placeholder="Copy the skills of…"
          help="Replaces the list below; adjust the levels afterwards."
          @update:model-value="applyCopy"
        />
        <div>
          <div class="mb-2 flex items-center justify-between">
            <p class="label mb-0">Required skills</p>
            <span class="text-xs text-fg-muted tabular-nums">{{ chosen }} of {{ MAX_SKILLS_PER_ROLE }}</span>
          </div>
          <ol class="divide-y divide-line/70 rounded-lg border border-line">
            <li v-for="(r, i) in rows" :key="i" class="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span class="w-5 text-end text-xs text-fg-subtle tabular-nums">{{ i + 1 }}</span>
              <AppSelect v-model="r.skillId" class="min-w-48 flex-1" :options="optionsFor(i)" placeholder="Choose a skill" searchable :aria-label="`Skill ${i + 1}`" />
              <SkillLevel v-model="r.level" editable :label="`Required level for skill ${i + 1}`" />
              <span class="w-24 text-xs font-medium text-fg">{{ r.level }} · {{ SKILL_LEVEL_LABELS[r.level] }}</span>
              <AppButton variant="ghost" size="sm" :icon="X" :aria-label="`Remove skill ${i + 1}`" @click="rows.splice(i, 1)" />
            </li>
            <li v-if="!rows.length" class="px-3 py-6 text-center text-sm text-fg-muted">No skills — saving clears this role's requirements.</li>
          </ol>
          <AppButton class="mt-3" size="sm" variant="secondary" :icon="Plus" :disabled="rows.length >= MAX_SKILLS_PER_ROLE" @click="rows.push({ skillId: null, level: 3 })">Add skill</AppButton>
        </div>
        <ul class="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-surface-muted/60 px-3 py-2 text-xs text-fg-muted" aria-label="Proficiency levels">
          <li v-for="n in 5" :key="n"><span class="font-semibold text-fg tabular-nums">{{ n }}</span> {{ SKILL_LEVEL_LABELS[n] }}</li>
        </ul>
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="editing = null">Cancel</AppButton>
        <AppButton :loading="busy" @click="save">Save requirements</AppButton>
      </template>
    </AppModal>
  </div>
</template>
