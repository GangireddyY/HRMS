<script setup lang="ts">
import { ref } from 'vue';
import { Boxes } from '@lucide/vue';
import type { Page } from '@/core/http/http-client';
import type { AuditQuery } from '@/modules/audit/api/audit.api';
import type { AuditEntry } from '@/modules/audit/types';
import { AppCard, AppDataTable, AppDatePicker, AppInput, AppModal, AppSearchInput, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { formatDateTime, fullName, humanize } from '@/shared/utils/format';

const props = defineProps<{ fetcher: (q: AuditQuery) => Promise<Page<AuditEntry>>; showOrganization?: boolean; organizationId?: string }>();

const table = useTable((q) => props.fetcher(q), {
  sort: 'createdAt:desc',
  pageSize: 25,
  filters: { entityType: undefined as string | undefined, from: undefined as string | undefined, to: undefined as string | undefined, organizationId: props.organizationId },
});
const selected = ref<AuditEntry | null>(null);

const columns: TableColumn<AuditEntry>[] = [
  { key: 'createdAt', label: 'When', sortField: 'createdAt', class: 'whitespace-nowrap' },
  { key: 'action', label: 'Action', sortField: 'action' },
  { key: 'summary', label: 'Details' },
  { key: 'actor', label: 'Actor' },
  ...(props.showOrganization ? [{ key: 'organization', label: 'Organization' }] : []),
];

const stringify = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
</script>

<template>
  <AppCard :padded="false">
    <div class="grid gap-3 border-b border-line/70 px-4 py-3 md:grid-cols-[1fr_180px_160px_160px]">
      <AppSearchInput v-model="table.search.value" placeholder="Search action or summary" aria-label="Search audit log" />
      <AppInput v-model="table.filters.entityType" placeholder="Entity (e.g. Role)" aria-label="Entity type" :icon="Boxes" />
      <AppDatePicker v-model="table.filters.from" placeholder="From date" aria-label="From date" :max="table.filters.to" />
      <AppDatePicker v-model="table.filters.to" placeholder="To date" aria-label="To date" :min="table.filters.from" />
    </div>
    <AppDataTable
      v-model:sort="table.sort.value"
      :columns="columns"
      :rows="table.rows.value"
      :loading="table.loading.value"
      :error="table.error.value"
      :meta="table.meta.value"
      clickable
      caption="Audit log"
      empty-title="No audit events"
      empty-description="Adjust the filters or date range."
      @page="table.setPage"
      @retry="table.load"
      @row-click="(row) => (selected = row)"
      :filtered="table.isFiltered.value"
      @clear="table.clearFilters()"
    >
      <template #cell-createdAt="{ row }"><span class="text-fg-muted">{{ formatDateTime(row.createdAt) }}</span></template>
      <template #cell-action="{ row }"><code class="rounded bg-surface-muted px-2 py-0.5 font-mono text-xs">{{ row.action }}</code></template>
      <template #cell-summary="{ row }"><span class="line-clamp-1 max-w-md">{{ row.summary ?? humanize(row.entityType) }}</span></template>
      <template #cell-actor="{ row }">{{ row.actor ? fullName(row.actor) : 'System' }}</template>
      <template #cell-organization="{ row }">{{ row.organization?.name ?? 'Platform' }}</template>
    </AppDataTable>

    <AppModal :open="!!selected" :title="selected?.action ?? ''" :description="selected ? formatDateTime(selected.createdAt) : ''" size="lg" @close="selected = null">
      <dl v-if="selected" class="grid grid-cols-[140px_1fr] gap-x-4 gap-y-3 text-sm">
        <dt class="text-fg-muted">Summary</dt><dd>{{ selected.summary ?? '—' }}</dd>
        <dt class="text-fg-muted">Actor</dt><dd>{{ selected.actor ? `${fullName(selected.actor)} (${selected.actor.email})` : 'System' }}</dd>
        <dt class="text-fg-muted">Entity</dt><dd>{{ selected.entityType }} <span class="font-mono text-xs text-fg-subtle">{{ selected.entityId }}</span></dd>
        <dt class="text-fg-muted">IP address</dt><dd>{{ selected.ipAddress ?? '—' }}</dd>
        <dt class="text-fg-muted">Request ID</dt><dd class="font-mono text-xs">{{ selected.requestId ?? '—' }}</dd>
      </dl>
      <div v-if="selected?.changes && Object.keys(selected.changes).length" class="mt-4">
        <p class="mb-2 text-sm font-medium">Changes</p>
        <table class="w-full overflow-hidden rounded-xl border border-line text-sm">
          <thead class="bg-surface-muted text-xs font-medium text-fg-muted"><tr><th class="px-3 py-2 text-start">Field</th><th class="px-3 py-2 text-start">Before</th><th class="px-3 py-2 text-start">After</th></tr></thead>
          <tbody class="divide-y divide-line">
            <tr v-for="(c, field) in selected.changes" :key="field">
              <td class="px-3 py-2 font-medium">{{ field }}</td>
              <td class="px-3 py-2 break-all text-danger-fg">{{ stringify(c.from) }}</td>
              <td class="px-3 py-2 break-all text-success-fg">{{ stringify(c.to) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="selected?.metadata" class="mt-4">
        <p class="mb-2 text-sm font-medium">Metadata</p>
        <pre class="max-h-64 overflow-auto rounded-lg bg-surface-muted p-3 text-xs">{{ JSON.stringify(selected.metadata, null, 2) }}</pre>
      </div>
    </AppModal>
  </AppCard>
</template>
