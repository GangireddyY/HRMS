<script setup lang="ts">
import { ref } from 'vue';
import { Archive, Eye, Pencil, Plus, Send, Trash2 } from '@lucide/vue';
import { ANNOUNCEMENT_STATUSES, type AnnouncementStatus } from '@contracts';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import AnnouncementFormModal from '@/modules/engagement/components/AnnouncementFormModal.vue';
import type { Announcement, Tracking } from '@/modules/engagement/types';
import { ANNOUNCEMENT_STATUS_LABELS, CATEGORY_LABELS, RSVP_LABELS, announcementTone, categoryTone, eventWhen } from '@/modules/engagement/utils/engagement-format';
import { AppBadge, AppButton, AppCard, AppDataTable, AppModal, AppPageHeader, AppSearchInput, AppSelect, AppSkeleton, type TableColumn } from '@/shared/components';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, timeAgo } from '@/shared/utils/format';

const feedback = useFeedbackStore();
const table = useTable((q) => engagementApi.announcements({ ...q, manage: true }), { filters: { status: undefined as AnnouncementStatus | undefined } });
const statusOptions = ANNOUNCEMENT_STATUSES.map((s) => ({ value: s, label: ANNOUNCEMENT_STATUS_LABELS[s] }));
const formOpen = ref(false);
const editing = ref<Announcement | null>(null);
function openForm(a: Announcement | null) {
  editing.value = a;
  formOpen.value = true;
}
async function onSaved() {
  formOpen.value = false;
  feedback.success('Announcement saved');
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
async function publish(a: Announcement) {
  if (!(await feedback.confirm({ title: `Publish "${a.title}"?`, message: a.requiresAck || a.category === 'ALERT' || a.category === 'EVENT' ? 'It appears in the feed and everyone in the audience is notified.' : 'It appears in the feed of everyone in the audience.', confirmLabel: 'Publish' }))) return;
  await act(() => engagementApi.publish(a.id), 'Published');
}
async function remove(a: Announcement) {
  if (!(await feedback.confirm({ title: `Delete "${a.title}"?`, message: 'The draft is deleted.', confirmLabel: 'Delete', danger: true }))) return;
  await act(() => engagementApi.removeAnnouncement(a.id), 'Draft deleted');
}
const trackingFor = ref<Announcement | null>(null);
const tracking = ref<Tracking | null>(null);
async function openTracking(a: Announcement) {
  trackingFor.value = a;
  tracking.value = null;
  try {
    tracking.value = await engagementApi.tracking(a.id);
  } catch (e) {
    trackingFor.value = null;
    feedback.error('Could not load responses', e);
  }
}
const columns: TableColumn<Announcement>[] = [
  { key: 'title', label: 'Announcement' },
  { key: 'status', label: 'Status' },
  { key: 'responses', label: 'Responses' },
  { key: 'actions', label: '', align: 'right' },
];
</script>

<template>
  <div>
    <AppPageHeader title="Announcements" description="News, policy updates and events for everyone or for specific departments and locations.">
      <template #actions><AppButton :icon="Plus" @click="openForm(null)">New announcement</AppButton></template>
    </AppPageHeader>
    <AppCard :padded="false">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search announcements" aria-label="Search announcements" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
      </div>
      <AppDataTable :columns="columns" :rows="table.rows.value" :loading="table.loading.value" :error="table.error.value" :meta="table.meta.value" caption="Announcements" empty-title="No announcements yet" @page="table.setPage" @retry="table.load">
        <template #cell-title="{ row }">
          <p class="font-medium text-fg">{{ row.title }}</p>
          <p class="text-xs text-fg-muted">
            <AppBadge :tone="categoryTone[row.category]" size="sm">{{ CATEGORY_LABELS[row.category] }}</AppBadge>
            <span class="ms-2">{{ row.category === 'EVENT' ? eventWhen(row) : row.publishedAt ? `Published ${timeAgo(row.publishedAt)}` : `Drafted ${timeAgo(row.createdAt)}` }}</span>
            <span v-if="row.departmentIds?.length || row.locationIds?.length" class="ms-2">· targeted</span>
            <span v-if="row.expiresAt" class="ms-2">· until {{ formatDate(row.expiresAt) }}</span>
          </p>
        </template>
        <template #cell-status="{ row }"><AppBadge :tone="announcementTone[row.status]" dot>{{ ANNOUNCEMENT_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-responses="{ row }">
          <span class="text-xs text-fg-muted">
            <template v-if="row.requiresAck">{{ row.counts?.acknowledged ?? 0 }} acknowledged</template>
            <template v-if="row.category === 'EVENT'">{{ row.requiresAck ? ' · ' : '' }}{{ row.counts?.going ?? 0 }} going · {{ row.counts?.maybe ?? 0 }} maybe</template>
            <template v-if="!row.requiresAck && row.category !== 'EVENT'">—</template>
          </span>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-1">
            <AppButton v-if="row.status !== 'DRAFT' && (row.requiresAck || row.category === 'EVENT')" size="sm" variant="ghost" :icon="Eye" :aria-label="`Responses to ${row.title}`" @click="openTracking(row)" />
            <AppButton v-if="row.status !== 'ARCHIVED'" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.title}`" @click="openForm(row)" />
            <AppButton v-if="row.status === 'DRAFT'" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.title}`" @click="remove(row)" />
            <AppButton v-if="row.status === 'PUBLISHED'" size="sm" variant="ghost" :icon="Archive" :aria-label="`Archive ${row.title}`" @click="act(() => engagementApi.archive(row.id), 'Archived')" />
            <AppButton v-if="row.status === 'DRAFT'" size="sm" :icon="Send" @click="publish(row)">Publish</AppButton>
          </div>
        </template>
      </AppDataTable>
    </AppCard>
    <AnnouncementFormModal :open="formOpen" :announcement="editing" @close="formOpen = false" @saved="onSaved" />
    <AppModal :open="!!trackingFor" :title="trackingFor ? `Responses · ${trackingFor.title}` : ''" size="lg" @close="trackingFor = null">
      <AppSkeleton v-if="!tracking" :lines="5" />
      <template v-else>
        <p class="mb-3 text-sm text-fg-muted">{{ tracking.people.filter((p) => p.acknowledgedAt).length }} of {{ tracking.audience }} acknowledged</p>
        <ul class="max-h-[60vh] divide-y divide-line overflow-y-auto">
          <li v-for="p in tracking.people" :key="p.employee.id" class="flex items-center justify-between gap-3 py-2 text-sm">
            <span><span class="text-fg">{{ p.employee.name }}</span> <span class="text-xs text-fg-muted">{{ p.employee.department }}</span></span>
            <span class="flex gap-2">
              <AppBadge v-if="p.rsvp" size="sm" tone="violet">{{ RSVP_LABELS[p.rsvp] }}</AppBadge>
              <AppBadge v-if="trackingFor?.requiresAck" size="sm" :tone="p.acknowledgedAt ? 'success' : 'warning'">{{ p.acknowledgedAt ? 'Acknowledged' : 'Not yet' }}</AppBadge>
            </span>
          </li>
        </ul>
      </template>
    </AppModal>
  </div>
</template>
