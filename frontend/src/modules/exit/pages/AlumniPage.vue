<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { ExternalLink, Mail, Phone } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { alumniApi } from '@/modules/exit/api/exit.api';
import type { AlumniRow } from '@/modules/exit/types';
import { TYPE_LABELS } from '@/modules/exit/utils/exit-format';
import { AppBadge, AppCard, AppCheckbox, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { formatDate } from '@/shared/utils/format';

const router = useRouter();
const auth = useAuthStore();
const manage = auth.can('exit.manage');
const table = useTable((q) => alumniApi.list(q), {
  filters: { rehire: undefined as 'yes' | 'no' | 'undecided' | undefined, optedIn: undefined as boolean | undefined, openToOpportunities: undefined as boolean | undefined },
});
const rehireOptions = [
  { value: 'yes', label: 'Eligible for rehire' },
  { value: 'no', label: 'Not eligible for rehire' },
  { value: 'undecided', label: 'Rehire not decided' },
];
const inNetwork = computed({ get: () => !!table.filters.optedIn, set: (v: boolean) => (table.filters.optedIn = v || undefined) });
const openOnly = computed({ get: () => !!table.filters.openToOpportunities, set: (v: boolean) => (table.filters.openToOpportunities = v || undefined) });
const columns = computed<TableColumn<AlumniRow>[]>(() => [
  { key: 'person', label: 'Former employee' },
  { key: 'exit', label: 'Left' },
  ...(manage ? [{ key: 'rehire', label: 'Rehire' }] : []),
  { key: 'now', label: 'Now' },
  { key: 'contact', label: 'Contact' },
]);
const rehireBadge = (v: boolean | null | undefined) => (v === true ? { tone: 'success' as const, label: 'Eligible' } : v === false ? { tone: 'danger' as const, label: 'Not eligible' } : { tone: 'neutral' as const, label: 'Not decided' });
</script>

<template>
  <div>
    <AppPageHeader title="Alumni" description="Everyone who has left, with the contact details of those who joined the alumni network." />
    <AppCard :padded="false">
      <div class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
        <AppSearchInput v-model="table.search.value" class="min-w-56 flex-1" placeholder="Search by name or code" aria-label="Search alumni" />
        <AppSelect v-if="manage" v-model="table.filters.rehire" class="w-56" :options="rehireOptions" placeholder="Any rehire decision" aria-label="Filter by rehire eligibility" />
        <AppCheckbox v-model="inNetwork" label="In the alumni network" />
        <AppCheckbox v-model="openOnly" label="Open to opportunities" />
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        :clickable="manage"
        caption="Alumni"
        empty-title="No alumni yet"
        empty-description="People appear here once their exit is completed."
        @page="table.setPage"
        @retry="table.load"
        @row-click="(r: AlumniRow) => r.exit && router.push(`/hr/exits/${r.exit.id}`)"
      >
        <template #cell-person="{ row }">
          <p class="font-medium text-fg">{{ row.name }}</p>
          <p class="text-xs text-fg-muted">{{ [row.employeeCode, row.designation, row.department].filter(Boolean).join(' · ') }}</p>
        </template>
        <template #cell-exit="{ row }">
          <p class="text-fg">{{ row.exitDate ? formatDate(row.exitDate) : '—' }}</p>
          <p class="text-xs text-fg-muted">{{ row.exit ? TYPE_LABELS[row.exit.type] : 'No exit record' }} · joined {{ formatDate(row.dateOfJoining) }}</p>
        </template>
        <template #cell-rehire="{ row }">
          <AppBadge v-if="row.exit" size="sm" :tone="rehireBadge(row.exit.eligibleForRehire).tone">{{ rehireBadge(row.exit.eligibleForRehire).label }}</AppBadge>
          <span v-else class="text-xs text-fg-muted">—</span>
        </template>
        <template #cell-now="{ row }">
          <template v-if="row.alumni">
            <p class="text-fg">{{ [row.alumni.currentTitle, row.alumni.currentCompany].filter(Boolean).join(' at ') || '—' }}</p>
            <p class="text-xs text-fg-muted">
              {{ row.alumni.city ?? '' }}
              <AppBadge v-if="row.alumni.openToOpportunities" size="sm" tone="brand">Open to opportunities</AppBadge>
            </p>
          </template>
          <span v-else class="text-xs text-fg-muted">Not in the network</span>
        </template>
        <template #cell-contact="{ row }">
          <div v-if="row.alumni" class="flex flex-wrap gap-3 text-xs" @click.stop>
            <a v-if="row.alumni.personalEmail" :href="`mailto:${row.alumni.personalEmail}`" class="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"><Mail :size="13" aria-hidden="true" />{{ row.alumni.personalEmail }}</a>
            <a v-if="row.alumni.phone" :href="`tel:${row.alumni.phone}`" class="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"><Phone :size="13" aria-hidden="true" />{{ row.alumni.phone }}</a>
            <a v-if="row.alumni.linkedinUrl" :href="row.alumni.linkedinUrl" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"><ExternalLink :size="13" aria-hidden="true" />LinkedIn</a>
          </div>
          <span v-else class="text-xs text-fg-muted">—</span>
        </template>
      </AppDataTable>
    </AppCard>
  </div>
</template>
