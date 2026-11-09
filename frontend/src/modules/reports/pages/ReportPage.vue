<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Building2, CalendarRange, ChevronDown, ChevronRight, Download, FileSpreadsheet, FileText, Info, Layers, Lightbulb, Loader2, RotateCcw, Sheet, Users } from '@lucide/vue';
import type { ReportExportFormat } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { structureApi } from '@/modules/people/api/people.api';
import { reportsApi, type ReportQuery } from '@/modules/reports/api/reports.api';
import ReportKpiCard from '@/modules/reports/components/ReportKpiCard.vue';
import ReportTableCard from '@/modules/reports/components/ReportTableCard.vue';
import { KPI_META, highlights, sparkFor } from '@/modules/reports/utils/report-visuals';
import TrendChart from '@/modules/reports/components/TrendChart.vue';
import { PERIOD_LABELS, REPORT_CATEGORIES, REPORTS, formatValue } from '@/modules/reports/utils/report-definitions';
import { AppAlert, AppBadge, AppButton, AppCard, AppDatePicker, AppDropdown, AppErrorState, AppInput, AppMenuItem, AppPageHeader, AppSelect, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** One report: period and department filters with quick presets, headline figures, trend chart, tables and export. */
const route = useRoute();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const def = computed(() => REPORTS.find((r) => r.key === route.params.key) ?? null);
const category = computed(() => (def.value ? REPORT_CATEGORIES[def.value.category] : null));
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = iso(new Date());
const thisMonth = today.slice(0, 7);
const year = Number(today.slice(0, 4));
const filters = reactive({ asOf: today as string | undefined, from: undefined as string | undefined, to: today as string | undefined, fromMonth: '', toMonth: thisMonth, departmentId: null as string | null });

/** Months or days back from today, as the start of a period. */
function back(amount: number, unit: 'days' | 'months') {
  const d = new Date();
  if (unit === 'months') d.setMonth(d.getMonth() - amount);
  else d.setDate(d.getDate() - amount);
  return iso(d);
}
function resetFilters() {
  const d = def.value;
  if (!d) return;
  if (d.period === 'months') Object.assign(filters, { fromMonth: back(d.defaultBack ?? 11, 'months').slice(0, 7), toMonth: thisMonth });
  else Object.assign(filters, { asOf: today, from: back(d.defaultBack ?? 30, 'days'), to: today });
  filters.departmentId = null;
}
resetFilters();

interface Preset {
  key: string;
  label: string;
  values: Partial<typeof filters>;
}
const lastMonthEnd = (() => {
  const d = new Date();
  d.setDate(0);
  return iso(d);
})();
const presets = computed<Preset[]>(() => {
  const p = def.value?.period;
  if (p === 'asOf')
    return [
      { key: 'today', label: 'Today', values: { asOf: today } },
      { key: 'month-end', label: 'Last month end', values: { asOf: lastMonthEnd } },
      { key: 'year-end', label: `End of ${year - 1}`, values: { asOf: `${year - 1}-12-31` } },
    ];
  if (p === 'months')
    return [
      { key: '6m', label: 'Last 6 months', values: { fromMonth: back(5, 'months').slice(0, 7), toMonth: thisMonth } },
      { key: '12m', label: 'Last 12 months', values: { fromMonth: back(11, 'months').slice(0, 7), toMonth: thisMonth } },
      { key: 'ytd', label: 'This year', values: { fromMonth: `${year}-01`, toMonth: thisMonth } },
    ];
  return [
    { key: '30d', label: 'Last 30 days', values: { from: back(30, 'days'), to: today } },
    { key: '90d', label: 'Last 90 days', values: { from: back(90, 'days'), to: today } },
    { key: '12m', label: 'Last 12 months', values: { from: back(365, 'days'), to: today } },
    { key: 'ytd', label: 'Year to date', values: { from: `${year}-01-01`, to: today } },
  ];
});
const isActive = (p: Preset) => (Object.keys(p.values) as (keyof typeof filters)[]).every((k) => filters[k] === p.values[k]);
const defaultPeriod = computed(() => {
  const d = def.value;
  if (!d) return {};
  return d.period === 'months' ? { fromMonth: back(d.defaultBack ?? 11, 'months').slice(0, 7), toMonth: thisMonth } : d.period === 'asOf' ? { asOf: today } : { from: back(d.defaultBack ?? 30, 'days'), to: today };
});
const modified = computed(() => !!filters.departmentId || !(Object.keys(defaultPeriod.value) as (keyof typeof filters)[]).every((k) => filters[k] === (defaultPeriod.value as Partial<typeof filters>)[k]));

const query = computed<ReportQuery>(() => {
  const d = def.value;
  if (!d) return {};
  const base = d.departmentFilter && filters.departmentId ? { departmentId: filters.departmentId } : {};
  if (d.period === 'asOf') return { ...base, asOf: filters.asOf };
  if (d.period === 'months') return { ...base, fromMonth: filters.fromMonth || undefined, toMonth: filters.toMonth || undefined };
  return { ...base, from: filters.from, to: filters.to };
});
const report = useAsync(() => reportsApi.run(def.value!.key, query.value), { immediate: !!def.value });
watch(
  () => route.params.key,
  () => {
    resetFilters();
    if (def.value) void report.run();
  },
);
watch(query, () => {
  if (def.value) void report.run();
}, { deep: true });
const departments = useAsync(() => structureApi.departments(), { immediate: !!def.value?.departmentFilter });
const departmentOptions = computed(() => (departments.data.value ?? []).map((d) => ({ value: d.id, label: d.name })));
const departmentName = computed(() => departmentOptions.value.find((o) => o.value === filters.departmentId)?.label ?? 'All departments');
const r = computed(() => report.data.value);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const chartPoints = computed(() => {
  const c = def.value?.chart;
  if (!c || !r.value?.trend) return [];
  return r.value.trend.map((t) => {
    const m = String(t.month);
    const label = /^\d{4}-\d{2}$/.test(m) ? `${MONTH_NAMES[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}` : m.replace(/ (\d{2})(\d{2})$/, ' $2');
    return { label, value: Number(t[c.key] ?? 0) };
  });
});
const monthLabel = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? `${MONTH_NAMES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : m);
const periodLabel = computed(() => {
  if (!r.value) return '';
  if (r.value.asOf) return `On ${formatDate(r.value.asOf)}`;
  if (r.value.from) return `${formatDate(r.value.from)} – ${formatDate(r.value.to!)}`;
  return `${monthLabel(r.value.fromMonth ?? '')} – ${monthLabel(r.value.toMonth ?? '')}`;
});
const kpis = computed(() => {
  const d = def.value;
  if (!d || !r.value) return [];
  return d.summary.map((s) => ({
    key: s.key,
    label: s.label,
    value: formatValue(r.value!.summary[s.key] ?? null, s.format),
    tone: s.tone ?? 'brand',
    icon: KPI_META[s.key]?.icon ?? Info,
    hint: KPI_META[s.key]?.hint,
    spark: sparkFor(d.key, s.key, r.value),
    changeLabel: (diff: number) => formatValue(diff, s.format),
  }));
});
const kpiCols = computed(() => ({ 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' })[kpis.value.length] ?? 'lg:grid-cols-4');
const takeaways = computed(() => (r.value ? highlights(r.value) : []));
const takeawayCols = computed(() => ({ 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 xl:grid-cols-4' })[takeaways.value.length] ?? '');
const others = computed(() => REPORTS.filter((x) => x.key !== def.value?.key && auth.can(x.permission)));

const exporting = ref<ReportExportFormat | null>(null);
async function exportAs(format: ReportExportFormat) {
  if (!def.value) return;
  exporting.value = format;
  try {
    await reportsApi.export(def.value.key, query.value, format);
  } catch (e) {
    feedback.error('Could not export the report', e);
  } finally {
    exporting.value = null;
  }
}
</script>

<template>
  <div>
    <AppPageHeader v-if="!def" title="Report not found" back="/hr/reports" back-label="Reports" />
    <AppAlert v-if="!def" tone="error">This report doesn't exist. Pick one from the reports list.</AppAlert>
    <template v-else>
      <AppPageHeader :title="def.title" :description="def.description" back="/hr/reports" back-label="Reports">
        <template #leading>
          <span :class="['flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', category?.tile]" aria-hidden="true"><component :is="def.icon" :size="20" /></span>
        </template>
        <template #badges>
          <AppBadge size="sm">{{ category?.label }}</AppBadge>
        </template>
        <template #actions>
          <AppButton v-if="modified" variant="ghost" :icon="RotateCcw" @click="resetFilters">Reset filters</AppButton>
          <AppDropdown v-if="auth.can('reports.export')" label="Export" width="w-56">
            <template #trigger="{ toggle }"><AppButton variant="secondary" :icon="Download" :icon-right="ChevronDown" :disabled="!r" :loading="!!exporting" @click="toggle">Export</AppButton></template>
            <template #default="{ close }">
              <AppMenuItem :icon="FileSpreadsheet" @select="close(); exportAs('xlsx')">Excel workbook (.xlsx)</AppMenuItem>
              <AppMenuItem :icon="FileText" @select="close(); exportAs('pdf')">PDF document</AppMenuItem>
              <AppMenuItem :icon="Sheet" @select="close(); exportAs('csv')">CSV (tables only)</AppMenuItem>
            </template>
          </AppDropdown>
        </template>
      </AppPageHeader>

      <section class="card mb-4" aria-label="Report filters">
        <div class="flex flex-wrap items-end gap-3 p-4">
          <AppDatePicker v-if="def.period === 'asOf'" v-model="filters.asOf" class="w-48 max-sm:flex-1" label="On" :max="today" />
          <template v-else-if="def.period === 'range'">
            <AppDatePicker v-model="filters.from" class="w-48 max-sm:flex-1" label="From" :max="filters.to" />
            <AppDatePicker v-model="filters.to" class="w-48 max-sm:flex-1" label="To" :max="today" />
          </template>
          <template v-else>
            <AppInput v-model="filters.fromMonth" class="w-40 max-sm:flex-1" label="From month" type="month" />
            <AppInput v-model="filters.toMonth" class="w-40 max-sm:flex-1" label="To month" type="month" />
          </template>
          <AppSelect v-if="def.departmentFilter" v-model="filters.departmentId" class="w-56 max-sm:w-full" label="Department" placeholder="All departments" :options="departmentOptions" />
          <div class="flex flex-wrap items-center gap-1.5 lg:ms-auto" role="group" aria-label="Quick periods">
            <button
              v-for="p in presets"
              :key="p.key"
              type="button"
              :aria-pressed="isActive(p)"
              :class="[
                'h-8 rounded-full px-3 text-xs font-medium ring-1 transition ring-inset focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
                isActive(p) ? 'bg-accent-soft text-accent-fg ring-brand-500/30' : 'text-fg-muted ring-line hover:bg-surface-muted hover:text-fg',
              ]"
              @click="Object.assign(filters, p.values)"
            >
              {{ p.label }}
            </button>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/70 bg-surface-muted/40 px-4 py-2 text-xs text-fg-muted">
          <span class="inline-flex items-center gap-1.5"><CalendarRange :size="13" aria-hidden="true" /><span class="font-medium text-fg">{{ periodLabel || '…' }}</span></span>
          <span v-if="def.departmentFilter" class="inline-flex items-center gap-1.5"><Building2 :size="13" aria-hidden="true" />{{ departmentName }}</span>
          <span class="inline-flex items-center gap-1.5"><Users :size="13" aria-hidden="true" />People within your access</span>
          <span v-if="report.loading.value && r" class="ms-auto inline-flex items-center gap-1.5 text-accent-fg" role="status"><Loader2 :size="13" class="animate-spin" aria-hidden="true" />Updating…</span>
        </div>
      </section>

      <div v-if="report.loading.value && !r" class="space-y-4">
        <div class="card skeleton h-24" />
        <div class="card p-4"><AppSkeleton :lines="8" /></div>
      </div>
      <AppErrorState v-else-if="report.error.value" :error="report.error.value" @retry="report.run" />
      <div v-else-if="r" class="space-y-4">
        <ul :class="['grid gap-3 transition-opacity sm:grid-cols-2', kpiCols, report.loading.value && 'opacity-60']" :aria-label="`${def.title} summary`">
          <li v-for="k in kpis" :key="k.key">
            <ReportKpiCard :label="k.label" :value="k.value" :icon="k.icon" :tone="k.tone" :hint="k.hint" :spark="k.spark" :change-label="k.changeLabel" />
          </li>
        </ul>
        <div class="space-y-4">
          <div class="min-w-0 space-y-4 transition-opacity" :class="report.loading.value && 'opacity-60'" :aria-busy="report.loading.value || undefined">
            <div :class="['grid items-stretch gap-4', def.chart && takeaways.length && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]']">
              <TrendChart v-if="def.chart" :title="def.chart.label" :description="periodLabel" :points="chartPoints" :format="def.chart.format" :kind="def.chart.kind" />
              <AppCard v-if="takeaways.length" title="Key takeaways" description="Worked out from the figures below" :icon="Lightbulb">
                <ul :class="['grid gap-3', !def.chart && takeawayCols]">
                  <li v-for="(t, i) in takeaways" :key="i" class="flex items-start gap-2.5 rounded-lg bg-surface-muted/50 p-3 text-sm leading-snug text-fg">
                    <span class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-fg" aria-hidden="true">{{ i + 1 }}</span>
                    {{ t }}
                  </li>
                </ul>
              </AppCard>
            </div>
            <div class="grid items-start gap-4 xl:grid-cols-2">
              <ReportTableCard v-for="t in r.tables" :key="t.key" :table="t" :class="t.columns.length > 4 ? 'xl:col-span-2' : ''" />
            </div>
          </div>

          <aside class="grid items-start gap-4 lg:grid-cols-2" aria-label="Report details">
            <AppCard title="About this report" :icon="Info">
              <dl class="space-y-3 text-sm">
                <div class="flex items-start gap-3">
                  <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><CalendarRange :size="14" /></span>
                  <div class="min-w-0"><dt class="text-xs text-fg-muted">{{ PERIOD_LABELS[def.period] }}</dt><dd class="font-medium text-fg">{{ periodLabel }}</dd></div>
                </div>
                <div v-if="def.departmentFilter" class="flex items-start gap-3">
                  <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><Building2 :size="14" /></span>
                  <div class="min-w-0"><dt class="text-xs text-fg-muted">Department</dt><dd class="truncate font-medium text-fg">{{ departmentName }}</dd></div>
                </div>
                <div class="flex items-start gap-3">
                  <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><Layers :size="14" /></span>
                  <div class="min-w-0">
                    <dt class="text-xs text-fg-muted">Broken down by</dt>
                    <dd class="mt-1 flex flex-wrap gap-1">
                      <span v-for="b in def.breakdowns" :key="b" class="rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted ring-1 ring-line ring-inset">{{ b }}</span>
                    </dd>
                  </div>
                </div>
              </dl>
              <p class="mt-4 rounded-md bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">Figures cover the people within your access, so colleagues with other roles may see different totals.</p>
            </AppCard>

            <AppCard v-if="others.length" title="Other reports" :padded="false">
              <ul class="divide-y divide-line/60">
                <li v-for="o in others" :key="o.key">
                  <RouterLink :to="`/hr/reports/${o.key}`" class="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-muted/50">
                    <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-md', REPORT_CATEGORIES[o.category].tile]" aria-hidden="true"><component :is="o.icon" :size="15" /></span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-fg">{{ o.title }}</span>
                      <span class="block truncate text-xs text-fg-muted">{{ REPORT_CATEGORIES[o.category].label }} · {{ PERIOD_LABELS[o.period].toLowerCase() }}</span>
                    </span>
                    <ChevronRight :size="15" class="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden="true" />
                  </RouterLink>
                </li>
              </ul>
            </AppCard>
          </aside>
        </div>
      </div>
    </template>
  </div>
</template>
