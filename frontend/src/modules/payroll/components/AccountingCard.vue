<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { BookOpenText, Building2, Layers } from '@lucide/vue';
import { LEDGER_NAME_PATTERN, LEDGER_SLOT_INFO, LEDGER_SLOTS, type LedgerSlot } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import { AppBadge, AppButton, AppCard, AppErrorState, AppInput, AppSkeleton, AppSwitch } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Ledger names an approved payroll run posts to, per-component expense ledgers and Tally import options. */
const props = defineProps<{ canConfigure: boolean }>();
const feedback = useFeedbackStore();
const settings = useAsync(() => payrollApi.accounting());
const components = useAsync(() => payrollApi.components());

const ENGINE_EARNINGS = [
  { code: 'ARREARS', name: 'Salary arrears' },
  { code: 'OVERTIME', name: 'Overtime' },
  { code: 'ENCASHMENT', name: 'Leave encashment' },
  { code: 'ADJUSTMENT', name: 'One-off earnings and bonuses' },
];
const earnings = computed(() => [...(components.data.value ?? []).filter((c) => c.isActive).map((c) => ({ code: c.code, name: c.name })), ...ENGINE_EARNINGS]);

const form = ref({ tallyCompany: '', voucherType: 'Journal', costCentres: false, costCategory: 'Primary Cost Category' });
const ledgers = ref<Record<LedgerSlot, string>>({} as Record<LedgerSlot, string>);
const own = ref<Record<string, string>>({});
watch(
  () => settings.data.value,
  (s) => {
    if (!s) return;
    form.value = { tallyCompany: s.tallyCompany ?? '', voucherType: s.voucherType, costCentres: s.costCentres, costCategory: s.costCategory };
    ledgers.value = { ...s.ledgers };
    own.value = { ...s.earningLedgers };
  },
  { immediate: true },
);

const nameError = (v: string, required = true) => (!v.trim() ? (required ? 'Required' : '') : LEDGER_NAME_PATTERN.test(v.trim()) ? '' : 'Up to 100 characters, without < > " or \\');
const errors = computed(() => ({
  tallyCompany: nameError(form.value.tallyCompany, false),
  voucherType: nameError(form.value.voucherType),
  costCategory: form.value.costCentres ? nameError(form.value.costCategory) : '',
  ledgers: Object.fromEntries(LEDGER_SLOTS.map((s) => [s, nameError(ledgers.value[s] ?? '')])) as Record<LedgerSlot, string>,
  own: Object.fromEntries(Object.entries(own.value).map(([k, v]) => [k, nameError(v, false)])),
}));
const valid = computed(
  () => !errors.value.tallyCompany && !errors.value.voucherType && !errors.value.costCategory && !Object.values(errors.value.ledgers).some(Boolean) && !Object.values(errors.value.own).some(Boolean),
);
const ownEntries = () =>
  Object.entries(own.value)
    .filter(([, v]) => v.trim())
    .map(([code, name]) => ({ code, name: name.trim() }));
const dirty = computed(() => {
  const s = settings.data.value;
  if (!s) return false;
  const stored = Object.entries(s.earningLedgers)
    .sort()
    .map(([c, n]) => `${c}=${n}`)
    .join('|');
  const next = ownEntries()
    .map((e) => `${e.code}=${e.name}`)
    .sort()
    .join('|');
  return (
    (s.tallyCompany ?? '') !== form.value.tallyCompany.trim() ||
    s.voucherType !== form.value.voucherType.trim() ||
    s.costCentres !== form.value.costCentres ||
    s.costCategory !== form.value.costCategory.trim() ||
    LEDGER_SLOTS.some((k) => s.ledgers[k] !== (ledgers.value[k] ?? '').trim()) ||
    stored !== next
  );
});
const renamed = computed(() => LEDGER_SLOTS.filter((s) => (ledgers.value[s] ?? '').trim() !== LEDGER_SLOT_INFO[s].default).length);

const saving = ref(false);
async function save() {
  saving.value = true;
  try {
    settings.data.value = await payrollApi.updateAccounting({
      tallyCompany: form.value.tallyCompany.trim() || null,
      voucherType: form.value.voucherType.trim(),
      costCentres: form.value.costCentres,
      costCategory: form.value.costCategory.trim(),
      ledgers: LEDGER_SLOTS.map((slot) => ({ slot, name: (ledgers.value[slot] ?? '').trim() })),
      earningLedgers: ownEntries(),
    });
    feedback.success('Accounting ledgers saved', 'Journals of approved runs use these names.');
  } catch (e) {
    feedback.error('Could not save the accounting ledgers', e);
  } finally {
    saving.value = false;
  }
}
const resetDefaults = () => {
  ledgers.value = Object.fromEntries(LEDGER_SLOTS.map((s) => [s, LEDGER_SLOT_INFO[s].default])) as Record<LedgerSlot, string>;
};
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-2">
    <AppSkeleton v-if="settings.loading.value && !settings.data.value" class="lg:col-span-2" :lines="8" />
    <AppErrorState v-else-if="settings.error.value" class="lg:col-span-2" :error="settings.error.value" @retry="settings.run" />
    <template v-else-if="settings.data.value">
      <AppCard title="Tally" :icon="Building2" description="Each approved run gives one journal voucher dated the last day of the month. Import it in Tally under Gateway → Import → Vouchers.">
        <div class="space-y-4">
          <AppInput
            v-model="form.tallyCompany"
            label="Company in Tally"
            placeholder="The company open in Tally"
            :disabled="!props.canConfigure"
            :error="errors.tallyCompany || undefined"
            help="Exactly as it appears in Tally. Leave empty to import into whichever company is open."
          />
          <AppInput v-model="form.voucherType" label="Voucher type" :disabled="!props.canConfigure" :error="errors.voucherType || undefined" help="Journal, or your own payroll voucher type." />
          <AppSwitch
            v-model="form.costCentres"
            :disabled="!props.canConfigure"
            label="Split expenses by department"
            description="Salary and employer cost lines are allocated to a cost centre per department (Unassigned when an employee has none)."
          />
          <AppInput v-if="form.costCentres" v-model="form.costCategory" label="Cost category" :disabled="!props.canConfigure" :error="errors.costCategory || undefined" />
        </div>
      </AppCard>

      <AppCard
        title="Earnings with their own ledger"
        :icon="Layers"
        description="Send a component to a separate expense ledger, such as House Rent Allowance or Bonus. Empty ones post to the salaries ledger."
        :padded="false"
      >
        <AppSkeleton v-if="components.loading.value && !components.data.value" class="p-4" :lines="4" />
        <ul v-else class="divide-y divide-line/60">
          <li v-for="e in earnings" :key="e.code" class="grid gap-2 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-fg">{{ e.name }}</p>
              <p class="font-mono text-2xs text-fg-subtle">{{ e.code }}</p>
            </div>
            <AppInput
              v-model="own[e.code]"
              :placeholder="ledgers.SALARY_EXPENSE || LEDGER_SLOT_INFO.SALARY_EXPENSE.default"
              :disabled="!props.canConfigure"
              :aria-label="`${e.name}: own ledger`"
              :error="errors.own[e.code] || undefined"
            />
          </li>
        </ul>
      </AppCard>

      <AppCard
        class="lg:col-span-2"
        title="Ledgers"
        :icon="BookOpenText"
        description="Names must match the ledgers in your Tally company. The masters file from a run creates any that are missing."
        :padded="false"
      >
        <template #actions>
          <AppBadge v-if="renamed" tone="info">{{ renamed }} renamed</AppBadge>
        </template>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[40rem] text-sm">
            <caption class="sr-only">
              Ledger names payroll posts to
            </caption>
            <thead>
              <tr class="border-b border-line/70 text-start text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                <th scope="col" class="px-4 py-2 text-start">Posting</th>
                <th scope="col" class="px-2 py-2 text-start">Side</th>
                <th scope="col" class="px-2 py-2 text-start">Tally group</th>
                <th scope="col" class="px-4 py-2 text-start">Ledger</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line/60">
              <tr v-for="slot in LEDGER_SLOTS" :key="slot">
                <th scope="row" class="px-4 py-2 text-start font-normal">
                  <p class="font-medium text-fg">{{ LEDGER_SLOT_INFO[slot].label }}</p>
                  <p class="text-xs text-fg-subtle">{{ LEDGER_SLOT_INFO[slot].help }}</p>
                </th>
                <td class="px-2 py-2">
                  <AppBadge :tone="LEDGER_SLOT_INFO[slot].side === 'DEBIT' ? 'warning' : 'success'">{{ LEDGER_SLOT_INFO[slot].side === 'DEBIT' ? 'Debit' : 'Credit' }}</AppBadge>
                </td>
                <td class="px-2 py-2 text-xs whitespace-nowrap text-fg-muted">{{ LEDGER_SLOT_INFO[slot].group }}</td>
                <td class="px-4 py-2">
                  <AppInput v-model="ledgers[slot]" :disabled="!props.canConfigure" :aria-label="`${LEDGER_SLOT_INFO[slot].label} ledger`" :error="errors.ledgers[slot] || undefined" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="props.canConfigure" class="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-4 py-3">
          <AppButton variant="ghost" size="sm" :disabled="!renamed" @click="resetDefaults">Use default names</AppButton>
          <AppButton :loading="saving" :disabled="!dirty || !valid" @click="save">Save ledgers</AppButton>
        </div>
      </AppCard>
    </template>
  </div>
</template>
