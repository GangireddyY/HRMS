<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ACCRUAL_FREQUENCIES, EMPLOYMENT_TYPES, type AccrualFrequency, type LeaveGender } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { LeaveType, LeaveTypeInput } from '@/modules/leave/types';
import { ACCRUAL_LABELS } from '@/modules/leave/utils/leave-format';
import { structureApi } from '@/modules/people/api/people.api';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { AppAlert, AppButton, AppInput, AppModal, AppMultiPick, AppSelect, AppSwitch, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Create or edit a leave type and its policy. */
const props = defineProps<{ open: boolean; type: LeaveType | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const COLORS = ['#0ea5e9', '#10b981', '#f43f5e', '#f59e0b', '#8b5cf6', '#d946ef', '#14b8a6', '#64748b'];
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const blank = (): LeaveTypeInput => ({
  code: '',
  name: '',
  description: null,
  color: COLORS[0]!,
  isPaid: true,
  unlimited: false,
  annualQuota: 12,
  accrualFrequency: 'YEARLY',
  prorateOnJoining: true,
  carryForwardLimit: 0,
  encashable: false,
  allowHalfDay: true,
  allowNegativeBalance: false,
  countNonWorkingDays: false,
  minNoticeDays: 0,
  maxBackdatedDays: 0,
  maxConsecutiveDays: null,
  eligibleAfterDays: 0,
  applicableGender: null,
  compOffValidityDays: null,
  approvalLevels: 1,
  secondApprovalMinDays: null,
  locationIds: null,
  employmentTypes: null,
  gradeIds: null,
  maxBalance: null,
  encashMaxDays: null,
  encashMinBalance: 0,
  isActive: true,
});
const locations = useAsync(() => structureApi.locations());
const grades = useAsync(() => structureApi.grades());
const locationOptions = computed(() => (locations.data.value ?? []).map((l) => ({ value: l.id, label: l.name })));
const gradeOptions = computed(() => (grades.data.value ?? []).map((g) => ({ value: g.id, label: g.name })));
const employmentOptions = EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_TYPE_LABELS[t] }));
/** AppMultiPick works on string arrays; the API takes null for "everyone". */
const picks = (key: 'locationIds' | 'employmentTypes' | 'gradeIds') =>
  computed<string[]>({ get: () => form[key] ?? [], set: (v) => ((form[key] as string[] | null) = v.length ? v : null) });
const pickedLocations = picks('locationIds');
const pickedEmployment = picks('employmentTypes');
const pickedGrades = picks('gradeIds');
const optional = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
type Approval = 'one' | 'two' | 'long';
const approval = computed<Approval>({
  get: () => (form.approvalLevels === 2 ? (form.secondApprovalMinDays ? 'long' : 'two') : 'one'),
  set: (v) => Object.assign(form, { approvalLevels: v === 'one' ? 1 : 2, secondApprovalMinDays: v === 'long' ? (form.secondApprovalMinDays ?? 3) : null }),
});
const approvalOptions: { value: Approval; label: string; description: string }[] = [
  { value: 'one', label: 'Manager', description: 'Anyone who approves leave for the person' },
  { value: 'two', label: 'Manager, then HR', description: 'Every request needs a second approval' },
  { value: 'long', label: 'Manager, then HR for longer leave', description: 'HR approves requests above a number of days' },
];
const form = reactive(blank());
const maxConsecutive = ref<string | number>('');
/** A comp-off type is credited by approved comp-off requests only, and keeps its balance across years (each credit expires). */
const compOff = computed({
  get: () => form.compOffValidityDays !== null,
  set: (on: boolean) => {
    if (on) Object.assign(form, { compOffValidityDays: 90, unlimited: false, accrualFrequency: 'NONE' as AccrualFrequency, carryForwardLimit: 366, encashable: false });
    else form.compOffValidityDays = null;
  },
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, props.type ? { ...props.type } : blank());
    maxConsecutive.value = props.type?.maxConsecutiveDays ?? '';
  },
  { immediate: true },
);
watch(
  () => form.unlimited,
  (u) => {
    if (u) Object.assign(form, { accrualFrequency: 'NONE' as AccrualFrequency, carryForwardLimit: 0, encashable: false, allowNegativeBalance: false });
  },
);

const accrualOptions = ACCRUAL_FREQUENCIES.map((f) => ({ value: f, label: ACCRUAL_LABELS[f] }));
const genderOptions: { value: LeaveGender; label: string }[] = [
  { value: 'FEMALE', label: 'Women only' },
  { value: 'MALE', label: 'Men only' },
];
const canSave = computed(() => form.code.trim().length >= 1 && form.name.trim().length >= 2);

async function save() {
  reset();
  saving.value = true;
  const body = {
    ...form,
    annualQuota: Number(form.annualQuota) || 0,
    carryForwardLimit: Number(form.carryForwardLimit) || 0,
    minNoticeDays: Number(form.minNoticeDays) || 0,
    maxBackdatedDays: Number(form.maxBackdatedDays) || 0,
    eligibleAfterDays: Number(form.eligibleAfterDays) || 0,
    maxConsecutiveDays: maxConsecutive.value === '' ? null : Number(maxConsecutive.value),
    compOffValidityDays: form.compOffValidityDays === null ? null : Number(form.compOffValidityDays) || 90,
    secondApprovalMinDays: approval.value === 'long' ? Number(form.secondApprovalMinDays) || 3 : null,
    maxBalance: optional(form.maxBalance),
    encashMaxDays: form.encashable ? optional(form.encashMaxDays) : null,
    encashMinBalance: form.encashable ? Number(form.encashMinBalance) || 0 : 0,
  };
  try {
    if (props.type) await leaveApi.updateType(props.type.id, body);
    else await leaveApi.createType(body);
    emit('saved');
  } catch (e) {
    handle(e, 'Could not save the leave type');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="type ? `Edit ${type.name}` : 'New leave type'" size="xl" @close="emit('close')">
    <form id="leave-type-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>

      <section class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-[1fr_140px]">
          <AppInput v-model="form.name" label="Name" required autofocus placeholder="e.g. Casual leave" :error="fieldErrors.name" />
          <AppInput v-model="form.code" label="Code" required placeholder="e.g. CL" :maxlength="10" :error="fieldErrors.code" />
        </div>
        <div>
          <p class="mb-2 text-sm font-medium text-fg">Colour</p>
          <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            <button
              v-for="c in COLORS"
              :key="c"
              type="button"
              role="radio"
              :aria-checked="form.color === c"
              :aria-label="c"
              class="h-7 w-7 rounded-full ring-offset-2 ring-offset-surface transition"
              :class="form.color === c ? 'ring-2 ring-fg' : 'hover:scale-110'"
              :style="{ backgroundColor: c }"
              @click="form.color = c"
            />
          </div>
        </div>
        <AppTextarea v-model="form.description" label="Description" :rows="2" :maxlength="500" placeholder="Shown to employees when they apply" />
        <div class="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <AppSwitch v-model="form.isPaid" label="Paid leave" description="Unpaid leave is deducted in payroll (loss of pay)." />
          <AppSwitch v-model="form.unlimited" label="No balance limit" description="For leave without pay; no balance is kept." />
        </div>
      </section>

      <section v-if="!form.unlimited" class="space-y-4 border-t border-line/70 pt-4">
        <h3 class="text-sm font-semibold text-fg">Balance</h3>
        <div class="rounded-xl border border-line bg-surface-muted/40 p-3">
          <AppSwitch
            v-model="compOff"
            label="Compensatory off"
            description="Earned by working on a holiday or weekly off: approved comp-off requests credit this type, and each credit expires."
          />
          <AppInput
            v-if="compOff"
            v-model="form.compOffValidityDays"
            class="mt-3 max-w-xs"
            label="Use within (days of the day worked)"
            type="number"
            :min="7"
            :max="365"
            :error="fieldErrors.compOffValidityDays"
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppSelect v-model="form.accrualFrequency" label="How days are credited" :options="accrualOptions" :clearable="false" :disabled="compOff" :error="fieldErrors.accrualFrequency" />
          <AppInput v-if="form.accrualFrequency !== 'NONE'" v-model="form.annualQuota" label="Days per year" type="number" :min="0" :max="366" :step="0.5" :error="fieldErrors.annualQuota" />
          <AppInput v-model="form.carryForwardLimit" label="Carry forward up to (days)" type="number" :min="0" :max="366" :step="0.5" help="0 = unused days lapse at year end" :error="fieldErrors.carryForwardLimit" />
          <AppInput
            v-if="form.accrualFrequency !== 'NONE'"
            v-model="form.maxBalance"
            label="Stop accruing at (days)"
            type="number"
            :min="1"
            :max="999"
            :step="0.5"
            placeholder="No cap"
            help="Accrual pauses while the balance is at the cap"
            :error="fieldErrors.maxBalance"
          />
        </div>
        <div class="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <AppSwitch v-if="form.accrualFrequency !== 'NONE'" v-model="form.prorateOnJoining" label="Prorate for new joiners" description="People joining mid-year get days for the months left." />
          <AppSwitch v-model="form.encashable" label="Can be encashed" description="Employees can ask to be paid for unused days; payroll pays them." />
          <AppSwitch v-model="form.allowNegativeBalance" label="Allow negative balance" description="Employees can take more than they have (adjusted later)." />
        </div>
        <div v-if="form.encashable" class="grid gap-4 rounded-xl border border-line bg-surface-muted/40 p-3 sm:grid-cols-2">
          <AppInput v-model="form.encashMaxDays" label="Encash up to (days a year)" type="number" :min="0.5" :max="366" :step="0.5" placeholder="No limit" :error="fieldErrors.encashMaxDays" />
          <AppInput v-model="form.encashMinBalance" label="Balance that must stay (days)" type="number" :min="0" :max="366" :step="0.5" :error="fieldErrors.encashMinBalance" />
        </div>
      </section>

      <section class="space-y-4 border-t border-line/70 pt-4">
        <div>
          <h3 class="text-sm font-semibold text-fg">Who it applies to</h3>
          <p class="text-xs text-fg-muted">Leave empty for everyone. People outside these don't see the type or get its balance.</p>
        </div>
        <div class="grid gap-4 md:grid-cols-3">
          <AppMultiPick v-model="pickedLocations" label="Locations" :options="locationOptions" placeholder="Every location" :error="fieldErrors.locationIds" />
          <AppMultiPick v-model="pickedEmployment" label="Employment types" :options="employmentOptions" placeholder="All types" :error="fieldErrors.employmentTypes" />
          <AppMultiPick v-model="pickedGrades" label="Grades" :options="gradeOptions" placeholder="All grades" :error="fieldErrors.gradeIds" />
        </div>
        <AppSelect v-model="form.applicableGender" class="max-w-xs" label="Gender" placeholder="Everyone" :options="genderOptions" />
      </section>

      <section class="space-y-4 border-t border-line/70 pt-4">
        <h3 class="text-sm font-semibold text-fg">Rules for applying</h3>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AppInput v-model="form.minNoticeDays" label="Notice (days ahead)" type="number" :min="0" :max="365" :error="fieldErrors.minNoticeDays" />
          <AppInput v-model="form.maxBackdatedDays" label="Back-dated up to (days)" type="number" :min="0" :max="365" help="0 = no past dates" :error="fieldErrors.maxBackdatedDays" />
          <AppInput v-model="maxConsecutive" label="Max days at a time" type="number" :min="1" :max="366" placeholder="No limit" :error="fieldErrors.maxConsecutiveDays" />
          <AppInput v-model="form.eligibleAfterDays" label="Usable after joining (days)" type="number" :min="0" :max="3650" :error="fieldErrors.eligibleAfterDays" />
        </div>
        <div class="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <AppSwitch v-model="form.allowHalfDay" label="Allow half days" />
          <AppSwitch v-model="form.countNonWorkingDays" label="Count weekends and holidays" description="Sandwich rule: days off inside the request count as leave." />
        </div>
      </section>

      <section class="space-y-4 border-t border-line/70 pt-4">
        <h3 class="text-sm font-semibold text-fg">Approval</h3>
        <div class="grid gap-4 sm:grid-cols-[1fr_200px]">
          <AppSelect v-model="approval" label="Who approves" :options="approvalOptions" :clearable="false" :searchable="false" :error="fieldErrors.approvalLevels" />
          <AppInput
            v-if="approval === 'long'"
            v-model="form.secondApprovalMinDays"
            label="HR approves above (days)"
            type="number"
            :min="0.5"
            :max="366"
            :step="0.5"
            :error="fieldErrors.secondApprovalMinDays"
          />
        </div>
        <p v-if="approval !== 'one'" class="text-xs text-fg-muted">HR is anyone who approves leave department- or organization-wide, and can't be the person who gave the first approval.</p>
      </section>

      <AppSwitch v-if="type" v-model="form.isActive" label="Active" description="Inactive types can't be applied for; existing balances and history stay." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="leave-type-form" :loading="saving" :disabled="!canSave">{{ type ? 'Save changes' : 'Create leave type' }}</AppButton>
    </template>
  </AppModal>
</template>
