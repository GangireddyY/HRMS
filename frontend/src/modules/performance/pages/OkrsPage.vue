<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Building2, ChevronLeft, ChevronRight, Crosshair, Gauge, ListTree, Plus, User, Users } from '@lucide/vue';
import type { OkrLevel } from '@contracts';
import { performanceApi } from '@/modules/performance/api/performance.api';
import ObjectiveCard from '@/modules/performance/components/ObjectiveCard.vue';
import ObjectiveDetailModal from '@/modules/performance/components/ObjectiveDetailModal.vue';
import ObjectiveFormModal from '@/modules/performance/components/ObjectiveFormModal.vue';
import OkrCheckInModal from '@/modules/performance/components/OkrCheckInModal.vue';
import type { KeyResult, ObjectiveDetail } from '@/modules/performance/types';
import { quarterOf, todayIso } from '@/modules/performance/utils/performance-ops';
import { AppButton, AppEmptyState, AppErrorState, AppPageHeader, AppSegmented, AppSkeleton, AppStatStrip } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** OKRs for a quarter: company objectives with the department and individual objectives aligned beneath them. */
const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const today = todayIso();
const offset = ref(0);
const quarter = computed(() => quarterOf(today, offset.value));
const date = computed(() => (offset.value === 0 ? today : quarter.value.start));
const okrs = useAsync(() => performanceApi.okrs({ date: date.value }));
watch(date, () => void okrs.run());
const data = computed(() => okrs.data.value);

type Filter = 'ALL' | OkrLevel | 'MINE';
const filter = ref<Filter>('ALL');
const filterOptions = [
  { value: 'ALL' as const, label: 'All', icon: ListTree },
  { value: 'COMPANY' as const, label: 'Company', icon: Building2 },
  { value: 'DEPARTMENT' as const, label: 'Departments', icon: Users },
  { value: 'MINE' as const, label: 'Mine', icon: User },
];

/** Depth-first: each objective followed by those aligned to it (orphans of hidden parents start a new root). */
const rows = computed(() => {
  const all = data.value?.objectives ?? [];
  const me = data.value?.selfEmployeeId;
  if (filter.value !== 'ALL') {
    const list = filter.value === 'MINE' ? all.filter((o) => o.owner?.id === me && !!me) : all.filter((o) => o.level === filter.value);
    return list.map((o) => ({ o, depth: 0, aligned: all.filter((c) => c.parentId === o.id).length }));
  }
  const ids = new Set(all.map((o) => o.id));
  const children = new Map<string, typeof all>();
  for (const o of all) if (o.parentId && ids.has(o.parentId)) children.set(o.parentId, [...(children.get(o.parentId) ?? []), o]);
  const out: { o: (typeof all)[number]; depth: number; aligned: number }[] = [];
  const seen = new Set<string>();
  const walk = (o: (typeof all)[number], depth: number) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    const kids = children.get(o.id) ?? [];
    out.push({ o, depth, aligned: kids.length });
    for (const c of kids) walk(c, depth + 1);
  };
  for (const o of all) if (!o.parentId || !ids.has(o.parentId)) walk(o, 0);
  return out;
});

const stats = computed(() => {
  const s = data.value?.summary;
  return [
    { key: 'total', label: 'Objectives', value: s?.total ?? 0, icon: Crosshair, tone: 'brand', hint: quarter.value.label },
    { key: 'avg', label: 'Average progress', value: `${s?.averageProgress ?? 0}%`, icon: Gauge, tone: 'info', hint: 'Active objectives' },
    { key: 'on', label: 'On track', value: s?.onTrack ?? 0, tone: 'success', hint: 'Latest check-in' },
    { key: 'risk', label: 'At risk', value: s?.atRisk ?? 0, tone: 'warning', hint: 'Latest check-in' },
    { key: 'off', label: 'Off track', value: s?.offTrack ?? 0, tone: 'danger', hint: `${s?.noCheckIn ?? 0} without a check-in` },
  ];
});
const canCreate = computed(() => !!data.value && (data.value.can.company || data.value.can.department || data.value.can.individual));

// ---- Modals ----------------------------------------------------------------------------------------------------
const openId = ref<string | null>(typeof route.query.objective === 'string' ? route.query.objective : null);
watch(openId, (id) => void router.replace({ query: { ...route.query, objective: id ?? undefined } }));
const form = ref<{ open: boolean; objective: ObjectiveDetail | null; parentId: string | null }>({ open: false, objective: null, parentId: null });
const detail = ref<InstanceType<typeof ObjectiveDetailModal> | null>(null);
const checkIn = ref<KeyResult | null>(null);
function openCheckIn(kr: KeyResult, objectiveId: string) {
  const o = data.value?.objectives.find((x) => x.id === objectiveId);
  checkIn.value = { ...kr, checkIns: o?.health ? [{ id: '', value: kr.currentValue, health: o.health, note: null, by: null, createdAt: '' }] : [] };
}
function saved(o: ObjectiveDetail) {
  const editing = !!form.value.objective;
  form.value = { open: false, objective: null, parentId: null };
  feedback.success(editing ? 'Objective saved' : 'Objective created');
  void okrs.run();
  if (editing) void detail.value?.reload();
  else openId.value = o.id;
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Objectives & key results" description="What the company, each department and every person is aiming for this quarter, and how it's going.">
      <template #actions>
        <AppButton v-if="canCreate" :icon="Plus" @click="form = { open: true, objective: null, parentId: null }">New objective</AppButton>
      </template>
    </AppPageHeader>

    <div class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-1 rounded-lg border border-line bg-surface p-1 shadow-xs">
        <AppButton size="sm" variant="ghost" :icon="ChevronLeft" aria-label="Previous quarter" @click="offset--" />
        <span class="min-w-20 text-center text-sm font-semibold text-fg tabular-nums" aria-live="polite">{{ quarter.label }}</span>
        <AppButton size="sm" variant="ghost" :icon="ChevronRight" aria-label="Next quarter" @click="offset++" />
      </div>
      <AppButton v-if="offset !== 0" size="sm" variant="link" @click="offset = 0">This quarter</AppButton>
      <div class="ms-auto"><AppSegmented v-model="filter" :options="filterOptions" label="Show" size="sm" /></div>
    </div>

    <AppStatStrip :items="stats" :loading="okrs.loading.value && !data" label="OKR summary" />

    <AppSkeleton v-if="okrs.loading.value && !data" :lines="8" />
    <AppErrorState v-else-if="okrs.error.value" :error="okrs.error.value" title="Could not load the OKRs" @retry="okrs.run" />
    <div v-else-if="!rows.length" class="card">
      <AppEmptyState
        :icon="Crosshair"
        :title="filter === 'MINE' ? 'No objectives of yours this quarter' : `No objectives for ${quarter.label}`"
        :description="canCreate ? 'Start with a few ambitious objectives, each with two to five measurable key results.' : 'Objectives your company and team set appear here.'"
      >
        <AppButton v-if="canCreate" size="sm" :icon="Plus" @click="form = { open: true, objective: null, parentId: null }">New objective</AppButton>
      </AppEmptyState>
    </div>
    <div v-else class="space-y-3" aria-label="Objectives">
      <ObjectiveCard v-for="r in rows" :key="r.o.id" :objective="r.o" :depth="r.depth" :aligned="r.aligned" @open="openId = $event" @check-in="openCheckIn" />
    </div>

    <ObjectiveDetailModal
      ref="detail"
      :id="openId"
      @close="openId = null"
      @open="openId = $event"
      @changed="okrs.run()"
      @edit="(o) => (form = { open: true, objective: o, parentId: null })"
      @align="(o) => { form = { open: true, objective: null, parentId: o.id }; openId = null; }"
    />
    <ObjectiveFormModal v-if="data" :open="form.open" :can="data.can" :date="date" :objective="form.objective" :parent-id="form.parentId" @close="form = { open: false, objective: null, parentId: null }" @saved="saved" />
    <OkrCheckInModal :open="!!checkIn" :key-result="checkIn" @close="checkIn = null" @saved="() => { checkIn = null; feedback.success('Check-in saved'); okrs.run(); }" />
  </div>
</template>
