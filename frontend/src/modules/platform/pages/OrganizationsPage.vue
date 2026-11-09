<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Plus } from '@lucide/vue';
import type { OrganizationStatus } from '@contracts';
import { platformApi } from '@/modules/platform/api/platform.api';
import type { PlatformOrgDetail, PlatformOrgRow } from '@/modules/platform/types';
import CreateOrganizationModal from '@/modules/platform/components/CreateOrganizationModal.vue';
import OrgMark from '@/modules/platform/components/OrgMark.vue';
import { planVisual } from '@/modules/platform/utils/platform-visuals';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { appLocale } from '@/core/locale/locale';
import { formatDate, timeAgo } from '@/shared/utils/format';
import { organizationTone, statusLabel } from '@/shared/utils/status';
import { COUNTRY_OPTIONS } from '@/shared/utils/options';

/** All tenants: status summary that doubles as a filter, search, plan filter and the tenant table. */
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const plans = useAsync(() => platformApi.plans());
/** Status counts for the summary strip come from the platform dashboard (the list itself is paginated). */
const counts = useAsync(() => platformApi.dashboard());
const table = useTable((q) => platformApi.organizations(q), {
  sort: 'createdAt:desc',
  filters: { status: undefined as OrganizationStatus | undefined, planId: undefined as string | undefined },
});
const canManage = computed(() => auth.canPlatform('platform.organizations.manage'));
const createOpen = ref(route.query.create === '1' && canManage.value);
const num = (n: number) => n.toLocaleString(appLocale());

const columns: TableColumn<PlatformOrgRow>[] = [
  { key: 'name', label: 'Organization', sortField: 'name' },
  { key: 'plan', label: 'Plan' },
  { key: 'status', label: 'Status', sortField: 'status' },
  { key: 'userCount', label: 'Users', align: 'right' },
  { key: 'country', label: 'Country' },
  { key: 'createdAt', label: 'Created', sortField: 'createdAt' },
];
const planOptions = computed(() => (plans.data.value ?? []).map((p) => ({ label: p.name, value: p.id })));
const countryName = (code: string) => COUNTRY_OPTIONS.find((c) => c.value === code)?.label ?? code;

const strip = computed<StripItem[]>(() => {
  const o = counts.data.value?.organizations;
  return [
    { key: 'ALL', label: 'All organizations', value: o?.total, tone: 'brand', hint: 'Every tenant' },
    { key: 'ACTIVE', label: 'Active', value: o?.active, tone: 'success', hint: 'Using the platform' },
    { key: 'PENDING', label: 'Pending', value: o?.pending, tone: 'warning', hint: 'Not yet activated' },
    { key: 'SUSPENDED', label: 'Suspended', value: o?.suspended, tone: 'danger', hint: 'Access blocked' },
    { key: 'DEACTIVATED', label: 'Deactivated', value: o?.deactivated, tone: 'neutral', hint: 'Closed tenants' },
  ];
});

async function onCreated(org: PlatformOrgDetail) {
  createOpen.value = false;
  feedback.success('Organization created', `An invitation was sent to ${org.admins[0]?.email}.`);
  void counts.run();
  await router.push(`/platform/organizations/${org.id}`);
}
</script>

<template>
  <div>
    <AppPageHeader title="Organizations" :description="counts.data.value ? `${num(counts.data.value.organizations.total)} tenants on the platform.` : 'All tenants on the platform.'">
      <template #actions><AppButton v-if="canManage" :icon="Plus" :disabled="!plans.data.value" @click="createOpen = true">New organization</AppButton></template>
    </AppPageHeader>

    <AppStatStrip
      class="mb-4"
      :items="strip"
      selectable
      :selected="table.filters.status ?? 'ALL'"
      :loading="counts.loading.value && !counts.data.value"
      label="Organizations by status"
      @select="(k) => (table.filters.status = (!k || k === 'ALL' ? undefined : k) as OrganizationStatus | undefined)"
    />

    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search name, slug or email" aria-label="Search organizations" />
        <AppSelect v-model="table.filters.planId" :options="planOptions" placeholder="All plans" aria-label="Filter by plan" />
      </div>
      <AppDataTable
        v-model:sort="table.sort.value"
        :grid="false"
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        clickable
        caption="Organizations"
        empty-title="No organizations found"
        empty-description="Organizations appear here once they are created."
        :filtered="table.isFiltered.value"
        @page="table.setPage"
        @retry="table.load"
        @row-click="(row) => router.push(`/platform/organizations/${row.id}`)"
        @clear="table.clearFilters()"
      >
        <template #empty><AppButton v-if="canManage" :icon="Plus" :disabled="!plans.data.value" @click="createOpen = true">New organization</AppButton></template>
        <template #cell-name="{ row }">
          <div class="flex items-center gap-3">
            <OrgMark :name="row.name" size="md" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.name }}</p>
              <p class="truncate font-mono text-xs text-fg-subtle">{{ row.slug }}</p>
            </div>
          </div>
        </template>
        <template #cell-plan="{ row }">
          <span class="inline-flex items-center gap-2">
            <span :class="['flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-inset', planVisual(row.plan.code).tile]" aria-hidden="true"><component :is="planVisual(row.plan.code).icon" :size="13" /></span>
            <span class="text-fg">{{ row.plan.name }}</span>
          </span>
        </template>
        <template #cell-status="{ row }">
          <AppBadge :tone="organizationTone[row.status]" dot>{{ statusLabel(row.status) }}</AppBadge>
          <p v-if="row.suspendedAt && row.status !== 'ACTIVE'" class="mt-1 text-xs text-fg-muted">since {{ formatDate(row.suspendedAt) }}</p>
        </template>
        <template #cell-userCount="{ row }"><span class="font-medium text-fg tabular-nums">{{ num(row.userCount) }}</span></template>
        <template #cell-country="{ row }"><span class="text-fg-muted">{{ countryName(row.country) }}</span></template>
        <template #cell-createdAt="{ row }"><span class="text-fg-muted" :title="formatDate(row.createdAt)">{{ timeAgo(row.createdAt) }}</span></template>
      </AppDataTable>
    </AppCard>

    <CreateOrganizationModal :open="createOpen" :plans="plans.data.value ?? []" @close="createOpen = false" @created="onCreated" />
  </div>
</template>
