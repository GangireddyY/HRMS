<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { CalendarDays, CheckCircle2, Download, FileSpreadsheet, Hourglass, ListPlus, Package, Upload, Wallet } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import { errorMessage } from '@/core/http/http-client';
import { importsApi, type ImportKind, type ImportSummary } from '@/modules/imports/api/imports.api';
import { formatBytes } from '@/modules/people/utils/labels';
import { AppAlert, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Bulk CSV imports per module: template → check (nothing saved) → import every row through the usual rules. */
const feedback = useFeedbackStore();
const kinds = useAsync(() => importsApi.list());
const ICONS: Record<string, Component> = { 'leave-balances': CalendarDays, salaries: Wallet, assets: Package, 'custom-fields': ListPlus };

const selected = ref<string | null>(null);
const kind = computed<ImportKind | null>(() => kinds.data.value?.find((k) => k.key === (selected.value ?? kinds.data.value?.[0]?.key)) ?? null);
const file = ref<File | null>(null);
const input = ref<HTMLInputElement | null>(null);
const checking = ref(false);
const importing = ref(false);
const result = ref<ImportSummary | null>(null);
const error = ref<string | null>(null);
const n = (v: number) => v.toLocaleString(appLocale());

function choose(key: string) {
  if (key === kind.value?.key) return;
  selected.value = key;
  file.value = null;
  result.value = null;
  error.value = null;
}

async function pick(f: File | null | undefined) {
  if (!f || !kind.value) return;
  file.value = f;
  result.value = null;
  error.value = null;
  checking.value = true;
  try {
    result.value = await importsApi.run(kind.value.key, f, true);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    checking.value = false;
  }
}

async function runImport() {
  if (!file.value || !kind.value) return;
  importing.value = true;
  try {
    const r = await importsApi.run(kind.value.key, file.value, false);
    result.value = r;
    if (!r.issueCount) {
      feedback.success(`${kind.value.label}: ${n(r.applied)} row${r.applied === 1 ? '' : 's'} imported`);
      file.value = null;
    }
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    importing.value = false;
  }
}

async function template() {
  if (!kind.value) return;
  try {
    await importsApi.template(kind.value.key);
  } catch (e) {
    feedback.error('Could not download the template', e);
  }
}

const ready = computed(() => !!result.value?.dryRun && result.value.issueCount === 0 && result.value.total > 0);
const done = computed(() => !!result.value && !result.value.dryRun);
</script>

<template>
  <div class="space-y-5">
    <AppPageHeader title="Bulk import" description="Load opening balances, salaries, assets and custom fields from a spreadsheet. Each file is checked first; nothing is saved until every row is valid." />

    <AppErrorState v-if="kinds.error.value" :error="kinds.error.value" @retry="kinds.run" />
    <div v-else-if="kinds.loading.value && !kinds.data.value" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <AppSkeleton v-for="i in 4" :key="i" class="h-24 rounded-xl" />
    </div>
    <AppEmptyState v-else-if="!kinds.data.value?.length" :icon="Upload" title="No imports available" description="You don't have permission for any bulk import." />

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="What to import">
        <button
          v-for="k in kinds.data.value"
          :key="k.key"
          type="button"
          role="radio"
          :aria-checked="k.key === kind?.key"
          :class="[
            'flex items-start gap-3 rounded-xl border p-4 text-start transition-colors',
            k.key === kind?.key ? 'border-brand-400 bg-accent-soft/50 ring-1 ring-brand-400/40' : 'border-line bg-surface hover:border-brand-300 hover:bg-surface-muted/50',
          ]"
          @click="choose(k.key)"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-accent-fg shadow-xs">
            <component :is="ICONS[k.key] ?? FileSpreadsheet" :size="18" aria-hidden="true" />
          </span>
          <span class="min-w-0">
            <span class="block font-medium text-fg">{{ k.label }}</span>
            <span class="mt-0.5 block text-xs text-fg-muted">{{ k.description }}</span>
          </span>
        </button>
      </div>

      <div v-if="kind" class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <AppCard :title="`${kind.label} columns`" :icon="FileSpreadsheet" class="max-lg:order-2">
          <template #actions>
            <AppButton size="sm" variant="secondary" :icon="Download" @click="template">Template</AppButton>
          </template>
          <ul class="divide-y divide-line text-sm">
            <li v-for="c in kind.columns" :key="c.header" class="flex items-baseline justify-between gap-3 py-2">
              <span class="font-mono text-xs text-fg">{{ c.header }}</span>
              <span class="min-w-0 text-end text-xs text-fg-muted">
                <span v-if="c.required" class="me-1 rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning-fg">Required</span>
                {{ c.help ?? '' }}
              </span>
            </li>
          </ul>
          <p class="mt-3 text-xs text-fg-muted">Employees are matched by <span class="font-medium text-fg">employee_code</span>. Headers are case-insensitive; other columns are ignored.</p>
        </AppCard>

        <AppCard title="Upload" :icon="Upload">
          <div class="space-y-4">
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-line px-4 py-5 text-start transition-colors hover:border-brand-400 hover:bg-surface-muted/50"
              :disabled="checking || importing"
              @click="input?.click()"
            >
              <FileSpreadsheet class="h-6 w-6 shrink-0 text-fg-subtle" aria-hidden="true" />
              <span v-if="file" class="min-w-0 text-sm">
                <span class="block truncate font-medium text-fg">{{ file.name }}</span>
                <span class="text-fg-muted">{{ formatBytes(file.size) }} · {{ checking ? 'Checking…' : 'Choose another file' }}</span>
              </span>
              <span v-else class="text-sm text-fg-muted"><span class="font-medium text-accent-fg">Choose a CSV file</span> exported from a spreadsheet (UTF-8)</span>
            </button>
            <input ref="input" type="file" class="sr-only" accept=".csv,text/csv" aria-label="CSV file" @change="pick(($event.target as HTMLInputElement).files?.[0]); ($event.target as HTMLInputElement).value = ''" />

            <AppAlert v-if="error">{{ error }}</AppAlert>

            <template v-if="result">
              <AppAlert v-if="ready" tone="success" :title="`${n(result.total)} row${result.total === 1 ? '' : 's'} ready to import`">
                <span class="inline-flex items-center gap-2"><CheckCircle2 class="h-4 w-4" aria-hidden="true" /> Every row is valid.</span>
                <span v-if="result.ignoredColumns.length"> Ignored columns: {{ result.ignoredColumns.join(', ') }}.</span>
              </AppAlert>
              <AppAlert v-else-if="done && !result.issueCount" tone="success" :title="`Imported ${n(result.applied)} of ${n(result.total)} rows`">
                <span v-if="result.pendingApproval" class="inline-flex items-center gap-2"><Hourglass class="h-4 w-4" aria-hidden="true" /> {{ n(result.pendingApproval) }} went for approval (above the raise threshold).</span>
                <span v-else>Everything was applied.</span>
              </AppAlert>
              <AppAlert v-else-if="done" tone="warning" :title="`Imported ${n(result.applied)}; ${n(result.failed)} row${result.failed === 1 ? '' : 's'} could not be saved`">
                The rows below were refused when saving; fix them and import just those rows again.
              </AppAlert>
              <AppAlert v-else-if="result.issueCount" tone="warning" :title="`${n(result.issueCount)} problem${result.issueCount === 1 ? '' : 's'} in ${n(result.invalid)} of ${n(result.total)} rows`">
                Fix these in your spreadsheet and choose the file again. Nothing has been imported.
              </AppAlert>

              <div v-if="result.issues.length" class="max-h-72 overflow-y-auto rounded-xl ring-1 ring-line">
                <table class="w-full text-sm">
                  <thead class="sticky top-0 bg-surface-muted text-start text-xs text-fg-muted">
                    <tr><th class="px-3 py-2 text-start font-medium">Row</th><th class="px-3 py-2 text-start font-medium">Column</th><th class="px-3 py-2 text-start font-medium">Problem</th></tr>
                  </thead>
                  <tbody class="divide-y divide-line">
                    <tr v-for="(e, i) in result.issues" :key="i">
                      <td class="px-3 py-2 tabular-nums text-fg-muted">{{ e.row }}</td>
                      <td class="px-3 py-2 font-mono text-xs text-fg-muted">{{ e.column ?? '—' }}</td>
                      <td class="px-3 py-2 text-fg">{{ e.message }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="result.issueCount > result.issues.length" class="text-xs text-fg-muted">Showing the first {{ n(result.issues.length) }} problems.</p>
            </template>

            <div class="flex justify-end">
              <AppButton :icon="Upload" :loading="importing" :disabled="!ready || checking" @click="runImport">Import {{ ready ? n(result!.total) : '' }} rows</AppButton>
            </div>
          </div>
        </AppCard>
      </div>
    </template>
  </div>
</template>
