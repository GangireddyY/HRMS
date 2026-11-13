<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Plus, Trash2 } from '@lucide/vue';
import { taxRuleSetProblem, type TaxRegimeRules, type TaxRuleSet } from '@contracts';
import { platformApi } from '@/modules/platform/api/platform.api';
import type { StatutoryOverview, TaxYear } from '@/modules/platform/types';
import { toPercent, toRate } from '@/modules/platform/utils/statutory';
import { AppAlert, AppButton, AppInput, AppModal, AppSegmented, AppSwitch } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/**
 * A financial year's income-tax rules, prefilled with what that year uses now (its own, built-in or borrowed). Rates are
 * typed as percentages; the last slab of each table has no upper limit.
 */
const props = defineProps<{ open: boolean; year: TaxYear | null }>();
const emit = defineEmits<{ close: []; saved: [o: StatutoryOverview] }>();
const { formError, handle, reset } = useFormErrors();

interface SlabRow {
  upTo: number | string | null;
  rate: number | string;
}
interface RegimeForm {
  standardDeduction: number | string;
  slabs: SlabRow[];
  bySeniority: boolean;
  slabsSenior: SlabRow[];
  slabsSuperSenior: SlabRow[];
  rebateIncomeLimit: number | string;
  rebateMax: number | string;
  rebateMarginalRelief: boolean;
  surcharge: { above: number | string; rate: number | string }[];
}
const blankRegime = (): RegimeForm => ({ standardDeduction: 0, slabs: [], bySeniority: false, slabsSenior: [], slabsSuperSenior: [], rebateIncomeLimit: 0, rebateMax: 0, rebateMarginalRelief: false, surcharge: [] });
const form = reactive({ NEW: blankRegime(), OLD: blankRegime(), cess: 4 as number | string, source: '' });
const regime = ref<'NEW' | 'OLD'>('NEW');
const saving = ref(false);

const rowsOf = (slabs: TaxRegimeRules['slabs'] | undefined): SlabRow[] => (slabs ?? []).map((s) => ({ upTo: s.upTo, rate: toPercent(s.rate) }));
const fromRules = (r: TaxRegimeRules): RegimeForm => ({
  standardDeduction: r.standardDeduction,
  slabs: rowsOf(r.slabs),
  bySeniority: !!(r.slabsSenior?.length || r.slabsSuperSenior?.length),
  slabsSenior: rowsOf(r.slabsSenior),
  slabsSuperSenior: rowsOf(r.slabsSuperSenior),
  rebateIncomeLimit: r.rebateIncomeLimit,
  rebateMax: r.rebateMax,
  rebateMarginalRelief: r.rebateMarginalRelief,
  surcharge: r.surcharge.map((s) => ({ above: s.above, rate: toPercent(s.rate) })),
});
watch(
  () => props.open,
  (open) => {
    if (!open || !props.year) return;
    reset();
    regime.value = 'NEW';
    Object.assign(form, { NEW: fromRules(props.year.rules.NEW), OLD: fromRules(props.year.rules.OLD), cess: toPercent(props.year.rules.cess), source: props.year.note ?? '' });
  },
  { immediate: true },
);

const slabs = (rows: SlabRow[]) => rows.map((s, i) => ({ upTo: i === rows.length - 1 || s.upTo === '' || s.upTo === null ? null : Number(s.upTo), rate: toRate(s.rate) }));
const toRules = (f: RegimeForm): TaxRegimeRules => ({
  standardDeduction: Number(f.standardDeduction),
  slabs: slabs(f.slabs),
  ...(f.bySeniority && f.slabsSenior.length ? { slabsSenior: slabs(f.slabsSenior) } : {}),
  ...(f.bySeniority && f.slabsSuperSenior.length ? { slabsSuperSenior: slabs(f.slabsSuperSenior) } : {}),
  rebateIncomeLimit: Number(f.rebateIncomeLimit),
  rebateMax: Number(f.rebateMax),
  rebateMarginalRelief: f.rebateMarginalRelief,
  surcharge: f.surcharge.map((s) => ({ above: Number(s.above), rate: toRate(s.rate) })),
});
const rules = computed<TaxRuleSet>(() => ({ NEW: toRules(form.NEW), OLD: toRules(form.OLD), cess: toRate(form.cess) }));
const problem = computed(() => taxRuleSetProblem(rules.value));
const current = computed(() => form[regime.value]);
const tables = computed(() => [
  { key: 'slabs' as const, label: current.value.bySeniority ? 'Below 60' : 'Slabs' },
  ...(current.value.bySeniority
    ? [
        { key: 'slabsSenior' as const, label: '60 to 79' },
        { key: 'slabsSuperSenior' as const, label: '80 and above' },
      ]
    : []),
]);
function addSlab(key: 'slabs' | 'slabsSenior' | 'slabsSuperSenior') {
  const rows = current.value[key];
  const last = rows.at(-1);
  if (last && last.upTo === null) last.upTo = '';
  rows.push({ upTo: null, rate: last ? last.rate : 0 });
}
function seniority(on: boolean) {
  current.value.bySeniority = on;
  if (on && !current.value.slabsSenior.length) current.value.slabsSenior = current.value.slabs.map((s) => ({ ...s }));
  if (on && !current.value.slabsSuperSenior.length) current.value.slabsSuperSenior = current.value.slabs.map((s) => ({ ...s }));
}

async function save() {
  if (!props.year) return;
  reset();
  saving.value = true;
  try {
    emit('saved', await platformApi.saveTaxRules(props.year.financialYear, { rules: rules.value, source: form.source.trim() || null }));
  } catch (e) {
    handle(e, 'Could not save the rules');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal
    :open="open"
    :title="year ? `Income-tax rules, ${year.label}` : 'Income-tax rules'"
    description="For salaried residents. Payroll uses them for every month of the year; draft runs pick up a change when recalculated, approved payslips keep their figures."
    size="lg"
    @close="emit('close')"
  >
    <form id="tax-rules-form" class="space-y-5" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-[1fr_13rem]">
        <AppInput v-model="form.source" label="Finance Act or circular (optional)" :maxlength="300" placeholder="e.g. Finance Act 2027" />
        <AppInput v-model="form.cess" type="number" label="Cess" suffix="%" :min="0" :max="20" :step="0.01" />
      </div>
      <AppSegmented
        v-model="regime"
        :options="[
          { value: 'NEW', label: 'New regime' },
          { value: 'OLD', label: 'Old regime' },
        ]"
        label="Regime"
      />
      <div class="grid gap-4 sm:grid-cols-3">
        <AppInput v-model="current.standardDeduction" type="number" label="Standard deduction" suffix="₹" :min="0" />
        <AppInput v-model="current.rebateIncomeLimit" type="number" label="87A rebate up to income" suffix="₹" :min="0" />
        <AppInput v-model="current.rebateMax" type="number" label="87A rebate, at most" suffix="₹" :min="0" />
      </div>
      <AppSwitch v-model="current.rebateMarginalRelief" label="Marginal relief just above the rebate limit" description="Tax can't exceed the income above the limit." />
      <AppSwitch :model-value="current.bySeniority" label="Different slabs for 60+ and 80+" @update:model-value="seniority" />

      <section v-for="t in tables" :key="t.key" class="space-y-2">
        <h3 class="text-sm font-semibold text-fg">{{ t.label }}</h3>
        <div v-for="(s, i) in current[t.key]" :key="i" class="grid grid-cols-[1fr_11rem_auto] items-end gap-2">
          <AppInput
            v-if="i < current[t.key].length - 1"
            v-model="s.upTo"
            type="number"
            :label="i === 0 ? 'Income up to' : undefined"
            :aria-label="`${t.label}: slab ${i + 1} upper limit`"
            suffix="₹"
            :min="1"
          />
          <p v-else class="flex h-10 items-center text-sm text-fg-muted">Above that</p>
          <AppInput v-model="s.rate" type="number" :label="i === 0 ? 'Rate' : undefined" :aria-label="`${t.label}: slab ${i + 1} rate`" suffix="%" :min="0" :max="60" :step="0.01" />
          <AppButton variant="ghost" :icon="Trash2" :aria-label="`Remove slab ${i + 1}`" :disabled="current[t.key].length === 1" @click="current[t.key].splice(i, 1)" />
        </div>
        <AppButton size="sm" variant="ghost" :icon="Plus" @click="addSlab(t.key)">Add slab</AppButton>
      </section>

      <section class="space-y-2">
        <h3 class="text-sm font-semibold text-fg">Surcharge</h3>
        <div v-for="(s, i) in current.surcharge" :key="i" class="grid grid-cols-[1fr_11rem_auto] items-end gap-2">
          <AppInput v-model="s.above" type="number" :label="i === 0 ? 'Income above' : undefined" :aria-label="`Surcharge band ${i + 1} threshold`" suffix="₹" :min="1" />
          <AppInput v-model="s.rate" type="number" :label="i === 0 ? 'Surcharge' : undefined" :aria-label="`Surcharge band ${i + 1} rate`" suffix="%" :min="0" :max="50" :step="0.01" />
          <AppButton variant="ghost" :icon="Trash2" :aria-label="`Remove surcharge band ${i + 1}`" @click="current.surcharge.splice(i, 1)" />
        </div>
        <AppButton size="sm" variant="ghost" :icon="Plus" @click="current.surcharge.push({ above: '', rate: '' })">Add band</AppButton>
      </section>
      <p v-if="problem" class="error-text" role="alert">{{ problem }}</p>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="tax-rules-form" :loading="saving" :disabled="!!problem">Save rules</AppButton>
    </template>
  </AppModal>
</template>
