<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ACCRUAL_FREQUENCIES, type AccrualFrequency, type LeaveGender } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { LeaveType, LeaveTypeInput } from '@/modules/leave/types';
import { ACCRUAL_LABELS } from '@/modules/leave/utils/leave-format';
import { AppAlert, AppButton, AppInput, AppModal, AppSelect, AppSwitch, AppTextarea } from '@/shared/components';
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
  isActive: true,
});
const form = reactive(blank());
const maxConsecutive = ref<string | number>('');

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
          <p class="mb-1.5 text-sm font-medium text-fg">Colour</p>
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
        <div class="grid gap-4 sm:grid-cols-2">
          <AppSelect v-model="form.accrualFrequency" label="How days are credited" :options="accrualOptions" :clearable="false" :error="fieldErrors.accrualFrequency" />
          <AppInput v-if="form.accrualFrequency !== 'NONE'" v-model="form.annualQuota" label="Days per year" type="number" :min="0" :max="366" :step="0.5" :error="fieldErrors.annualQuota" />
          <AppInput v-model="form.carryForwardLimit" label="Carry forward up to (days)" type="number" :min="0" :max="366" :step="0.5" help="0 = unused days lapse at year end" :error="fieldErrors.carryForwardLimit" />
        </div>
        <div class="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <AppSwitch v-if="form.accrualFrequency !== 'NONE'" v-model="form.prorateOnJoining" label="Prorate for new joiners" description="People joining mid-year get days for the months left." />
          <AppSwitch v-model="form.encashable" label="Can be encashed" description="HR can pay out unused days." />
          <AppSwitch v-model="form.allowNegativeBalance" label="Allow negative balance" description="Employees can take more than they have (adjusted later)." />
        </div>
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
        <AppSelect v-model="form.applicableGender" class="max-w-xs" label="Applies to" placeholder="Everyone" :options="genderOptions" />
      </section>

      <AppSwitch v-if="type" v-model="form.isActive" label="Active" description="Inactive types can't be applied for; existing balances and history stay." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="leave-type-form" :loading="saving" :disabled="!canSave">{{ type ? 'Save changes' : 'Create leave type' }}</AppButton>
    </template>
  </AppModal>
</template>
