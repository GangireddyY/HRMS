<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { LIFE_EVENTS, type DependentRelation, type LifeEvent } from '@contracts';
import { benefitsApi } from '@/modules/benefits/api/benefits.api';
import type { Enrollment, FamilyDependent, MyPlan } from '@/modules/benefits/types';
import { LIFE_EVENT_LABELS, RELATION_LABELS, inr } from '@/modules/benefits/utils/benefits-format';
import { AppAlert, AppButton, AppCheckbox, AppDatePicker, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { formatDate } from '@/shared/utils/format';

/** Choose a coverage option and the family members it covers; outside a window, give the life event. */
const props = defineProps<{ open: boolean; plan: MyPlan | null; family: FamilyDependent[] }>();
const emit = defineEmits<{ close: []; saved: [e: Enrollment] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const optionId = ref<string | null>(null);
const dependentIds = ref<string[]>([]);
const lifeEvent = ref<LifeEvent | null>(null);
const lifeEventDate = ref<string | undefined>(undefined);
const note = ref('');
const saving = ref(false);
const pad = (n: number) => String(n).padStart(2, '0');
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();
watch(
  () => props.open,
  (open) => {
    if (!open || !props.plan) return;
    reset();
    const current = props.plan.pending ?? props.plan.current;
    optionId.value = current?.option?.id ?? props.plan.options.find((o) => o.isDefault)?.id ?? props.plan.options[0]?.id ?? null;
    dependentIds.value = (current?.dependents ?? []).map((d) => d.familyMemberId).filter((x): x is string => !!x);
    lifeEvent.value = null;
    lifeEventDate.value = undefined;
    note.value = '';
  },
  { immediate: true },
);
const option = computed(() => props.plan?.options.find((o) => o.id === optionId.value) ?? null);
const coverable = computed(() => props.family.filter((f) => f.coverable && option.value?.allowedRelations.includes(f.relationship as DependentRelation)));
watch(option, () => {
  dependentIds.value = dependentIds.value.filter((id) => coverable.value.some((f) => f.id === id));
});
function toggle(id: string, on: boolean) {
  dependentIds.value = on ? [...dependentIds.value, id] : dependentIds.value.filter((x) => x !== id);
}
const needsEvent = computed(() => !props.plan?.window);
const eventOptions = LIFE_EVENTS.map((e) => ({ value: e, label: LIFE_EVENT_LABELS[e] }));
const approval = computed(() => !!props.plan && (props.plan.requiresApproval || needsEvent.value));
const canSave = computed(() => !!option.value && dependentIds.value.length <= (option.value?.maxDependents ?? 0) && (!needsEvent.value || (!!lifeEvent.value && !!lifeEventDate.value)));

async function save() {
  if (!props.plan || !optionId.value) return;
  reset();
  saving.value = true;
  try {
    emit(
      'saved',
      await benefitsApi.enroll(props.plan.id, {
        optionId: optionId.value,
        dependentIds: dependentIds.value,
        lifeEvent: needsEvent.value ? lifeEvent.value : null,
        lifeEventDate: needsEvent.value ? (lifeEventDate.value ?? null) : null,
        note: note.value || null,
      }),
    );
  } catch (e) {
    handle(e, 'Could not save your choice');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="plan ? (plan.current ? `Change ${plan.name}` : `Enrol in ${plan.name}`) : ''" :description="plan?.provider ?? undefined" size="lg" @close="emit('close')">
    <form v-if="plan" id="enroll-form" class="space-y-5" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppAlert v-if="needsEvent" tone="info" title="Enrolment is closed">You can change your cover within 30 days of a life event such as marriage or the birth of a child. HR reviews the request.</AppAlert>
      <AppAlert v-else tone="info">{{ plan.window!.kind === 'NEW_JOINER' ? 'New joiner enrolment' : 'Open enrolment' }} closes on {{ formatDate(plan.window!.closesOn) }}.</AppAlert>

      <fieldset>
        <legend class="label">Coverage</legend>
        <div class="grid gap-3 sm:grid-cols-2">
          <label
            v-for="o in plan.options"
            :key="o.id"
            class="flex cursor-pointer gap-3 rounded-xl p-4 ring-1 transition"
            :class="optionId === o.id ? 'bg-brand-50/60 ring-2 ring-brand-500 dark:bg-brand-500/10' : 'ring-line hover:ring-line-strong'"
          >
            <input v-model="optionId" type="radio" name="option" :value="o.id" class="mt-1 accent-brand-600" />
            <span class="min-w-0">
              <span class="block font-medium text-fg">{{ o.name }}</span>
              <span class="block text-xs text-fg-muted">
                <template v-if="o.coverageAmount">Cover {{ inr(o.coverageAmount) }} · </template>
                {{ o.employeeMonthly ? `you pay ${inr(o.employeeMonthly)}/month` : 'no cost to you' }}
                <template v-if="o.maxDependents"> · up to {{ o.maxDependents }} dependant{{ o.maxDependents === 1 ? '' : 's' }} ({{ o.allowedRelations.map((r) => RELATION_LABELS[r].toLowerCase()).join(', ') }})</template>
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset v-if="option && option.maxDependents > 0">
        <legend class="label">Who to cover <span class="font-normal text-fg-muted">(up to {{ option.maxDependents }})</span></legend>
        <p v-if="!coverable.length" class="text-sm text-fg-muted">
          No family members who can be covered yet.
          <RouterLink to="/me/employment" class="font-medium text-brand-600 hover:underline dark:text-brand-400">Add them under My employment → Family &amp; background</RouterLink>.
        </p>
        <div v-else class="space-y-2">
          <AppCheckbox
            v-for="f in coverable"
            :key="f.id"
            :model-value="dependentIds.includes(f.id)"
            :label="f.name"
            :description="`${RELATION_LABELS[f.relationship as DependentRelation]}${f.dateOfBirth ? ` · born ${formatDate(f.dateOfBirth)}` : ''}`"
            :disabled="!dependentIds.includes(f.id) && dependentIds.length >= option.maxDependents"
            @update:model-value="(on: boolean) => toggle(f.id, on)"
          />
        </div>
        <p v-if="fieldErrors.dependentIds" class="error-text" role="alert">{{ fieldErrors.dependentIds }}</p>
      </fieldset>

      <div v-if="needsEvent" class="grid gap-4 sm:grid-cols-2">
        <AppSelect v-model="lifeEvent" label="Life event" :options="eventOptions" required :error="fieldErrors.lifeEvent" />
        <AppDatePicker v-model="lifeEventDate" label="Date of the event" required :max="today" :error="fieldErrors.lifeEventDate" />
      </div>
      <AppTextarea v-model="note" label="Note for HR" :rows="2" :maxlength="1000" />
      <p class="text-xs text-fg-muted">
        {{ approval ? 'HR reviews your request; your current cover stays until it is approved.' : 'Your choice takes effect straight away.' }}
        Contributions are deducted from your salary every month you're covered.
      </p>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="enroll-form" :loading="saving" :disabled="!canSave">{{ approval ? 'Send request' : 'Confirm' }}</AppButton>
    </template>
  </AppModal>
</template>
