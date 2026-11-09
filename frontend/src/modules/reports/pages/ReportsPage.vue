<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowRight, Building2, CalendarRange, Download, FileBarChart, Info, SearchX } from '@lucide/vue';
import type { ReportKey } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { reportsApi, type ReportResult } from '@/modules/reports/api/reports.api';
import ReportKpiCard from '@/modules/reports/components/ReportKpiCard.vue';
import { PERIOD_LABELS, REPORT_CATEGORIES, REPORTS, formatValue, type ReportCategory, type ReportDefinition } from '@/modules/reports/utils/report-definitions';
import { KPI_META, SERIES_COLORS, chartable, sparkFor } from '@/modules/reports/utils/report-visuals';
import { AppButton, AppCard, AppEmptyState, AppPageHeader, AppSearchInput, AppSegmented, AppSparkline } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';

/** Reports hub: today's workforce, then every report the user may run with its live headline figure and a preview. */
const auth = useAuthStore();
const available = computed(() => REPORTS.filter((r) => auth.can(r.permission)));
const canExport = auth.can('reports.export');

/** Each report with its default period, loaded side by side; one failing doesn't hide the others. */
const previews = useAsync(async () => {
  const settled = await Promise.allSettled(available.value.map((r) => reportsApi.run(r.key, {})));
  return Object.fromEntries(available.value.map((r, i) => [r.key, settled[i]!.status === 'fulfilled' ? settled[i]!.value : null])) as Partial<Record<ReportKey, ReportResult | null>>;
});
const result = (key: ReportKey) => previews.data.value?.[key] ?? null;

const headcountDef = REPORTS.find((r) => r.key === 'headcount')!;
const showSnapshot = computed(() => available.value.includes(headcountDef));
const snapshot = computed(() => result('headcount'));
const snapshotCards = computed(() =>
  headcountDef.summary.map((s) => ({
    key: s.key,
    label: s.label,
    value: snapshot.value ? formatValue(snapshot.value.summary[s.key] ?? null, s.format) : '…',
    tone: s.tone ?? 'brand',
    icon: KPI_META[s.key]?.icon ?? Info,
    hint: KPI_META[s.key]?.hint,
    spark: sparkFor('headcount', s.key, snapshot.value),
    changeLabel: (diff: number) => formatValue(diff, s.format),
  })),
);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : m);
function periodText(res: ReportResult | null): string | null {
  if (!res) return null;
  if (res.asOf) return `On ${formatDate(res.asOf)}`;
  if (res.from && res.to) return `${formatDate(res.from)} – ${formatDate(res.to)}`;
  if (res.fromMonth && res.toMonth) return `${month(res.fromMonth)} – ${month(res.toMonth)}`;
  return null;
}

/** Headline figure, a supporting figure, and a preview: the trend when there is one, else the main breakdown split. */
function preview(r: ReportDefinition) {
  const res = result(r.key);
  if (!res) return null;
  const [main, second] = r.summary;
  const trendKpi = r.summary.find((s) => sparkFor(r.key, s.key, res));
  const split = res.tables.map((t) => ({ t, spec: chartable(t) })).find((x) => x.spec?.whole);
  const parts = split
    ? (() => {
        const rows = [...split.t.rows].sort((a, b) => Number(b[split.spec!.bar.key] ?? 0) - Number(a[split.spec!.bar.key] ?? 0));
        const total = rows.reduce((n, row) => n + Number(row[split.spec!.bar.key] ?? 0), 0) || 1;
        return {
          title: split.t.title,
          items: rows.map((row, i) => ({ label: String(row[split.spec!.label]), pct: (Number(row[split.spec!.bar.key] ?? 0) / total) * 100, color: SERIES_COLORS[i % SERIES_COLORS.length]! })),
        };
      })()
    : null;
  return {
    value: main ? formatValue(res.summary[main.key] ?? null, main.format) : '—',
    label: main?.label ?? '',
    second: second ? `${second.label} ${formatValue(res.summary[second.key] ?? null, second.format)}` : null,
    spark: trendKpi ? sparkFor(r.key, trendKpi.key, res) : null,
    tone: main?.tone ?? 'brand',
    parts,
    period: periodText(res),
  };
}
const cards = computed(() => available.value.map((r) => ({ def: r, preview: preview(r) })));

const search = ref('');
const category = ref<'all' | ReportCategory>('all');
const categories = computed(() => (Object.keys(REPORT_CATEGORIES) as ReportCategory[]).filter((c) => available.value.some((r) => r.category === c)));
const categoryOptions = computed(() => [
  { value: 'all' as const, label: `All ${available.value.length}` },
  ...categories.value.map((c) => ({ value: c, label: `${REPORT_CATEGORIES[c].label} ${available.value.filter((r) => r.category === c).length}`, icon: REPORT_CATEGORIES[c].icon })),
]);
const matches = computed(() => {
  const q = search.value.trim().toLowerCase();
  return cards.value.filter(
    ({ def: r }) => (category.value === 'all' || r.category === category.value) && (!q || [r.title, r.description, ...r.breakdowns].some((t) => t.toLowerCase().includes(q))),
  );
});
function clear() {
  search.value = '';
  category.value = 'all';
}
</script>

<template>
  <div class="space-y-6">
    <AppPageHeader title="Reports" description="Figures across the organization. HR reports cover the people within your access; every report can be filtered and exported." />

    <AppCard v-if="!available.length">
      <AppEmptyState :icon="FileBarChart" title="No reports available" description="Your roles do not include report access. Ask an administrator if you need workforce or payroll figures." />
    </AppCard>

    <template v-else>
      <section v-if="showSnapshot" aria-labelledby="snapshot-title" class="space-y-3">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="snapshot-title" class="text-sm font-semibold text-fg">
            Workforce today <span class="font-normal text-fg-muted">· {{ formatDate(snapshot?.asOf ?? new Date()) }}</span>
          </h2>
          <AppButton size="xs" variant="link" :icon-right="ArrowRight" to="/hr/reports/headcount">Open headcount report</AppButton>
        </div>
        <p v-if="previews.error.value || (previews.data.value && !snapshot)" class="card px-4 py-3 text-sm text-fg-muted">Today's figures could not be loaded. The reports below still work.</p>
        <ul v-else :class="['grid gap-3 sm:grid-cols-2 lg:grid-cols-5', previews.loading.value && !snapshot && 'animate-pulse']" aria-label="Workforce today">
          <li v-for="k in snapshotCards" :key="k.key">
            <ReportKpiCard :label="k.label" :value="k.value" :icon="k.icon" :tone="k.tone" :hint="k.hint" :spark="k.spark" :change-label="k.changeLabel" />
          </li>
        </ul>
      </section>

      <section aria-labelledby="library-title" class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <h2 id="library-title" class="me-2 text-sm font-semibold text-fg">Report library</h2>
          <AppSearchInput v-model="search" class="w-full sm:w-72" placeholder="Search reports" aria-label="Search reports" />
          <AppSegmented v-if="categories.length > 1" v-model="category" class="sm:ms-auto" size="sm" :options="categoryOptions" label="Report area" />
        </div>

        <AppCard v-if="!matches.length">
          <AppEmptyState :icon="SearchX" title="No reports match" description="Try another word, or show all areas.">
            <AppButton size="sm" variant="secondary" @click="clear">Clear search</AppButton>
          </AppEmptyState>
        </AppCard>

        <ul v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Reports">
          <li v-for="{ def: r, preview: p } in matches" :key="r.key">
            <RouterLink :to="`/hr/reports/${r.key}`" class="group card card-interactive flex h-full flex-col overflow-hidden focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:outline-none">
              <div class="flex items-start gap-3 p-5 pb-0">
                <span :class="['flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', REPORT_CATEGORIES[r.category].tile]" aria-hidden="true"><component :is="r.icon" :size="20" /></span>
                <div class="min-w-0 flex-1">
                  <p class="text-2xs font-semibold tracking-wider text-fg-subtle uppercase">{{ REPORT_CATEGORIES[r.category].label }}</p>
                  <h3 class="font-semibold text-fg transition group-hover:text-accent-fg">{{ r.title }}</h3>
                </div>
                <span class="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted">
                  <CalendarRange :size="11" aria-hidden="true" />{{ PERIOD_LABELS[r.period] }}
                </span>
              </div>

              <!-- Live figure and preview -->
              <div class="mx-5 mt-4 rounded-xl border border-line/70 bg-surface-muted/40 p-4">
                <template v-if="p">
                  <div class="flex items-end justify-between gap-3">
                    <div class="min-w-0">
                      <p class="text-2xl leading-none font-semibold tracking-tight text-fg tabular-nums">{{ p.value }}</p>
                      <p class="mt-1.5 truncate text-xs text-fg-muted">{{ p.label }}<template v-if="p.second"> · {{ p.second }}</template></p>
                    </div>
                    <div v-if="p.spark" class="w-28 shrink-0"><AppSparkline :values="p.spark" :tone="p.tone" :height="36" /></div>
                  </div>
                  <div v-if="!p.spark && p.parts" class="mt-3">
                    <div class="flex h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                      <div v-for="it in p.parts.items" :key="it.label" class="h-full first:rounded-s-full last:rounded-e-full" :style="{ width: `${it.pct}%`, background: it.color }" />
                    </div>
                    <ul class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-muted" :aria-label="p.parts.title">
                      <li v-for="it in p.parts.items.filter((x) => x.pct > 0).slice(0, 3)" :key="it.label" class="inline-flex items-center gap-1.5">
                        <span class="h-2 w-2 rounded-sm" :style="{ background: it.color }" aria-hidden="true" />{{ it.label }} {{ Math.round(it.pct) }}%
                      </li>
                    </ul>
                  </div>
                  <p v-if="p.period" class="mt-3 text-2xs text-fg-subtle">{{ p.period }}</p>
                </template>
                <div v-else-if="previews.loading.value" class="space-y-2" aria-hidden="true">
                  <div class="skeleton h-6 w-24 rounded-md" />
                  <div class="skeleton h-3 w-40 rounded-full" />
                </div>
                <p v-else class="text-xs text-fg-muted">Open the report to see its figures.</p>
              </div>

              <div class="flex flex-1 flex-col p-5 pt-4">
                <p class="line-clamp-2 text-sm text-fg-muted">{{ r.description }}</p>
                <ul class="mt-3 flex flex-wrap gap-1.5" aria-label="Breakdowns">
                  <li v-for="b in r.breakdowns.slice(0, 4)" :key="b" class="rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted ring-1 ring-line ring-inset">{{ b }}</li>
                  <li v-if="r.breakdowns.length > 4" class="px-1 py-0.5 text-2xs text-fg-subtle">+{{ r.breakdowns.length - 4 }} more</li>
                </ul>
                <div class="mt-auto pt-4">
                  <div class="flex items-center justify-between gap-2 border-t border-line/70 pt-3 text-xs">
                    <span class="inline-flex items-center gap-3 text-fg-subtle">
                      <span v-if="r.departmentFilter" class="inline-flex items-center gap-1"><Building2 :size="12" aria-hidden="true" />By department</span>
                      <span v-if="canExport" class="inline-flex items-center gap-1"><Download :size="12" aria-hidden="true" />Excel · PDF · CSV</span>
                    </span>
                    <span class="inline-flex items-center gap-1 font-medium text-accent-fg">Open report<ArrowRight :size="14" class="transition group-hover:translate-x-0.5" aria-hidden="true" /></span>
                  </div>
                </div>
              </div>
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
