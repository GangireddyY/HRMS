<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { BarChart3, Lock, Pencil, Plus, Rocket, Trash2 } from '@lucide/vue';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import SurveyFormModal from '@/modules/engagement/components/SurveyFormModal.vue';
import type { SurveyDetail, SurveySummary } from '@/modules/engagement/types';
import { SURVEY_STATUS_LABELS, surveyTone } from '@/modules/engagement/utils/engagement-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

const router = useRouter();
const feedback = useFeedbackStore();
const table = useTable((q) => engagementApi.surveys({ ...q, manage: true }));
const formOpen = ref(false);
const editing = ref<SurveyDetail | null>(null);
async function openForm(s: SurveySummary | null) {
  editing.value = s ? await engagementApi.survey(s.id).catch(() => null) : null;
  formOpen.value = true;
}
async function onSaved() {
  formOpen.value = false;
  feedback.success('Survey saved');
  await table.load();
}
async function act(fn: () => Promise<unknown>, success: string, description?: string) {
  try {
    await fn();
    feedback.success(success, description);
    await table.load();
  } catch (e) {
    feedback.error('Could not complete the action', e);
  }
}
async function open(s: SurveySummary) {
  if (!(await feedback.confirm({ title: `Open "${s.title}"?`, message: 'Everyone in the audience is notified. Questions and anonymity can no longer change.', confirmLabel: 'Open survey' }))) return;
  await act(() => engagementApi.openSurvey(s.id), 'Survey opened', 'Employees have been asked to respond.');
}
async function close(s: SurveySummary) {
  if (!(await feedback.confirm({ title: `Close "${s.title}"?`, message: 'No more answers are accepted.', confirmLabel: 'Close survey' }))) return;
  await act(() => engagementApi.closeSurvey(s.id), 'Survey closed');
}
async function remove(s: SurveySummary) {
  if (!(await feedback.confirm({ title: `Delete "${s.title}"?`, message: 'The draft is deleted.', confirmLabel: 'Delete', danger: true }))) return;
  await act(() => engagementApi.removeSurvey(s.id), 'Draft deleted');
}
const columns: TableColumn<SurveySummary>[] = [
  { key: 'title', label: 'Survey' },
  { key: 'status', label: 'Status' },
  { key: 'responses', label: 'Responses', align: 'right' },
  { key: 'actions', label: '', align: 'right' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Surveys" description="Pulse checks and engagement surveys, anonymous by default.">
      <template #actions><AppButton :icon="Plus" @click="openForm(null)">New survey</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" caption="Surveys" empty-title="No surveys yet" @page="table.setPage" @retry="table.load">
        <template #cell-title="{ row }">
          <p class="font-medium text-fg">{{ row.title }}</p>
          <p class="text-xs text-fg-muted">{{ row.questions }} question{{ row.questions === 1 ? '' : 's' }} · {{ row.anonymous ? 'anonymous' : 'named' }}{{ row.departmentIds?.length ? ' · targeted' : '' }}{{ row.closesAt ? ` · closes ${formatDateTime(row.closesAt)}` : '' }}{{ row.openedAt ? ` · opened ${timeAgo(row.openedAt)}` : '' }}</p>
        </template>
        <template #cell-status="{ row }"><AppBadge :tone="surveyTone[row.status]" dot>{{ row.status === 'OPEN' && !row.open ? 'Past closing time' : SURVEY_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-responses="{ row }"><span class="tabular-nums">{{ row.status === 'DRAFT' ? '—' : row.responses }}</span></template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1">
            <AppButton v-if="row.status !== 'DRAFT'" size="sm" variant="secondary" :icon="BarChart3" @click="router.push(`/hr/engagement/surveys/${row.id}`)">Results</AppButton>
            <AppButton v-if="row.status !== 'CLOSED'" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.title}`" @click="openForm(row)" />
            <AppButton v-if="row.status === 'DRAFT'" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.title}`" @click="remove(row)" />
            <AppButton v-if="row.status === 'OPEN'" size="sm" variant="ghost" :icon="Lock" :aria-label="`Close ${row.title}`" @click="close(row)" />
            <AppButton v-if="row.status === 'DRAFT'" size="sm" :icon="Rocket" @click="open(row)">Open</AppButton>
          </div>
        </template>
      </AppDataTable>
    </AppCard>
    <SurveyFormModal :open="formOpen" :survey="editing" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
