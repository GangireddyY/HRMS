<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Archive, CalendarDays, CircleSlash, GitBranch, MessageSquarePlus, Pencil, Plus, RotateCcw, Trash2 } from '@lucide/vue';
import { performanceApi } from '@/modules/performance/api/performance.api';
import KeyResultFormModal from '@/modules/performance/components/KeyResultFormModal.vue';
import OkrCheckInModal from '@/modules/performance/components/OkrCheckInModal.vue';
import type { KeyResult, ObjectiveDetail } from '@/modules/performance/types';
import { OKR_HEALTH_FILL, OKR_HEALTH_LABELS, OKR_LEVEL_LABELS, OKR_STATUS_LABELS, krProgressText, krValue, okrHealthTone, okrLevelTone } from '@/modules/performance/utils/performance-format';
import { AppBadge, AppButton, AppErrorState, AppModal, AppSkeleton } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate, formatDateTime, formatMoney } from '@/shared/utils/format';

/** An objective in full: key results with their check-in history, what it supports and what supports it. */
const props = defineProps<{ id: string | null }>();
const emit = defineEmits<{ close: []; changed: []; open: [id: string]; edit: [o: ObjectiveDetail]; align: [o: ObjectiveDetail] }>();

const feedback = useFeedbackStore();
const o = ref<ObjectiveDetail | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);
async function load() {
  if (!props.id) return;
  loading.value = true;
  error.value = null;
  try {
    o.value = await performanceApi.okr(props.id);
  } catch (e) {
    error.value = e;
  } finally {
    loading.value = false;
  }
}
watch(
  () => props.id,
  (id) => {
    o.value = null;
    if (id) void load();
  },
  { immediate: true },
);
defineExpose({ reload: load });

function updated(next: ObjectiveDetail) {
  o.value = next;
  emit('changed');
}
const editable = computed(() => !!o.value?.canEdit && o.value.status === 'ACTIVE');
const krModal = ref<{ open: boolean; kr: KeyResult | null }>({ open: false, kr: null });
const checkIn = ref<KeyResult | null>(null);
const expanded = ref<string | null>(null);

async function setStatus(status: 'ACTIVE' | 'CLOSED' | 'DROPPED') {
  const d = o.value!;
  if (status !== 'ACTIVE' && !(await feedback.confirm({ title: status === 'CLOSED' ? 'Close this objective?' : 'Drop this objective?', message: status === 'CLOSED' ? 'It stays on record with its final progress; check-ins stop.' : 'Dropped objectives are hidden from the OKR list.', confirmLabel: status === 'CLOSED' ? 'Close' : 'Drop' }))) return;
  try {
    updated(await performanceApi.updateOkr(d.id, { status }));
    feedback.success(status === 'ACTIVE' ? 'Objective reopened' : status === 'CLOSED' ? 'Objective closed' : 'Objective dropped');
  } catch (e) {
    feedback.error('Could not update the objective', e);
  }
}
async function remove() {
  const d = o.value!;
  if (!(await feedback.confirm({ title: `Delete "${d.title}"?`, message: d.children.length ? 'Objectives aligned to it stay, but are no longer aligned.' : 'Its key results and check-ins are deleted too.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await performanceApi.removeOkr(d.id);
    feedback.success('Objective deleted');
    emit('changed');
    emit('close');
  } catch (e) {
    feedback.error('Could not delete the objective', e);
  }
}
async function removeKr(k: KeyResult) {
  if (!(await feedback.confirm({ title: `Remove "${k.title}"?`, message: 'Its check-ins are removed and the objective progress is recalculated.', confirmLabel: 'Remove', danger: true }))) return;
  try {
    updated(await performanceApi.removeKeyResult(k.id));
  } catch (e) {
    feedback.error('Could not remove the key result', e);
  }
}
const who = computed(() => {
  const d = o.value;
  if (!d) return '';
  if (d.level === 'COMPANY') return d.owner?.name ?? 'Whole company';
  if (d.level === 'DEPARTMENT') return [d.department?.name, d.owner ? `owner ${d.owner.name}` : null].filter(Boolean).join(' · ');
  return [d.owner?.name, d.ownerDepartment].filter(Boolean).join(' · ');
});
</script>

<template>
  <AppModal :open="!!id" :title="o?.title ?? 'Objective'" size="lg" @close="emit('close')">
    <AppSkeleton v-if="loading && !o" :lines="6" />
    <AppErrorState v-else-if="error" :error="error" title="Could not load the objective" @retry="load" />
    <div v-else-if="o" class="space-y-5">
      <div class="flex flex-wrap items-center gap-1.5">
        <AppBadge :tone="okrLevelTone[o.level]">{{ OKR_LEVEL_LABELS[o.level] }}</AppBadge>
        <AppBadge v-if="o.status !== 'ACTIVE'" tone="neutral">{{ OKR_STATUS_LABELS[o.status] }}</AppBadge>
        <AppBadge v-if="o.health" :tone="okrHealthTone[o.health]" dot>{{ OKR_HEALTH_LABELS[o.health] }}</AppBadge>
        <span class="ms-1 inline-flex items-center gap-1 text-xs text-fg-muted"><CalendarDays :size="13" aria-hidden="true" />{{ formatDate(o.periodStart) }} – {{ formatDate(o.periodEnd) }}</span>
      </div>
      <div class="flex items-start gap-4">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-fg">{{ who }}</p>
          <p v-if="o.description" class="mt-1 text-sm whitespace-pre-line text-fg-muted">{{ o.description }}</p>
        </div>
        <div class="w-28 shrink-0 text-end">
          <p class="text-3xl font-semibold text-fg tabular-nums">{{ o.progress }}%</p>
          <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <div :class="['h-full rounded-full', o.health ? OKR_HEALTH_FILL[o.health] : 'bg-brand-500']" :style="{ width: `${o.progress}%` }" />
          </div>
        </div>
      </div>

      <button v-if="o.parent" type="button" class="flex w-full items-center gap-2.5 rounded-lg border border-line/80 bg-surface-muted/40 px-3 py-2 text-start transition hover:bg-surface-muted" @click="emit('open', o.parent.id)">
        <GitBranch :size="15" class="shrink-0 text-fg-subtle" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-sm"><span class="text-fg-muted">Supports </span><span class="font-medium text-fg">{{ o.parent.title }}</span></span>
        <span class="text-xs text-fg-muted tabular-nums">{{ o.parent.progress }}%</span>
      </button>

      <section aria-labelledby="krs-title">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h3 id="krs-title" class="text-sm font-semibold text-fg">Key results</h3>
          <AppButton v-if="editable && o.keyResults.length < 8" size="sm" variant="secondary" :icon="Plus" @click="krModal = { open: true, kr: null }">Add key result</AppButton>
        </div>
        <p v-if="!o.keyResults.length" class="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-fg-muted">No key results yet. Add two to five measurable outcomes.</p>
        <ul v-else class="space-y-2">
          <li v-for="k in o.keyResults" :key="k.id" class="rounded-lg border border-line/80">
            <div class="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div class="min-w-0 flex-1 basis-56">
                <p class="text-sm font-medium text-fg">{{ k.title }}</p>
                <p class="text-xs text-fg-muted">
                  {{ krProgressText(k, formatMoney) }}<template v-if="k.metric !== 'MILESTONE'"> · started at {{ krValue(k.startValue, k, formatMoney) }}</template> · weight {{ k.weight }}×
                </p>
              </div>
              <span class="w-10 text-end text-sm font-semibold text-fg tabular-nums">{{ k.progress }}%</span>
              <div class="flex items-center gap-1">
                <AppButton v-if="editable" size="sm" :icon="MessageSquarePlus" @click="checkIn = k">Check in</AppButton>
                <AppButton v-if="editable" size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${k.title}`" @click="krModal = { open: true, kr: k }" />
                <AppButton v-if="editable" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Remove ${k.title}`" @click="removeKr(k)" />
              </div>
            </div>
            <div class="h-1 bg-surface-muted" aria-hidden="true"><div :class="['h-full', k.progress >= 100 ? 'bg-success' : 'bg-brand-500']" :style="{ width: `${k.progress}%` }" /></div>
            <div v-if="k.checkIns?.length" class="px-3 py-2">
              <button type="button" class="text-xs font-medium text-accent-fg hover:underline" :aria-expanded="expanded === k.id" @click="expanded = expanded === k.id ? null : k.id">
                {{ expanded === k.id ? 'Hide' : 'Show' }} {{ k.checkIns.length }} check-in{{ k.checkIns.length === 1 ? '' : 's' }}
              </button>
              <ol v-if="expanded === k.id" class="mt-2 space-y-2 border-s border-line ps-4">
                <li v-for="c in k.checkIns" :key="c.id" class="relative text-sm">
                  <span :class="['absolute top-1.5 -start-[21px] h-2.5 w-2.5 rounded-full ring-2 ring-surface', OKR_HEALTH_FILL[c.health]]" aria-hidden="true" />
                  <p class="flex flex-wrap items-center gap-2">
                    <span class="font-medium text-fg tabular-nums">{{ krValue(c.value, k, formatMoney) }}</span>
                    <AppBadge size="sm" :tone="okrHealthTone[c.health]">{{ OKR_HEALTH_LABELS[c.health] }}</AppBadge>
                    <span class="text-xs text-fg-subtle">{{ formatDateTime(c.createdAt) }}<template v-if="c.by"> · {{ c.by }}</template></span>
                  </p>
                  <p v-if="c.note" class="mt-0.5 text-xs whitespace-pre-line text-fg-muted">{{ c.note }}</p>
                </li>
              </ol>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="o.children.length || o.level !== 'INDIVIDUAL'" aria-labelledby="aligned-title">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h3 id="aligned-title" class="text-sm font-semibold text-fg">Aligned objectives</h3>
          <AppButton v-if="o.status === 'ACTIVE'" size="sm" variant="ghost" :icon="GitBranch" @click="emit('align', o)">Align an objective</AppButton>
        </div>
        <p v-if="!o.children.length" class="text-sm text-fg-muted">Nothing is aligned to this yet.</p>
        <ul v-else class="divide-y divide-line/70 rounded-lg border border-line/80">
          <li v-for="c in o.children" :key="c.id">
            <button type="button" class="flex w-full items-center gap-3 px-3 py-2 text-start transition hover:bg-surface-muted/50" @click="emit('open', c.id)">
              <AppBadge size="sm" :tone="okrLevelTone[c.level]">{{ OKR_LEVEL_LABELS[c.level] }}</AppBadge>
              <span class="min-w-0 flex-1 truncate text-sm text-fg">{{ c.title }}</span>
              <span class="truncate text-xs text-fg-muted">{{ c.owner?.name ?? c.department?.name ?? '' }}</span>
              <span class="w-10 text-end text-xs font-semibold text-fg tabular-nums">{{ c.progress }}%</span>
            </button>
          </li>
        </ul>
      </section>
    </div>
    <template v-if="o?.canEdit" #footer>
      <AppButton variant="ghost" :icon="Trash2" class="me-auto" @click="remove">Delete</AppButton>
      <template v-if="o.status === 'ACTIVE'">
        <AppButton variant="secondary" :icon="CircleSlash" @click="setStatus('DROPPED')">Drop</AppButton>
        <AppButton variant="secondary" :icon="Archive" @click="setStatus('CLOSED')">Close</AppButton>
        <AppButton :icon="Pencil" @click="emit('edit', o)">Edit</AppButton>
      </template>
      <AppButton v-else :icon="RotateCcw" @click="setStatus('ACTIVE')">Reopen</AppButton>
    </template>

    <KeyResultFormModal :open="krModal.open" :objective-id="o?.id ?? ''" :key-result="krModal.kr" @close="krModal = { open: false, kr: null }" @saved="(x) => { updated(x); krModal = { open: false, kr: null }; }" />
    <OkrCheckInModal :open="!!checkIn" :key-result="checkIn" @close="checkIn = null" @saved="(x) => { updated(x); checkIn = null; feedback.success('Check-in saved'); }" />
  </AppModal>
</template>
