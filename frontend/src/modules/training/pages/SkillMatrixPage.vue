<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { AlertTriangle, ArrowDown, BadgeCheck, Check, ClipboardCheck, Grid3x3, Library, ShieldCheck, Target, TriangleAlert, Users, X } from '@lucide/vue';
import { SKILL_LEVEL_LABELS } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { useAuthStore } from '@/core/auth/auth.store';
import { structureApi } from '@/modules/people/api/people.api';
import { SKILL_CATEGORY_LABELS, skillsApi } from '@/modules/training/api/skills.api';
import RoleRequirementsPanel from '@/modules/training/components/RoleRequirementsPanel.vue';
import SkillCatalogPanel from '@/modules/training/components/SkillCatalogPanel.vue';
import SkillLevel from '@/modules/training/components/SkillLevel.vue';
import SkillMatrixCell from '@/modules/training/components/SkillMatrixCell.vue';
import type { MatrixCell, MatrixRow } from '@/modules/training/types';
import {
  AppAlert,
  AppAvatar,
  AppButton,
  AppEmptyState,
  AppErrorState,
  AppModal,
  AppPageHeader,
  AppPagination,
  AppSearchInput,
  AppSegmented,
  AppSelect,
  AppSkeleton,
  AppTabs,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Skill matrix of the people in scope, the skills catalog and the skills each role needs. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const manage = auth.can('training.manage');
const tab = ref('matrix');
const tabs = [
  { key: 'matrix', label: 'Matrix', icon: Grid3x3 },
  ...(manage ? [{ key: 'catalog', label: 'Skills catalog', icon: Library }, { key: 'roles', label: 'Role requirements', icon: ClipboardCheck }] : []),
];

const filters = reactive({
  departmentId: undefined as string | undefined,
  designationId: undefined as string | undefined,
  skillIds: [] as string[],
  search: '',
  show: 'all' as 'all' | 'gaps',
  sort: 'name:asc',
  page: 1,
});
const matrix = useAsync(() =>
  skillsApi.matrix(
    {
      departmentId: filters.departmentId,
      designationId: filters.designationId,
      search: filters.search || undefined,
      gapsOnly: filters.show === 'gaps' || undefined,
      sort: filters.sort === 'name:asc' ? undefined : filters.sort,
      page: filters.page,
      pageSize: 25,
    },
    filters.skillIds,
  ),
);
let timer: ReturnType<typeof setTimeout> | undefined;
watch([() => filters.departmentId, () => filters.designationId, () => filters.skillIds.join(','), () => filters.show, () => filters.sort], () => {
  if (filters.page !== 1) filters.page = 1;
  else void matrix.run();
});
watch(() => filters.page, () => void matrix.run());
watch(
  () => filters.search,
  () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (filters.page !== 1) filters.page = 1;
      else void matrix.run();
    }, 300);
  },
);
const isFiltered = computed(() => !!(filters.departmentId || filters.designationId || filters.skillIds.length || filters.search || filters.show !== 'all'));
function clearFilters() {
  Object.assign(filters, { departmentId: undefined, designationId: undefined, skillIds: [], search: '', show: 'all' });
}

const departments = useAsync(() => structureApi.departments());
const designations = useAsync(() => structureApi.designations());
const catalog = useAsync(() => skillsApi.list());
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const designationOptions = computed(() => (designations.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const skillOptions = computed(() =>
  (catalog.data.value ?? []).filter((s) => !filters.skillIds.includes(s.id)).map((s) => ({ value: s.id, label: s.name, description: SKILL_CATEGORY_LABELS[s.category] })),
);
const pick = ref<string | null>(null);
watch(pick, (id) => {
  if (!id) return;
  filters.skillIds = [...filters.skillIds, id];
  pick.value = null;
});
const skillName = (id: string) => catalog.data.value?.find((s) => s.id === id)?.name ?? matrix.data.value?.skills.find((s) => s.id === id)?.name ?? '…';
const showOptions = [
  { value: 'all' as const, label: 'Everyone' },
  { value: 'gaps' as const, label: 'Gaps only' },
];
const sortOptions = [
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'readiness:asc', label: 'Least ready first' },
  { value: 'readiness:desc', label: 'Most ready first' },
];

// ---- Headline figures ------------------------------------------------------------------------------------------
const num = (n: number) => n.toLocaleString(appLocale());
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : null);
const totals = computed(() => matrix.data.value?.totals ?? null);
const readinessPct = computed(() => (totals.value ? pct(totals.value.met, totals.value.requirements) : null));
const verifiedPct = computed(() => (totals.value ? pct(totals.value.verified, totals.value.ratings) : null));
type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info';
const toneFor = (p: number | null): Tone => (p === null ? 'brand' : p >= 80 ? 'success' : p >= 50 ? 'warning' : 'danger');
interface Kpi {
  label: string;
  value: string | null;
  hint: string | undefined;
  icon: typeof Users;
  tone: Tone;
  /** 0–100 progress shown under the figure, or null for none. */
  bar: number | null;
}
const kpis = computed((): Kpi[] => {
  const t = totals.value;
  return [
    { label: 'People in scope', value: t ? num(t.people) : null, hint: t ? `${num(t.ratings)} skill ratings recorded` : undefined, icon: Users, tone: 'brand', bar: null },
    {
      label: 'Role readiness',
      value: readinessPct.value === null ? '—' : `${readinessPct.value}%`,
      hint: t ? (t.requirements ? `${num(t.met)} of ${num(t.requirements)} requirements met` : 'No role needs these skills') : undefined,
      icon: Target,
      tone: toneFor(readinessPct.value),
      bar: readinessPct.value,
    },
    {
      label: 'Skill gaps',
      value: t ? num(t.gaps) : null,
      hint: t ? `${num(t.critical)} critical · 2+ levels short` : undefined,
      icon: TriangleAlert,
      tone: t && t.critical ? 'danger' : t && t.gaps ? 'warning' : 'success',
      bar: null,
    },
    {
      label: 'Verified ratings',
      value: verifiedPct.value === null ? '—' : `${verifiedPct.value}%`,
      hint: t ? `${num(t.verified)} of ${num(t.ratings)} confirmed by a manager or course` : undefined,
      icon: ShieldCheck,
      tone: 'info',
      bar: verifiedPct.value,
    },
  ];
});
const CHIP: Record<Tone, string> = {
  brand: 'bg-accent-soft text-accent-fg',
  success: 'bg-success-soft text-success-fg',
  warning: 'bg-warning-soft text-warning-fg',
  danger: 'bg-danger-soft text-danger-fg',
  info: 'bg-info-soft text-info-fg',
};
const BAR: Record<Tone, string> = { brand: 'bg-brand-500', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info' };
const summaryOf = (skillId: string) => matrix.data.value?.summary.find((x) => x.skillId === skillId);
const barClass = (p: number) => (p >= 80 ? 'bg-success' : p >= 50 ? 'bg-warning' : 'bg-danger');
const READINESS_TEXT = (p: number) => (p >= 80 ? 'text-success-fg' : p >= 50 ? 'text-warning-fg' : 'text-danger-fg');
/** The skill column under the pointer, highlighted with its header. */
const hoverCol = ref<string | null>(null);

// ---- Verifying a level -----------------------------------------------------------------------------------------
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
const verdict = computed(() => {
  const v = verifying.value;
  if (!v?.cell.required) return null;
  const gap = v.cell.required - verifyLevel.value;
  if (gap <= 0) return { tone: 'success' as const, text: `At ${SKILL_LEVEL_LABELS[verifyLevel.value]}, ${v.row.employee.name} meets what the role needs.` };
  return { tone: gap >= 2 ? ('error' as const) : ('warning' as const), text: `At ${SKILL_LEVEL_LABELS[verifyLevel.value]}, ${v.row.employee.name} is ${gap} level${gap === 1 ? '' : 's'} below what the role needs.` };
});
</script>

<template>
  <div>
    <AppPageHeader title="Skill matrix" description="Who knows what across your people, measured against the levels their roles need. Select a cell to review and verify a level." />
    <AppTabs v-model="tab" :tabs="tabs">
      <div v-if="tab === 'matrix'">
        <!-- One card: summary, toolbar, matrix and a sticky footer (no overflow clipping, so the footer can stick). -->
        <section class="card flex flex-col">
          <!-- Headline figures for everyone in scope (all pages), for the skills shown. -->
          <dl class="grid gap-px overflow-hidden rounded-t-md border-b border-line/70 bg-line/70 sm:grid-cols-2 xl:grid-cols-4">
            <div v-for="k in kpis" :key="k.label" class="flex items-start gap-3 bg-surface px-5 py-4">
              <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', CHIP[k.tone]]" aria-hidden="true"><component :is="k.icon" :size="17" /></span>
              <div class="min-w-0 flex-1">
                <dt class="text-xs font-medium text-fg-muted">{{ k.label }}</dt>
                <dd>
                  <div v-if="matrix.loading.value && !totals" class="skeleton mt-1 h-7 w-16 rounded-md" />
                  <p v-else class="mt-0.5 text-2xl font-semibold tracking-tight text-fg tabular-nums">{{ k.value ?? '—' }}</p>
                  <div v-if="k.bar !== null" class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                    <div :class="['h-full rounded-full transition-[width] duration-500', BAR[k.tone]]" :style="{ width: `${k.bar}%` }" />
                  </div>
                  <p class="mt-1.5 truncate text-2xs text-fg-subtle" :title="k.hint">{{ k.hint }}</p>
                </dd>
              </div>
            </div>
          </dl>

          <div class="flex flex-wrap items-center gap-2 px-4 py-3">
            <AppSearchInput v-model="filters.search" class="w-full sm:w-56" placeholder="Search people or ID" aria-label="Search people" />
            <AppSelect v-model="filters.departmentId" class="w-40 max-sm:flex-1" :options="departmentOptions" placeholder="All departments" aria-label="Filter by department" />
            <AppSelect v-model="filters.designationId" class="w-40 max-sm:flex-1" :options="designationOptions" placeholder="All roles" aria-label="Filter by role" />
            <AppSelect v-model="pick" class="w-44 max-sm:w-full" :options="skillOptions" placeholder="+ Add skill column" searchable aria-label="Add a skill column" />
            <div class="flex flex-wrap items-center gap-2 xl:ms-auto">
              <AppSegmented v-model="filters.show" class="w-44" :options="showOptions" label="Who to show" />
              <AppSelect v-model="filters.sort" class="w-44" :options="sortOptions" :clearable="false" :searchable="false" aria-label="Sort people" />
            </div>
          </div>
          <div v-if="filters.skillIds.length || isFiltered" class="flex flex-wrap items-center gap-1.5 px-4 pb-3">
            <div v-if="filters.skillIds.length" class="flex flex-wrap items-center gap-1.5">
              <span
                v-for="id in filters.skillIds"
                :key="id"
                class="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 ps-2.5 pe-1 text-xs font-medium text-accent-fg ring-1 ring-brand-500/20 ring-inset"
              >
                {{ skillName(id) }}
                <button type="button" class="rounded-full p-0.5 hover:bg-brand-500/15" :aria-label="`Remove ${skillName(id)} column`" @click="filters.skillIds = filters.skillIds.filter((x) => x !== id)">
                  <X :size="12" aria-hidden="true" />
                </button>
              </span>
            </div>
            <AppButton v-if="isFiltered" size="xs" variant="link" @click="clearFilters">Clear filters</AppButton>
          </div>

          <div class="border-t border-line/70">
            <AppSkeleton v-if="matrix.loading.value && !matrix.data.value" class="p-4" :lines="8" />
            <AppErrorState v-else-if="matrix.error.value" :error="matrix.error.value" @retry="matrix.run" />
            <AppEmptyState
              v-else-if="!matrix.data.value?.skills.length"
              compact
              :icon="Grid3x3"
              title="No skills to show"
              description="Add skill columns, choose a role with requirements, or ask people to rate their skills."
            />
            <AppEmptyState
              v-else-if="!matrix.data.value.page.items.length"
              compact
              :icon="filters.show === 'gaps' ? Check : Users"
              :title="filters.show === 'gaps' ? 'No gaps — everyone meets their role' : 'No people match'"
              :description="filters.show === 'gaps' ? 'Nobody in scope is below a level their role needs for these skills.' : 'Try another department, role or search.'"
            >
              <AppButton v-if="isFiltered" size="sm" variant="secondary" @click="clearFilters">Clear filters</AppButton>
            </AppEmptyState>
            <template v-else>
              <!-- All rows show (the page scrolls); with many skill columns it scrolls sideways, the person column frozen. -->
              <div :class="['overflow-x-auto', matrix.loading.value && 'opacity-60 transition-opacity']" @mouseleave="hoverCol = null">
                <table class="w-full border-separate border-spacing-0 text-xs" :aria-busy="matrix.loading.value || undefined">
                  <caption class="sr-only">Skill levels by person; each cell shows the level, what the role needs and whether it is verified</caption>
                  <thead>
                    <tr>
                      <th scope="col" class="sticky start-0 z-20 min-w-60 border-b border-line bg-surface-muted px-4 py-3 text-start align-bottom text-2xs font-semibold tracking-wider text-fg-muted uppercase">
                        Person
                      </th>
                      <th scope="col" class="w-36 min-w-36 border-b border-line bg-surface-muted px-3 py-3 text-start align-bottom text-2xs font-semibold tracking-wider text-fg-muted uppercase">Readiness</th>
                      <th
                        v-for="s in matrix.data.value.skills"
                        :key="s.id"
                        scope="col"
                        :class="['min-w-32 border-b border-line px-2 py-3 text-center align-bottom font-normal transition-colors', hoverCol === s.id ? 'bg-brand-500/8' : 'bg-surface-muted']"
                        @mouseenter="hoverCol = s.id"
                      >
                        <span class="block truncate text-xs font-semibold text-fg" :title="s.name">{{ s.name }}</span>
                        <span class="block truncate text-2xs text-fg-subtle">{{ SKILL_CATEGORY_LABELS[s.category] }}</span>
                        <template v-if="summaryOf(s.id)?.required">
                          <span class="mx-auto mt-2 block h-1 w-20 overflow-hidden rounded-full bg-line" aria-hidden="true">
                            <span :class="['block h-full rounded-full', barClass(pct(summaryOf(s.id)!.meeting, summaryOf(s.id)!.required)!)]" :style="{ width: `${pct(summaryOf(s.id)!.meeting, summaryOf(s.id)!.required)}%` }" />
                          </span>
                          <span class="mt-1 block text-2xs text-fg-muted tabular-nums">{{ summaryOf(s.id)!.meeting }} of {{ summaryOf(s.id)!.required }} meet</span>
                        </template>
                        <span v-else class="mt-2 block text-2xs text-fg-muted tabular-nums">
                          {{ summaryOf(s.id)?.people ?? 0 }} {{ summaryOf(s.id)?.people === 1 ? 'person' : 'people' }}{{ summaryOf(s.id)?.average ? ` · avg ${summaryOf(s.id)!.average}` : '' }}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in matrix.data.value.page.items" :key="r.employee.id" class="group/row">
                      <th scope="row" class="sticky start-0 z-10 border-b border-line/60 bg-surface px-4 py-2 text-start font-normal transition-colors group-hover/row:bg-surface-muted">
                        <div class="flex items-center gap-3">
                          <AppAvatar :name="r.employee.name" size="md" />
                          <div class="min-w-0">
                            <p class="truncate text-sm font-medium text-fg">{{ r.employee.name }}</p>
                            <p class="truncate text-xs text-fg-muted">{{ [r.employee.designation, r.employee.department].filter(Boolean).join(' · ') || r.employee.employeeCode }}</p>
                          </div>
                        </div>
                      </th>
                      <td class="border-b border-line/60 px-3 py-2 transition-colors group-hover/row:bg-surface-muted/60">
                        <template v-if="r.readiness !== null">
                          <div class="flex items-center gap-2">
                            <span :class="['w-9 text-sm font-semibold tabular-nums', READINESS_TEXT(r.readiness)]">{{ r.readiness }}%</span>
                            <span class="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                              <span :class="['block h-full rounded-full', barClass(r.readiness)]" :style="{ width: `${Math.max(r.readiness, 4)}%` }" />
                            </span>
                          </div>
                          <p class="mt-0.5 text-2xs text-fg-muted">
                            <template v-if="r.gaps">{{ r.gaps }} gap{{ r.gaps === 1 ? '' : 's' }}<span v-if="r.critical" class="text-danger-fg"> · {{ r.critical }} critical</span></template>
                            <template v-else>All met</template>
                          </p>
                        </template>
                        <span v-else class="text-2xs text-fg-subtle" title="The role needs none of the skills shown">Not required</span>
                      </td>
                      <td
                        v-for="c in r.cells"
                        :key="c.skillId"
                        :class="['border-b border-line/60 px-2 py-2 transition-colors', hoverCol === c.skillId ? 'bg-brand-500/5' : 'group-hover/row:bg-surface-muted/60']"
                        @mouseenter="hoverCol = c.skillId"
                      >
                        <SkillMatrixCell :cell="c" :person="r.employee.name" :skill="skillName(c.skillId)" @open="openCell(r, c)" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>

          <!-- Sticks to the bottom of the screen: legend and paging stay in view while the page scrolls. -->
          <footer
            v-if="matrix.data.value?.skills.length"
            class="sticky bottom-0 z-30 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-b-md border-t border-line bg-surface/95 ps-4 shadow-[0_-4px_12px_-6px_rgb(0_0_0/0.08)] backdrop-blur"
          >
            <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-1.5 py-2 text-xs text-fg-muted">
                <ul class="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legend">
                  <li class="inline-flex items-center gap-1.5"><span class="inline-flex h-4 w-4 items-center justify-center rounded bg-success-soft text-success-fg ring-1 ring-success/30 ring-inset"><Check :size="10" /></span>Meets the role</li>
                  <li class="inline-flex items-center gap-1.5"><span class="inline-flex h-4 w-4 items-center justify-center rounded bg-warning-soft text-warning-fg ring-1 ring-warning/35 ring-inset"><ArrowDown :size="10" /></span>One level short</li>
                  <li class="inline-flex items-center gap-1.5"><span class="inline-flex h-4 w-4 items-center justify-center rounded bg-danger-soft text-danger-fg ring-1 ring-danger/30 ring-inset"><AlertTriangle :size="10" /></span>Two or more short</li>
                  <li class="inline-flex items-center gap-1.5"><span class="h-4 w-4 rounded bg-accent-soft ring-1 ring-brand-500/25 ring-inset" />Has the skill (not required)</li>
                  <li class="inline-flex items-center gap-1.5"><span class="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true"><span class="h-1 w-1 rounded-full bg-fg-subtle" /></span>Not rated</li>
                  <li class="inline-flex items-center gap-1.5"><BadgeCheck :size="13" />Verified</li>
                  <li><span class="font-semibold text-fg tabular-nums">3 / 4</span> = has level 3, role needs 4</li>
                </ul>
                <ol class="flex flex-wrap gap-x-3 gap-y-1" aria-label="Proficiency levels">
                  <li v-for="n in 5" :key="n"><span class="font-semibold text-fg tabular-nums">{{ n }}</span> {{ SKILL_LEVEL_LABELS[n] }}</li>
                </ol>
            </div>
            <AppPagination
              v-if="matrix.data.value.page.meta.total > 0"
              class="shrink-0 max-sm:w-full"
              :meta="matrix.data.value.page.meta"
              :disabled="matrix.loading.value"
              @change="(p: number) => (filters.page = p)"
            />
          </footer>
        </section>
      </div>
      <SkillCatalogPanel v-else-if="tab === 'catalog'" @changed="catalog.run()" />
      <RoleRequirementsPanel v-else />
    </AppTabs>

    <AppModal :open="!!verifying" :title="verifying ? skillName(verifying.cell.skillId) : ''" :description="verifying ? `${verifying.row.employee.name} · ${[verifying.row.employee.designation, verifying.row.employee.department].filter(Boolean).join(' · ')}` : undefined" size="md" dialog @close="verifying = null">
      <template v-if="verifying">
        <dl class="mb-5 grid grid-cols-3 gap-2">
          <div class="rounded-md bg-surface-muted/70 p-3">
            <dt class="text-2xs font-medium text-fg-muted">Own rating</dt>
            <dd class="mt-1 text-sm font-semibold text-fg">{{ verifying.cell.selfLevel ? SKILL_LEVEL_LABELS[verifying.cell.selfLevel] : '—' }}</dd>
            <dd class="mt-1.5"><SkillLevel :model-value="verifying.cell.selfLevel" size="sm" label="Own rating" /></dd>
          </div>
          <div class="rounded-md bg-surface-muted/70 p-3">
            <dt class="flex items-center gap-1 text-2xs font-medium text-fg-muted">Verified <BadgeCheck v-if="verifying.cell.verifiedLevel" :size="11" /></dt>
            <dd class="mt-1 text-sm font-semibold text-fg">{{ verifying.cell.verifiedLevel ? SKILL_LEVEL_LABELS[verifying.cell.verifiedLevel] : '—' }}</dd>
            <dd class="mt-1.5"><SkillLevel :model-value="verifying.cell.verifiedLevel" size="sm" label="Verified level" /></dd>
          </div>
          <div class="rounded-md bg-surface-muted/70 p-3">
            <dt class="text-2xs font-medium text-fg-muted">Role needs</dt>
            <dd class="mt-1 text-sm font-semibold text-fg">{{ verifying.cell.required ? SKILL_LEVEL_LABELS[verifying.cell.required] : 'Not required' }}</dd>
            <dd class="mt-1.5"><SkillLevel :model-value="verifying.cell.required" size="sm" label="Required level" /></dd>
          </div>
        </dl>
        <p class="label">Verified level</p>
        <div class="flex items-center gap-3">
          <SkillLevel v-model="verifyLevel" editable label="Verified level" :required="verifying.cell.required" />
          <span class="text-sm font-medium text-fg">{{ verifyLevel }} · {{ SKILL_LEVEL_LABELS[verifyLevel] }}</span>
        </div>
        <AppAlert v-if="verdict" class="mt-4" :tone="verdict.tone">{{ verdict.text }}</AppAlert>
      </template>
      <template #footer>
        <AppButton variant="secondary" @click="verifying = null">Close</AppButton>
        <AppButton :icon="BadgeCheck" :loading="busy" @click="verify">Verify level</AppButton>
      </template>
    </AppModal>
  </div>
</template>
