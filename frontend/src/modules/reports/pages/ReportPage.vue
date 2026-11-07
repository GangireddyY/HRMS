<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ChevronDown, Download, FileSpreadsheet, FileText, Sheet } from '@lucide/vue';
import type { ReportExportFormat } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { structureApi } from '@/modules/people/api/people.api';
import { reportsApi, type ReportQuery } from '@/modules/reports/api/reports.api';
import ReportTableCard from '@/modules/reports/components/ReportTableCard.vue';
import TrendChart from '@/modules/reports/components/TrendChart.vue';
import { REPORTS, formatValue } from '@/modules/reports/utils/report-definitions';
import { AppAlert, AppButton, AppDatePicker, AppDropdown, AppErrorState, AppInput, AppMenuItem, AppPageHeader, AppSelect, AppSkeleton, AppStatCard } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const route = useRoute();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const def = computed(() => REPORTS.find((r) => r.key === route.params.key) ?? null);
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = iso(new Date());
const thisMonth = today.slice(0, 7);
const filters = reactive({ asOf: today as string | undefined, from: undefined as string | undefined, to: today as string | undefined, fromMonth: '', toMonth: thisMonth, departmentId: null as string | null });
function resetFilters() {
  const d = def.value;
  if (!d) return;
  const back = new Date();
  if (d.period === 'months') {
    back.setMonth(back.getMonth() - (d.defaultBack ?? 11));
    Object.assign(filters, { fromMonth: iso(back).slice(0, 7), toMonth: thisMonth });
  } else {
    back.setDate(back.getDate() - (d.defaultBack ?? 30));
    Object.assign(filters, { asOf: today, from: iso(back), to: today });
  }
  filters.departmentId = null;
}
resetFilters();
const query = computed<ReportQuery>(() => {
  const d = def.value!;
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
const periodLabel = computed(() => {
  if (!r.value) return '';
  if (r.value.asOf) return `On ${formatDate(r.value.asOf)}`;
  if (r.value.from) return `${formatDate(r.value.from)} – ${formatDate(r.value.to!)}`;
  return `${r.value.fromMonth} – ${r.value.toMonth}`;
});
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
    <AppAlert v-if="!def" tone="error">This report doesn't exist.</AppAlert>
    <template v-else>
      <AppPageHeader :title="def.title" :description="def.description" back="/hr/reports" back-label="Reports">
        <template v-if="auth.can('reports.export')" #actions>
          <AppDropdown label="Export" width="w-56">
            <template #trigger="{ toggle }"><AppButton variant="secondary" :icon="Download" :icon-right="ChevronDown" :disabled="!r" :loading="!!exporting" @click="toggle">Export</AppButton></template>
            <template #default="{ close }">
              <AppMenuItem :icon="FileSpreadsheet" @select="close(); exportAs('xlsx')">Excel workbook (.xlsx)</AppMenuItem>
              <AppMenuItem :icon="FileText" @select="close(); exportAs('pdf')">PDF document</AppMenuItem>
              <AppMenuItem :icon="Sheet" @select="close(); exportAs('csv')">CSV (tables only)</AppMenuItem>
            </template>
          </AppDropdown>
        </template>
      </AppPageHeader>

      <div class="mb-4 flex flex-wrap items-end gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line">
        <AppDatePicker v-if="def.period === 'asOf'" v-model="filters.asOf" class="w-48" label="On" :max="today" />
        <template v-else-if="def.period === 'range'">
          <AppDatePicker v-model="filters.from" class="w-48" label="From" :max="filters.to" />
          <AppDatePicker v-model="filters.to" class="w-48" label="To" :max="today" />
        </template>
        <template v-else>
          <AppInput v-model="filters.fromMonth" class="w-40" label="From month" type="month" />
          <AppInput v-model="filters.toMonth" class="w-40" label="To month" type="month" />
        </template>
        <AppSelect v-if="def.departmentFilter" v-model="filters.departmentId" class="w-56" label="Department" placeholder="All departments" :options="departmentOptions" />
        <p v-if="r" class="ml-auto text-xs text-fg-muted">{{ periodLabel }}</p>
      </div>

      <AppSkeleton v-if="report.loading.value && !r" :lines="8" />
      <AppErrorState v-else-if="report.error.value" :error="report.error.value" @retry="report.run" />
      <div v-else-if="r" class="space-y-4" :class="report.loading.value ? 'opacity-60 transition' : ''">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <AppStatCard v-for="s in def.summary" :key="s.key" :label="s.label" :value="formatValue(r.summary[s.key] ?? null, s.format)" :tone="s.tone" />
        </div>
        <TrendChart v-if="def.chart" :title="def.chart.label" :points="chartPoints" :format="def.chart.format" />
        <div class="grid items-start gap-4 xl:grid-cols-2">
          <ReportTableCard v-for="t in r.tables" :key="t.key" :table="t" :class="t.columns.length > 4 ? 'xl:col-span-2' : ''" />
        </div>
      </div>
    </template>
  </div>
</template>
