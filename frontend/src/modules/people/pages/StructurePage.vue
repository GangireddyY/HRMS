<script setup lang="ts">
import { computed, ref } from 'vue';
import { Pencil, Plus, Trash2 } from '@lucide/vue';
import { structureApi, type StructureKind } from '@/modules/people/api/people.api';
import StructureFormModal from '@/modules/people/components/StructureFormModal.vue';
import type { Department, Designation, Location } from '@/modules/people/types';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppTabs, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

type Row = Department | Designation | Location;

const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = computed(() => auth.can('organization.structure.manage'));
const tab = ref<StructureKind>('departments');
const tabs = [
  { key: 'departments', label: 'Departments' },
  { key: 'designations', label: 'Designations' },
  { key: 'locations', label: 'Locations' },
];

const departments = useAsync(() => structureApi.departments());
const designations = useAsync(() => structureApi.designations());
const locations = useAsync(() => structureApi.locations());
const sources = { departments, designations, locations };
const current = computed(() => sources[tab.value]);

const columns = computed<TableColumn<Row>[]>(() => {
  const base: TableColumn<Row>[] = [{ key: 'name', label: 'Name' }];
  if (tab.value === 'departments') base.push({ key: 'code', label: 'Code' }, { key: 'parent', label: 'Parent' });
  if (tab.value === 'designations') base.push({ key: 'level', label: 'Level', align: 'right' });
  if (tab.value === 'locations') base.push({ key: 'code', label: 'Code' }, { key: 'place', label: 'City' });
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

const singular: Record<StructureKind, string> = { departments: 'department', designations: 'designation', locations: 'location' };
</script>

<template>
  <div>
    <AppPageHeader title="Organization structure" description="Departments, designations and locations used across employee records, approvals and reports.">
      <template v-if="canManage" #actions>
        <AppButton :icon="Plus" @click="openModal()">New {{ singular[tab] }}</AppButton>
      </template>
    </AppPageHeader>
    <AppTabs v-model="tab" :tabs="tabs">
      <AppCard :padded="false">
        <AppDataTable
          :columns="columns"
          :rows="(current.data.value ?? []) as Row[]"
          :loading="current.loading.value"
          :error="current.error.value"
          :caption="tabs.find((t) => t.key === tab)!.label"
          :empty-title="`No ${tab} yet`"
          :empty-description="canManage ? `Create your first ${singular[tab]} to organize employees.` : undefined"
          @retry="current.run"
        >
          <template #cell-name="{ row }">
            <p class="font-medium text-fg">{{ row.name }}</p>
            <p v-if="'description' in row && row.description" class="max-w-md truncate text-xs text-fg-muted">{{ row.description }}</p>
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
