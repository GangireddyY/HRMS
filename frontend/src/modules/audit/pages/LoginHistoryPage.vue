<script setup lang="ts">
import { auditApi } from '@/modules/audit/api/audit.api';
import type { LoginEventRow } from '@/modules/audit/types';
import { AppBadge, AppCard, AppDataTable, AppDatePicker, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { describeUserAgent, formatDateTime, fullName } from '@/shared/utils/format';
import { loginTone, statusLabel } from '@/shared/utils/status';

const table = useTable((q) => auditApi.loginEvents(q), {
  pageSize: 25,
  filters: { outcome: undefined as string | undefined, from: undefined as string | undefined, to: undefined as string | undefined },
});

const columns: TableColumn<LoginEventRow>[] = [
  { key: 'createdAt', label: 'When', class: 'whitespace-nowrap' },
  { key: 'user', label: 'User' },
  { key: 'outcome', label: 'Result' },
  { key: 'device', label: 'Device' },
  { key: 'ipAddress', label: 'IP address' },
];
const outcomeOptions = [
  { label: 'Successful', value: 'SUCCESS' },
  { label: 'Failed', value: 'FAILURE' },
  { label: 'Locked', value: 'LOCKED' },
  { label: 'MFA challenge', value: 'MFA_CHALLENGE' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Login history" description="Sign-in attempts for this organization, including failures and lockouts." />
    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 md:grid-cols-[1fr_180px_160px_160px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search by email" aria-label="Search by email" />
        <AppSelect v-model="table.filters.outcome" :options="outcomeOptions" placeholder="All results" aria-label="Filter by result" />
        <AppDatePicker v-model="table.filters.from" placeholder="From date" aria-label="From date" :max="table.filters.to" />
        <AppDatePicker v-model="table.filters.to" placeholder="To date" aria-label="To date" :min="table.filters.from" />
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        caption="Login history"
        empty-title="No sign-in events"
        @page="table.setPage"
        @retry="table.load"
      >
        <template #cell-createdAt="{ row }"><span class="text-fg-muted">{{ formatDateTime(row.createdAt) }}</span></template>
        <template #cell-user="{ row }">
          <p class="font-medium">{{ row.user ? fullName(row.user) : '—' }}</p>
          <p class="text-xs text-fg-muted">{{ row.email }}</p>
        </template>
        <template #cell-outcome="{ row }">
          <AppBadge :tone="loginTone[row.outcome]">{{ statusLabel(row.outcome) }}</AppBadge>
          <span v-if="row.failureReason" class="ms-1 text-xs text-fg-subtle">{{ row.failureReason.replace(/_/g, ' ') }}</span>
        </template>
        <template #cell-device="{ row }">{{ describeUserAgent(row.userAgent) }}</template>
      </AppDataTable>
    </AppCard>
  </div>
</template>
