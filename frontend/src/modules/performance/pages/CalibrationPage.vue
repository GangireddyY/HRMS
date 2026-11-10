<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { BarChart3, Grid3x3, Hourglass, Scale, SlidersHorizontal, Sparkles, UsersRound } from '@lucide/vue';
import { POTENTIAL_LABELS, SUGGESTED_DISTRIBUTION } from '@contracts';
import { structureApi } from '@/modules/people/api/people.api';
import { performanceApi } from '@/modules/performance/api/performance.api';
import RatingChip from '@/modules/performance/components/RatingChip.vue';
import type { CalibrationPerson } from '@/modules/performance/types';
import { NINE_BOX_TONE } from '@/modules/performance/utils/performance-format';
import { RATING_FILL } from '@/modules/performance/utils/performance-ops';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppDataTable, AppErrorState, AppInput, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppStatStrip, AppTextarea, type TableColumn } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** HR calibration for a cycle: the rating curve against the target, the 9-box (rating × potential) and per-person adjustments. */
const route = useRoute();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const department = ref<string | null>(null);
const view = useAsync(() => performanceApi.calibration(id.value, department.value ?? undefined));
watch([id, department], () => void view.run());
const c = computed(() => view.data.value);
const departments = useAsync(async () => (await structureApi.departments()).map((d) => ({ value: d.id, label: d.name })));

const offCurve = computed(() => (c.value ? Math.round(c.value.distribution.reduce((s, d) => s + Math.abs(d.gap), 0) / 2) : 0));
const stats = computed(() => [
  { key: 'rated', label: 'Rated', value: c.value?.rated ?? 0, icon: UsersRound, tone: 'brand', hint: 'Completed reviews' },
  { key: 'pending', label: 'Still in review', value: c.value?.pending ?? 0, icon: Hourglass, tone: 'info', hint: 'Not counted yet' },
  { key: 'potential', label: 'Without potential', value: c.value?.withoutPotential ?? 0, icon: Sparkles, tone: c.value?.withoutPotential ? 'warning' : 'success', hint: 'Not on the 9-box' },
  { key: 'gap', label: 'Off the curve', value: offCurve.value, icon: Scale, tone: offCurve.value ? 'orange' : 'success', hint: 'People to move to match the target' },
]);
const maxPercent = computed(() => Math.max(10, ...(c.value?.distribution ?? []).flatMap((d) => [d.percent, d.target])));

// 9-box: performance high at the top, potential low → high left to right.
const grid = computed(() =>
  [2, 1, 0].map((performance) =>
    [0, 1, 2].map((potential) => {
      const cell = c.value?.nineBox.find((b) => b.performance === performance && b.potential === potential);
      const people = (c.value?.people ?? []).filter((p) => p.box?.performance === performance && p.box.potential === potential);
      return { performance, potential, label: cell?.label ?? '', people };
    }),
  ),
);
const BAND = ['Low', 'Medium', 'High'];

const columns: TableColumn<CalibrationPerson>[] = [
  { key: 'employee', label: 'Employee', exportValue: (r) => r.employee.name },
  { key: 'reviewer', label: 'Reviewer', value: (r) => r.reviewer?.name ?? '—' },
  { key: 'rating', label: 'Rating', exportValue: (r) => r.rating },
  { key: 'potential', label: 'Potential', exportValue: (r) => (r.potential ? POTENTIAL_LABELS[r.potential as 1 | 2 | 3] : '') },
  { key: 'box', label: '9-box', exportValue: (r) => r.box?.label ?? '' },
  { key: 'actions', label: '', align: 'right', noExport: true },
];
const potentialOptions = ([1, 2, 3] as const).map((v) => ({ value: v, label: POTENTIAL_LABELS[v] }));
const saving = ref<string | null>(null);
async function setPotential(p: CalibrationPerson, value: number | null | undefined) {
  saving.value = p.reviewId;
  try {
    await performanceApi.setPotential(p.reviewId, value ?? null);
    await view.run();
  } catch (e) {
    feedback.error('Could not set the potential', e);
  } finally {
    saving.value = null;
  }
}

const calibrating = ref<CalibrationPerson | null>(null);
const cal = reactive({ rating: 3 as number, note: '' });
function openCalibrate(p: CalibrationPerson) {
  calibrating.value = p;
  Object.assign(cal, { rating: p.rating ?? 3, note: p.calibrationNote ?? '' });
}
const ratingOptions = computed(() => [1, 2, 3, 4, 5].map((r) => ({ value: r, label: `${r} · ${c.value?.cycle.ratingLabels[r - 1] ?? ''}` })));
async function saveCalibration() {
  const p = calibrating.value!;
  saving.value = 'cal';
  try {
    await performanceApi.calibrate(p.reviewId, cal.rating, cal.note);
    calibrating.value = null;
    feedback.success('Rating calibrated', p.employee.name);
    await view.run();
  } catch (e) {
    feedback.error('Could not calibrate', e);
  } finally {
    saving.value = null;
  }
}

const targetOpen = ref(false);
const target = ref<(number | string | null)[]>([]);
function openTarget() {
  target.value = [...(c.value?.targetDistribution ?? SUGGESTED_DISTRIBUTION)];
  targetOpen.value = true;
}
const targetSum = computed(() => target.value.reduce<number>((s, n) => s + (Number(n) || 0), 0));
async function saveTarget() {
  saving.value = 'target';
  try {
    await performanceApi.updateCycle(id.value, { targetDistribution: target.value.map((n) => Number(n) || 0) });
    targetOpen.value = false;
    feedback.success('Target curve saved');
    await view.run();
  } catch (e) {
    feedback.error('Could not save the target', e);
  } finally {
    saving.value = null;
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader :title="c ? `Calibration · ${c.cycle.name}` : 'Calibration'" description="Compare the rating spread with the target curve, place people on the 9-box, and adjust ratings before results are released." :back="`/hr/performance/cycles/${id}`" back-label="Review cycle">
      <template #actions>
        <div class="w-56"><AppSelect v-model="department" aria-label="Department" :options="departments.data.value ?? []" placeholder="All departments" searchable /></div>
        <AppButton v-if="c?.canCalibrate" variant="secondary" :icon="SlidersHorizontal" @click="openTarget">Target curve</AppButton>
      </template>
    </AppPageHeader>

    <AppSkeleton v-if="view.loading.value && !c" :lines="10" />
    <AppErrorState v-else-if="view.error.value" :error="view.error.value" title="Could not load the calibration" @retry="view.run" />
    <template v-else-if="c">
      <AppAlert v-if="!c.canCalibrate" tone="info">{{ c.cycle.resultsReleasedAt ? 'Results are released: ratings can no longer change.' : 'Calibration is available while the cycle is running.' }}</AppAlert>
      <AppStatStrip :items="stats" label="Calibration summary" />

      <div class="grid items-start gap-4 xl:grid-cols-2">
        <AppCard title="Rating distribution" :icon="BarChart3" :description="`Actual vs ${c.targetIsCustom ? 'the cycle’s target' : 'the suggested bell curve'} · ${c.rated} rated`">
          <ul class="space-y-3.5" aria-label="Ratings">
            <li v-for="d in c.distribution" :key="d.rating" class="grid grid-cols-[minmax(0,13rem)_1fr_auto] items-center gap-3 max-sm:grid-cols-[1fr_auto]">
              <div class="min-w-0 max-sm:col-span-2">
                <p class="truncate text-sm font-medium text-fg" :title="d.label">{{ d.rating }} · {{ d.label }}</p>
                <p class="truncate text-2xs text-fg-subtle tabular-nums">{{ d.count }} of {{ c.rated }} · target {{ d.target }}% (≈{{ d.expected }})</p>
              </div>
              <div class="relative h-6 rounded-md bg-surface-muted" role="img" :aria-label="`${d.percent}% actual, ${d.target}% target`">
                <div :class="['absolute inset-y-0 start-0 rounded-md transition-[width] duration-700', RATING_FILL[d.rating]]" :style="{ width: `${(d.percent / maxPercent) * 100}%` }" />
                <div class="absolute inset-y-[-3px] w-0.5 rounded bg-fg" :style="{ insetInlineStart: `calc(${(d.target / maxPercent) * 100}% - 1px)` }" aria-hidden="true" />
                <span class="absolute end-1.5 top-1/2 -translate-y-1/2 rounded bg-surface/85 px-1 text-2xs font-semibold text-fg tabular-nums">{{ d.percent }}%</span>
              </div>
              <AppBadge size="sm" :tone="d.gap === 0 ? 'success' : Math.abs(d.gap) === 1 ? 'warning' : 'danger'" class="w-12 justify-center tabular-nums">{{ d.gap > 0 ? `+${d.gap}` : d.gap }}</AppBadge>
            </li>
          </ul>
          <p class="mt-4 flex items-center gap-2 text-2xs text-fg-subtle"><span class="h-3 w-0.5 rounded bg-fg" aria-hidden="true" />Target share · badges show people above (+) or below (−) the target count</p>
        </AppCard>

        <AppCard title="9-box" :icon="Grid3x3" description="Performance (rating) against potential. Set potential in the table below.">
          <div class="flex gap-2">
            <div class="flex w-5 shrink-0 items-center justify-center"><span class="-rotate-90 text-2xs font-semibold tracking-wide whitespace-nowrap text-fg-muted uppercase">Performance →</span></div>
            <div class="min-w-0 flex-1">
              <div class="grid grid-cols-3 gap-1.5">
                <template v-for="row in grid" :key="row[0]!.performance">
                  <div v-for="cell in row" :key="`${cell.performance}-${cell.potential}`" :class="['flex min-h-24 flex-col rounded-lg p-2', NINE_BOX_TONE[cell.performance]![cell.potential]]">
                    <p class="flex items-baseline justify-between gap-1 text-2xs font-semibold">
                      <span class="truncate">{{ cell.label }}</span><span class="tabular-nums">{{ cell.people.length }}</span>
                    </p>
                    <ul class="mt-1.5 flex flex-wrap gap-1">
                      <li v-for="p in cell.people.slice(0, 6)" :key="p.reviewId" :title="p.employee.name"><AppAvatar :name="p.employee.name" size="xs" /></li>
                      <li v-if="cell.people.length > 6" class="text-2xs font-medium">+{{ cell.people.length - 6 }}</li>
                    </ul>
                  </div>
                </template>
              </div>
              <div class="mt-1.5 grid grid-cols-3 text-center text-2xs text-fg-muted"><span v-for="b in BAND" :key="b">{{ b }}</span></div>
              <p class="mt-0.5 text-center text-2xs font-semibold tracking-wide text-fg-muted uppercase">Potential →</p>
            </div>
          </div>
        </AppCard>
      </div>

      <AppDataTable :columns="columns" :rows="c.people" :row-key="(r) => r.reviewId" caption="People" empty-title="No completed reviews yet" empty-description="Reviews appear here once the manager review is submitted." :export-file="`calibration-${c.cycle.name}`">
        <template #cell-employee="{ row }">
          <div class="flex items-center gap-3">
            <AppAvatar :name="row.employee.name" size="sm" />
            <div class="min-w-0">
              <p class="truncate font-medium text-fg">{{ row.employee.name }}</p>
              <p class="truncate text-xs text-fg-muted">{{ row.employee.department ?? row.employee.employeeCode }}</p>
            </div>
          </div>
        </template>
        <template #cell-rating="{ row }">
          <div class="flex items-center gap-1.5">
            <RatingChip :rating="row.rating" :labels="c.cycle.ratingLabels" />
            <span v-if="row.calibratedRating !== null && row.calibratedRating !== row.finalRating" class="text-2xs text-fg-subtle">was {{ row.finalRating }}</span>
          </div>
        </template>
        <template #cell-potential="{ row }">
          <div class="w-36">
            <AppSelect :model-value="row.potential" size="sm" :aria-label="`Potential of ${row.employee.name}`" :options="potentialOptions" placeholder="Set…" :disabled="!c.canCalibrate || saving === row.reviewId" @update:model-value="(v) => setPotential(row, v as number | null)" />
          </div>
        </template>
        <template #cell-box="{ row }">
          <AppBadge v-if="row.box" size="sm" tone="neutral">{{ row.box.label }}</AppBadge>
          <span v-else class="text-xs text-fg-subtle">—</span>
        </template>
        <template #cell-actions="{ row }">
          <AppButton v-if="c.canCalibrate" size="sm" variant="ghost" :icon="Scale" @click="openCalibrate(row)">Calibrate</AppButton>
        </template>
      </AppDataTable>
    </template>

    <AppModal :open="!!calibrating" :title="calibrating ? `Calibrate ${calibrating.employee.name}` : ''" :description="calibrating ? `Reviewer's rating: ${calibrating.finalRating ?? '—'}` : undefined" size="sm" @close="calibrating = null">
      <div class="space-y-4">
        <AppSelect v-model="cal.rating" label="Calibrated rating" :options="ratingOptions" :clearable="false" />
        <AppTextarea v-model="cal.note" label="Why" required :rows="3" :maxlength="1000" placeholder="e.g. Aligned with the engineering calibration panel" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="calibrating = null">Cancel</AppButton>
        <AppButton :loading="saving === 'cal'" :disabled="cal.note.trim().length < 3" @click="saveCalibration">Save</AppButton>
      </template>
    </AppModal>

    <AppModal :open="targetOpen" title="Target curve" description="The share of people you expect at each rating. It guides calibration; nothing is forced." size="sm" @close="targetOpen = false">
      <div class="space-y-3">
        <div v-for="(_, i) in target" :key="i" class="grid grid-cols-[1fr_6rem] items-center gap-3">
          <span class="truncate text-sm text-fg">{{ i + 1 }} · {{ c?.cycle.ratingLabels[i] }}</span>
          <AppInput v-model="target[i]" type="number" :min="0" :max="100" suffix="%" :aria-label="`Target for rating ${i + 1}`" />
        </div>
        <p :class="['text-sm font-medium tabular-nums', targetSum === 100 ? 'text-success-fg' : 'text-danger-fg']">Total {{ targetSum }}%{{ targetSum === 100 ? '' : ' · must be 100%' }}</p>
        <AppButton size="sm" variant="link" @click="target = [...SUGGESTED_DISTRIBUTION]">Use the suggested bell curve</AppButton>
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="targetOpen = false">Cancel</AppButton>
        <AppButton :loading="saving === 'target'" :disabled="targetSum !== 100" @click="saveTarget">Save</AppButton>
      </template>
    </AppModal>
  </div>
</template>
