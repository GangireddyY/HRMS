<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Plus, Trash2, X } from '@lucide/vue';
import { DEFAULT_RATING_LABELS, SUGGESTED_COMPETENCIES } from '@contracts';
import { structureApi } from '@/modules/people/api/people.api';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { CycleDetail } from '@/modules/performance/types';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Create or edit a review cycle. Once launched, only the name, description and due dates can change. */
const props = defineProps<{ open: boolean; cycle: CycleDetail | null }>();
const emit = defineEmits<{ close: []; saved: [c: CycleDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const departments = useAsync(() => structureApi.departments(), { immediate: false });
const saving = ref(false);
const locked = computed(() => !!props.cycle && props.cycle.status !== 'DRAFT');
const form = reactive({
  name: '',
  description: '',
  periodStart: undefined as string | undefined,
  periodEnd: undefined as string | undefined,
  goalsDue: undefined as string | undefined,
  selfReviewDue: undefined as string | undefined,
  managerReviewDue: undefined as string | undefined,
  goalsWeight: 70 as number | string,
  competencies: [] as { key: string; name: string; description: string }[],
  ratingLabels: [...DEFAULT_RATING_LABELS],
  eligibilityCutoff: undefined as string | undefined,
  departmentIds: [] as string[],
});
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    if (!departments.data.value) void departments.run();
    const c = props.cycle;
    const year = new Date().getFullYear();
    Object.assign(form, {
      name: c?.name ?? '',
      description: c?.description ?? '',
      periodStart: c?.periodStart ?? `${year}-04-01`,
      periodEnd: c?.periodEnd ?? `${year + 1}-03-31`,
      goalsDue: c?.goalsDue ?? undefined,
      selfReviewDue: c?.selfReviewDue ?? undefined,
      managerReviewDue: c?.managerReviewDue ?? undefined,
      goalsWeight: c?.goalsWeight ?? 70,
      competencies: (c?.competencies ?? SUGGESTED_COMPETENCIES).map((k) => ({ key: k.key, name: k.name, description: k.description ?? '' })),
      ratingLabels: [...(c?.ratingLabels ?? DEFAULT_RATING_LABELS)],
      eligibilityCutoff: c?.eligibilityCutoff ?? undefined,
      departmentIds: [...(c?.departmentIds ?? [])],
    });
  },
  { immediate: true },
);

const pickDepartment = ref<string | null>(null);
watch(pickDepartment, (id) => {
  if (id && !form.departmentIds.includes(id)) form.departmentIds.push(id);
  pickDepartment.value = null;
});
const departmentOptions = computed(() => (departments.data.value ?? []).filter((d) => d.isActive !== false && !form.departmentIds.includes(d.id)).map((d) => ({ value: d.id, label: d.name })));
const departmentName = (id: string) => departments.data.value?.find((d) => d.id === id)?.name ?? '…';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'competency';
function addCompetency() {
  form.competencies.push({ key: '', name: '', description: '' });
}
const weight = computed(() => Number(form.goalsWeight));
const canSave = computed(() => form.name.trim().length >= 2 && !!form.periodStart && !!form.periodEnd && form.competencies.every((c) => c.name.trim().length >= 2));

async function save() {
  reset();
  saving.value = true;
  const used = new Set<string>();
  const competencies = form.competencies.map((c) => {
    let key = c.key || slug(c.name);
    while (used.has(key)) key = `${key.slice(0, 37)}-${used.size}`;
    used.add(key);
    return { key, name: c.name.trim(), description: c.description || null };
  });
  const dates = { goalsDue: form.goalsDue ?? null, selfReviewDue: form.selfReviewDue ?? null, managerReviewDue: form.managerReviewDue ?? null };
  const body = locked.value
    ? { name: form.name, description: form.description || null, ...dates }
    : {
        name: form.name,
        description: form.description || null,
        periodStart: form.periodStart!,
        periodEnd: form.periodEnd!,
        ...dates,
        goalsWeight: weight.value,
        competencies,
        ratingLabels: form.ratingLabels.map((l) => l.trim()),
        eligibilityCutoff: form.eligibilityCutoff ?? null,
        departmentIds: form.departmentIds.length ? form.departmentIds : null,
      };
  try {
    emit('saved', props.cycle ? await performanceApi.updateCycle(props.cycle.id, body) : await performanceApi.createCycle(body as Parameters<typeof performanceApi.createCycle>[0]));
  } catch (e) {
    handle(e, 'Could not save the cycle');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="cycle ? `Edit ${cycle.name}` : 'New review cycle'" description="Launching creates a review for every eligible employee, with their manager as reviewer." size="xl" @close="emit('close')">
    <form id="cycle-form" class="space-y-5" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppAlert v-if="locked" tone="info">The cycle is running: only the name, description and due dates can change.</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.name" label="Name" required placeholder="e.g. Annual review 2026-27" :error="fieldErrors.name" />
        <AppTextarea v-model="form.description" label="Description" :rows="1" :maxlength="1000" />
      </div>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <AppDatePicker v-model="form.periodStart" label="Period from" required :disabled="locked" :error="fieldErrors.periodStart" />
        <AppDatePicker v-model="form.periodEnd" label="Period to" required :disabled="locked" :min="form.periodStart" :error="fieldErrors.periodEnd" />
        <AppDatePicker v-model="form.goalsDue" label="Goals due" :min="form.periodStart" :error="fieldErrors.goalsDue" />
        <AppDatePicker v-model="form.selfReviewDue" label="Self-review due" :min="form.periodStart" :error="fieldErrors.selfReviewDue" />
        <AppDatePicker v-model="form.managerReviewDue" label="Manager review due" :min="form.selfReviewDue ?? form.periodStart" :error="fieldErrors.managerReviewDue" />
      </div>

      <fieldset :disabled="locked" class="space-y-5">
        <div>
          <AppInput v-model="form.goalsWeight" class="max-w-xs" label="Goals share of the score (%)" type="number" :min="0" :max="100" :error="fieldErrors.goalsWeight" :help="`Goals ${weight}% · competencies ${100 - weight}%`" />
        </div>
        <div v-if="weight < 100">
          <p class="label">Competencies</p>
          <ul class="space-y-2">
            <li v-for="(c, i) in form.competencies" :key="i" class="grid items-start gap-2 sm:grid-cols-[220px_1fr_auto]">
              <AppInput v-model="c.name" :aria-label="`Competency ${i + 1}`" placeholder="Name" :maxlength="80" />
              <AppInput v-model="c.description" :aria-label="`Competency ${i + 1} description`" placeholder="What good looks like" :maxlength="300" />
              <AppButton variant="ghost" :icon="Trash2" :aria-label="`Remove competency ${i + 1}`" @click="form.competencies.splice(i, 1)" />
            </li>
          </ul>
          <AppButton class="mt-2" size="sm" variant="secondary" :icon="Plus" :disabled="form.competencies.length >= 12" @click="addCompetency">Add competency</AppButton>
          <p v-if="fieldErrors.competencies" class="error-text" role="alert">{{ fieldErrors.competencies }}</p>
        </div>
        <details class="rounded-xl p-3 ring-1 ring-line">
          <summary class="cursor-pointer text-sm font-medium text-fg">Rating scale labels</summary>
          <div class="mt-3 grid gap-2 sm:grid-cols-5">
            <AppInput v-for="n in 5" :key="n" v-model="form.ratingLabels[n - 1]" :label="String(n)" :maxlength="60" />
          </div>
        </details>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppDatePicker v-model="form.eligibilityCutoff" label="Joined on or before" help="Leave empty to include everyone active at launch." />
          <div>
            <AppSelect v-model="pickDepartment" label="Departments" placeholder="All departments" :options="departmentOptions" />
            <ul v-if="form.departmentIds.length" class="mt-2 flex flex-wrap gap-2">
              <li v-for="id in form.departmentIds" :key="id" class="inline-flex items-center gap-2 rounded-full bg-surface-muted py-1 pe-2 ps-3 text-sm text-fg">
                {{ departmentName(id) }}
                <button type="button" class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" :aria-label="`Remove ${departmentName(id)}`" @click="form.departmentIds = form.departmentIds.filter((x) => x !== id)"><X :size="13" /></button>
              </li>
            </ul>
          </div>
        </div>
      </fieldset>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="cycle-form" :loading="saving" :disabled="!canSave">Save</AppButton>
    </template>
  </AppModal>
</template>
