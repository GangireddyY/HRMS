<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { BadgeCheck } from '@lucide/vue';
import { SKILL_LEVEL_LABELS } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { structureApi } from '@/modules/people/api/people.api';
import { skillsApi } from '@/modules/training/api/skills.api';
import RoleRequirementsPanel from '@/modules/training/components/RoleRequirementsPanel.vue';
import SkillCatalogPanel from '@/modules/training/components/SkillCatalogPanel.vue';
import SkillLevel from '@/modules/training/components/SkillLevel.vue';
import type { MatrixCell, MatrixRow } from '@/modules/training/types';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppPagination, AppSearchInput, AppSelect, AppSkeleton, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Skill matrix of the people in scope, the skills catalog and the skills each role needs. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const manage = auth.can('training.manage');
const tab = ref('matrix');
const tabs = [{ key: 'matrix', label: 'Matrix' }, ...(manage ? [{ key: 'catalog', label: 'Skills catalog' }, { key: 'roles', label: 'Role requirements' }] : [])];
const filters = reactive({ departmentId: undefined as string | undefined, designationId: undefined as string | undefined, skillIds: [] as string[], search: '', page: 1 });
const matrix = useAsync(() => skillsApi.matrix({ departmentId: filters.departmentId, designationId: filters.designationId, search: filters.search || undefined, page: filters.page, pageSize: 25 }, filters.skillIds));
let timer: ReturnType<typeof setTimeout> | undefined;
watch([() => filters.departmentId, () => filters.designationId, () => filters.skillIds.join(','), () => filters.page], () => void matrix.run());
watch(
  () => filters.search,
  () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.page = 1;
      void matrix.run();
    }, 300);
  },
);
const departments = useAsync(() => structureApi.departments());
const designations = useAsync(() => structureApi.designations());
const catalog = useAsync(() => skillsApi.list());
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const designationOptions = computed(() => (designations.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const skillOptions = computed(() => (catalog.data.value ?? []).filter((s) => !filters.skillIds.includes(s.id)).map((s) => ({ value: s.id, label: s.name })));
const pick = ref<string | null>(null);
watch(pick, (id) => {
  if (!id) return;
  filters.skillIds = [...filters.skillIds, id];
  pick.value = null;
});
const skillName = (id: string) => catalog.data.value?.find((s) => s.id === id)?.name ?? matrix.data.value?.skills.find((s) => s.id === id)?.name ?? '…';

function cellClass(c: MatrixCell) {
  if (!c.level) return c.required ? 'bg-red-500/10 text-red-700 ring-red-500/25 dark:text-red-300' : 'bg-surface text-fg-subtle ring-line';
  if (c.required === null) return 'bg-brand-500/10 text-brand-800 ring-brand-500/25 dark:text-brand-200';
  if (c.gap === 0) return 'bg-emerald-500/15 text-emerald-800 ring-emerald-500/30 dark:text-emerald-200';
  return c.gap === 1 ? 'bg-amber-500/15 text-amber-800 ring-amber-500/30 dark:text-amber-200' : 'bg-red-500/10 text-red-700 ring-red-500/25 dark:text-red-300';
}

// Verifying a level.
const verifying = ref<{ row: MatrixRow; cell: MatrixCell } | null>(null);
const verifyLevel = ref(3);
function openCell(row: MatrixRow, cell: MatrixCell) {
  verifying.value = { row, cell };
  verifyLevel.value = cell.verifiedLevel ?? cell.selfLevel ?? cell.required ?? 3;
}
const busy = ref(false);
async function verify() {
  const v = verifying.value!;
  busy.value = true;
  try {
    await skillsApi.verify(v.row.employee.id, v.cell.skillId, verifyLevel.value);
    feedback.success('Level verified', `${skillName(v.cell.skillId)} of ${v.row.employee.name}: ${SKILL_LEVEL_LABELS[verifyLevel.value]}.`);
    verifying.value = null;
    await matrix.run();
  } catch (e) {
    feedback.error('Could not verify the level', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Skill matrix" description="Who knows what across your people, against the levels their roles need. Click a cell to verify a level." />
    <AppTabs v-model="tab" :tabs="tabs">
      <AppCard v-if="tab === 'matrix'" :padded="false">
        <div class="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <AppSelect v-model="filters.departmentId" class="w-48" :options="departmentOptions" placeholder="All departments" aria-label="Filter by department" />
          <AppSelect v-model="filters.designationId" class="w-48" :options="designationOptions" placeholder="All roles" aria-label="Filter by role" />
          <AppSelect v-model="pick" class="w-52" :options="skillOptions" placeholder="Add a skill column…" searchable aria-label="Add a skill" />
          <AppSearchInput v-model="filters.search" class="min-w-48 flex-1" placeholder="Search people" aria-label="Search people" />
        </div>
        <div v-if="filters.skillIds.length" class="flex flex-wrap gap-1.5 border-b border-line px-4 py-2">
          <AppBadge v-for="id in filters.skillIds" :key="id" tone="brand">
            {{ skillName(id) }}
            <button type="button" class="ml-1 cursor-pointer" :aria-label="`Remove ${skillName(id)}`" @click="filters.skillIds = filters.skillIds.filter((x) => x !== id)">×</button>
          </AppBadge>
          <AppButton size="xs" variant="link" @click="filters.skillIds = []">Clear</AppButton>
        </div>
        <div class="p-4">
          <AppSkeleton v-if="matrix.loading.value && !matrix.data.value" :lines="8" />
          <AppErrorState v-else-if="matrix.error.value" :error="matrix.error.value" @retry="matrix.run" />
          <AppEmptyState v-else-if="!matrix.data.value?.skills.length" compact title="No skills to show" description="Pick skills, choose a role with requirements, or ask people to rate their skills." />
          <div v-else class="overflow-x-auto">
            <table class="w-full border-separate border-spacing-1 text-xs">
              <thead>
                <tr>
                  <th class="sticky left-0 z-10 bg-surface text-left font-medium text-fg-muted">Person</th>
                  <th v-for="s in matrix.data.value.skills" :key="s.id" class="min-w-24 align-bottom font-medium text-fg-muted">
                    <span class="block">{{ s.name }}</span>
                    <span class="block font-normal text-fg-subtle">{{ matrix.data.value.summary.find((x) => x.skillId === s.id)?.people ?? 0 }} people</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in matrix.data.value.page.items" :key="r.employee.id">
                  <th scope="row" class="sticky left-0 z-10 max-w-36 min-w-32 bg-surface pr-2 text-left font-normal sm:max-w-none sm:min-w-48">
                    <span class="block truncate text-sm font-medium text-fg">{{ r.employee.name }}</span>
                    <span class="block truncate text-fg-muted">{{ [r.employee.designation, r.employee.department].filter(Boolean).join(' · ') || r.employee.employeeCode }}</span>
                  </th>
                  <td v-for="c in r.cells" :key="c.skillId" class="p-0">
                    <button
                      type="button"
                      :class="['flex h-full w-full cursor-pointer flex-col items-center rounded-md px-1.5 py-1.5 ring-1 ring-inset transition hover:ring-brand-400', cellClass(c)]"
                      :aria-label="`${r.employee.name}, ${skillName(c.skillId)}: ${c.level ? SKILL_LEVEL_LABELS[c.level] : 'none'}${c.required ? `, needs ${SKILL_LEVEL_LABELS[c.required]}` : ''}${c.verifiedLevel ? ', verified' : ''}`"
                      @click="openCell(r, c)"
                    >
                      <span class="flex items-center gap-1 font-semibold tabular-nums">{{ c.level || '–' }}<span v-if="c.required" class="font-normal opacity-70">/{{ c.required }}</span><BadgeCheck v-if="c.verifiedLevel" :size="11" aria-hidden="true" /></span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
              <li class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-emerald-500/40" aria-hidden="true" />Meets the role</li>
              <li class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-amber-500/40" aria-hidden="true" />One level short</li>
              <li class="inline-flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-red-500/30" aria-hidden="true" />Further short</li>
              <li class="inline-flex items-center gap-1.5"><BadgeCheck :size="12" aria-hidden="true" />Verified</li>
              <li>“3/4” = level 3, the role needs 4</li>
            </ul>
          </div>
        </div>
        <div v-if="matrix.data.value && matrix.data.value.page.meta.totalPages > 1" class="border-t border-line p-3">
          <AppPagination :meta="matrix.data.value.page.meta" @change="(p: number) => (filters.page = p)" />
        </div>
      </AppCard>
      <SkillCatalogPanel v-else-if="tab === 'catalog'" @changed="catalog.run()" />
      <RoleRequirementsPanel v-else />
    </AppTabs>

    <AppModal :open="!!verifying" :title="verifying ? `${skillName(verifying.cell.skillId)} · ${verifying.row.employee.name}` : ''" size="sm" @close="verifying = null">
      <template v-if="verifying">
        <dl class="mb-4 grid grid-cols-3 gap-3 text-sm">
          <div><dt class="text-xs text-fg-muted">Own rating</dt><dd class="text-fg">{{ verifying.cell.selfLevel ? SKILL_LEVEL_LABELS[verifying.cell.selfLevel] : '—' }}</dd></div>
          <div><dt class="text-xs text-fg-muted">Verified</dt><dd class="text-fg">{{ verifying.cell.verifiedLevel ? SKILL_LEVEL_LABELS[verifying.cell.verifiedLevel] : '—' }}</dd></div>
          <div><dt class="text-xs text-fg-muted">Role needs</dt><dd class="text-fg">{{ verifying.cell.required ? SKILL_LEVEL_LABELS[verifying.cell.required] : '—' }}</dd></div>
        </dl>
        <p class="label">Verified level</p>
        <div class="flex items-center gap-3">
          <SkillLevel v-model="verifyLevel" editable label="Verified level" :required="verifying.cell.required" />
          <span class="text-sm text-fg-muted">{{ SKILL_LEVEL_LABELS[verifyLevel] }}</span>
        </div>
      </template>
      <template #footer>
        <AppButton variant="secondary" @click="verifying = null">Close</AppButton>
        <AppButton :loading="busy" @click="verify">Verify level</AppButton>
      </template>
    </AppModal>
  </div>
</template>
