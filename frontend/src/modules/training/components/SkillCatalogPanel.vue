<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Pencil, Plus, Trash2 } from '@lucide/vue';
import { SKILL_CATEGORIES, type SkillCategory } from '@contracts';
import { SKILL_CATEGORY_LABELS, skillsApi } from '@/modules/training/api/skills.api';
import type { Skill } from '@/modules/training/types';
import { CATEGORY_VISUALS } from '@/modules/training/utils/skill-visuals';
import { AppAlert, AppBadge, AppButton, AppDataTable, AppInput, AppModal, AppSearchInput, AppStatStrip, AppSwitch, AppTextarea, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** The skills catalog (`training.manage`). */
const emit = defineEmits<{ changed: [] }>();
const feedback = useFeedbackStore();
const skills = useAsync(() => skillsApi.list({ includeInactive: true }));
const requirements = useAsync(() => skillsApi.requirements());

/** Roles that need each skill. */
const rolesBySkill = computed(() => {
  const map = new Map<string, string[]>();
  for (const r of requirements.data.value ?? []) for (const s of r.skills) map.set(s.skillId, [...(map.get(s.skillId) ?? []), r.designation.name]);
  return map;
});
const all = computed(() => skills.data.value ?? []);
const isUnused = (s: Skill) => s.isActive && !(s.people ?? 0) && !rolesBySkill.value.has(s.id);

type View = 'all' | 'used' | 'required' | 'unused' | 'inactive';
const view = ref<View>('all');
const category = ref<SkillCategory | null>(null);
const search = ref('');
const MATCH: Record<View, (s: Skill) => boolean> = {
  all: () => true,
  used: (s) => (s.people ?? 0) > 0,
  required: (s) => rolesBySkill.value.has(s.id),
  unused: isUnused,
  inactive: (s) => !s.isActive,
};
const strip = computed<StripItem[]>(() => {
  const count = (v: View) => all.value.filter(MATCH[v]).length;
  return [
    { key: 'all', label: 'All skills', value: all.value.length, hint: `${all.value.filter((s) => s.isActive).length} active`, tone: 'brand' },
    { key: 'used', label: 'In use', value: count('used'), hint: 'Rated by at least one person', tone: 'success' },
    { key: 'required', label: 'Required by roles', value: count('required'), hint: `Across ${(requirements.data.value ?? []).filter((r) => r.skills.length).length} roles`, tone: 'violet' },
    { key: 'unused', label: 'Unused', value: count('unused'), hint: 'Nobody has or needs them', tone: 'warning' },
    { key: 'inactive', label: 'Inactive', value: count('inactive'), hint: "Can't be added to profiles", tone: 'neutral' },
  ];
});
const inView = computed(() => all.value.filter(MATCH[view.value]));
const categoryCounts = computed(() => new Map(SKILL_CATEGORIES.map((c) => [c, inView.value.filter((s) => s.category === c).length])));
const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  return inView.value
    .filter((s) => (!category.value || s.category === category.value) && (!q || s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)))
    .sort((a, b) => (b.people ?? 0) - (a.people ?? 0) || a.name.localeCompare(b.name));
});
const maxPeople = computed(() => Math.max(1, ...all.value.map((s) => s.people ?? 0)));
const filtered = computed(() => view.value !== 'all' || !!category.value || !!search.value.trim());
function clearFilters() {
  view.value = 'all';
  category.value = null;
  search.value = '';
}

const columns: TableColumn<Skill>[] = [
  { key: 'name', label: 'Skill' },
  { key: 'category', label: 'Category' },
  { key: 'people', label: 'People' },
  { key: 'roles', label: 'Required by' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];

// ---- Add / edit ------------------------------------------------------------------------------------------------
const { fieldErrors, formError, handle, reset } = useFormErrors();
const editing = ref<Skill | 'new' | null>(null);
const form = reactive({ name: '', category: 'TECHNICAL' as SkillCategory, description: '', isActive: true });
function edit(s: Skill | null) {
  reset();
  editing.value = s ?? 'new';
  Object.assign(form, s ? { name: s.name, category: s.category, description: s.description ?? '', isActive: s.isActive } : { name: '', category: category.value ?? 'TECHNICAL', description: '', isActive: true });
}
const busy = ref(false);
async function save() {
  reset();
  busy.value = true;
  try {
    const body = { name: form.name, category: form.category, description: form.description || null, isActive: form.isActive };
    if (editing.value === 'new') await skillsApi.create(body);
    else await skillsApi.update((editing.value as Skill).id, body);
    feedback.success(editing.value === 'new' ? 'Skill added' : 'Skill saved', `${form.name} · ${SKILL_CATEGORY_LABELS[form.category]}`);
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
  if (!(await feedback.confirm({ title: `Delete ${s.name}?`, message: 'Skills that people have or roles need can only be deactivated.', confirmLabel: 'Delete', danger: true }))) return;
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
  <div class="space-y-4">
    <AppStatStrip :items="strip" selectable :selected="view === 'all' ? null : view" :loading="skills.loading.value && !skills.data.value" label="Skills summary" @select="(k) => (view = (k ?? 'all') as View)" />

    <section class="card">
      <div class="space-y-3 border-b border-line/70 px-4 py-3">
        <div class="flex flex-wrap items-center gap-3">
          <AppSearchInput v-model="search" class="w-full sm:w-80" placeholder="Search skills or descriptions" aria-label="Search skills" />
          <AppButton class="ms-auto" :icon="Plus" @click="edit(null)">Add skill</AppButton>
        </div>
        <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by category">
          <button
            type="button"
            :class="['inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 transition ring-inset', !category ? 'bg-fg text-surface ring-fg' : 'text-fg-muted ring-line hover:bg-surface-muted hover:text-fg']"
            :aria-pressed="!category"
            @click="category = null"
          >
            All <span class="tabular-nums opacity-70">{{ inView.length }}</span>
          </button>
          <button
            v-for="c in SKILL_CATEGORIES"
            :key="c"
            type="button"
            :class="['inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 transition ring-inset', category === c ? 'bg-accent-soft text-accent-fg ring-brand-500/30' : 'text-fg-muted ring-line hover:bg-surface-muted hover:text-fg']"
            :aria-pressed="category === c"
            @click="category = category === c ? null : c"
          >
            <component :is="CATEGORY_VISUALS[c].icon" :size="13" aria-hidden="true" />
            {{ SKILL_CATEGORY_LABELS[c] }}
            <span class="tabular-nums opacity-70">{{ categoryCounts.get(c) }}</span>
          </button>
        </div>
      </div>

      <AppDataTable
        :columns="columns"
        :rows="rows"
        :loading="skills.loading.value"
        :error="skills.error.value"
        caption="Skills"
        layout-key="skills-catalog"
        empty-title="No skills yet"
        empty-description="Add the skills your organization cares about, then set the levels each role needs."
        :filtered="filtered"
        @clear="clearFilters"
        @retry="skills.run"
      >
        <template #empty><AppButton :icon="Plus" @click="edit(null)">Add skill</AppButton></template>
        <template #cell-name="{ row }">
          <div class="flex items-center gap-3">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', CATEGORY_VISUALS[row.category].tile]" aria-hidden="true">
              <component :is="CATEGORY_VISUALS[row.category].icon" :size="17" />
            </span>
            <div class="min-w-0">
              <p :class="['truncate font-medium', row.isActive ? 'text-fg' : 'text-fg-muted line-through decoration-fg-subtle/60']">{{ row.name }}</p>
              <p class="max-w-md truncate text-xs text-fg-muted">{{ row.description || 'No description' }}</p>
            </div>
          </div>
        </template>
        <template #cell-category="{ row }">
          <span class="inline-flex items-center gap-1.5 text-fg-muted"><span :class="['h-2 w-2 rounded-full', CATEGORY_VISUALS[row.category].dot]" aria-hidden="true" />{{ SKILL_CATEGORY_LABELS[row.category] }}</span>
        </template>
        <template #cell-people="{ row }">
          <div class="flex items-center gap-2 max-md:justify-end">
            <span class="h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              <span class="block h-full rounded-full bg-brand-500" :style="{ width: `${((row.people ?? 0) / maxPeople) * 100}%` }" />
            </span>
            <span class="w-6 text-end tabular-nums text-fg">{{ row.people ?? 0 }}</span>
          </div>
        </template>
        <template #cell-roles="{ row }">
          <span v-if="!rolesBySkill.get(row.id)" class="text-xs text-fg-subtle">No role</span>
          <span v-else class="flex flex-wrap items-center gap-1 max-md:justify-end" :title="rolesBySkill.get(row.id)!.join(', ')">
            <AppBadge v-for="r in rolesBySkill.get(row.id)!.slice(0, 2)" :key="r" size="sm" tone="violet">{{ r }}</AppBadge>
            <AppBadge v-if="rolesBySkill.get(row.id)!.length > 2" size="sm">+{{ rolesBySkill.get(row.id)!.length - 2 }}</AppBadge>
          </span>
        </template>
        <template #cell-status="{ row }">
          <AppBadge v-if="!row.isActive" size="sm" dot>Inactive</AppBadge>
          <AppBadge v-else-if="isUnused(row)" size="sm" tone="warning" dot>Unused</AppBadge>
          <AppBadge v-else size="sm" tone="success" dot>Active</AppBadge>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1">
            <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.name}`" @click="edit(row)" />
            <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.name}`" @click="remove(row)" />
          </div>
        </template>
      </AppDataTable>
    </section>

    <AppModal :open="!!editing" :title="editing === 'new' ? 'Add skill' : 'Edit skill'" description="Skills are rated 1 (Beginner) to 5 (Expert) by people and verified by managers." size="lg" dialog @close="editing = null">
      <form id="skill-form" class="space-y-4" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppInput v-model="form.name" label="Name" required :maxlength="80" placeholder="e.g. TypeScript" :error="fieldErrors.name" autofocus />
        <fieldset>
          <legend class="label">Category</legend>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Category">
            <button
              v-for="c in SKILL_CATEGORIES"
              :key="c"
              type="button"
              role="radio"
              :aria-checked="form.category === c"
              :class="[
                'flex items-center gap-2 rounded-lg px-3 py-2 text-start text-sm ring-1 transition ring-inset focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
                form.category === c ? 'bg-accent-soft font-medium text-fg ring-brand-500/50' : 'text-fg-muted ring-line hover:bg-surface-muted',
              ]"
              @click="form.category = c"
            >
              <span :class="['flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset', CATEGORY_VISUALS[c].tile]" aria-hidden="true"><component :is="CATEGORY_VISUALS[c].icon" :size="14" /></span>
              <span class="truncate">{{ SKILL_CATEGORY_LABELS[c] }}</span>
            </button>
          </div>
        </fieldset>
        <AppTextarea v-model="form.description" label="Description" :rows="2" :maxlength="500" placeholder="What this skill covers, so people rate themselves consistently" />
        <AppSwitch v-if="editing !== 'new'" v-model="form.isActive" label="Active" description="Inactive skills stay on profiles but can't be added." />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="editing = null">Cancel</AppButton>
        <AppButton type="submit" form="skill-form" :loading="busy" :disabled="form.name.trim().length < 2">{{ editing === 'new' ? 'Add skill' : 'Save changes' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
