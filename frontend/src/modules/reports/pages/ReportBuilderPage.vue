<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { BookmarkPlus, ChevronDown, Download, Filter, Play, Plus, Search, Sigma, Table2, Trash2, X } from '@lucide/vue';
import type { BuilderColumn, BuilderDataset, BuilderFilter, BuilderOperator, BuilderQuery } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { reportsApi, type BuilderResult, type SavedReportRow } from '@/modules/reports/api/reports.api';
import ReportSchedulesCard from '@/modules/reports/components/ReportSchedulesCard.vue';
import { AppAlert, AppBadge, AppButton, AppCard, AppCheckbox, AppDatePicker, AppDropdown, AppEmptyState, AppErrorState, AppInput, AppMenuItem, AppModal, AppMultiPick, AppPageHeader, AppSegmented, AppSelect, AppSkeleton, AppSwitch } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { addDaysIso, localToday } from '@/shared/utils/dates';
import { formatDate, formatMoney, humanize, timeAgo } from '@/shared/utils/format';

/** Build a report: dataset → columns → filters → optional summary; preview, export, save. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const datasets = useAsync(() => reportsApi.datasets());
const saved = useAsync(() => reportsApi.saved());

const today = localToday();
const q = reactive({ dataset: 'employees' as BuilderDataset, columns: [] as string[], filters: [] as BuilderFilter[], sortColumn: null as string | null, sortDirection: 'asc' as 'asc' | 'desc', groupBy: null as string | null, from: `${today.slice(0, 7)}-01` as string | undefined, to: today as string | undefined });
const current = computed(() => datasets.data.value?.find((d) => d.key === q.dataset) ?? null);
const byKey = computed(() => new Map((current.value?.columns ?? []).map((c) => [c.key, c])));
const DEFAULTS: Record<BuilderDataset, string[]> = {
  employees: ['employeeCode', 'employee', 'department', 'designation', 'status', 'dateOfJoining'],
  leave_requests: ['employee', 'department', 'leaveType', 'startDate', 'endDate', 'days', 'status'],
  attendance: ['employee', 'date', 'status', 'checkIn', 'checkOut', 'workedHours'],
  claims: ['employee', 'category', 'title', 'expenseDate', 'amount', 'status'],
  payslips: ['employee', 'department', 'period', 'gross', 'deductions', 'netPay'],
};
function pick(dataset: BuilderDataset) {
  q.dataset = dataset;
  q.columns = DEFAULTS[dataset].filter((c) => byKey.value.has(c));
  q.filters = [];
  q.sortColumn = null;
  q.groupBy = null;
  loadedId.value = null;
  result.value = null;
}
watch(
  () => datasets.data.value,
  (list) => {
    if (list?.length && !list.some((d) => d.key === q.dataset)) pick(list[0]!.key);
    else if (list?.length && !q.columns.length) pick(q.dataset);
  },
);
const datasetOptions = computed(() => (datasets.data.value ?? []).map((d) => ({ value: d.key, label: d.label })));

// ---- Columns ---------------------------------------------------------------------------------------------------
const colSearch = ref('');
const groups = computed(() => {
  const term = colSearch.value.trim().toLowerCase();
  const by = new Map<string, BuilderColumn[]>();
  for (const c of current.value?.columns ?? []) {
    if (term && !c.label.toLowerCase().includes(term)) continue;
    by.set(c.group, [...(by.get(c.group) ?? []), c]);
  }
  return [...by.entries()].map(([group, cols]) => ({ group, cols }));
});
function toggleColumn(key: string, on: boolean) {
  q.columns = on ? [...q.columns, key] : q.columns.filter((c) => c !== key);
}
const columnOptions = computed(() => (current.value?.columns ?? []).map((c) => ({ value: c.key, label: c.label })));

// ---- Filters ---------------------------------------------------------------------------------------------------
const OPS: Record<BuilderColumn['type'], { value: BuilderOperator; label: string }[]> = {
  text: [
    { value: 'eq', label: 'is' },
    { value: 'neq', label: 'is not' },
    { value: 'in', label: 'is one of' },
    { value: 'contains', label: 'contains' },
    { value: 'empty', label: 'is empty' },
    { value: 'not_empty', label: 'is not empty' },
  ],
  number: [
    { value: 'eq', label: '=' },
    { value: 'gte', label: '≥' },
    { value: 'lte', label: '≤' },
    { value: 'neq', label: '≠' },
    { value: 'empty', label: 'is empty' },
    { value: 'not_empty', label: 'is not empty' },
  ],
  money: [],
  date: [
    { value: 'eq', label: 'on' },
    { value: 'gte', label: 'on or after' },
    { value: 'lte', label: 'on or before' },
    { value: 'empty', label: 'is empty' },
    { value: 'not_empty', label: 'is not empty' },
  ],
  boolean: [{ value: 'eq', label: 'is' }],
};
OPS.money = OPS.number;
function addFilter() {
  const first = current.value?.columns[0];
  if (first) q.filters.push({ column: first.key, op: first.values?.length ? 'in' : 'eq', value: null });
}
function filterColumnChanged(f: BuilderFilter) {
  const c = byKey.value.get(f.column);
  f.op = c?.values?.length ? 'in' : c?.type === 'boolean' ? 'eq' : 'eq';
  f.value = c?.type === 'boolean' ? true : null;
}
const needsValue = (f: BuilderFilter) => f.op !== 'empty' && f.op !== 'not_empty';
/** "ON_NOTICE" → "On notice"; ordinary values (department names, sizes) stay as they are. */
const label = (v: string) => (/^[A-Z][A-Z0-9_]*$/.test(v) && v.length > 2 ? `${v.charAt(0)}${v.slice(1).toLowerCase().replace(/_/g, ' ')}` : humanize(v));
const scalar = (f: BuilderFilter): string | number | null => (typeof f.value === 'string' || typeof f.value === 'number' ? f.value : null);
const valueOptions = (f: BuilderFilter) => (byKey.value.get(f.column)?.values ?? []).map((v) => ({ value: v, label: label(v) }));

// ---- Run -------------------------------------------------------------------------------------------------------
const query = computed<BuilderQuery>(() => ({
  dataset: q.dataset,
  columns: q.groupBy && !q.columns.includes(q.groupBy) ? [q.groupBy, ...q.columns] : q.columns,
  filters: q.filters.filter((f) => !needsValue(f) || (f.value !== null && f.value !== '' && !(Array.isArray(f.value) && !f.value.length))),
  sort: q.sortColumn ? { column: q.sortColumn, direction: q.sortDirection } : null,
  groupBy: q.groupBy,
  ...(current.value?.dated ? { from: q.from, to: q.to } : {}),
}));
const result = ref<BuilderResult | null>(null);
const running = ref(false);
const runError = ref<unknown>(null);
async function run() {
  if (!q.columns.length) return;
  running.value = true;
  runError.value = null;
  try {
    result.value = await reportsApi.runBuilder(query.value);
  } catch (e) {
    runError.value = e;
  } finally {
    running.value = false;
  }
}
const cell = (c: BuilderColumn, v: string | number | boolean | null) => {
  if (v === null || v === '') return '—';
  if (c.type === 'boolean') return v ? 'Yes' : 'No';
  if (c.type === 'money') return formatMoney(Number(v));
  if (c.type === 'date') return formatDate(String(v));
  if (c.type === 'number') return Number(v).toLocaleString();
  return c.values ? label(String(v)) : String(v);
};
const presets = computed(() => {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const mm = (n: number) => String(n).padStart(2, '0');
  const lastMonthEnd = addDaysIso(`${y}-${mm(m)}-01`, -1);
  return [
    { label: 'This month', from: `${y}-${mm(m)}-01`, to: today },
    { label: 'Last month', from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
    { label: 'Last 90 days', from: addDaysIso(today, -89), to: today },
    { label: 'This year', from: `${y}-01-01`, to: today },
  ].filter((p) => !current.value?.dated || (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 <= current.value.dated.maxDays);
});

// ---- Save / export ---------------------------------------------------------------------------------------------
const loadedId = ref<string | null>(null);
const canSchedule = auth.can('reports.export');
const datedDatasets = computed(() => (datasets.data.value ?? []).filter((d) => d.dated).map((d) => d.key));
const loaded = computed(() => saved.data.value?.find((s) => s.id === loadedId.value) ?? null);
function load(r: SavedReportRow) {
  q.dataset = r.dataset;
  q.columns = r.definition.columns.filter((c) => c !== r.definition.groupBy || r.definition.columns.indexOf(c) > 0);
  q.filters = (r.definition.filters ?? []).map((f) => ({ ...f }));
  q.sortColumn = r.definition.sort?.column ?? null;
  q.sortDirection = r.definition.sort?.direction ?? 'asc';
  q.groupBy = r.definition.groupBy ?? null;
  if (r.definition.from) q.from = r.definition.from;
  if (r.definition.to) q.to = r.definition.to;
  loadedId.value = r.id;
  void run();
}
const saveOpen = ref(false);
const saveForm = reactive({ name: '', description: '', shared: false, asNew: false });
function openSave() {
  Object.assign(saveForm, { name: loaded.value?.name ?? '', description: loaded.value?.description ?? '', shared: loaded.value?.shared ?? false, asNew: !loaded.value?.mine });
  saveOpen.value = true;
}
async function save() {
  try {
    const list = await reportsApi.save({ name: saveForm.name, description: saveForm.description || null, shared: saveForm.shared, query: query.value }, saveForm.asNew ? undefined : (loadedId.value ?? undefined));
    saved.data.value = list;
    loadedId.value = list.find((s) => s.name === saveForm.name && s.mine)?.id ?? loadedId.value;
    saveOpen.value = false;
    feedback.success('Report saved');
  } catch (e) {
    feedback.error('Could not save the report', e);
  }
}
async function removeSaved(r: SavedReportRow) {
  if (!(await feedback.confirm({ title: `Delete "${r.name}"?`, message: r.shared ? 'It is removed for everyone it was shared with.' : 'This only deletes the saved settings.', confirmLabel: 'Delete', danger: true }))) return;
  await reportsApi.removeSaved(r.id);
  if (loadedId.value === r.id) loadedId.value = null;
  await saved.run();
}
async function exportAs(format: 'csv' | 'xlsx') {
  try {
    await reportsApi.exportBuilder(query.value, format, loaded.value?.name ?? `${current.value?.label ?? 'Report'} report`);
  } catch (e) {
    feedback.error('Could not export the report', e);
  }
}
const sortOptions = computed(() => (result.value?.columns ?? q.columns.map((k) => byKey.value.get(k)).filter((c): c is BuilderColumn => !!c)).map((c) => ({ value: c.key, label: c.label })));
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Report builder" description="Pick the data, the columns and filters; summarize, then export or save it to run again.">
      <template #actions>
        <AppButton variant="secondary" :icon="BookmarkPlus" :disabled="!q.columns.length" @click="openSave">{{ loaded?.mine ? 'Save changes' : 'Save' }}</AppButton>
        <AppDropdown v-if="auth.can('reports.export')" label="Export" width="w-56">
          <template #trigger="{ toggle }"><AppButton variant="secondary" :icon="Download" :icon-right="ChevronDown" :disabled="!result" @click="toggle">Export</AppButton></template>
          <template #default="{ close }">
            <AppMenuItem @select="close(); exportAs('csv')">CSV</AppMenuItem>
            <AppMenuItem @select="close(); exportAs('xlsx')">Excel (.xlsx)</AppMenuItem>
          </template>
        </AppDropdown>
        <AppButton :icon="Play" :loading="running" :disabled="!q.columns.length" @click="run">Run</AppButton>
      </template>
    </AppPageHeader>

    <AppSkeleton v-if="datasets.loading.value && !datasets.data.value" :lines="8" />
    <AppErrorState v-else-if="datasets.error.value" :error="datasets.error.value" @retry="datasets.run" />
    <div v-else class="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside class="space-y-4">
        <AppCard title="Data" :icon="Table2">
          <AppSelect :model-value="q.dataset" label="Dataset" :options="datasetOptions" :clearable="false" @update:model-value="(v) => v && pick(v as BuilderDataset)" />
          <p v-if="current" class="mt-1.5 text-xs text-fg-muted">{{ current.description }}</p>
          <div v-if="current?.dated" class="mt-4 space-y-2">
            <p class="label">{{ current.dated.label }}</p>
            <div class="grid grid-cols-2 gap-2">
              <AppDatePicker v-model="q.from" aria-label="From" />
              <AppDatePicker v-model="q.to" aria-label="To" :min="q.from" />
            </div>
            <div class="flex flex-wrap gap-1">
              <button v-for="p in presets" :key="p.label" type="button" class="rounded-full px-2 py-0.5 text-2xs font-medium text-fg-muted ring-1 ring-line transition hover:bg-surface-muted hover:text-fg" @click="q.from = p.from; q.to = p.to">{{ p.label }}</button>
            </div>
            <p class="text-2xs text-fg-subtle">Up to {{ current.dated.maxDays }} days.</p>
          </div>
        </AppCard>

        <AppCard title="Columns" :description="`${q.columns.length} selected`" :padded="false">
          <div class="border-b border-line/70 p-3"><AppInput v-model="colSearch" :icon="Search" aria-label="Find a column" placeholder="Find a column" size="md" /></div>
          <div class="max-h-[22rem] space-y-3 overflow-y-auto p-3">
            <div v-for="g in groups" :key="g.group">
              <p class="mb-1 text-2xs font-semibold tracking-wide text-fg-muted uppercase">{{ g.group }}</p>
              <AppCheckbox v-for="c in g.cols" :key="c.key" :model-value="q.columns.includes(c.key)" :label="c.label" @update:model-value="(v: boolean) => toggleColumn(c.key, v)" />
            </div>
          </div>
        </AppCard>

        <AppCard title="Saved reports" :padded="false">
          <p v-if="!saved.data.value?.length" class="px-4 py-3 text-sm text-fg-muted">Nothing saved yet.</p>
          <ul v-else class="divide-y divide-line/70">
            <li v-for="r in saved.data.value" :key="r.id" :class="['flex items-center gap-2 px-3 py-2', loadedId === r.id && 'bg-accent-soft/50']">
              <button type="button" class="min-w-0 flex-1 text-start" @click="load(r)">
                <p class="truncate text-sm font-medium text-fg">{{ r.name }}</p>
                <p class="truncate text-2xs text-fg-muted">{{ datasets.data.value?.find((d) => d.key === r.dataset)?.label }}<template v-if="!r.mine"> · by {{ r.owner }}</template> · {{ timeAgo(r.updatedAt) }}</p>
              </button>
              <AppBadge v-if="r.shared" size="sm" tone="info">Shared</AppBadge>
              <AppButton v-if="r.mine" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${r.name}`" @click="removeSaved(r)" />
            </li>
          </ul>
        </AppCard>

        <ReportSchedulesCard v-if="canSchedule" :reports="saved.data.value ?? []" :dated-datasets="datedDatasets" :loaded-report-id="loadedId" />
      </aside>

      <div class="min-w-0 space-y-4">
        <AppCard title="Filters & summary" :icon="Filter">
          <ul v-if="q.filters.length" class="mb-3 space-y-2">
            <li v-for="(f, i) in q.filters" :key="i" class="grid items-start gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,9rem)_minmax(0,1fr)_auto]">
              <AppSelect v-model="f.column" :aria-label="`Filter ${i + 1} column`" :options="columnOptions" :clearable="false" searchable @update:model-value="filterColumnChanged(f)" />
              <AppSelect v-model="f.op" :aria-label="`Filter ${i + 1} condition`" :options="(OPS[byKey.get(f.column)?.type ?? 'text'] ?? []).filter((o) => o.value !== 'in' || !!byKey.get(f.column)?.values?.length)" :clearable="false" />
              <template v-if="needsValue(f)">
                <AppMultiPick v-if="f.op === 'in'" :model-value="(f.value as string[]) ?? []" label="" :options="valueOptions(f)" @update:model-value="(v: string[]) => (f.value = v)" />
                <AppSegmented v-else-if="byKey.get(f.column)?.type === 'boolean'" :model-value="f.value ? 'yes' : 'no'" :options="[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]" label="Value" size="sm" @update:model-value="(v: string) => (f.value = v === 'yes')" />
                <AppDatePicker v-else-if="byKey.get(f.column)?.type === 'date'" :model-value="(f.value as string) || undefined" :aria-label="`Filter ${i + 1} date`" @update:model-value="(v) => (f.value = v ?? null)" />
                <AppInput v-else :model-value="scalar(f)" :type="byKey.get(f.column)?.type === 'text' ? 'text' : 'number'" :aria-label="`Filter ${i + 1} value`" @update:model-value="(v) => (f.value = v)" />
              </template>
              <span v-else />
              <AppButton variant="ghost" :icon="X" :aria-label="`Remove filter ${i + 1}`" @click="q.filters.splice(i, 1)" />
            </li>
          </ul>
          <div class="flex flex-wrap items-end gap-3">
            <AppButton size="sm" variant="secondary" :icon="Plus" :disabled="q.filters.length >= 20" @click="addFilter">Add filter</AppButton>
            <div class="ms-auto flex flex-wrap items-end gap-3">
              <AppSelect v-model="q.groupBy" class="w-52" label="Summarize by" :options="columnOptions" placeholder="No summary" searchable />
              <AppSelect v-model="q.sortColumn" class="w-48" label="Sort by" :options="sortOptions" placeholder="Default order" />
              <AppSwitch v-if="q.sortColumn" :model-value="q.sortDirection === 'desc'" label="Descending" @update:model-value="(v: boolean) => (q.sortDirection = v ? 'desc' : 'asc')" />
            </div>
          </div>
          <p v-if="q.groupBy" class="mt-2 flex items-center gap-1.5 text-xs text-fg-muted"><Sigma :size="12" aria-hidden="true" />One row per {{ byKey.get(q.groupBy)?.label.toLowerCase() }}, with a count and totals of the number columns.</p>
        </AppCard>

        <AppCard :padded="false">
          <AppErrorState v-if="runError" :error="runError" title="The report couldn't run" @retry="run" />
          <div v-else-if="!result" class="py-10">
            <AppEmptyState :icon="Play" title="Run the report to see it" description="Choose columns on the left, add filters if you need them, then press Run." compact>
              <AppButton size="sm" :icon="Play" :loading="running" :disabled="!q.columns.length" @click="run">Run</AppButton>
            </AppEmptyState>
          </div>
          <template v-else>
            <div class="flex flex-wrap items-center gap-2 border-b border-line/70 px-4 py-2.5 text-sm">
              <span class="font-semibold text-fg tabular-nums">{{ result.total.toLocaleString() }}</span>
              <span class="text-fg-muted">{{ q.groupBy ? 'groups' : 'rows' }}</span>
              <span v-if="result.truncated" class="text-xs text-fg-subtle">· showing the first 500 · export for all</span>
              <AppAlert v-if="result.capped" tone="warning" class="w-full">Only the first 20,000 records were used. Narrow the period or add filters.</AppAlert>
            </div>
            <div class="max-h-[34rem] overflow-auto">
              <table class="w-full text-sm">
                <thead class="sticky top-0 z-10 bg-surface-muted">
                  <tr>
                    <th v-for="c in result.columns" :key="c.key" scope="col" :class="['px-3 py-2 text-2xs font-semibold tracking-wide whitespace-nowrap text-fg-muted uppercase', c.type === 'number' || c.type === 'money' ? 'text-end' : 'text-start']">{{ c.label }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line/60">
                  <tr v-for="(r, i) in result.rows" :key="i" class="hover:bg-surface-muted/40">
                    <td v-for="c in result.columns" :key="c.key" :class="['px-3 py-1.5 whitespace-nowrap', c.type === 'number' || c.type === 'money' ? 'text-end tabular-nums' : 'text-fg', r[c.key] === null ? 'text-fg-subtle' : 'text-fg']">{{ cell(c, r[c.key] ?? null) }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-if="!result.rows.length" class="px-4 py-8 text-center text-sm text-fg-muted">No records match.</p>
            </div>
          </template>
        </AppCard>
      </div>
    </div>

    <AppModal :open="saveOpen" title="Save report" size="sm" @close="saveOpen = false">
      <div class="space-y-4">
        <AppInput v-model="saveForm.name" label="Name" required :maxlength="120" />
        <AppInput v-model="saveForm.description" label="Description (optional)" :maxlength="500" />
        <AppSwitch v-model="saveForm.shared" label="Share with the organization" description="Everyone who can see this data can run it; each sees only what their access allows." />
        <AppCheckbox v-if="loaded?.mine" v-model="saveForm.asNew" label="Save as a new report" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="saveOpen = false">Cancel</AppButton>
        <AppButton :disabled="saveForm.name.trim().length < 2" @click="save">Save</AppButton>
      </template>
    </AppModal>
  </div>
</template>
