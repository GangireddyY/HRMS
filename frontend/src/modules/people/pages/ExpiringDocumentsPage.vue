<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { documentsApi } from '@/modules/people/api/people.api';
import type { ExpiringDocument } from '@/modules/people/types';
import { DOCUMENT_CATEGORY_LABELS } from '@/modules/people/utils/labels';
import { AppAvatar, AppBadge, AppCard, AppDataTable, AppPageHeader, AppSelect, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';

const router = useRouter();
const days = ref(30);
const docs = useAsync(() => documentsApi.expiring(days.value));
watch(days, () => void docs.run());

const windowOptions = [
  { value: 0, label: 'Expired only' },
  { value: 30, label: 'Expired or within 30 days' },
  { value: 60, label: 'Expired or within 60 days' },
  { value: 90, label: 'Expired or within 90 days' },
];
const columns: TableColumn<ExpiringDocument>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'title', label: 'Document' },
  { key: 'expiryDate', label: 'Expiry' },
];
const expiredCount = computed(() => (docs.data.value ?? []).filter((d) => d.expired).length);
const daysLeft = (d: string) => Math.round((new Date(`${d}T00:00:00Z`).getTime() - new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000);
</script>

<template>
  <div>
    <AppPageHeader title="Document expiry" description="Passports, visas, certifications and other employee documents that have expired or expire soon.">
      <template #actions>
        <AppSelect v-model="days" class="w-64 max-sm:w-full" :options="windowOptions" :clearable="false" aria-label="Expiry window" />
      </template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div v-if="docs.data.value?.length" class="flex flex-wrap gap-2 border-b border-line px-4 py-3 text-sm">
        <AppBadge tone="danger">{{ expiredCount }} expired</AppBadge>
        <AppBadge tone="warning">{{ docs.data.value.length - expiredCount }} expiring soon</AppBadge>
      </div>
      <AppDataTable
        :columns="columns"
        :rows="docs.data.value ?? []"
        :loading="docs.loading.value"
        :error="docs.error.value"
        clickable
        caption="Expiring documents"
        empty-title="Nothing expiring"
        empty-description="No documents in your scope have expired or expire in this window."
        @retry="docs.run"
        @row-click="(row) => router.push({ path: `/hr/employees/${row.employee.id}`, query: { tab: 'documents' } })"
      >
        <template #cell-employee="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.employee.name" size="sm" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ [row.employee.employeeCode, row.employee.department].filter(Boolean).join(' · ') }}</p>
            </div>
          </div>
        </template>
        <template #cell-title="{ row }">
          <p class="text-fg">{{ row.title }}</p>
          <p class="text-xs text-fg-muted">{{ DOCUMENT_CATEGORY_LABELS[row.category] }}</p>
        </template>
        <template #cell-expiryDate="{ row }">
          <AppBadge :tone="row.expired ? 'danger' : 'warning'" dot>{{ row.expired ? 'Expired' : `In ${daysLeft(row.expiryDate)} day${daysLeft(row.expiryDate) === 1 ? '' : 's'}` }}</AppBadge>
          <p class="mt-0.5 text-xs text-fg-muted">{{ formatDate(row.expiryDate) }}</p>
        </template>
      </AppDataTable>
    </AppCard>
  </div>
</template>
