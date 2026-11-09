<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AlertTriangle, Archive, BellRing, CalendarClock, CheckCheck, CheckCircle2, Download, FilePlus2, FileText, FileUp, History, Info, Rocket, ScrollText, Settings, Trash2, Users, X } from '@lucide/vue';
import { POLICY_FILE_MAX_BYTES } from '@contracts';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import PolicyFormModal from '@/modules/compliance/components/PolicyFormModal.vue';
import type { AckCounts, AckState, PersonAck, PolicyDetail } from '@/modules/compliance/types';
import { ACK_LABELS, POLICY_CATEGORY_LABELS, POLICY_STATUS_LABELS, ackTone, policyTone } from '@/modules/compliance/utils/compliance-format';
import { POLICY_VISUALS, ackPct, daysFromToday, relativeDays } from '@/modules/compliance/utils/compliance-visuals';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppCheckbox, AppDataTable, AppDatePicker, AppErrorState, AppFacts, AppInput, AppPageHeader, AppSearchInput, AppSelect, AppSkeleton, AppTabs, AppTextarea, type Fact, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime, timeAgo } from '@/shared/utils/format';

/** One policy for HR: its text and drafts, who has acknowledged it (with reminders), its versions and settings. */
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
const tracksAcks = computed(() => p.value?.status === 'PUBLISHED' && p.value.requiresAck);
const tabs = computed(() => [
  { key: 'content', label: draft.value ? `Draft (version ${draft.value.version})` : 'Policy text', icon: FileText },
  ...(tracksAcks.value ? [{ key: 'acks', label: 'Acknowledgements', icon: Users, count: stats.value ? stats.value.pending + stats.value.overdue : null }] : []),
  { key: 'history', label: 'Versions', icon: History, count: p.value?.versions.length ?? null },
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

// ---- Overview ----
const pct = computed(() => ackPct(stats.value));
const share = (n: number) => (stats.value?.audience ? `${(n / stats.value.audience) * 100}%` : '0%');
const CIRC = 2 * Math.PI * 42;
const overviewItems = computed<{ key: AckState | undefined; label: string; value: number; dot: string }[]>(() => {
  const s = stats.value;
  if (!s) return [];
  return [
    { key: undefined, label: 'Applies to', value: s.audience, dot: 'bg-fg-subtle' },
    { key: 'ACKNOWLEDGED', label: 'Acknowledged', value: s.acknowledged, dot: 'bg-success' },
    { key: 'PENDING', label: 'To acknowledge', value: s.pending, dot: 'bg-warning' },
    { key: 'OVERDUE', label: 'Overdue', value: s.overdue, dot: 'bg-danger' },
  ];
});
const canRemind = computed(() => !!stats.value && stats.value.pending + stats.value.overdue > 0);
/** Open the acknowledgement list filtered to one state (or everyone). */
function showAcks(state?: AckState) {
  tracking.filters.state = state;
  if (tab.value !== 'acks') tab.value = 'acks';
}
const audience = computed(() => {
  const x = p.value;
  if (!x) return '';
  const parts = [
    x.departmentIds?.length ? `${x.departmentIds.length} department${x.departmentIds.length === 1 ? '' : 's'}` : null,
    x.locationIds?.length ? `${x.locationIds.length} location${x.locationIds.length === 1 ? '' : 's'}` : null,
    x.employmentTypes?.length ? x.employmentTypes.map((t) => EMPLOYMENT_TYPE_LABELS[t] ?? t).join(', ') : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Everyone';
});
const facts = computed<Fact[]>(() => {
  const x = p.value!;
  return [
    { label: 'Category', value: POLICY_CATEGORY_LABELS[x.category] },
    { label: 'Applies to', value: audience.value },
    { label: 'Acknowledgement', value: x.requiresAck ? `Within ${x.ackDueDays} days` : 'Not required' },
    { label: 'Review cycle', value: x.reviewMonths ? `Every ${x.reviewMonths} months` : 'None' },
    { label: 'Next review', value: x.nextReviewOn ? formatDate(x.nextReviewOn) : '—', strong: x.reviewDue },
    ...(x.requiresAck ? [{ label: 'Last reminder', value: x.lastRemindedAt ? timeAgo(x.lastRemindedAt) : 'Never' }] : []),
    { label: 'Last updated', value: timeAgo(x.updatedAt) },
  ];
});
const dueText = (row: PersonAck) => {
  const d = daysFromToday(row.dueOn);
  return row.state === 'OVERDUE' || d < 0 ? `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue` : `Due ${relativeDays(row.dueOn)}`;
};
</script>

<template>
  <div>
    <AppSkeleton v-if="detail.loading.value && !p" :lines="10" />
    <AppErrorState v-else-if="detail.error.value" :error="detail.error.value" @retry="detail.run" />
    <template v-else-if="p">
      <AppPageHeader :title="p.title" :description="[POLICY_CATEGORY_LABELS[p.category], p.owner ? `owner ${p.owner.name}` : null, p.summary].filter(Boolean).join(' · ')" back="/hr/compliance/policies" back-label="Policies">
        <template #leading>
          <span :class="['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset max-sm:hidden', POLICY_VISUALS[p.category].tile]" aria-hidden="true">
            <component :is="POLICY_VISUALS[p.category].icon" :size="22" />
          </span>
        </template>
        <template #badges>
          <AppBadge :tone="policyTone[p.status]" dot>{{ POLICY_STATUS_LABELS[p.status] }}</AppBadge>
          <AppBadge v-if="p.currentVersion">Version {{ p.currentVersion.version }}</AppBadge>
          <AppBadge v-if="draft && p.status !== 'DRAFT'" tone="info">Draft changes</AppBadge>
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

      <!-- Acknowledgement overview -->
      <section v-if="stats" class="card mb-4 overflow-hidden" aria-labelledby="ack-overview-title">
        <div class="flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-4">
          <div class="relative h-24 w-24 shrink-0">
            <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="42" fill="none" stroke-width="10" class="stroke-surface-muted" />
              <circle cx="50" cy="50" r="42" fill="none" stroke-width="10" stroke-linecap="round" :class="['transition-[stroke-dashoffset] duration-700', pct >= 90 ? 'stroke-success' : 'stroke-brand-500']" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - pct / 100)" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-xl font-semibold text-fg tabular-nums">{{ pct }}%</span>
              <span class="text-2xs text-fg-muted">acknowledged</span>
            </div>
          </div>
          <div class="min-w-0 flex-1 basis-80">
            <h2 id="ack-overview-title" class="text-sm font-semibold text-fg">
              {{ stats.acknowledged }} of {{ stats.audience }} {{ stats.audience === 1 ? 'person has' : 'people have' }} acknowledged{{ current ? ` version ${current.version}` : '' }}
            </h2>
            <div class="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="`${stats.acknowledged} acknowledged, ${stats.pending} to acknowledge, ${stats.overdue} overdue`">
              <span class="h-full bg-success" :style="{ width: share(stats.acknowledged) }" />
              <span class="h-full bg-warning" :style="{ width: share(stats.pending) }" />
              <span class="h-full bg-danger" :style="{ width: share(stats.overdue) }" />
            </div>
            <ul class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Acknowledgement counts">
              <li v-for="s in overviewItems" :key="s.label">
                <component
                  :is="tracksAcks ? 'button' : 'div'"
                  :type="tracksAcks ? 'button' : undefined"
                  :class="['w-full rounded-md px-2.5 py-1.5 text-start', tracksAcks && 'transition hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none', tracksAcks && tab === 'acks' && tracking.filters.state === s.key && 'bg-accent-soft']"
                  :aria-label="tracksAcks ? `${s.label}: ${s.value}. Show the list` : undefined"
                  @click="tracksAcks && showAcks(s.key)"
                >
                  <span class="flex items-center gap-1.5 text-xs text-fg-muted"><span :class="['h-2 w-2 rounded-full', s.dot]" aria-hidden="true" />{{ s.label }}</span>
                  <span :class="['block text-lg font-semibold tabular-nums', s.key === 'OVERDUE' && s.value ? 'text-danger-fg' : 'text-fg']">{{ s.value }}</span>
                </component>
              </li>
            </ul>
          </div>
          <div v-if="tracksAcks" class="flex flex-col items-start gap-1.5 sm:items-end">
            <AppButton :icon="BellRing" :loading="busy === 'remind'" :disabled="!canRemind" @click="remind">Remind {{ canRemind ? stats.pending + stats.overdue : '' }}</AppButton>
            <span class="text-2xs text-fg-subtle">{{ !canRemind ? 'Everyone has acknowledged' : p.lastRemindedAt ? `Last reminder ${timeAgo(p.lastRemindedAt)}` : 'No reminder sent yet' }}</span>
          </div>
        </div>
      </section>
      <AppAlert v-if="p.reviewDue" tone="warning" class="mb-4">The review was due on {{ formatDate(p.nextReviewOn!) }}. Publish an updated version, or mark it reviewed if nothing needs to change.</AppAlert>

      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div class="min-w-0">
          <AppTabs v-model="tab" :tabs="tabs">
            <template v-if="tab === 'content'">
              <AppCard v-if="draft" :title="`Draft of version ${draft.version}`" description="Not visible to employees until it's published." :icon="FilePlus2">
                <div class="space-y-4">
                  <AppTextarea v-model="form.content" label="Policy text" :rows="16" :maxlength="200000" />
                  <div class="flex flex-wrap items-center gap-3 rounded-md bg-surface-muted/50 p-3 ring-1 ring-line ring-inset">
                    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-fg-muted ring-1 ring-line" aria-hidden="true"><FileText :size="15" /></span>
                    <template v-if="draft.file">
                      <span class="min-w-0 flex-1 truncate text-sm text-fg">{{ draft.file.name }}</span>
                      <AppButton size="sm" variant="ghost" :icon="Download" :aria-label="`Download ${draft.file.name}`" @click="download(draft.id, draft.file.name)" />
                      <AppButton size="sm" variant="ghost" :icon="X" :loading="busy === 'unfile'" aria-label="Remove the document" @click="act('unfile', () => complianceApi.removeDraftFile(id), 'Document removed')" />
                    </template>
                    <span v-else class="min-w-0 flex-1 text-sm text-fg-muted">No document attached. You can attach a PDF up to 10 MB.</span>
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
                  <div class="flex flex-wrap items-center justify-end gap-2">
                    <span v-if="dirty" class="me-auto text-xs text-warning-fg">Unsaved changes</span>
                    <AppButton v-if="p.status !== 'DRAFT'" variant="ghost" :loading="busy === 'discard'" @click="discard">Discard draft</AppButton>
                    <AppButton variant="secondary" :loading="busy === 'save'" :disabled="!dirty" @click="saveDraft">Save draft</AppButton>
                  </div>
                </template>
              </AppCard>
              <AppCard
                v-if="current"
                :class="draft ? 'mt-4' : ''"
                :title="`Version ${current.version} (in force)`"
                :description="[current.effectiveFrom ? `from ${formatDate(current.effectiveFrom)}` : null, current.publishedBy ? `published by ${current.publishedBy}` : null].filter(Boolean).join(' · ')"
                :icon="ScrollText"
              >
                <template v-if="!draft && p.status === 'PUBLISHED'" #actions>
                  <AppButton size="sm" variant="secondary" :icon="FilePlus2" :loading="busy === 'start'" @click="startVersion">New version</AppButton>
                </template>
                <AppButton v-if="current.file" class="mb-4" size="sm" variant="secondary" :icon="Download" @click="download(current.id, current.file.name)">{{ current.file.name }}</AppButton>
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
                <p v-if="p.lastRemindedAt" class="flex items-center gap-1.5 border-b border-line px-4 py-2 text-xs text-fg-muted"><BellRing :size="12" aria-hidden="true" />Last reminder {{ timeAgo(p.lastRemindedAt) }}.</p>
                <AppDataTable :columns="ackColumns" :rows="tracking.rows.value" :loading="tracking.loading.value" :error="tracking.error.value" :meta="tracking.meta.value" caption="Acknowledgements" empty-title="Nobody here" :grid="false" @page="tracking.setPage" @retry="tracking.load" :filtered="tracking.isFiltered.value" @clear="tracking.clearFilters()">
                  <template #cell-employee="{ row }">
                    <div class="flex min-w-0 items-center gap-2.5">
                      <AppAvatar :name="row.employee.name" size="sm" />
                      <div class="min-w-0">
                        <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
                        <p class="truncate text-xs text-fg-muted">{{ row.employee.employeeCode }}{{ row.employee.department ? ` · ${row.employee.department}` : '' }}</p>
                      </div>
                    </div>
                  </template>
                  <template #cell-state="{ row }"><AppBadge :tone="ackTone[row.state]" dot>{{ ACK_LABELS[row.state] }}</AppBadge></template>
                  <template #cell-when="{ row }">
                    <span v-if="row.state === 'ACKNOWLEDGED'" class="text-fg-muted">
                      Version {{ row.acknowledgedVersion }} · <span :title="formatDateTime(row.acknowledgedAt!)">{{ formatDate(row.acknowledgedAt!) }}</span>
                    </span>
                    <span v-else :class="['inline-flex items-center gap-1', row.state === 'OVERDUE' ? 'font-medium text-danger-fg' : 'text-fg-muted']" :title="`Due ${formatDate(row.dueOn)}`">
                      <AlertTriangle v-if="row.state === 'OVERDUE'" :size="12" aria-hidden="true" />{{ dueText(row) }}
                      <span class="text-xs font-normal text-fg-subtle tabular-nums">· {{ formatDate(row.dueOn) }}</span>
                    </span>
                  </template>
                </AppDataTable>
              </AppCard>
            </template>

            <AppCard v-else title="Versions" description="Every published version is kept with who published it and when." :icon="History">
              <ol class="relative">
                <li v-for="(v, i) in p.versions" :key="v.id" class="relative flex gap-3 pb-5 last:pb-0">
                  <span v-if="i < p.versions.length - 1" class="absolute top-8 bottom-0 start-[15px] w-px bg-line" aria-hidden="true" />
                  <span
                    :class="[
                      'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ring-1 ring-inset',
                      v.status === 'PUBLISHED' ? 'bg-success-soft text-success-fg ring-success/25' : v.status === 'DRAFT' ? 'bg-info-soft text-info-fg ring-info/25' : 'bg-surface-muted text-fg-muted ring-line',
                    ]"
                    aria-hidden="true"
                  >
                    v{{ v.version }}
                  </span>
                  <div class="min-w-0 flex-1 pt-0.5">
                    <p class="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                      Version {{ v.version }}
                      <AppBadge size="sm" :tone="v.status === 'PUBLISHED' ? 'success' : v.status === 'DRAFT' ? 'info' : 'neutral'">{{ v.status === 'PUBLISHED' ? 'In force' : v.status === 'DRAFT' ? 'Draft' : 'Superseded' }}</AppBadge>
                    </p>
                    <p class="text-xs text-fg-muted">
                      {{ v.publishedOn ? `Published ${formatDate(v.publishedOn)}${v.publishedBy ? ` by ${v.publishedBy}` : ''}` : 'Not published' }}
                      <template v-if="v.effectiveFrom"> · in force from {{ formatDate(v.effectiveFrom) }}</template>
                    </p>
                    <p v-if="v.changeSummary" class="mt-1 text-sm text-fg">{{ v.changeSummary }}</p>
                    <p v-if="v.version > 1 && v.publishedOn" class="mt-0.5 text-xs text-fg-subtle">{{ v.reacknowledge ? 'Everyone was asked to acknowledge again' : 'Earlier acknowledgements kept' }}</p>
                  </div>
                  <AppButton v-if="v.file" size="sm" variant="ghost" :icon="Download" :aria-label="`Download version ${v.version}`" @click="download(v.id, v.file.name)" />
                </li>
              </ol>
            </AppCard>
          </AppTabs>
        </div>

        <aside class="space-y-4" aria-label="Policy details">
          <AppCard title="Details" :icon="Info">
            <div v-if="p.owner" class="mb-3 flex items-center gap-2.5 border-b border-line/70 pb-3">
              <AppAvatar :name="p.owner.name" size="sm" />
              <div class="min-w-0">
                <p class="text-xs text-fg-muted">Owner</p>
                <p class="truncate text-sm font-medium text-fg">{{ p.owner.name }}</p>
              </div>
            </div>
            <AppFacts :items="facts" />
          </AppCard>

          <AppCard v-if="p.reviewMonths" title="Review" :icon="CalendarClock">
            <div class="flex items-start gap-3">
              <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-full', p.reviewDue ? 'bg-warning-soft text-warning-fg' : 'bg-success-soft text-success-fg']" aria-hidden="true">
                <component :is="p.reviewDue ? AlertTriangle : CheckCircle2" :size="16" />
              </span>
              <div class="min-w-0 text-sm">
                <p class="font-medium text-fg">{{ p.reviewDue ? 'Review is due' : 'Up to date' }}</p>
                <p class="text-xs text-fg-muted">
                  <template v-if="p.nextReviewOn">Next review {{ formatDate(p.nextReviewOn) }} ({{ relativeDays(p.nextReviewOn) }}). </template>
                  {{ p.reviewDue ? 'Publish an updated version, or mark it reviewed if nothing needs to change.' : `Reviewed every ${p.reviewMonths} months.` }}
                </p>
              </div>
            </div>
          </AppCard>

          <div v-if="p.status === 'DRAFT'" class="rounded-md border border-dashed border-line px-4 py-3 text-xs text-fg-muted">
            <p class="flex items-center gap-1.5 font-medium text-fg"><Rocket :size="13" class="text-accent-fg" aria-hidden="true" />Not published yet</p>
            <p class="mt-1">Employees can't see this policy. {{ p.requiresAck ? 'When you publish it, everyone it applies to is asked to read and acknowledge it.' : 'Publish it to make it available to everyone it applies to.' }}</p>
          </div>
        </aside>
      </div>
      <PolicyFormModal :open="settingsOpen" :policy="p" @close="settingsOpen = false" @saved="onSettings" />
    </template>
  </div>
</template>
