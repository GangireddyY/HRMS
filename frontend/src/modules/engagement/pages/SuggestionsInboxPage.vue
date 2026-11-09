<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronRight, Clock, FilterX, Inbox, Lightbulb, MessageSquareReply, SearchX, UserX, Workflow } from '@lucide/vue';
import { SUGGESTION_CATEGORIES, SUGGESTION_STATUSES, type SuggestionStatus } from '@contracts';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import type { SuggestionItem } from '@/modules/engagement/types';
import { SUGGESTION_FLOW, SUGGESTION_VISUALS } from '@/modules/engagement/utils/admin-visuals';
import { SUGGESTION_CATEGORY_LABELS, SUGGESTION_STATUS_LABELS, suggestionTone } from '@/modules/engagement/utils/engagement-format';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppPagination, AppSelect, AppStatStrip, AppTextarea, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate, formatDateTime, timeAgo } from '@/shared/utils/format';

/** Suggestions inbox for HR: the review workflow at a glance, ideas waiting longest first to notice, and a review panel. */
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
    await Promise.all([table.load(), summary.run()]);
  } catch (e) {
    feedback.error('Could not update the suggestion', e);
  } finally {
    busy.value = false;
  }
}

// ---- Summary -------------------------------------------------------------------------------------------------------
const summary = useAsync(() => fetchAllPages((page, pageSize) => engagementApi.suggestions({ view: 'all', page, pageSize })));
const everything = computed(() => summary.data.value ?? []);
const STALE_DAYS = 7;
const ageDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
const isStale = (s: SuggestionItem) => s.status === 'NEW' && ageDays(s.createdAt) >= STALE_DAYS;
const countOf = (st: SuggestionStatus) => everything.value.filter((s) => s.status === st).length;
const stale = computed(() => everything.value.filter(isStale));
const stripItems = computed<StripItem[]>(() =>
  SUGGESTION_FLOW.map((f) => ({
    key: f.status,
    label: SUGGESTION_STATUS_LABELS[f.status],
    value: countOf(f.status),
    tone: { NEW: countOf('NEW') ? 'warning' : 'neutral', UNDER_REVIEW: 'info', ACCEPTED: 'success', IMPLEMENTED: 'brand', DECLINED: 'danger' }[f.status],
    hint: f.status === 'NEW' && stale.value.length ? `${stale.value.length} waiting over a week` : f.hint,
  })),
);
const total = computed(() => everything.value.length);
const responded = computed(() => everything.value.filter((s) => s.status !== 'NEW').length);
const byCategory = computed(() =>
  SUGGESTION_CATEGORIES.map((c) => ({ category: c, count: everything.value.filter((s) => s.category === c).length }))
    .filter((c) => c.count)
    .sort((a, b) => b.count - a.count),
);
const catMax = computed(() => Math.max(1, ...byCategory.value.map((c) => c.count)));
const FLOW_BAR: Record<SuggestionStatus, string> = { NEW: 'bg-warning', UNDER_REVIEW: 'bg-info', ACCEPTED: 'bg-success', IMPLEMENTED: 'bg-brand-600', DECLINED: 'bg-danger/70' };
const FLOW_ICON_TONE: Record<SuggestionStatus, string> = {
  NEW: 'bg-warning-soft text-warning-fg',
  UNDER_REVIEW: 'bg-info-soft text-info-fg',
  ACCEPTED: 'bg-success-soft text-success-fg',
  IMPLEMENTED: 'bg-accent-soft text-accent-fg',
  DECLINED: 'bg-danger-soft text-danger-fg',
};
const flowOf = (st: SuggestionStatus) => SUGGESTION_FLOW.find((f) => f.status === st)!;
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Suggestions" description="Ideas from employees. Anonymous suggestions carry no name." />

    <AppStatStrip :items="stripItems" :loading="summary.loading.value && !summary.data.value" selectable :selected="table.filters.status ?? null" label="Suggestions by status — select to filter" @select="(k) => (table.filters.status = (k ?? undefined) as SuggestionStatus | undefined)" />

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section class="card min-w-0 overflow-hidden" aria-labelledby="inbox-title">
        <header class="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-2.5">
          <div class="flex items-center gap-3">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><Inbox :size="16" /></span>
            <div>
              <h2 id="inbox-title" class="text-sm font-semibold text-fg">Inbox</h2>
              <p class="text-xs text-fg-muted">{{ table.filters.status ? SUGGESTION_STATUS_LABELS[table.filters.status] : 'All suggestions' }}<template v-if="table.meta.value"> · {{ table.meta.value.total }}</template></p>
            </div>
          </div>
          <AppSelect size="sm" v-model="table.filters.status" class="w-52" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        </header>

        <AppErrorState v-if="table.error.value && !table.loading.value" :error="table.error.value" @retry="table.load" />
        <ul v-else-if="table.loading.value && !table.rows.value.length" class="divide-y divide-line/70" aria-label="Loading suggestions">
          <li v-for="i in 4" :key="i" class="flex gap-3 px-4 py-4">
            <div class="skeleton h-10 w-10 rounded-lg" />
            <div class="flex-1 space-y-2"><div class="skeleton h-3.5 w-1/2 rounded-full" /><div class="skeleton h-3 w-5/6 rounded-full" /></div>
          </li>
        </ul>
        <AppEmptyState v-else-if="!table.rows.value.length && table.isFiltered.value" :icon="SearchX" title="No matches" :description="`No suggestions are ${table.filters.status ? SUGGESTION_STATUS_LABELS[table.filters.status].toLowerCase() : 'in this view'}.`">
          <AppButton variant="secondary" size="sm" :icon="FilterX" @click="table.clearFilters()">Clear filters</AppButton>
        </AppEmptyState>
        <AppEmptyState v-else-if="!table.rows.value.length" :icon="Lightbulb" title="No suggestions" description="When employees share ideas from My Workspace, they land here for you to review and respond." />
        <ul v-else :class="['divide-y divide-line/70', table.loading.value && 'opacity-60']">
          <li v-for="s in table.rows.value" :key="s.id">
            <button type="button" :class="['relative flex w-full items-start gap-3 px-4 py-3.5 text-start transition hover:bg-surface-muted/50 focus-visible:bg-surface-muted/50 focus-visible:outline-none', s.status === 'NEW' && 'bg-warning-soft/15']" @click="open(s)">
              <span v-if="s.status === 'NEW'" class="absolute inset-y-0 start-0 w-1 bg-warning" aria-hidden="true" />
              <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', SUGGESTION_VISUALS[s.category].tile]" :title="SUGGESTION_CATEGORY_LABELS[s.category]" aria-hidden="true">
                <component :is="SUGGESTION_VISUALS[s.category].icon" :size="18" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span :class="['text-sm text-fg', s.status === 'NEW' ? 'font-semibold' : 'font-medium']">{{ s.title }}</span>
                  <span v-if="isStale(s)" class="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-medium text-warning-fg"><Clock :size="11" aria-hidden="true" />Waiting {{ ageDays(s.createdAt) }} days</span>
                </span>
                <span class="mt-0.5 line-clamp-2 block text-xs text-fg-muted">{{ s.body }}</span>
                <span class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                  <span class="inline-flex items-center gap-1.5">
                    <AppAvatar v-if="s.author" :name="s.author.name" size="xs" />
                    <span v-else class="flex h-5 w-5 items-center justify-center rounded-full bg-surface-muted text-fg-subtle" aria-hidden="true"><UserX :size="11" /></span>
                    <span :class="s.anonymous ? 'text-fg-subtle italic' : 'text-fg'">{{ s.author?.name ?? 'Anonymous' }}</span>
                  </span>
                  <span>{{ SUGGESTION_CATEGORY_LABELS[s.category] }}</span>
                  <span :title="formatDateTime(s.createdAt)">{{ timeAgo(s.createdAt) }}</span>
                  <span v-if="s.response" class="inline-flex min-w-0 items-center gap-1 text-fg-subtle"><MessageSquareReply :size="12" class="shrink-0" aria-hidden="true" /><span class="max-w-72 truncate">Replied{{ s.respondedBy ? ` by ${s.respondedBy}` : '' }}: {{ s.response }}</span></span>
                </span>
              </span>
              <span class="flex shrink-0 items-center gap-2 self-center">
                <AppBadge :tone="suggestionTone[s.status]" dot>{{ SUGGESTION_STATUS_LABELS[s.status] }}</AppBadge>
                <ChevronRight :size="16" class="text-fg-subtle" aria-hidden="true" />
              </span>
            </button>
          </li>
        </ul>
        <AppPagination v-if="table.meta.value && table.meta.value.total > 0" class="border-t border-line" :meta="table.meta.value" :disabled="table.loading.value" @change="table.setPage" />
      </section>

      <aside class="space-y-4">
        <AppCard title="Workflow" :icon="Workflow" :description="total ? `${responded} of ${total} picked up` : 'How ideas move through review'">
          <ol class="space-y-3">
            <li v-for="f in SUGGESTION_FLOW" :key="f.status">
              <button type="button" :aria-pressed="table.filters.status === f.status" :class="['-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-1.5 text-start transition hover:bg-surface-muted/60', table.filters.status === f.status && 'bg-accent-soft']" @click="table.filters.status = table.filters.status === f.status ? undefined : f.status">
                <span :class="['flex h-7 w-7 shrink-0 items-center justify-center rounded-md', FLOW_ICON_TONE[f.status]]" aria-hidden="true"><component :is="f.icon" :size="14" /></span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-baseline justify-between gap-2 text-xs">
                    <span class="font-medium text-fg">{{ SUGGESTION_STATUS_LABELS[f.status] }}</span>
                    <span class="font-semibold text-fg tabular-nums">{{ countOf(f.status) }}</span>
                  </span>
                  <span class="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true"><span :class="['block h-full rounded-full', FLOW_BAR[f.status]]" :style="{ width: `${total ? (countOf(f.status) / total) * 100 : 0}%` }" /></span>
                </span>
              </button>
            </li>
          </ol>
        </AppCard>
        <AppCard v-if="byCategory.length" title="By category" :icon="Lightbulb">
          <ul class="space-y-3">
            <li v-for="c in byCategory" :key="c.category">
              <div class="mb-1 flex items-center gap-2 text-xs">
                <span :class="['flex h-5 w-5 items-center justify-center rounded', SUGGESTION_VISUALS[c.category].tile]" aria-hidden="true"><component :is="SUGGESTION_VISUALS[c.category].icon" :size="11" /></span>
                <span class="flex-1 font-medium text-fg">{{ SUGGESTION_CATEGORY_LABELS[c.category] }}</span>
                <span class="text-fg-muted tabular-nums">{{ c.count }}</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true"><div class="h-full rounded-full bg-brand-500" :style="{ width: `${(c.count / catMax) * 100}%` }" /></div>
            </li>
          </ul>
        </AppCard>
      </aside>
    </div>

    <AppModal :open="!!reviewing" :title="reviewing?.title ?? ''" :description="reviewing ? `${SUGGESTION_CATEGORY_LABELS[reviewing.category]} · ${reviewing.author?.name ?? 'Anonymous'}` : undefined" @close="reviewing = null">
      <template v-if="reviewing">
        <div class="mb-5 rounded-xl bg-surface-muted/50 p-4 ring-1 ring-line/60">
          <div class="mb-3 flex items-center gap-3">
            <AppAvatar v-if="reviewing.author" :name="reviewing.author.name" size="sm" />
            <span v-else class="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-fg-subtle ring-1 ring-line" aria-hidden="true"><UserX :size="15" /></span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-fg">{{ reviewing.author?.name ?? 'Anonymous' }}</p>
              <p class="text-xs text-fg-muted">{{ SUGGESTION_CATEGORY_LABELS[reviewing.category] }} · submitted {{ formatDate(reviewing.createdAt) }} ({{ timeAgo(reviewing.createdAt) }})</p>
            </div>
            <AppBadge :tone="suggestionTone[reviewing.status]" dot>{{ SUGGESTION_STATUS_LABELS[reviewing.status] }}</AppBadge>
          </div>
          <p class="text-sm whitespace-pre-line text-fg">{{ reviewing.body }}</p>
          <p v-if="reviewing.respondedAt" class="mt-3 border-t border-line/70 pt-3 text-xs text-fg-muted">Last updated{{ reviewing.respondedBy ? ` by ${reviewing.respondedBy}` : '' }} {{ timeAgo(reviewing.respondedAt) }}</p>
        </div>
        <div class="space-y-4">
          <div>
            <p class="mb-2 text-xs font-medium text-fg-muted" id="flow-label">Move to</p>
            <div class="flex flex-wrap gap-2" role="group" aria-labelledby="flow-label">
              <button
                v-for="f in SUGGESTION_FLOW"
                :key="f.status"
                type="button"
                :aria-pressed="status === f.status"
                :class="['inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition', status === f.status ? `${FLOW_ICON_TONE[f.status]} ring-current` : 'text-fg-muted ring-line hover:bg-surface-muted hover:text-fg']"
                @click="status = f.status"
              >
                <component :is="f.icon" :size="13" aria-hidden="true" />{{ SUGGESTION_STATUS_LABELS[f.status] }}
              </button>
            </div>
            <p class="mt-1.5 text-2xs text-fg-subtle">{{ flowOf(status).hint }}</p>
          </div>
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
