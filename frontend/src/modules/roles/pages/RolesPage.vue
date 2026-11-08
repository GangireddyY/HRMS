<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Lock, Plus } from '@lucide/vue';
import { rolesApi } from '@/modules/roles/api/roles.api';
import type { RoleSummary } from '@/modules/roles/types';
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppCard,
  AppDataTable,
  AppInput,
  AppModal,
  AppPageHeader,
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
      <AppDataTable
        :columns="columns"
        :rows="roles.data.value ?? []"
        :loading="roles.loading.value"
        :error="roles.error.value"
        clickable
        caption="Roles"
        @retry="roles.run"
        @row-click="(row) => router.push(`/admin/roles/${row.id}`)"
      >
        <template #empty><AppButton v-if="auth.can('role.manage')" :icon="Plus" @click="openCreate">New role</AppButton></template>
        <template #cell-name="{ row }">
          <p class="flex items-center gap-2 font-medium text-fg">{{ row.name }} <Lock v-if="row.isLocked" :size="13" class="text-fg-subtle" aria-label="Locked" /></p>
          <p v-if="row.description" class="max-w-md truncate text-xs text-fg-muted">{{ row.description }}</p>
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
