<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { appLocale } from '@/core/locale/locale';
import { CheckCircle2, Download, FileArchive, FileDown, Trash2 } from '@lucide/vue';
import type { LogArchiveKind } from '@contracts';
import { logArchivesApi } from '@/modules/audit/api/audit.api';
import type { LogArchive, LogArchivePreview } from '@/modules/audit/types';
import { formatBytes } from '@/modules/people/utils/labels';
import { AppAlert, AppBadge, AppButton, AppDatePicker, AppEmptyState, AppFacts, AppInput, AppModal, AppSkeleton, type Fact } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime } from '@/shared/utils/format';

/**
 * Archive & delete for the audit trail or login history: the records are first saved to a CSV file (kept on the
 * server and downloaded), and only an archive whose file was downloaded can have its records deleted.
 */
const props = defineProps<{ open: boolean; kind: LogArchiveKind }>();
const emit = defineEmits<{ close: []; purged: [] }>();
const feedback = useFeedbackStore();

const LABEL: Record<LogArchiveKind, { title: string; noun: string }> = {
  AUDIT_LOG: { title: 'audit log', noun: 'audit log entries' },
  LOGIN_HISTORY: { title: 'login history', noun: 'sign-in events' },
};
const label = computed(() => LABEL[props.kind]);

const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = localIso(new Date());
const defaultBefore = () => {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return localIso(d);
};
const num = (n: number) => n.toLocaleString(appLocale());

const before = ref<string | undefined>(defaultBefore());
const preview = ref<LogArchivePreview | null>(null);
const previewing = ref(false);
const archives = ref<LogArchive[]>([]);
const loadingArchives = ref(false);
const current = ref<LogArchive | null>(null);
const creating = ref(false);
const downloading = ref<string | null>(null);
const purging = ref(false);
const confirmText = ref('');

let previewSeq = 0;
async function loadPreview() {
  const seq = ++previewSeq;
  if (!before.value) {
    preview.value = null;
    return;
  }
  previewing.value = true;
  try {
    const p = await logArchivesApi.preview(props.kind, before.value);
    if (seq === previewSeq) preview.value = p;
  } catch (e) {
    if (seq === previewSeq) preview.value = null;
    feedback.error('Could not count the records', e);
  } finally {
    if (seq === previewSeq) previewing.value = false;
  }
}

async function loadArchives() {
  loadingArchives.value = true;
  try {
    archives.value = await logArchivesApi.list(props.kind);
    if (current.value) current.value = archives.value.find((a) => a.id === current.value!.id) ?? current.value;
  } catch (e) {
    feedback.error('Could not load saved archives', e);
  } finally {
    loadingArchives.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    before.value = defaultBefore();
    current.value = null;
    confirmText.value = '';
    void loadPreview();
    void loadArchives();
  },
);
watch(before, () => props.open && void loadPreview());

const tooMany = computed(() => !!preview.value && preview.value.count > preview.value.maxRecords);

async function download(a: LogArchive) {
  downloading.value = a.id;
  try {
    await logArchivesApi.download(a);
    await loadArchives();
  } catch (e) {
    feedback.error('Could not download the archive', e);
  } finally {
    downloading.value = null;
  }
}

/** Step 1: save the file on the server, then straight to the admin's device. */
async function createArchive() {
  if (!before.value) return;
  creating.value = true;
  try {
    const archive = await logArchivesApi.create(props.kind, before.value);
    current.value = archive;
    confirmText.value = '';
    feedback.success('Archive saved', `${num(archive.recordCount)} ${label.value.noun} saved to ${archive.fileName}.`);
    await download(archive);
  } catch (e) {
    feedback.error('Could not create the archive', e);
  } finally {
    creating.value = false;
  }
}

function pick(a: LogArchive) {
  current.value = a;
  confirmText.value = '';
}

/** Step 2: delete exactly the archived records. */
async function purge() {
  const a = current.value;
  if (!a || confirmText.value.replace(/[\s,]/g, '') !== String(a.recordCount)) return;
  const ok = await feedback.confirm({
    title: `Delete ${num(a.recordCount)} ${label.value.noun}?`,
    message: `Records before ${formatDate(a.before)} are removed from the ${label.value.title} for good. ${a.fileName} stays available under Saved archives, and the deletion itself is recorded in the audit log.`,
    confirmLabel: 'Delete records',
    danger: true,
  });
  if (!ok) return;
  purging.value = true;
  try {
    const done = await logArchivesApi.purge(a.id, a.recordCount);
    current.value = null;
    confirmText.value = '';
    feedback.success('Records deleted', `${num(done.purgedCount ?? a.recordCount)} ${label.value.noun} deleted. The archive file is kept.`);
    emit('purged');
    await Promise.all([loadArchives(), loadPreview()]);
  } catch (e) {
    feedback.error('Could not delete the records', e);
  } finally {
    purging.value = false;
  }
}

const facts = computed<Fact[]>(() => {
  const a = current.value;
  if (!a) return [];
  return [
    { label: 'File', value: a.fileName, mono: true },
    { label: 'Records', value: num(a.recordCount), strong: true },
    { label: 'From', value: formatDateTime(a.firstRecordAt) },
    { label: 'To', value: formatDateTime(a.lastRecordAt) },
    { label: 'Size', value: formatBytes(a.sizeBytes) },
    { label: 'SHA-256', value: a.sha256, mono: true },
    { label: 'Write-once until', value: a.lockedUntil ? formatDate(a.lockedUntil) : 'Not locked' },
  ];
});
const confirmed = computed(() => !!current.value && confirmText.value.replace(/[\s,]/g, '') === String(current.value.recordCount));
</script>

<template>
  <AppModal
    :open="open"
    :title="`Archive & delete ${label.title}`"
    description="Old records are saved to a CSV file first. Only after the file has been downloaded can those records be deleted."
    size="lg"
    :guide="false"
    :guard-changes="false"
    @close="emit('close')"
  >
    <div class="space-y-6">
      <section class="space-y-3" aria-labelledby="archive-step-1">
        <h3 id="archive-step-1" class="flex items-center gap-2 text-sm font-semibold text-fg">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-xs text-accent-fg">1</span>
          Save the records to a file
        </h3>
        <div class="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-end">
          <AppDatePicker v-model="before" label="Records before" :max="today" required help="Everything older than this day." />
          <p class="text-sm text-fg-muted sm:pb-2" aria-live="polite">
            <template v-if="previewing">Counting…</template>
            <template v-else-if="preview && preview.count">
              <strong class="text-fg">{{ num(preview.count) }}</strong> {{ label.noun }} from {{ formatDate(preview.firstRecordAt) }} to {{ formatDate(preview.lastRecordAt) }}.
            </template>
            <template v-else-if="preview">No records before this date. Pick a later date.</template>
          </p>
        </div>
        <AppAlert v-if="tooMany" tone="warning">
          One archive holds up to {{ num(preview!.maxRecords) }} records. Pick an earlier date and archive in parts, oldest first.
        </AppAlert>
        <AppButton :icon="FileDown" :loading="creating" :disabled="!preview?.count || tooMany || previewing" @click="createArchive">Save archive file</AppButton>
      </section>

      <section v-if="current && current.status === 'ARCHIVED'" class="space-y-3 rounded-md border border-danger/25 p-4" aria-labelledby="archive-step-2">
        <h3 id="archive-step-2" class="flex items-center gap-2 text-sm font-semibold text-fg">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-danger-soft text-xs text-danger-fg">2</span>
          Delete the archived records
        </h3>
        <AppFacts :items="facts" class="break-all" />
        <AppAlert v-if="!current.downloadedAt" tone="warning">The file hasn't been downloaded yet. Download it and keep it somewhere safe before deleting.</AppAlert>
        <AppAlert v-else tone="success">
          Downloaded {{ formatDateTime(current.downloadedAt) }}. A copy is also kept on the server under Saved archives. The SHA-256 above lets you check the file hasn't changed.
        </AppAlert>
        <div class="flex flex-wrap gap-2">
          <AppButton size="sm" variant="secondary" :icon="Download" :loading="downloading === current.id" @click="download(current)">
            {{ current.downloadedAt ? 'Download again' : 'Download file' }}
          </AppButton>
        </div>
        <AppInput
          v-model="confirmText"
          :label="`Type ${current.recordCount} to confirm`"
          :disabled="!current.downloadedAt"
          inputmode="numeric"
          autocomplete="off"
          class="max-w-xs"
        />
        <AppButton variant="danger" :icon="Trash2" :loading="purging" :disabled="!current.downloadedAt || !confirmed" @click="purge">
          Delete {{ num(current.recordCount) }} records
        </AppButton>
      </section>

      <section class="space-y-3" aria-labelledby="archive-saved">
        <h3 id="archive-saved" class="text-sm font-semibold text-fg">Saved archives</h3>
        <AppSkeleton v-if="loadingArchives && !archives.length" :lines="3" />
        <AppEmptyState v-else-if="!archives.length" compact :icon="FileArchive" title="No archives yet" :description="`Archives of the ${label.title} appear here.`" />
        <ul v-else class="divide-y divide-line/70 rounded-md border border-line">
          <li v-for="a in archives" :key="a.id" :class="['flex flex-wrap items-center gap-3 px-4 py-3', current?.id === a.id && 'bg-accent-soft/40']">
            <FileArchive :size="18" class="shrink-0 text-fg-muted" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-fg">{{ a.fileName }}</p>
              <p class="text-xs text-fg-muted">
                {{ num(a.recordCount) }} records · {{ formatBytes(a.sizeBytes) }} · saved {{ formatDateTime(a.createdAt) }}{{ a.createdBy ? ` by ${a.createdBy.name}` : '' }}
              </p>
              <p v-if="a.status === 'PURGED'" class="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
                <CheckCircle2 :size="12" class="text-success-fg" aria-hidden="true" />
                <template v-if="a.purgedCount !== null">Records deleted {{ formatDateTime(a.purgedAt) }}{{ a.purgedBy ? ` by ${a.purgedBy.name}` : '' }}</template>
                <template v-else>Records deleted together with a later archive</template>
              </p>
            </div>
            <AppBadge size="sm" :tone="a.status === 'PURGED' ? 'neutral' : 'info'">{{ a.status === 'PURGED' ? 'Records deleted' : 'Saved' }}</AppBadge>
            <div class="flex gap-1">
              <AppButton size="sm" variant="ghost" :icon="Download" :loading="downloading === a.id" :aria-label="`Download ${a.fileName}`" @click="download(a)" />
              <AppButton v-if="a.status === 'ARCHIVED' && current?.id !== a.id" size="sm" variant="ghost" :icon="Trash2" @click="pick(a)">Delete records…</AppButton>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Close</AppButton>
    </template>
  </AppModal>
</template>
