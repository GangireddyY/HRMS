<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { LayoutGrid, Pencil, Plus, Rows3, Trash2 } from '@lucide/vue';
import { structureApi, type StructureKind } from '@/modules/people/api/people.api';
import StructureCard from '@/modules/people/components/StructureCard.vue';
import StructureFormModal from '@/modules/people/components/StructureFormModal.vue';
import type { CostCenter, Department, Designation, Grade, Location } from '@/modules/people/types';
import { STRUCTURE_VISUALS } from '@/modules/people/utils/structure-visuals';
import { AppBadge, AppButton, AppCard, AppDataTable, AppEmptyState, AppErrorState, AppPageHeader, AppSegmented, AppTabs, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

type Row = Department | Designation | Location | Grade | CostCenter;

const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('organization.structure.manage'));
const tab = ref<StructureKind>('departments');

const departments = useAsync(() => structureApi.departments());
const designations = useAsync(() => structureApi.designations());
const locations = useAsync(() => structureApi.locations());
const grades = useAsync(() => structureApi.grades());
const costCenters = useAsync(() => structureApi.costCenters());
const sources = { departments, designations, locations, grades, 'cost-centers': costCenters };
const current = computed(() => sources[tab.value]);
const rows = computed(() => (current.value.data.value ?? []) as Row[]);

const TAB_LABELS: Record<StructureKind, string> = { departments: 'Departments', designations: 'Designations', locations: 'Locations', grades: 'Grades', 'cost-centers': 'Cost centers' };
const tabs = computed(() =>
  (Object.keys(TAB_LABELS) as StructureKind[]).map((key) => ({ key, label: TAB_LABELS[key], icon: STRUCTURE_VISUALS[key].icon, count: sources[key].data.value?.length ?? null })),
);

const VIEW_KEY = 'hrms.structure.view';
const view = ref<'table' | 'grid'>(localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'table');
watch(view, (v) => localStorage.setItem(VIEW_KEY, v));
const viewOptions = [
  { value: 'table' as const, label: 'Table', icon: Rows3 },
  { value: 'grid' as const, label: 'Grid', icon: LayoutGrid },
];

const columns = computed<TableColumn<Row>[]>(() => {
  const base: TableColumn<Row>[] = [{ key: 'name', label: 'Name' }];
  if (tab.value === 'departments') base.push({ key: 'code', label: 'Code' }, { key: 'parent', label: 'Parent' });
  if (tab.value === 'designations') base.push({ key: 'level', label: 'Level', align: 'right' });
  if (tab.value === 'locations') base.push({ key: 'code', label: 'Code' }, { key: 'place', label: 'City' });
  if (tab.value === 'grades') base.push({ key: 'code', label: 'Code' }, { key: 'level', label: 'Level', align: 'right' });
  if (tab.value === 'cost-centers') base.push({ key: 'code', label: 'Code' });
  base.push({ key: 'employeeCount', label: 'Employees', align: 'right' }, { key: 'status', label: 'Status' });
  if (canManage.value) base.push({ key: 'actions', label: '', align: 'right' });
  return base;
});

const modalOpen = ref(false);
const editing = ref<Row | null>(null);
function openModal(row: Row | null = null) {
  editing.value = row;
  modalOpen.value = true;
}
async function onSaved() {
  modalOpen.value = false;
  feedback.success(editing.value ? 'Changes saved' : 'Created');
  await current.value.run();
  if (tab.value === 'departments') await departments.run();
}

async function remove(row: Row) {
  if (!(await feedback.confirm({ title: `Delete "${row.name}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await structureApi.remove(tab.value, row.id);
    feedback.success('Deleted');
    await current.value.run();
  } catch (e) {
    feedback.error('Could not delete', e);
  }
}

const singular: Record<StructureKind, string> = { departments: 'department', designations: 'designation', locations: 'location', grades: 'grade', 'cost-centers': 'cost center' };
const plural: Record<StructureKind, string> = { departments: 'departments', designations: 'designations', locations: 'locations', grades: 'grades', 'cost-centers': 'cost centers' };
</script>

<template>
  <div>
    <AppPageHeader title="Organization structure" description="Departments, designations, locations, grades and cost centers used across employee records, approvals, payroll and reports.">
      <template v-if="canManage" #actions>
        <AppButton :icon="Plus" @click="openModal()">New {{ singular[tab] }}</AppButton>
      </template>
    </AppPageHeader>
    <AppTabs v-model="tab" :tabs="tabs">
      <template #actions>
        <AppSegmented v-model="view" class="w-44 max-sm:w-auto" size="sm" :options="viewOptions" label="Layout" />
      </template>

      <div v-if="view === 'grid'" :aria-busy="current.loading.value || undefined">
        <AppCard v-if="current.error.value && !current.loading.value"><AppErrorState :error="current.error.value" @retry="current.run" /></AppCard>
        <ul v-else-if="current.loading.value && !rows.length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" :aria-label="`Loading ${plural[tab]}`">
          <li v-for="i in 8" :key="i" class="card space-y-3 p-4">
            <div class="flex items-center gap-3">
              <div class="skeleton h-11 w-11 rounded-lg" />
              <div class="flex-1 space-y-2">
                <div class="skeleton h-3.5 w-2/3 rounded-full" />
                <div class="skeleton h-3 w-1/3 rounded-full" />
              </div>
            </div>
            <div class="skeleton h-3 w-3/4 rounded-full" />
            <div class="skeleton h-8 rounded-md" />
          </li>
        </ul>
        <ul v-else-if="rows.length" :class="['grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4', current.loading.value && 'opacity-60']" :aria-label="TAB_LABELS[tab]">
          <li v-for="r in rows" :key="r.id">
            <StructureCard :kind="tab" :row="r" :can-manage="canManage" @edit="openModal(r)" @remove="remove(r)" />
          </li>
        </ul>
        <AppCard v-else>
          <AppEmptyState :icon="STRUCTURE_VISUALS[tab].icon" :title="`No ${plural[tab]} yet`" :description="canManage ? `Create your first ${singular[tab]} to organize employees.` : undefined">
            <AppButton v-if="canManage" :icon="Plus" @click="openModal()">New {{ singular[tab] }}</AppButton>
          </AppEmptyState>
        </AppCard>
      </div>

      <AppCard v-else :padded="false">
        <AppDataTable
          :grid="false"
          :columns="columns"
          :rows="rows"
          :loading="current.loading.value"
          :error="current.error.value"
          :caption="TAB_LABELS[tab]"
          :empty-title="`No ${plural[tab]} yet`"
          :empty-description="canManage ? `Create your first ${singular[tab]} to organize employees.` : undefined"
          @retry="current.run"
        >
          <template #empty><AppButton v-if="canManage" :icon="Plus" @click="openModal()">New {{ singular[tab] }}</AppButton></template>
          <template #cell-name="{ row }">
            <div class="flex items-center gap-3">
              <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', STRUCTURE_VISUALS[tab].tile]" aria-hidden="true">
                <component :is="STRUCTURE_VISUALS[tab].icon" :size="16" />
              </span>
              <div class="min-w-0">
                <p class="font-medium text-fg">{{ row.name }}</p>
                <p v-if="'description' in row && row.description" class="max-w-md truncate text-xs text-fg-muted">{{ row.description }}</p>
              </div>
            </div>
          </template>
          <template #cell-code="{ row }"><span class="font-mono text-xs text-fg-muted">{{ ('code' in row && row.code) || '—' }}</span></template>
          <template #cell-parent="{ row }"><span class="text-fg-muted">{{ ('parentName' in row && row.parentName) || '—' }}</span></template>
          <template #cell-level="{ row }"><span class="tabular-nums">{{ ('level' in row && row.level) || '—' }}</span></template>
          <template #cell-place="{ row }"><span class="text-fg-muted">{{ 'city' in row ? [row.city, row.country].filter(Boolean).join(', ') || '—' : '—' }}</span></template>
          <template #cell-employeeCount="{ row }"><span class="tabular-nums">{{ row.employeeCount }}</span></template>
          <template #cell-status="{ row }"><AppBadge :tone="row.isActive ? 'success' : 'neutral'" dot>{{ row.isActive ? 'Active' : 'Inactive' }}</AppBadge></template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-1">
              <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.name}`" @click="openModal(row)" />
              <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.name}`" @click="remove(row)" />
            </div>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <StructureFormModal :open="modalOpen" :kind="tab" :row="editing" :departments="departments.data.value ?? []" @close="modalOpen = false" @saved="onSaved" />
  </div>
</template>
