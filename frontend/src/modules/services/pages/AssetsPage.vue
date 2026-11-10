<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Ban, Boxes, Check, Inbox, Plus } from '@lucide/vue';
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABELS, ASSET_STATUSES, type AssetCategory, type AssetStatus } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { assetsApi } from '@/modules/services/api/services.api';
import AssetFormModal from '@/modules/services/components/AssetFormModal.vue';
import type { Asset, AssetDetail, AssetRequest } from '@/modules/services/types';
import { ASSET_ICONS, ASSET_REQUEST_STATUS_LABELS, ASSET_STATUS_LABELS, assetRequestTone, assetStatusTone } from '@/modules/services/utils/services-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, AppTabs, AppTextarea, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** The asset register (what the company owns and who holds it) and requests from employees. Managers see what their people hold. */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canManage = auth.can('assets.manage');

const tab = ref(canManage && route.query.tab === 'requests' ? 'requests' : 'register');
const summary = useAsync(() => (canManage ? assetsApi.summary() : Promise.resolve(null)));
const tabs = computed(() => [
  { key: 'register', label: 'Register', icon: Boxes },
  ...(canManage ? [{ key: 'requests', label: 'Requests', icon: Inbox, count: summary.data.value?.pendingRequests || null }] : []),
]);
const strip = computed<StripItem[]>(() => {
  const s = summary.data.value;
  return [
    { key: 'IN_STOCK', label: 'In stock', value: s?.inStock, tone: 'success', hint: 'Ready to hand out' },
    { key: 'ASSIGNED', label: 'With employees', value: s?.assigned, tone: 'brand', hint: s ? `of ${s.total} assets` : undefined },
    { key: 'IN_REPAIR', label: 'In repair', value: s?.inRepair, tone: 'warning', hint: 'Out of use for now' },
    { key: 'RETIRED', label: 'Retired or lost', value: s?.retired, tone: 'neutral', hint: 'No longer in use' },
  ];
});

// ---- Register ----------------------------------------------------------------------------------
const table = useTable((q) => assetsApi.list(q), { filters: { status: undefined as AssetStatus | undefined, category: undefined as AssetCategory | undefined } });
const statusOptions = ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] }));
const categoryOptions = ASSET_CATEGORIES.map((c) => ({ value: c, label: ASSET_CATEGORY_LABELS[c] }));
const stripSelected = computed(() => (table.filters.status && table.filters.status !== 'LOST' ? table.filters.status : null));
const selectStatus = (key: string | null) => (table.filters.status = (key as AssetStatus | null) ?? undefined);
const columns: TableColumn<Asset>[] = [
  { key: 'asset', label: 'Asset' },
  { key: 'serial', label: 'Serial / model' },
  { key: 'holder', label: 'With' },
  { key: 'status', label: 'Status' },
];
const adding = ref(false);
async function onAdded(a: AssetDetail) {
  adding.value = false;
  feedback.success('Asset added', `${a.tag} is in stock.`);
  await router.push(`/hr/assets/${a.id}`);
}

// ---- Requests ----------------------------------------------------------------------------------
const requests = useTable((q) => (canManage ? assetsApi.requests({ ...q, view: 'all' }) : Promise.resolve({ items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } })), {
  filters: { status: 'PENDING' as AssetRequest['status'] | undefined },
});
const requestStatusOptions = (['PENDING', 'FULFILLED', 'REJECTED', 'CANCELLED'] as const).map((s) => ({ value: s, label: ASSET_REQUEST_STATUS_LABELS[s] }));
const requestColumns: TableColumn<AssetRequest>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'need', label: 'Needs' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' },
];

const handling = ref<AssetRequest | null>(null);
const decision = reactive({ mode: 'fulfil' as 'fulfil' | 'reject', assetId: null as string | null, note: '', error: '' });
const stock = useAsync(() => (handling.value ? assetsApi.list({ status: 'IN_STOCK', category: handling.value.category, page: 1, pageSize: 100 }) : Promise.resolve(null)), { immediate: false });
const stockOptions = computed(() => (stock.data.value?.items ?? []).map((a) => ({ value: a.id, label: `${a.tag} · ${a.name}`, description: a.serialNumber ?? undefined })));
async function openDecision(r: AssetRequest, mode: 'fulfil' | 'reject') {
  handling.value = r;
  Object.assign(decision, { mode, assetId: null, note: '', error: '' });
  if (mode === 'fulfil') await stock.run();
}
const deciding = ref(false);
async function decide() {
  const r = handling.value!;
  deciding.value = true;
  decision.error = '';
  try {
    if (decision.mode === 'fulfil') await assetsApi.fulfil(r.id, { assetId: decision.assetId!, note: decision.note || null });
    else await assetsApi.reject(r.id, decision.note);
    feedback.success(decision.mode === 'fulfil' ? 'Handed over' : 'Request declined', r.employee?.name);
    handling.value = null;
    await Promise.all([requests.load(), table.load(), summary.run()]);
  } catch (e) {
    decision.error = e instanceof Error ? e.message : 'Something went wrong';
  } finally {
    deciding.value = false;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Assets" :description="canManage ? 'Company equipment, who holds it and requests for more.' : 'Company equipment held by the people you manage.'">
      <template v-if="canManage" #actions><AppButton :icon="Plus" @click="adding = true">Add asset</AppButton></template>
    </AppPageHeader>

    <AppStatStrip v-if="canManage" :items="strip" :loading="summary.loading.value && !summary.data.value" selectable :selected="stripSelected" label="Assets by status" @select="selectStatus" />

    <AppTabs v-model="tab" :tabs="tabs">
      <AppCard v-if="tab === 'register'" :padded="false">
        <div class="grid gap-3 border-b border-line/70 px-3 py-3 sm:grid-cols-[1fr_180px_180px]">
          <AppSearchInput v-model="table.search.value" placeholder="Search tag, name, serial or person" aria-label="Search assets" />
          <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="Any status" aria-label="Filter by status" />
          <AppSelect v-model="table.filters.category" :options="categoryOptions" placeholder="Any category" aria-label="Filter by category" />
        </div>
        <AppDataTable
          :columns="columns"
          :rows="table.rows.value"
          :loading="table.loading.value"
          :error="table.error.value"
          :meta="table.meta.value"
          clickable
          caption="Assets"
          empty-title="No assets yet"
          :empty-description="canManage ? 'Add laptops, phones, ID cards and other equipment to track who holds what.' : 'Assets held by your team appear here.'"
          :filtered="table.isFiltered.value"
          @page="table.setPage"
          @retry="table.load"
          @row-click="(a: Asset) => router.push(`/hr/assets/${a.id}`)"
          @clear="table.clearFilters()"
        >
          <template #empty><AppButton v-if="canManage" :icon="Plus" @click="adding = true">Add asset</AppButton></template>
          <template #cell-asset="{ row }">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg" aria-hidden="true"><component :is="ASSET_ICONS[row.category]" :size="16" /></span>
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.name }}</p>
                <p class="truncate text-xs text-fg-muted"><span class="font-mono">{{ row.tag }}</span> · {{ ASSET_CATEGORY_LABELS[row.category] }}</p>
              </div>
            </div>
          </template>
          <template #cell-serial="{ row }">
            <p class="truncate font-mono text-xs text-fg">{{ row.serialNumber ?? '—' }}</p>
            <p class="truncate text-xs text-fg-muted">{{ row.model ?? '' }}</p>
          </template>
          <template #cell-holder="{ row }">
            <div v-if="row.assignedTo" class="flex items-center gap-2">
              <AppAvatar :name="row.assignedTo.name" size="sm" />
              <div class="min-w-0">
                <p class="truncate text-sm text-fg">{{ row.assignedTo.name }}</p>
                <p class="truncate text-2xs text-fg-muted">since {{ formatDate(row.assignedAt) }}</p>
              </div>
            </div>
            <span v-else class="text-fg-subtle">{{ row.location?.name ?? '—' }}</span>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="assetStatusTone[row.status]" size="sm" dot>{{ ASSET_STATUS_LABELS[row.status] }}</AppBadge>
          </template>
        </AppDataTable>
      </AppCard>

      <AppCard v-else :padded="false">
        <div class="grid gap-3 border-b border-line/70 px-3 py-3 sm:grid-cols-[1fr_200px]">
          <AppSearchInput v-model="requests.search.value" placeholder="Search" aria-label="Search requests" />
          <AppSelect v-model="requests.filters.status" :options="requestStatusOptions" placeholder="Any status" aria-label="Filter by status" />
        </div>
        <AppDataTable
          :columns="requestColumns"
          :rows="requests.rows.value"
          :loading="requests.loading.value"
          :error="requests.error.value"
          :meta="requests.meta.value"
          caption="Asset requests"
          empty-title="No requests"
          empty-description="When employees ask for equipment, their requests appear here."
          :filtered="requests.isFiltered.value"
          @page="requests.setPage"
          @retry="requests.load"
          @clear="requests.clearFilters()"
        >
          <template #cell-employee="{ row }">
            <div class="flex items-center gap-3">
              <AppAvatar :name="row.employee?.name ?? '?'" size="sm" />
              <div class="min-w-0">
                <p class="truncate font-medium text-fg">{{ row.employee?.name }}</p>
                <p class="truncate text-xs text-fg-muted">{{ row.employee?.employeeCode }}{{ row.employee?.department ? ` · ${row.employee.department}` : '' }}</p>
              </div>
            </div>
          </template>
          <template #cell-need="{ row }">
            <p class="text-fg">{{ ASSET_CATEGORY_LABELS[row.category] }}<span v-if="row.asset" class="text-fg-muted"> · {{ row.asset.tag }}</span></p>
            <p class="max-w-72 truncate text-xs text-fg-muted">{{ row.reason }} · {{ timeAgo(row.createdAt) }}</p>
          </template>
          <template #cell-status="{ row }">
            <AppBadge :tone="assetRequestTone[row.status]" size="sm" dot>{{ ASSET_REQUEST_STATUS_LABELS[row.status] }}</AppBadge>
          </template>
          <template #cell-actions="{ row }">
            <div v-if="row.status === 'PENDING'" class="flex justify-end gap-2">
              <AppButton size="sm" variant="ghost" :icon="Ban" @click="openDecision(row, 'reject')">Decline</AppButton>
              <AppButton size="sm" :icon="Check" @click="openDecision(row, 'fulfil')">Hand over</AppButton>
            </div>
          </template>
        </AppDataTable>
      </AppCard>
    </AppTabs>

    <AssetFormModal :open="adding" @close="adding = false" @saved="onAdded" />

    <AppModal
      :open="!!handling"
      dialog
      :title="decision.mode === 'fulfil' ? `Hand over a ${handling ? ASSET_CATEGORY_LABELS[handling.category].toLowerCase() : ''}` : 'Decline the request'"
      :description="handling ? `${handling.employee?.name}: ${handling.reason}` : undefined"
      @close="handling = null"
    >
      <form id="asset-decision" class="space-y-4" novalidate @submit.prevent="decide">
        <AppAlert v-if="decision.error">{{ decision.error }}</AppAlert>
        <template v-if="decision.mode === 'fulfil'">
          <AppSelect v-model="decision.assetId" label="From stock" :options="stockOptions" :placeholder="stock.loading.value ? 'Loading…' : 'Choose an asset'" searchable />
          <p v-if="stock.data.value && !stockOptions.length" class="text-sm text-fg-muted">Nothing of this kind is in stock. Add the asset to the register first.</p>
          <AppTextarea v-model="decision.note" label="Note for the employee" :rows="2" :maxlength="500" />
        </template>
        <AppTextarea v-else v-model="decision.note" label="Why not?" required :rows="3" :maxlength="500" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="handling = null">Cancel</AppButton>
        <AppButton
          type="submit"
          form="asset-decision"
          :variant="decision.mode === 'reject' ? 'danger' : 'primary'"
          :loading="deciding"
          :disabled="decision.mode === 'fulfil' ? !decision.assetId : decision.note.trim().length < 3"
          >{{ decision.mode === 'fulfil' ? 'Hand over' : 'Decline' }}</AppButton
        >
      </template>
    </AppModal>
  </div>
</template>
