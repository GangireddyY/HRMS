<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ExternalLink, FilterX, GraduationCap, LayoutGrid, Mail, MapPin, Phone, Rows3, SearchX } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { alumniApi } from '@/modules/exit/api/exit.api';
import AlumniProfileCard from '@/modules/exit/components/AlumniProfileCard.vue';
import type { AlumniRow } from '@/modules/exit/types';
import { TYPE_LABELS } from '@/modules/exit/utils/exit-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppCheckbox, AppDataTable, AppEmptyState, AppErrorState, AppPageHeader, AppPagination, AppSearchInput, AppSegmented, AppSelect, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { formatDate } from '@/shared/utils/format';

/** Former employees: where they are now, rehire eligibility, and contact details of those in the alumni network. */
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

// Directory totals per segment, from the same list endpoint.
const totals = useAsync(() =>
  Promise.all([
    alumniApi.list({ page: 1, pageSize: 1 }),
    alumniApi.list({ page: 1, pageSize: 1, optedIn: true }),
    alumniApi.list({ page: 1, pageSize: 1, openToOpportunities: true }),
    manage ? alumniApi.list({ page: 1, pageSize: 1, rehire: 'yes' }) : Promise.resolve(null),
  ]).then((r) => r.map((p) => p?.meta.total ?? null)),
);
const strip = computed<StripItem[]>(() => {
  const [all, network, open, rehire] = totals.data.value ?? [];
  return [
    { key: 'all', label: 'Alumni', value: all, tone: 'neutral', hint: 'Everyone who has left' },
    { key: 'network', label: 'In the alumni network', value: network, tone: 'brand', hint: 'Shared their contact details' },
    { key: 'open', label: 'Open to opportunities', value: open, tone: 'success', hint: 'Happy to hear about openings' },
    ...(manage ? [{ key: 'rehire', label: 'Eligible for rehire', value: rehire, tone: 'info', hint: 'As decided at exit' }] : []),
  ];
});
const selected = computed(() => {
  const f = table.filters;
  if (f.openToOpportunities && !f.optedIn && !f.rehire) return 'open';
  if (f.optedIn && !f.openToOpportunities && !f.rehire) return 'network';
  if (f.rehire === 'yes' && !f.optedIn && !f.openToOpportunities) return 'rehire';
  if (!f.rehire && !f.optedIn && !f.openToOpportunities) return 'all';
  return null;
});
function selectSegment(k: string | null) {
  table.filters.optedIn = k === 'network' || undefined;
  table.filters.openToOpportunities = k === 'open' || undefined;
  table.filters.rehire = k === 'rehire' ? 'yes' : undefined;
}

const VIEW_KEY = 'hrms.alumni.view';
const view = ref<'table' | 'grid'>(localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid');
watch(view, (v) => localStorage.setItem(VIEW_KEY, v));
const viewOptions = [
  { value: 'grid' as const, label: 'Cards', icon: LayoutGrid },
  { value: 'table' as const, label: 'Table', icon: Rows3 },
];
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Alumni" description="Everyone who has left, with the contact details of those who joined the alumni network." />

    <AppStatStrip :items="strip" :loading="totals.loading.value && !totals.data.value" selectable :selected="selected" label="Alumni directory" @select="selectSegment" />

    <AppCard :padded="false">
      <div class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
        <AppSearchInput v-model="table.search.value" class="min-w-56 flex-1" placeholder="Search by name or code" aria-label="Search alumni" />
        <AppSelect v-if="manage" v-model="table.filters.rehire" class="w-56" :options="rehireOptions" placeholder="Any rehire decision" aria-label="Filter by rehire eligibility" />
        <AppCheckbox v-model="inNetwork" label="In the alumni network" />
        <AppCheckbox v-model="openOnly" label="Open to opportunities" />
        <AppSegmented v-model="view" class="w-44 max-md:hidden" size="sm" :options="viewOptions" label="Layout" />
      </div>

      <div v-if="view === 'grid'" :aria-busy="table.loading.value || undefined">
        <AppErrorState v-if="table.error.value && !table.loading.value" :error="table.error.value" @retry="table.load" />
        <template v-else>
          <ul v-if="table.loading.value && !table.rows.value.length" class="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" aria-label="Loading alumni">
            <li v-for="i in 4" :key="i" class="card overflow-hidden">
              <div class="skeleton h-16 rounded-none" />
              <div class="flex flex-col items-center gap-2 px-4 pb-5">
                <div class="relative z-10 -mt-10 h-22 w-22 rounded-full bg-surface p-1"><div class="skeleton h-full w-full rounded-full" /></div>
                <div class="skeleton h-3.5 w-2/3 rounded-full" />
                <div class="skeleton h-3 w-1/2 rounded-full" />
                <div class="skeleton mt-3 h-12 w-full rounded-lg" />
              </div>
            </li>
          </ul>
          <ul v-else-if="table.rows.value.length" :class="['grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4', table.loading.value && 'opacity-60']" aria-label="Alumni">
            <li v-for="r in table.rows.value" :key="r.id"><AlumniProfileCard :row="r" :manage="manage" /></li>
          </ul>
          <AppEmptyState v-else-if="table.isFiltered.value" :icon="SearchX" title="No matches" description="Nothing matches your search or filters.">
            <AppButton variant="secondary" size="sm" :icon="FilterX" @click="table.clearFilters()">Clear filters</AppButton>
          </AppEmptyState>
          <AppEmptyState v-else :icon="GraduationCap" title="No alumni yet" description="People appear here once their exit is completed. They can then join the network from their exit page." />
          <AppPagination v-if="table.meta.value && table.meta.value.total > 0" class="border-t border-line" :meta="table.meta.value" :disabled="table.loading.value" @change="table.setPage" />
        </template>
      </div>

      <AppDataTable
        v-else
        :grid="false"
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
        :filtered="table.isFiltered.value"
        @clear="table.clearFilters()"
      >
        <template #cell-person="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.name" size="md" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ [row.employeeCode, row.designation, row.department].filter(Boolean).join(' · ') }}</p>
            </div>
          </div>
        </template>
        <template #cell-exit="{ row }">
          <p class="text-fg tabular-nums">{{ row.exitDate ? formatDate(row.exitDate) : '—' }}</p>
          <p class="text-xs text-fg-muted">{{ row.exit ? TYPE_LABELS[row.exit.type] : 'No exit record' }} · joined {{ formatDate(row.dateOfJoining) }}</p>
        </template>
        <template #cell-rehire="{ row }">
          <AppBadge v-if="row.exit" size="sm" dot :tone="rehireBadge(row.exit.eligibleForRehire).tone">{{ rehireBadge(row.exit.eligibleForRehire).label }}</AppBadge>
          <span v-else class="text-xs text-fg-muted">—</span>
        </template>
        <template #cell-now="{ row }">
          <template v-if="row.alumni">
            <p class="text-fg">{{ [row.alumni.currentTitle, row.alumni.currentCompany].filter(Boolean).join(' at ') || '—' }}</p>
            <p class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span v-if="row.alumni.city" class="inline-flex items-center gap-1"><MapPin :size="11" aria-hidden="true" />{{ row.alumni.city }}</span>
              <AppBadge v-if="row.alumni.openToOpportunities" size="sm" tone="brand" dot>Open to opportunities</AppBadge>
            </p>
          </template>
          <span v-else class="text-xs text-fg-subtle">Not in the network</span>
        </template>
        <template #cell-contact="{ row }">
          <div v-if="row.alumni" class="flex flex-wrap gap-3 text-xs" @click.stop>
            <a v-if="row.alumni.personalEmail" :href="`mailto:${row.alumni.personalEmail}`" class="inline-flex items-center gap-1 text-accent-fg hover:underline"><Mail :size="13" aria-hidden="true" />{{ row.alumni.personalEmail }}</a>
            <a v-if="row.alumni.phone" :href="`tel:${row.alumni.phone}`" class="inline-flex items-center gap-1 text-accent-fg hover:underline"><Phone :size="13" aria-hidden="true" />{{ row.alumni.phone }}</a>
            <a v-if="row.alumni.linkedinUrl" :href="row.alumni.linkedinUrl" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-accent-fg hover:underline"><ExternalLink :size="13" aria-hidden="true" />LinkedIn</a>
          </div>
          <span v-else class="text-xs text-fg-muted">—</span>
        </template>
      </AppDataTable>
    </AppCard>
  </div>
</template>
