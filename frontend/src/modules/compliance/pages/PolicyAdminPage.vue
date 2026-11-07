<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Archive, BellRing, CheckCheck, Download, FilePlus2, FileUp, Rocket, Settings, Trash2, X } from '@lucide/vue';
import { POLICY_FILE_MAX_BYTES } from '@contracts';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import PolicyFormModal from '@/modules/compliance/components/PolicyFormModal.vue';
import type { AckCounts, AckState, PersonAck, PolicyDetail } from '@/modules/compliance/types';
import { ACK_LABELS, POLICY_CATEGORY_LABELS, POLICY_STATUS_LABELS, ackTone, policyTone } from '@/modules/compliance/utils/compliance-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppCheckbox, AppDataTable, AppDatePicker, AppErrorState, AppInput, AppPageHeader, AppSearchInput, AppSelect, AppSkeleton, AppStatCard, AppTabs, AppTextarea, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime, timeAgo } from '@/shared/utils/format';

const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const detail = useAsync(() => complianceApi.policy(id.value));
watch(id, () => void detail.run());
const p = computed(() => detail.data.value);
const draft = computed(() => p.value?.versions.find((v) => v.status === 'DRAFT') ?? null);
const current = computed(() => p.value?.versions.find((v) => v.status === 'PUBLISHED') ?? null);
const tab = ref('content');
const tabs = computed(() => [
  { key: 'content', label: draft.value ? `Draft (version ${draft.value.version})` : 'Policy text' },
  ...(p.value?.status === 'PUBLISHED' && p.value.requiresAck ? [{ key: 'acks', label: 'Acknowledgements' }] : []),
  { key: 'history', label: 'Versions' },
]);

// ---- Draft editor ----
const form = reactive({ content: '', changeSummary: '', reacknowledge: true, effectiveFrom: undefined as string | undefined });
watch(
  () => draft.value?.id,
  () => {
    const d = draft.value;
    Object.assign(form, { content: d?.content ?? '', changeSummary: d?.changeSummary ?? '', reacknowledge: d?.reacknowledge ?? true, effectiveFrom: d?.effectiveFrom ?? undefined });
  },
  { immediate: true },
);
const dirty = computed(() => !!draft.value && (form.content !== (draft.value.content ?? '') || form.changeSummary !== (draft.value.changeSummary ?? '') || form.reacknowledge !== draft.value.reacknowledge || (form.effectiveFrom ?? null) !== draft.value.effectiveFrom));
const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<PolicyDetail>, success: string, description?: string) {
  busy.value = key;
  try {
    detail.data.value = await fn();
    feedback.success(success, description);
    return true;
  } catch (e) {
    feedback.error('Could not complete the action', e);
    return false;
  } finally {
    busy.value = null;
  }
}
const saveDraft = () =>
  act('save', () => complianceApi.saveDraft(id.value, { content: form.content || null, changeSummary: form.changeSummary || null, reacknowledge: form.reacknowledge, effectiveFrom: form.effectiveFrom ?? null }), 'Draft saved');
const startVersion = () => act('start', () => complianceApi.saveDraft(id.value, {}), 'New version started', 'Edit the text, then publish it.');
async function discard() {
  if (!(await feedback.confirm({ title: 'Discard the draft?', message: 'The published version stays in force.', confirmLabel: 'Discard', danger: true }))) return;
  await act('discard', () => complianceApi.discardDraft(id.value), 'Draft discarded');
}
async function publish() {
  if (dirty.value && !(await act('save', () => complianceApi.saveDraft(id.value, { content: form.content || null, changeSummary: form.changeSummary || null, reacknowledge: form.reacknowledge, effectiveFrom: form.effectiveFrom ?? null }), 'Draft saved'))) return;
  const asks = p.value!.requiresAck && (p.value!.status === 'DRAFT' || form.reacknowledge);
  if (!(await feedback.confirm({ title: `Publish version ${draft.value!.version}?`, message: asks ? 'Everyone it applies to is asked to read and acknowledge it.' : 'Earlier acknowledgements stay valid.', confirmLabel: 'Publish' }))) return;
  if (await act('publish', () => complianceApi.publish(id.value), 'Policy published')) tab.value = 'content';
}
const fileInput = ref<HTMLInputElement | null>(null);
async function upload(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  if (f.size > POLICY_FILE_MAX_BYTES) {
    feedback.error('The PDF is too large', 'Up to 10 MB.');
    return;
  }
  await act('file', () => complianceApi.uploadDraftFile(id.value, f), 'Document attached');
}
async function download(versionId: string, name: string) {
  try {
    await complianceApi.downloadVersion(id.value, versionId, name);
  } catch (e) {
    feedback.error('Could not download the document', e);
  }
}

// ---- Lifecycle ----
const settingsOpen = ref(false);
function onSettings(next: PolicyDetail) {
  settingsOpen.value = false;
  detail.data.value = next;
  feedback.success('Settings saved');
}
async function retire() {
  if (!(await feedback.confirm({ title: `Retire ${p.value?.title}?`, message: 'Employees no longer see it. Acknowledgements are kept.', confirmLabel: 'Retire', danger: true }))) return;
  await act('retire', () => complianceApi.retire(id.value), 'Policy retired');
}
async function remove() {
  if (!(await feedback.confirm({ title: `Delete ${p.value?.title}?`, message: 'The draft is deleted.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await complianceApi.removePolicy(id.value);
    feedback.success('Draft deleted');
    await router.push('/hr/compliance/policies');
  } catch (e) {
    feedback.error('Could not delete the policy', e);
  }
}

// ---- Acknowledgements ----
const counts = ref<AckCounts | null>(null);
const tracking = useTable(
  async (q) => {
    const r = await complianceApi.tracking(id.value, q);
    counts.value = r.counts;
    return { items: r.items, meta: r.meta };
  },
  { filters: { state: undefined as AckState | undefined }, immediate: false },
);
watch(tab, (t) => {
  if (t === 'acks') void tracking.load();
});
const stateOptions = (['OVERDUE', 'PENDING', 'ACKNOWLEDGED'] as const).map((s) => ({ value: s, label: ACK_LABELS[s] }));
const ackColumns: TableColumn<PersonAck>[] = [
  { key: 'employee', label: 'Employee' },
  { key: 'state', label: 'Status' },
  { key: 'when', label: 'Due / acknowledged' },
];
async function remind() {
  busy.value = 'remind';
  try {
    const r = await complianceApi.remind(id.value);
    feedback.success(`Reminder sent to ${r.reminded} ${r.reminded === 1 ? 'person' : 'people'}`, r.withoutLogin ? `${r.withoutLogin} without a login were not reminded.` : undefined);
    await detail.run();
  } catch (e) {
    feedback.error('Could not send reminders', e);
  } finally {
    busy.value = null;
  }
}
async function csv() {
  if (!p.value) return;
  try {
    await complianceApi.trackingCsv(p.value);
  } catch (e) {
    feedback.error('Could not export', e);
  }
}
const stats = computed(() => counts.value ?? p.value?.stats ?? null);
</script>

<template>
  <div>
    <AppSkeleton v-if="detail.loading.value && !p" :lines="10" />
    <AppErrorState v-else-if="detail.error.value" :error="detail.error.value" @retry="detail.run" />
    <template v-else-if="p">
      <AppPageHeader :title="p.title" :description="[POLICY_CATEGORY_LABELS[p.category], p.owner ? `owner ${p.owner.name}` : null, p.summary].filter(Boolean).join(' · ')" back="/hr/compliance/policies" back-label="Policies">
        <template #badges>
          <AppBadge :tone="policyTone[p.status]" dot>{{ POLICY_STATUS_LABELS[p.status] }}</AppBadge>
          <AppBadge v-if="p.currentVersion">Version {{ p.currentVersion.version }}</AppBadge>
          <AppBadge v-if="p.reviewDue" tone="warning">Review due</AppBadge>
        </template>
        <template #actions>
          <AppButton variant="secondary" :icon="Settings" @click="settingsOpen = true">Settings</AppButton>
          <AppButton v-if="p.status === 'PUBLISHED' && p.reviewMonths" variant="secondary" :icon="CheckCheck" :loading="busy === 'reviewed'" @click="act('reviewed', () => complianceApi.reviewed(id), 'Review recorded')">Mark reviewed</AppButton>
          <AppButton v-if="p.status === 'DRAFT'" variant="ghost" :icon="Trash2" aria-label="Delete policy" @click="remove" />
          <AppButton v-if="p.status === 'PUBLISHED'" variant="ghost" :icon="Archive" :loading="busy === 'retire'" @click="retire">Retire</AppButton>
          <AppButton v-if="draft && p.status !== 'RETIRED'" :icon="Rocket" :loading="busy === 'publish'" @click="publish">Publish</AppButton>
        </template>
      </AppPageHeader>

      <div v-if="stats" class="mb-4 grid gap-4 sm:grid-cols-4">
        <AppStatCard label="Applies to" :value="stats.audience" />
        <AppStatCard label="Acknowledged" :value="stats.acknowledged" tone="success" />
        <AppStatCard label="To acknowledge" :value="stats.pending" tone="warning" />
        <AppStatCard label="Overdue" :value="stats.overdue" tone="danger" />
      </div>
      <AppAlert v-if="p.reviewDue" tone="warning" class="mb-4">The review was due on {{ formatDate(p.nextReviewOn!) }}. Publish an updated version, or mark it reviewed if nothing needs to change.</AppAlert>

      <AppTabs v-model="tab" :tabs="tabs">
        <template v-if="tab === 'content'">
          <AppCard v-if="draft" :title="`Draft of version ${draft.version}`" description="Not visible to employees until it's published.">
            <div class="space-y-4">
              <AppTextarea v-model="form.content" label="Policy text" :rows="16" :maxlength="200000" />
              <div class="flex flex-wrap items-center gap-3 rounded-xl p-3 ring-1 ring-line">
                <template v-if="draft.file">
                  <span class="text-sm text-fg">{{ draft.file.name }}</span>
                  <AppButton size="sm" variant="ghost" :icon="Download" :aria-label="`Download ${draft.file.name}`" @click="download(draft.id, draft.file.name)" />
                  <AppButton size="sm" variant="ghost" :icon="X" :loading="busy === 'unfile'" aria-label="Remove the document" @click="act('unfile', () => complianceApi.removeDraftFile(id), 'Document removed')" />
                </template>
                <span v-else class="text-sm text-fg-muted">No document attached.</span>
                <AppButton size="sm" variant="secondary" :icon="FileUp" :loading="busy === 'file'" @click="fileInput?.click()">{{ draft.file ? 'Replace PDF' : 'Attach PDF' }}</AppButton>
                <input ref="fileInput" type="file" class="sr-only" accept=".pdf,application/pdf" aria-label="Policy document" @change="upload" />
              </div>
              <div v-if="p.status !== 'DRAFT'" class="grid gap-4 sm:grid-cols-2">
                <AppInput v-model="form.changeSummary" label="What changed" :maxlength="1000" help="Shown to employees with the new version." />
                <AppDatePicker v-model="form.effectiveFrom" label="In force from" help="Defaults to the publishing date." />
                <AppCheckbox v-model="form.reacknowledge" class="sm:col-span-2" label="Ask everyone to acknowledge again" description="For material changes. Leave it off for corrections; earlier acknowledgements then stay valid." />
              </div>
              <AppDatePicker v-else v-model="form.effectiveFrom" label="In force from" help="Defaults to the publishing date." />
            </div>
            <template #footer>
              <div class="flex flex-wrap justify-end gap-2">
                <AppButton v-if="p.status !== 'DRAFT'" variant="ghost" :loading="busy === 'discard'" @click="discard">Discard draft</AppButton>
                <AppButton variant="secondary" :loading="busy === 'save'" :disabled="!dirty" @click="saveDraft">Save draft</AppButton>
              </div>
            </template>
          </AppCard>
          <AppCard v-if="current" :class="draft ? 'mt-4' : ''" :title="`Version ${current.version} (in force)`" :description="[current.effectiveFrom ? `from ${formatDate(current.effectiveFrom)}` : null, current.publishedBy ? `published by ${current.publishedBy}` : null].filter(Boolean).join(' · ')">
            <template v-if="!draft && p.status === 'PUBLISHED'" #actions>
              <AppButton size="sm" variant="secondary" :icon="FilePlus2" :loading="busy === 'start'" @click="startVersion">New version</AppButton>
            </template>
            <AppButton v-if="current.file" class="mb-3" size="sm" variant="secondary" :icon="Download" @click="download(current.id, current.file.name)">{{ current.file.name }}</AppButton>
            <div v-if="current.content" class="max-w-3xl text-sm leading-relaxed whitespace-pre-line text-fg">{{ current.content }}</div>
            <p v-else class="text-sm text-fg-muted">The policy is in the attached document.</p>
          </AppCard>
        </template>

        <template v-else-if="tab === 'acks'">
          <AppCard :padded="false">
            <div class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
              <AppSearchInput v-model="tracking.search.value" class="min-w-56 flex-1" placeholder="Search by name or code" aria-label="Search people" />
              <AppSelect v-model="tracking.filters.state" class="w-48" :options="stateOptions" placeholder="Everyone" aria-label="Filter by status" />
              <AppButton variant="secondary" :icon="Download" @click="csv">Export</AppButton>
              <AppButton :icon="BellRing" :loading="busy === 'remind'" :disabled="!stats || stats.pending + stats.overdue === 0" @click="remind">Remind</AppButton>
            </div>
            <p v-if="p.lastRemindedAt" class="border-b border-line px-4 py-2 text-xs text-fg-muted">Last reminder {{ timeAgo(p.lastRemindedAt) }}.</p>
            <AppDataTable :columns="ackColumns" :rows="tracking.rows.value" :loading="tracking.loading.value" :error="tracking.error.value" :meta="tracking.meta.value" caption="Acknowledgements" empty-title="Nobody here" @page="tracking.setPage" @retry="tracking.load">
              <template #cell-employee="{ row }">
                <p class="font-medium text-fg">{{ row.employee.name }}</p>
                <p class="text-xs text-fg-muted">{{ row.employee.employeeCode }}{{ row.employee.department ? ` · ${row.employee.department}` : '' }}</p>
              </template>
              <template #cell-state="{ row }"><AppBadge :tone="ackTone[row.state]" dot>{{ ACK_LABELS[row.state] }}</AppBadge></template>
              <template #cell-when="{ row }">
                <span v-if="row.state === 'ACKNOWLEDGED'" class="text-fg-muted">Version {{ row.acknowledgedVersion }} · {{ formatDateTime(row.acknowledgedAt!) }}</span>
                <span v-else :class="row.state === 'OVERDUE' ? 'text-red-600 dark:text-red-400' : 'text-fg-muted'">Due {{ formatDate(row.dueOn) }}</span>
              </template>
            </AppDataTable>
          </AppCard>
        </template>

        <AppCard v-else title="Versions" :padded="false">
          <ul class="divide-y divide-line">
            <li v-for="v in p.versions" :key="v.id" class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div class="min-w-0 flex-1">
                <p class="font-medium text-fg">Version {{ v.version }} <AppBadge size="sm" :tone="v.status === 'PUBLISHED' ? 'success' : 'neutral'">{{ v.status === 'PUBLISHED' ? 'In force' : v.status === 'DRAFT' ? 'Draft' : 'Superseded' }}</AppBadge></p>
                <p class="text-xs text-fg-muted">
                  {{ v.publishedOn ? `Published ${formatDate(v.publishedOn)}${v.publishedBy ? ` by ${v.publishedBy}` : ''}` : 'Not published' }}
                  <template v-if="v.changeSummary"> · {{ v.changeSummary }}</template>
                  <template v-if="v.version > 1 && v.publishedOn"> · {{ v.reacknowledge ? 'acknowledged again' : 'earlier acknowledgements kept' }}</template>
                </p>
              </div>
              <AppButton v-if="v.file" size="sm" variant="ghost" :icon="Download" :aria-label="`Download version ${v.version}`" @click="download(v.id, v.file.name)" />
            </li>
          </ul>
        </AppCard>
      </AppTabs>
      <PolicyFormModal :open="settingsOpen" :policy="p" @close="settingsOpen = false" @saved="onSettings" />
    </template>
  </div>
</template>
