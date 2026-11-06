<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CheckCircle2, Download, FileSpreadsheet } from '@lucide/vue';
import { EMPLOYEE_IMPORT_MAX_ROWS } from '@contracts';
import { employeesApi } from '@/modules/people/api/people.api';
import type { ImportResult } from '@/modules/people/types';
import { formatBytes } from '@/modules/people/utils/labels';
import { AppAlert, AppButton, AppModal } from '@/shared/components';
import { errorMessage } from '@/core/http/http-client';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** CSV import: the file is checked first (nothing is saved); importing creates every row or none. */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; imported: [count: number] }>();

const feedback = useFeedbackStore();
const file = ref<File | null>(null);
const input = ref<HTMLInputElement | null>(null);
const checking = ref(false);
const importing = ref(false);
const result = ref<ImportResult | null>(null);
const error = ref<string | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    file.value = null;
    result.value = null;
    error.value = null;
  },
);

async function pick(f: File | null | undefined) {
  if (!f) return;
  file.value = f;
  result.value = null;
  error.value = null;
  checking.value = true;
  try {
    result.value = await employeesApi.importCsv(f, true);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    checking.value = false;
  }
}

async function runImport() {
  importing.value = true;
  try {
    const r = await employeesApi.importCsv(file.value!, false);
    if (r.errorCount) {
      result.value = r;
      return;
    }
    emit('imported', r.created);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    importing.value = false;
  }
}

async function template() {
  try {
    await employeesApi.importTemplate();
  } catch (e) {
    feedback.error('Could not download the template', e);
  }
}

const ready = computed(() => !!result.value && result.value.errorCount === 0 && result.value.total > 0);
const groupedErrors = computed(() => result.value?.errors ?? []);
</script>

<template>
  <AppModal :open="open" title="Import employees" :description="`Add up to ${EMPLOYEE_IMPORT_MAX_ROWS.toLocaleString()} employees from a CSV file. The file is checked first; nothing is saved until every row is valid.`" size="lg" @close="emit('close')">
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-muted/60 px-4 py-3 text-sm">
        <p class="text-fg-muted">
          Required columns: <span class="font-medium text-fg">first_name, last_name, date_of_joining</span> (YYYY-MM-DD). Department, designation, location, grade and cost center must already exist; managers are referenced by <span class="font-medium text-fg">manager_code</span>.
        </p>
        <AppButton size="sm" variant="secondary" :icon="Download" @click="template">Template</AppButton>
      </div>

      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-line px-4 py-4 text-left transition-colors hover:border-brand-400 hover:bg-surface-muted/50"
        :disabled="checking || importing"
        @click="input?.click()"
      >
        <FileSpreadsheet class="h-6 w-6 shrink-0 text-fg-subtle" aria-hidden="true" />
        <span v-if="file" class="min-w-0 text-sm">
          <span class="block truncate font-medium text-fg">{{ file.name }}</span>
          <span class="text-fg-muted">{{ formatBytes(file.size) }} · {{ checking ? 'Checking…' : 'Choose another file' }}</span>
        </span>
        <span v-else class="text-sm text-fg-muted"><span class="font-medium text-brand-600 dark:text-brand-400">Choose a CSV file</span> exported from a spreadsheet (UTF-8)</span>
      </button>
      <input ref="input" type="file" class="sr-only" accept=".csv,text/csv" aria-label="CSV file" @change="pick(($event.target as HTMLInputElement).files?.[0]); ($event.target as HTMLInputElement).value = ''" />

      <AppAlert v-if="error">{{ error }}</AppAlert>

      <template v-if="result">
        <AppAlert v-if="ready" tone="success" :title="`${result.total.toLocaleString()} employee${result.total === 1 ? '' : 's'} ready to import`">
          <span class="inline-flex items-center gap-1.5"><CheckCircle2 class="h-4 w-4" aria-hidden="true" /> Every row is valid.</span>
          <span v-if="result.ignoredColumns.length"> Ignored columns: {{ result.ignoredColumns.join(', ') }}.</span>
        </AppAlert>
        <template v-else-if="result.errorCount">
          <AppAlert tone="warning" :title="`${result.errorCount.toLocaleString()} problem${result.errorCount === 1 ? '' : 's'} in ${(result.total - result.valid).toLocaleString()} of ${result.total.toLocaleString()} rows`">
            Fix these in your spreadsheet and choose the file again. Nothing has been imported.
          </AppAlert>
          <div class="max-h-64 overflow-y-auto rounded-xl ring-1 ring-line">
            <table class="w-full text-sm">
              <thead class="sticky top-0 bg-surface-muted text-left text-xs text-fg-muted">
                <tr><th class="px-3 py-2 font-medium">Row</th><th class="px-3 py-2 font-medium">Column</th><th class="px-3 py-2 font-medium">Problem</th></tr>
              </thead>
              <tbody class="divide-y divide-line">
                <tr v-for="(e, i) in groupedErrors" :key="i">
                  <td class="px-3 py-1.5 tabular-nums text-fg-muted">{{ e.row }}</td>
                  <td class="px-3 py-1.5 font-mono text-xs text-fg-muted">{{ e.column ?? '—' }}</td>
                  <td class="px-3 py-1.5 text-fg">{{ e.message }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="result.errorCount > result.errors.length" class="text-xs text-fg-muted">Showing the first {{ result.errors.length }} problems.</p>
        </template>
      </template>
    </div>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton :loading="importing" :disabled="!ready || checking" @click="runImport">Import {{ result && ready ? result.total.toLocaleString() : '' }} employees</AppButton>
    </template>
  </AppModal>
</template>
