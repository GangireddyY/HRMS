<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowRight, Building2, CalendarRange, Download, FileBarChart, SearchX } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { reportsApi } from '@/modules/reports/api/reports.api';
import { PERIOD_LABELS, REPORT_CATEGORIES, REPORTS, formatValue, type ReportCategory } from '@/modules/reports/utils/report-definitions';
import { AppButton, AppCard, AppEmptyState, AppPageHeader, AppSearchInput, AppSegmented, AppStatStrip, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';

/** Reports hub: the reports the user may run, grouped by area and searchable, with today's workforce at a glance. */
const auth = useAuthStore();
const available = computed(() => REPORTS.filter((r) => auth.can(r.permission)));
const canExport = auth.can('reports.export');

const headcountDef = REPORTS.find((r) => r.key === 'headcount')!;
const showSnapshot = auth.can(headcountDef.permission);
const snapshot = useAsync(() => reportsApi.run('headcount', {}), { immediate: showSnapshot });
const snapshotItems = computed<StripItem[]>(() =>
  headcountDef.summary.map((s) => ({ key: s.key, label: s.label, value: snapshot.data.value ? formatValue(snapshot.data.value.summary[s.key] ?? null, s.format) : undefined, tone: s.tone ?? 'brand' })),
);

const search = ref('');
const category = ref<'all' | ReportCategory>('all');
const categories = computed(() => (Object.keys(REPORT_CATEGORIES) as ReportCategory[]).filter((c) => available.value.some((r) => r.category === c)));
const categoryOptions = computed(() => [
  { value: 'all' as const, label: `All ${available.value.length}` },
  ...categories.value.map((c) => ({ value: c, label: `${REPORT_CATEGORIES[c].label} ${available.value.filter((r) => r.category === c).length}`, icon: REPORT_CATEGORIES[c].icon })),
]);
const matches = computed(() => {
  const q = search.value.trim().toLowerCase();
  return available.value.filter(
    (r) => (category.value === 'all' || r.category === category.value) && (!q || [r.title, r.description, ...r.breakdowns].some((t) => t.toLowerCase().includes(q))),
  );
});
function clear() {
  search.value = '';
  category.value = 'all';
}
</script>

<template>
  <div class="space-y-5">
    <AppPageHeader title="Reports" description="Figures across the organization. HR reports cover the people within your access; every report can be filtered and exported." />

    <AppCard v-if="!available.length">
      <AppEmptyState :icon="FileBarChart" title="No reports available" description="Your roles do not include report access. Ask an administrator if you need workforce or payroll figures." />
    </AppCard>

    <template v-else>
      <section v-if="showSnapshot" aria-labelledby="snapshot-title" class="space-y-2">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="snapshot-title" class="text-sm font-semibold text-fg">
            Workforce today <span class="font-normal text-fg-muted">· {{ formatDate(snapshot.data.value?.asOf ?? new Date()) }}</span>
          </h2>
          <AppButton size="xs" variant="link" :icon-right="ArrowRight" to="/hr/reports/headcount">Open headcount report</AppButton>
        </div>
        <p v-if="snapshot.error.value" class="card px-4 py-3 text-sm text-fg-muted">Today's figures could not be loaded. The reports below still work.</p>
        <AppStatStrip v-else :items="snapshotItems" :loading="snapshot.loading.value" label="Workforce today" />
      </section>

      <div class="flex flex-wrap items-center gap-2">
        <AppSearchInput v-model="search" class="w-full sm:w-72" placeholder="Search reports" aria-label="Search reports" />
        <AppSegmented v-if="categories.length > 1" v-model="category" class="sm:ms-auto" size="sm" :options="categoryOptions" label="Report area" />
      </div>

      <AppCard v-if="!matches.length">
        <AppEmptyState :icon="SearchX" title="No reports match" description="Try another word, or show all areas.">
          <AppButton size="sm" variant="secondary" @click="clear">Clear search</AppButton>
        </AppEmptyState>
      </AppCard>

      <ul v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Reports">
        <li v-for="r in matches" :key="r.key">
          <RouterLink :to="`/hr/reports/${r.key}`" class="group card card-interactive flex h-full flex-col p-5">
            <div class="flex items-start gap-3">
              <span :class="['flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', REPORT_CATEGORIES[r.category].tile]" aria-hidden="true"><component :is="r.icon" :size="20" /></span>
              <div class="min-w-0 flex-1">
                <p class="text-2xs font-semibold tracking-wider text-fg-subtle uppercase">{{ REPORT_CATEGORIES[r.category].label }}</p>
                <p class="font-semibold text-fg">{{ r.title }}</p>
                <p class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                  <span class="inline-flex items-center gap-1"><CalendarRange :size="12" aria-hidden="true" />{{ PERIOD_LABELS[r.period] }}</span>
                  <span v-if="r.departmentFilter" class="inline-flex items-center gap-1"><Building2 :size="12" aria-hidden="true" />By department</span>
                </p>
              </div>
            </div>
            <p class="mt-3 text-sm text-fg-muted">{{ r.description }}</p>
            <ul class="mt-3 flex flex-wrap gap-1.5" aria-label="Breakdowns">
              <li v-for="b in r.breakdowns" :key="b" class="rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted ring-1 ring-line ring-inset">{{ b }}</li>
            </ul>
            <div class="mt-auto pt-4">
              <div class="flex items-center justify-between gap-2 border-t border-line/70 pt-3 text-xs">
                <span v-if="canExport" class="inline-flex items-center gap-1 text-fg-subtle"><Download :size="12" aria-hidden="true" />Excel · PDF · CSV</span>
                <span v-else />
                <span class="inline-flex items-center gap-1 font-medium text-accent-fg">Open report<ArrowRight :size="14" class="transition group-hover:translate-x-0.5" aria-hidden="true" /></span>
              </div>
            </div>
          </RouterLink>
        </li>
      </ul>
    </template>
  </div>
</template>
