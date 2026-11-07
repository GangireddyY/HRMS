<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import type { OrganizationStatus } from '@contracts';
import { platformApi } from '@/modules/platform/api/platform.api';
import type { PlatformOrgDetail, PlatformOrgRow } from '@/modules/platform/types';
import CreateOrganizationModal from '@/modules/platform/components/CreateOrganizationModal.vue';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';
import { organizationTone, statusLabel } from '@/shared/utils/status';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const plans = useAsync(() => platformApi.plans());
const table = useTable((q) => platformApi.organizations(q), {
  sort: 'createdAt:desc',
  filters: { status: undefined as OrganizationStatus | undefined, planId: undefined as string | undefined },
});
const canManage = computed(() => auth.canPlatform('platform.organizations.manage'));
const createOpen = ref(route.query.create === '1' && canManage.value);

const columns: TableColumn<PlatformOrgRow>[] = [
  { key: 'name', label: 'Organization', sortField: 'name' },
  { key: 'plan', label: 'Plan' },
  { key: 'status', label: 'Status', sortField: 'status' },
  { key: 'userCount', label: 'Users', align: 'right' },
  { key: 'createdAt', label: 'Created', sortField: 'createdAt' },
];
const statusOptions = (['ACTIVE', 'PENDING', 'SUSPENDED', 'DEACTIVATED'] as OrganizationStatus[]).map((s) => ({ label: s.charAt(0) + s.slice(1).toLowerCase(), value: s }));
const planOptions = computed(() => (plans.data.value ?? []).map((p) => ({ label: p.name, value: p.id })));

async function onCreated(org: PlatformOrgDetail) {
  createOpen.value = false;
  feedback.success('Organization created', `An invitation was sent to ${org.admins[0]?.email}.`);
  await router.push(`/platform/organizations/${org.id}`);
}
</script>

<template>
  <div>
    <AppPageHeader title="Organizations" description="All tenants on the platform.">
      <template #actions><AppButton v-if="canManage" :icon="Plus" :disabled="!plans.data.value" @click="createOpen = true">New organization</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_180px_180px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search name, slug or email" aria-label="Search organizations" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        <AppSelect v-model="table.filters.planId" :options="planOptions" placeholder="All plans" aria-label="Filter by plan" />
      </div>
      <AppDataTable
        v-model:sort="table.sort.value"
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        clickable
        caption="Organizations"
        empty-title="No organizations found"
        @page="table.setPage"
        @retry="table.load"
        @row-click="(row) => router.push(`/platform/organizations/${row.id}`)"
      >
        <template #cell-name="{ row }">
          <p class="font-medium">{{ row.name }}</p>
          <p class="font-mono text-xs text-fg-subtle">{{ row.slug }}</p>
        </template>
        <template #cell-plan="{ row }">{{ row.plan.name }}</template>
        <template #cell-status="{ row }"><AppBadge :tone="organizationTone[row.status]" dot>{{ statusLabel(row.status) }}</AppBadge></template>
        <template #cell-createdAt="{ row }"><span class="text-fg-muted">{{ formatDate(row.createdAt) }}</span></template>
      </AppDataTable>
    </AppCard>
    <CreateOrganizationModal :open="createOpen" :plans="plans.data.value ?? []" @close="createOpen = false" @created="onCreated" />
  </div>
</template>
