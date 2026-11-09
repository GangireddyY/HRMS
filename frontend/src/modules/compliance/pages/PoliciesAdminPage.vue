<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { useRouter } from 'vue-router';
import { AlertTriangle, BellRing, CalendarClock, CheckCircle2, FilePen, Plus, ScrollText, Users } from '@lucide/vue';
import { POLICY_CATEGORIES, POLICY_STATUSES, type PolicyCategory, type PolicyStatus } from '@contracts';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import PolicyFormModal from '@/modules/compliance/components/PolicyFormModal.vue';
import PolicyGridCard from '@/modules/compliance/components/PolicyGridCard.vue';
import type { PolicyDetail, PolicySummary } from '@/modules/compliance/types';
import { POLICY_CATEGORY_LABELS, POLICY_STATUS_LABELS, policyTone } from '@/modules/compliance/utils/compliance-format';
import { POLICY_VISUALS, ackBar, ackPct, relativeDays } from '@/modules/compliance/utils/compliance-visuals';
import { AppBadge, AppButton, AppCard, AppDataTable, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, type StripItem, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useTable } from '@/shared/composables/use-table';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { fetchAllPages } from '@/shared/utils/fetch-all';
import { formatDate, timeAgo } from '@/shared/utils/format';

/** Policy library for HR: acknowledgement rates, reviews that are due and drafts waiting to be published. */
const router = useRouter();
const feedback = useFeedbackStore();
const table = useTable((q) => complianceApi.policies(q), { filters: { status: undefined as PolicyStatus | undefined, category: undefined as PolicyCategory | undefined } });
/** Every policy for the summary and the attention list, independent of the table's filters. */
const all = useAsync(() => fetchAllPages((page, pageSize) => complianceApi.policies({ page, pageSize })));
const statusOptions = POLICY_STATUSES.map((s) => ({ value: s, label: POLICY_STATUS_LABELS[s] }));
const categoryOptions = POLICY_CATEGORIES.map((c) => ({ value: c, label: POLICY_CATEGORY_LABELS[c] }));
const formOpen = ref(false);
async function onSaved(p: PolicyDetail) {
  formOpen.value = false;
  feedback.success('Policy drafted', 'Review the text, then publish it.');
  await router.push(`/hr/compliance/policies/${p.id}`);
}
const columns: TableColumn<PolicySummary>[] = [
  { key: 'title', label: 'Policy' },
  { key: 'status', label: 'Status' },
  { key: 'acks', label: 'Acknowledged' },
  { key: 'review', label: 'Next review' },
  { key: 'updated', label: 'Updated' },
];
const pct = (p: PolicySummary) => ackPct(p.stats);

// ---- Summary ---------------------------------------------------------------------------------------------------
const policies = computed(() => all.data.value ?? []);
const countOf = (s: PolicyStatus) => policies.value.filter((p) => p.status === s).length;
const tracked = computed(() => policies.value.filter((p) => p.status === 'PUBLISHED' && p.requiresAck && p.stats));
const totals = computed(() =>
  tracked.value.reduce((t, p) => ({ audience: t.audience + p.stats!.audience, acknowledged: t.acknowledged + p.stats!.acknowledged, pending: t.pending + p.stats!.pending, overdue: t.overdue + p.stats!.overdue }), { audience: 0, acknowledged: 0, pending: 0, overdue: 0 }),
);
const overallPct = computed(() => ackPct(totals.value));
const reviewDue = computed(() => policies.value.filter((p) => p.reviewDue).length);
const strip = computed<StripItem[]>(() => [
  { key: 'PUBLISHED', label: 'Published', value: all.data.value ? countOf('PUBLISHED') : null, hint: 'In force for employees', tone: 'success' },
  { key: 'DRAFT', label: 'Drafts', value: all.data.value ? countOf('DRAFT') : null, hint: 'Not visible to employees yet', tone: 'neutral' },
  { key: 'RETIRED', label: 'Retired', value: all.data.value ? countOf('RETIRED') : null, hint: 'Kept with their acknowledgements', tone: 'warning' },
]);
const CIRC = 2 * Math.PI * 42;

// ---- Needs attention -------------------------------------------------------------------------------------------
interface Attention {
  policy: PolicySummary;
  text: string;
  tone: 'danger' | 'warning' | 'info';
  icon: Component;
  rank: number;
}
const attention = computed<Attention[]>(() => {
  const out: Attention[] = [];
  for (const p of policies.value) {
    if (p.status === 'RETIRED') continue;
    if (p.stats?.overdue) out.push({ policy: p, text: `${p.stats.overdue} ${p.stats.overdue === 1 ? 'person is' : 'people are'} overdue${p.lastRemindedAt ? ` · reminded ${timeAgo(p.lastRemindedAt)}` : ' · not reminded yet'}`, tone: 'danger', icon: BellRing, rank: 0 });
    if (p.reviewDue) out.push({ policy: p, text: `Review was due ${p.nextReviewOn ? formatDate(p.nextReviewOn) : ''}`.trim(), tone: 'warning', icon: CalendarClock, rank: 1 });
    if (p.status === 'PUBLISHED' && p.stats && !p.stats.overdue && p.stats.audience && pct(p) < 50) out.push({ policy: p, text: p.stats.acknowledged ? `Only ${pct(p)}% acknowledged so far` : 'No acknowledgements yet', tone: 'warning', icon: Users, rank: 2 });
    if (p.status === 'DRAFT') out.push({ policy: p, text: 'Drafted — not published yet', tone: 'info', icon: FilePen, rank: 3 });
    else if (p.hasDraft) out.push({ policy: p, text: 'Draft changes waiting to be published', tone: 'info', icon: FilePen, rank: 3 });
  }
  return out.sort((a, b) => a.rank - b.rank);
});
const ATTENTION_SHOWN = 4;
const TONE_TEXT = { danger: 'text-danger-fg', warning: 'text-warning-fg', info: 'text-info-fg' } as const;
const TONE_EDGE = { danger: 'bg-danger', warning: 'bg-warning', info: 'bg-info' } as const;
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Policies" description="Company policies, who they apply to and who has acknowledged them.">
      <template #actions>
        <AppButton variant="secondary" :icon="CalendarClock" to="/hr/compliance/calendar">Statutory calendar</AppButton>
        <AppButton :icon="Plus" @click="formOpen = true">New policy</AppButton>
      </template>
    </AppPageHeader>

    <AppStatStrip :items="strip" selectable :selected="table.filters.status ?? null" :loading="all.loading.value && !all.data.value" label="Policies by status" @select="(k) => (table.filters.status = (k as PolicyStatus | null) ?? undefined)" />

    <div v-if="(all.loading.value && !all.data.value) || policies.length" class="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <AppCard title="Acknowledgement" :icon="ScrollText" description="Across published policies that ask for it" fill>
        <div v-if="all.loading.value && !all.data.value" class="skeleton h-28 rounded-md" />
        <div v-else-if="tracked.length" class="flex flex-1 flex-wrap items-center gap-5">
          <div class="relative h-28 w-28 shrink-0">
            <svg class="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="50" cy="50" r="42" fill="none" stroke-width="10" class="stroke-surface-muted" />
              <circle cx="50" cy="50" r="42" fill="none" stroke-width="10" stroke-linecap="round" :class="['transition-[stroke-dashoffset] duration-700', overallPct >= 90 ? 'stroke-success' : 'stroke-brand-500']" :stroke-dasharray="CIRC" :stroke-dashoffset="CIRC * (1 - overallPct / 100)" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-2xl font-semibold text-fg tabular-nums">{{ overallPct }}%</span>
              <span class="text-2xs text-fg-muted">acknowledged</span>
            </div>
          </div>
          <dl class="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt class="text-xs text-fg-muted">Acknowledgements</dt>
              <dd class="font-semibold text-fg tabular-nums">{{ totals.acknowledged }}<span class="font-normal text-fg-muted"> / {{ totals.audience }}</span></dd>
            </div>
            <div>
              <dt class="text-xs text-fg-muted">Policies tracked</dt>
              <dd class="font-semibold text-fg tabular-nums">{{ tracked.length }}</dd>
            </div>
            <div>
              <dt class="text-xs text-fg-muted">Still to acknowledge</dt>
              <dd class="font-semibold text-warning-fg tabular-nums">{{ totals.pending }}</dd>
            </div>
            <div>
              <dt class="text-xs text-fg-muted">Overdue</dt>
              <dd :class="['font-semibold tabular-nums', totals.overdue ? 'text-danger-fg' : 'text-fg']">{{ totals.overdue }}</dd>
            </div>
          </dl>
        </div>
        <p v-else class="text-sm text-fg-muted">Publish a policy that asks for acknowledgement to track who has read it.</p>
        <template v-if="reviewDue" #footer>
          <p class="flex items-center gap-1.5 text-xs text-warning-fg"><CalendarClock :size="13" aria-hidden="true" />{{ reviewDue }} {{ reviewDue === 1 ? 'policy is' : 'policies are' }} due for review</p>
        </template>
      </AppCard>

      <AppCard title="Needs attention" :icon="AlertTriangle" :description="attention.length ? 'Overdue acknowledgements, reviews and unpublished drafts' : 'Policies that need action show up here'" :padded="false" fill>
        <div v-if="all.loading.value && !all.data.value" class="space-y-3 p-4">
          <div v-for="i in 3" :key="i" class="skeleton h-9 rounded-md" />
        </div>
        <div v-else-if="!attention.length" class="flex flex-1 items-start gap-3 p-4">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-fg" aria-hidden="true"><CheckCircle2 :size="16" /></span>
          <p class="text-sm text-fg-muted">Nothing needs attention. Reviews are up to date and nobody is overdue.</p>
        </div>
        <ul v-else class="flex-1 divide-y divide-line/70">
          <li v-for="a in attention.slice(0, ATTENTION_SHOWN)" :key="`${a.policy.id}-${a.rank}`" class="relative">
            <span :class="['absolute inset-y-0 start-0 w-0.5', TONE_EDGE[a.tone]]" aria-hidden="true" />
            <RouterLink :to="`/hr/compliance/policies/${a.policy.id}`" class="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-muted/50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-inset">
              <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset', POLICY_VISUALS[a.policy.category].tile]" aria-hidden="true">
                <component :is="POLICY_VISUALS[a.policy.category].icon" :size="15" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-fg group-hover:underline">{{ a.policy.title }}</span>
                <span :class="['flex items-center gap-1 truncate text-xs font-medium', TONE_TEXT[a.tone]]"><component :is="a.icon" :size="12" class="shrink-0" aria-hidden="true" />{{ a.text }}</span>
              </span>
            </RouterLink>
          </li>
        </ul>
        <template v-if="attention.length > ATTENTION_SHOWN" #footer>
          <p class="text-xs text-fg-muted">and {{ attention.length - ATTENTION_SHOWN }} more</p>
        </template>
      </AppCard>
    </div>

    <section class="card overflow-hidden" aria-labelledby="library-title">
      <header class="flex items-center gap-3 border-b border-line/70 px-4 py-3">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><ScrollText :size="16" /></span>
        <div class="min-w-0 flex-1">
          <h2 id="library-title" class="text-sm font-semibold text-fg">Policy library</h2>
          <p class="text-xs text-fg-muted">Open a policy to edit its text, publish a new version or follow up on acknowledgements.</p>
        </div>
      </header>
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px_220px]">
        <AppSearchInput v-model="table.search.value" placeholder="Search policies" aria-label="Search policies" />
        <AppSelect v-model="table.filters.status" :options="statusOptions" placeholder="All statuses" aria-label="Filter by status" />
        <AppSelect v-model="table.filters.category" :options="categoryOptions" placeholder="All categories" aria-label="Filter by category" />
      </div>
      <AppDataTable
        :columns="columns"
        :rows="table.rows.value"
        :loading="table.loading.value"
        :error="table.error.value"
        :meta="table.meta.value"
        clickable
        caption="Policies"
        empty-title="No policies yet"
        empty-description="Draft your first policy, choose who it applies to, then publish it and ask employees to acknowledge it."
        :filtered="table.isFiltered.value"
        @page="table.setPage"
        @retry="table.load"
        @row-click="(p: PolicySummary) => router.push(`/hr/compliance/policies/${p.id}`)"
        @clear="table.clearFilters()"
      >
        <template #empty><AppButton :icon="Plus" @click="formOpen = true">New policy</AppButton></template>
        <template #cell-title="{ row }">
          <div class="flex min-w-0 items-center gap-3 py-1">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', POLICY_VISUALS[row.category].tile]" aria-hidden="true">
              <component :is="POLICY_VISUALS[row.category].icon" :size="16" />
            </span>
            <div class="min-w-0">
              <p class="flex min-w-0 items-center gap-2">
                <span class="truncate font-medium text-fg">{{ row.title }}</span>
                <AppBadge v-if="row.hasDraft && row.currentVersion" size="sm" tone="info">Draft changes</AppBadge>
              </p>
              <p class="truncate text-xs text-fg-muted">{{ POLICY_CATEGORY_LABELS[row.category] }}{{ row.currentVersion ? ` · v${row.currentVersion.version}` : '' }}{{ row.summary ? ` · ${row.summary}` : '' }}</p>
            </div>
          </div>
        </template>
        <template #cell-status="{ row }"><AppBadge :tone="policyTone[row.status]" dot>{{ POLICY_STATUS_LABELS[row.status] }}</AppBadge></template>
        <template #cell-acks="{ row }">
          <div v-if="row.stats" class="w-44 max-md:ms-auto">
            <p class="flex items-baseline justify-between gap-2 text-xs">
              <span class="font-semibold text-fg tabular-nums">{{ pct(row) }}%</span>
              <span class="text-fg-muted tabular-nums">{{ row.stats.acknowledged }} / {{ row.stats.audience }}</span>
            </p>
            <span class="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              <span :class="['block h-full rounded-full', ackBar(pct(row), row.stats.overdue)]" :style="{ width: `${Math.max(pct(row), row.stats.acknowledged ? 3 : 0)}%` }" />
            </span>
            <p v-if="row.stats.overdue" class="mt-0.5 flex items-center gap-1 text-2xs font-medium text-danger-fg"><AlertTriangle :size="11" aria-hidden="true" />{{ row.stats.overdue }} overdue</p>
            <p v-else-if="row.stats.pending" class="mt-0.5 text-2xs text-fg-subtle tabular-nums">{{ row.stats.pending }} still to acknowledge</p>
            <p v-else class="mt-0.5 flex items-center gap-1 text-2xs text-success-fg"><CheckCircle2 :size="11" aria-hidden="true" />Everyone has acknowledged</p>
          </div>
          <span v-else class="text-xs text-fg-muted">{{ row.requiresAck ? '—' : 'Not required' }}</span>
        </template>
        <template #cell-review="{ row }">
          <span v-if="row.nextReviewOn && row.reviewDue" class="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-fg ring-1 ring-warning/20 ring-inset" :title="formatDate(row.nextReviewOn)">
            <CalendarClock :size="12" aria-hidden="true" />Due {{ formatDate(row.nextReviewOn) }}
          </span>
          <span v-else-if="row.nextReviewOn" class="text-fg">
            {{ formatDate(row.nextReviewOn) }}
            <span class="block text-2xs text-fg-subtle">{{ relativeDays(row.nextReviewOn) }}</span>
          </span>
          <span v-else class="text-xs text-fg-muted">{{ row.reviewMonths ? '—' : 'No review cycle' }}</span>
        </template>
        <template #cell-updated="{ row }"><span class="text-xs text-fg-muted" :title="formatDate(row.updatedAt)">{{ timeAgo(row.updatedAt) }}</span></template>
        <template #card="{ row }"><PolicyGridCard :policy="row" /></template>
      </AppDataTable>
    </section>
    <PolicyFormModal :open="formOpen" :policy="null" @close="formOpen = false" @saved="onSaved" />
  </div>
</template>
