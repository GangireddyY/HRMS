<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { FilterX, LayoutGrid, Lock, Plus, Rows3, SearchX, ShieldCheck } from '@lucide/vue';
import { rolesApi } from '@/modules/roles/api/roles.api';
import RoleCard from '@/modules/roles/components/RoleCard.vue';
import type { RoleSummary } from '@/modules/roles/types';
import { roleVisual } from '@/modules/roles/utils/role-visuals';
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppCard,
  AppDataTable,
  AppEmptyState,
  AppErrorState,
  AppInput,
  AppModal,
  AppPageHeader,
  AppSearchInput,
  AppSegmented,
  AppSelect,
  AppTextarea,
  type TableColumn,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const feedback = useFeedbackStore();
const roles = useAsync(() => rolesApi.list());
const createOpen = ref(false);
const creating = ref(false);
const form = reactive({ name: '', description: '' });
const { fieldErrors, formError, handle, reset } = useFormErrors();

const columns: TableColumn<RoleSummary>[] = [
  { key: 'name', label: 'Role' },
  { key: 'type', label: 'Type' },
  { key: 'memberCount', label: 'Users', align: 'right' },
  { key: 'permissionCount', label: 'Permissions', align: 'right' },
  { key: 'updatedAt', label: 'Updated' },
];

const VIEW_KEY = 'hrms.roles.view';
const view = ref<'table' | 'grid'>(localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'table');
watch(view, (v) => localStorage.setItem(VIEW_KEY, v));
const viewOptions = [
  { value: 'table' as const, label: 'Table', icon: Rows3 },
  { value: 'grid' as const, label: 'Grid', icon: LayoutGrid },
];

// The full list of roles is small and comes in one response, so search and the type filter run here.
const search = ref('');
const type = ref<'system' | 'custom' | undefined>(undefined);
const typeOptions = [
  { label: 'System roles', value: 'system' as const },
  { label: 'Custom roles', value: 'custom' as const },
];
const filtered = computed(() => !!search.value.trim() || !!type.value);
const shown = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (roles.data.value ?? []).filter(
    (r) => (!type.value || r.isSystem === (type.value === 'system')) && (!q || r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)),
  );
});
function clearFilters() {
  search.value = '';
  type.value = undefined;
}

function openCreate() {
  reset();
  Object.assign(form, { name: '', description: '' });
  createOpen.value = true;
}

/** "New role" elsewhere (e.g. the role page side menu) links here with ?new=1. */
onMounted(() => {
  if (route.query.new === undefined) return;
  void router.replace({ query: {} });
  if (auth.can('role.manage')) openCreate();
});

async function create() {
  reset();
  creating.value = true;
  try {
    const role = await rolesApi.create({ name: form.name.trim(), description: form.description.trim() || undefined, permissions: [] });
    createOpen.value = false;
    feedback.success('Role created', 'Now choose its permissions.');
    await router.push(`/admin/roles/${role.id}`);
  } catch (e) {
    handle(e, 'Could not create role');
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Roles & permissions" description="System roles are provisioned for every organization; create custom roles for specific needs.">
      <template #actions><AppButton v-if="auth.can('role.manage')" :icon="Plus" @click="openCreate">New role</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px] lg:grid-cols-[1fr_200px_auto]">
        <AppSearchInput v-model="search" placeholder="Search roles" aria-label="Search roles" />
        <AppSelect v-model="type" :options="typeOptions" placeholder="All roles" aria-label="Filter by type" />
        <AppSegmented v-model="view" class="sm:col-span-2 lg:col-span-1 lg:w-48" :options="viewOptions" label="Layout" />
      </div>

      <div v-if="view === 'grid'" :aria-busy="roles.loading.value || undefined">
        <AppErrorState v-if="roles.error.value && !roles.loading.value" :error="roles.error.value" @retry="roles.run" />
        <ul v-else-if="roles.loading.value && !roles.data.value" class="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-label="Loading roles">
          <li v-for="i in 8" :key="i" class="card space-y-3 p-4">
            <div class="flex items-center gap-3">
              <div class="skeleton h-11 w-11 rounded-lg" />
              <div class="flex-1 space-y-2">
                <div class="skeleton h-3.5 w-2/3 rounded-full" />
                <div class="skeleton h-3 w-1/4 rounded-full" />
              </div>
            </div>
            <div class="skeleton h-3 w-full rounded-full" />
            <div class="grid grid-cols-2 gap-2"><div class="skeleton h-14 rounded-md" /><div class="skeleton h-14 rounded-md" /></div>
          </li>
        </ul>
        <ul v-else-if="shown.length" class="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <li v-for="r in shown" :key="r.id"><RoleCard :role="r" /></li>
        </ul>
        <AppEmptyState v-else-if="filtered" :icon="SearchX" title="No matches" description="No role matches your search or filter.">
          <AppButton variant="secondary" size="sm" :icon="FilterX" @click="clearFilters">Clear filters</AppButton>
        </AppEmptyState>
        <AppEmptyState v-else :icon="ShieldCheck" title="No roles yet">
          <AppButton v-if="auth.can('role.manage')" :icon="Plus" @click="openCreate">New role</AppButton>
        </AppEmptyState>
      </div>

      <AppDataTable
        v-else
        :grid="false"
        :columns="columns"
        :rows="shown"
        :loading="roles.loading.value"
        :error="roles.error.value"
        clickable
        caption="Roles"
        :filtered="filtered"
        @clear="clearFilters"
        @retry="roles.run"
        @row-click="(row) => router.push(`/admin/roles/${row.id}`)"
      >
        <template #empty><AppButton v-if="auth.can('role.manage')" :icon="Plus" @click="openCreate">New role</AppButton></template>
        <template #cell-name="{ row }">
          <div class="flex items-center gap-3">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', roleVisual(row.key).tile]" aria-hidden="true">
              <component :is="roleVisual(row.key).icon" :size="17" />
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-2 font-medium text-fg">{{ row.name }} <Lock v-if="row.isLocked" :size="13" class="text-fg-subtle" aria-label="Locked" /></p>
              <p v-if="row.description" class="max-w-md truncate text-xs text-fg-muted">{{ row.description }}</p>
            </div>
          </div>
        </template>
        <template #cell-type="{ row }"><AppBadge :tone="row.isSystem ? 'neutral' : 'info'">{{ row.isSystem ? 'System' : 'Custom' }}</AppBadge></template>
        <template #cell-updatedAt="{ row }"><span class="text-fg-muted">{{ timeAgo(row.updatedAt) }}</span></template>
      </AppDataTable>
    </AppCard>

    <AppModal :open="createOpen" title="New role" description="You'll configure permissions on the next screen." @close="createOpen = false">
      <form id="create-role" class="space-y-4" novalidate @submit.prevent="create">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppInput v-model="form.name" label="Role name" required autofocus :error="fieldErrors.name" />
        <AppTextarea v-model="form.description" label="Description" :maxlength="500" :error="fieldErrors.description" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="createOpen = false">Cancel</AppButton>
        <AppButton type="submit" form="create-role" :loading="creating" :disabled="form.name.trim().length < 2">Create role</AppButton>
      </template>
    </AppModal>
  </div>
</template>
