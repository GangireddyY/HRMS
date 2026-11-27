<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RotateCcw, UserMinus, Users } from '@lucide/vue';
import { integrationsApi } from '@/modules/integrations/integrations.api';
import type { VectorAccessList, VectorAccessPerson } from '@/modules/integrations/types';
import { AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppErrorState, AppSkeleton, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const props = defineProps<{ configured: boolean; allowedRoleIds: string[] }>();
const emit = defineEmits<{ count: [number] }>();
const feedback = useFeedbackStore();
const access = useAsync(() => integrationsApi.vectorAccess(), { immediate: false });
const busyId = ref<string | null>(null);
const showDenied = ref(false);

watch(
  () => [props.configured, props.allowedRoleIds.join(',')] as const,
  ([configured]) => {
    if (configured) void access.run();
    else {
      access.data.value = { people: [], denied: [] };
      emit('count', 0);
    }
  },
  { immediate: true },
);

watch(
  () => access.data.value,
  (list) => {
    if (list) emit('count', list.people.length);
  },
);

function apply(next: VectorAccessList) {
  access.data.value = next;
  emit('count', next.people.length);
}

const rows = computed(() => (showDenied.value ? (access.data.value?.denied ?? []) : (access.data.value?.people ?? [])));
const columns: TableColumn<VectorAccessPerson>[] = [
  { key: 'name', label: 'Person' },
  { key: 'email', label: 'Email' },
  { key: 'roles', label: 'Access via' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right', noExport: true },
];

async function removePerson(person: VectorAccessPerson) {
  if (
    !(await feedback.confirm({
      title: `Remove ${person.firstName} ${person.lastName}?`,
      message: `${person.email} will no longer see Apps → Vector, even though their role is still allowed. You can restore them later.`,
      confirmLabel: 'Remove access',
      danger: true,
    }))
  )
    return;
  busyId.value = person.userId;
  try {
    apply(await integrationsApi.denyVectorAccess(person.userId));
    feedback.success(`Removed Vector access for ${person.firstName}`);
  } catch (e) {
    feedback.error('Could not remove access', e);
  } finally {
    busyId.value = null;
  }
}

async function restorePerson(person: VectorAccessPerson) {
  busyId.value = person.userId;
  try {
    apply(await integrationsApi.restoreVectorAccess(person.userId));
    feedback.success(`Restored Vector access for ${person.firstName}`);
  } catch (e) {
    feedback.error('Could not restore access', e);
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <AppCard :padded="false" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-3">
      <p class="me-auto text-xs text-fg-muted">Everyone who can open Vector from the allowed roles.</p>
      <AppButton size="sm" :variant="showDenied ? 'ghost' : 'secondary'" @click="showDenied = false">
        Active
        <AppBadge v-if="access.data.value" class="ms-1" size="sm" tone="neutral">{{ access.data.value.people.length }}</AppBadge>
      </AppButton>
      <AppButton size="sm" :variant="showDenied ? 'secondary' : 'ghost'" :disabled="!(access.data.value?.denied.length)" @click="showDenied = true">
        Removed
        <AppBadge v-if="access.data.value?.denied.length" class="ms-1" size="sm" tone="warning">{{ access.data.value.denied.length }}</AppBadge>
      </AppButton>
    </div>

    <AppSkeleton v-if="access.loading.value && !access.data.value" class="p-5" :lines="5" />
    <AppErrorState v-else-if="access.error.value" class="p-5" :error="access.error.value" @retry="access.run" />
    <AppDataTable
      v-else
      :columns="columns"
      :rows="rows"
      :row-key="(row) => row.userId"
      :grid="true"
      layout-key="vector-access-people"
      caption="People with Vector access"
      :empty-title="showDenied ? 'No one removed' : 'No one with access yet'"
      :empty-description="
        showDenied
          ? 'Removed people will appear here so you can restore them.'
          : 'Choose roles under Connector enabled and save. People in those roles show up here.'
      "
      class="min-h-0 flex-1"
    >
      <template #cell-name="{ row }">
        <div class="flex items-center gap-3">
          <AppAvatar :name="`${row.firstName} ${row.lastName}`" :src="row.avatarUrl" size="sm" />
          <div class="min-w-0">
            <p class="truncate font-medium text-fg">{{ row.firstName }} {{ row.lastName }}</p>
            <p class="truncate text-xs text-fg-muted sm:hidden">{{ row.email }}</p>
          </div>
        </div>
      </template>
      <template #cell-email="{ row }">
        <span class="text-fg-muted">{{ row.email }}</span>
      </template>
      <template #cell-roles="{ row }">
        <div class="flex flex-wrap gap-1">
          <AppBadge v-for="name in row.roleNames.slice(0, 3)" :key="name" tone="brand" size="sm">{{ name }}</AppBadge>
          <AppBadge v-if="row.roleNames.length > 3" size="sm">+{{ row.roleNames.length - 3 }}</AppBadge>
        </div>
      </template>
      <template #cell-status="{ row }">
        <AppBadge v-if="showDenied" tone="warning" dot>Removed</AppBadge>
        <AppBadge v-else-if="!row.removable" tone="info" dot>Admin</AppBadge>
        <AppBadge v-else tone="success" dot>Allowed</AppBadge>
      </template>
      <template #cell-actions="{ row }">
        <AppButton
          v-if="showDenied"
          type="button"
          size="sm"
          variant="secondary"
          :icon="RotateCcw"
          :loading="busyId === row.userId"
          @click="restorePerson(row)"
        >
          Restore
        </AppButton>
        <AppButton
          v-else-if="row.removable"
          type="button"
          size="sm"
          variant="ghost"
          :icon="UserMinus"
          :loading="busyId === row.userId"
          @click="removePerson(row)"
        >
          Remove
        </AppButton>
        <span v-else class="text-xs text-fg-subtle">—</span>
      </template>

      <template #card="{ row }">
        <div class="flex h-full flex-col gap-3">
          <div class="flex items-start gap-3">
            <AppAvatar :name="`${row.firstName} ${row.lastName}`" :src="row.avatarUrl" size="md" />
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <h3 class="truncate text-sm font-semibold text-fg">{{ row.firstName }} {{ row.lastName }}</h3>
                <AppBadge v-if="showDenied" class="shrink-0" tone="warning" size="sm" dot>Removed</AppBadge>
                <AppBadge v-else-if="!row.removable" class="shrink-0" tone="info" size="sm" dot>Admin</AppBadge>
                <AppBadge v-else class="shrink-0" tone="success" size="sm" dot>Allowed</AppBadge>
              </div>
              <p class="mt-0.5 truncate text-xs text-fg-muted" :title="row.email">{{ row.email }}</p>
            </div>
          </div>

          <dl class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-line/60 pt-3 text-xs">
            <dt class="self-center font-medium text-fg-muted">Access via</dt>
            <dd class="min-w-0">
              <div class="flex flex-wrap gap-1">
                <AppBadge v-for="name in row.roleNames.slice(0, 3)" :key="name" tone="brand" size="sm">{{ name }}</AppBadge>
                <AppBadge v-if="row.roleNames.length > 3" size="sm">+{{ row.roleNames.length - 3 }}</AppBadge>
                <span v-if="!row.roleNames.length" class="text-fg-subtle">—</span>
              </div>
            </dd>
          </dl>

          <div class="mt-auto flex items-center justify-end border-t border-line/60 pt-3" @click.stop>
            <AppButton
              v-if="showDenied"
              type="button"
              size="sm"
              variant="secondary"
              :icon="RotateCcw"
              :loading="busyId === row.userId"
              @click="restorePerson(row)"
            >
              Restore
            </AppButton>
            <AppButton
              v-else-if="row.removable"
              type="button"
              size="sm"
              variant="ghost"
              :icon="UserMinus"
              :loading="busyId === row.userId"
              @click="removePerson(row)"
            >
              Remove
            </AppButton>
            <span v-else class="text-xs text-fg-subtle">Managed by role permissions</span>
          </div>
        </div>
      </template>

      <template #empty>
        <span class="inline-flex items-center gap-2 text-fg-muted"><Users :size="16" aria-hidden="true" /> Manage roles in the Connector enabled tab</span>
      </template>
    </AppDataTable>
  </AppCard>
</template>
