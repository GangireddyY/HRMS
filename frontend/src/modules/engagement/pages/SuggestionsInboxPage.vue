<script setup lang="ts">
import { ref } from 'vue';
import { SUGGESTION_STATUSES, type SuggestionStatus } from '@contracts';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import type { SuggestionItem } from '@/modules/engagement/types';
import { SUGGESTION_CATEGORY_LABELS, SUGGESTION_STATUS_LABELS, suggestionTone } from '@/modules/engagement/utils/engagement-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSelect, AppTextarea, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

const feedback = useFeedbackStore();
const table = useTable((q) => engagementApi.suggestions({ ...q, view: 'all' }), { filters: { status: undefined as SuggestionStatus | undefined } });
const statusOptions = SUGGESTION_STATUSES.map((s) => ({ value: s, label: SUGGESTION_STATUS_LABELS[s] }));
const reviewing = ref<SuggestionItem | null>(null);
const status = ref<SuggestionStatus>('UNDER_REVIEW');
const response = ref('');
const busy = ref(false);
function open(s: SuggestionItem) {
  reviewing.value = s;
  status.value = s.status === 'NEW' ? 'UNDER_REVIEW' : s.status;
  response.value = s.response ?? '';
}
async function save() {
  busy.value = true;
  try {
    await engagementApi.reviewSuggestion(reviewing.value!.id, status.value, response.value || null);
    feedback.success('Suggestion updated', reviewing.value!.anonymous ? undefined : 'The author has been notified.');
    reviewing.value = null;
    await table.load();
  } catch (e) {
    feedback.error('Could not update the suggestion', e);
  } finally {
    busy.value = false;
  }
}
const columns: TableColumn<SuggestionItem>[] = [
  { key: 'title', label: 'Suggestion' },
  { key: 'author', label: 'From' },
  { key: 'status', label: 'Status' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Suggestions" description="Ideas from employees. Anonymous suggestions carry no name." />
    <AppCard :padded="false">
      <div class="flex items-center justify-end gap-2 border-b border-line/70 px-4 py-2">
        <AppSelect size="sm" v-model="table.filters.status" class="w-52" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" clickable caption="Suggestions" empty-title="No suggestions" @page="table.setPage" @retry="table.load" @row-click="open">
        <template #cell-title="{ row }">
          <p class="font-medium text-fg">{{ row.title }}</p>
          <p class="line-clamp-2 text-xs text-fg-muted">{{ SUGGESTION_CATEGORY_LABELS[row.category] }} · {{ timeAgo(row.createdAt) }} · {{ row.body }}</p>
        </template>
        <template #cell-author="{ row }"><span :class="row.anonymous ? 'text-fg-subtle italic' : 'text-fg-muted'">{{ row.author?.name ?? 'Anonymous' }}</span></template>
        <template #cell-status="{ row }"><AppBadge :tone="suggestionTone[row.status]" dot>{{ SUGGESTION_STATUS_LABELS[row.status] }}</AppBadge></template>
      </AppDataTable>
    </AppCard>
    <AppModal :open="!!reviewing" :title="reviewing?.title ?? ''" :description="reviewing ? `${SUGGESTION_CATEGORY_LABELS[reviewing.category]} · ${reviewing.author?.name ?? 'Anonymous'}` : undefined" @close="reviewing = null">
      <template v-if="reviewing">
        <p class="mb-4 text-sm whitespace-pre-line text-fg">{{ reviewing.body }}</p>
        <div class="space-y-4">
          <AppSelect v-model="status" label="Status" :options="statusOptions" :clearable="false" />
          <AppTextarea v-model="response" label="Response" :rows="3" :maxlength="2000" :help="reviewing.anonymous ? 'Anonymous authors can\'t see responses.' : 'The author sees this.'" />
        </div>
      </template>
      <template #footer>
        <AppButton variant="secondary" @click="reviewing = null">Cancel</AppButton>
        <AppButton :loading="busy" @click="save">Save</AppButton>
      </template>
    </AppModal>
  </div>
</template>
