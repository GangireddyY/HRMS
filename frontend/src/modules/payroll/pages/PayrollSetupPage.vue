<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { AlertTriangle, Blocks, Building2, CalendarCheck, Clock, Coins, HeartPulse, Home, Landmark, Layers, Pencil, PiggyBank, Plus, Receipt, Scale, Sparkles, Trash2 } from '@lucide/vue';
import { PROFESSIONAL_TAX_STATES } from '@contracts';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import ComponentFormModal from '@/modules/payroll/components/ComponentFormModal.vue';
import StructureFormModal from '@/modules/payroll/components/StructureFormModal.vue';
import type { SalaryComponentDef, SalaryStructure } from '@/modules/payroll/types';
import { lineRule } from '@/modules/payroll/utils/payroll-format';
import { AppAddTile, AppAlert, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppInput, AppPageHeader, AppSelect, AppSkeleton, AppStatStrip, AppSwitch, AppTabs, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Payroll setup: salary structures, components and the statutory rules (PF, ESI, professional tax, TDS, overtime), with what still needs filling in. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const canConfigure = computed(() => auth.can('payroll.configure'));
const tab = ref('structures');
const components = useAsync(() => payrollApi.components());
const structures = useAsync(() => payrollApi.structures());
const tabs = computed(() => [
  { key: 'structures', label: 'Salary structures', icon: Layers, count: structures.data.value?.length ?? null },
  { key: 'components', label: 'Components', icon: Blocks, count: components.data.value?.length ?? null },
  { key: 'statutory', label: 'Statutory settings', icon: Scale },
]);

const seeding = ref(false);
async function addStandard() {
  seeding.value = true;
  try {
    const r = await payrollApi.recommended();
    components.data.value = r.components;
    structures.data.value = r.structures;
    feedback.success('Standard structure added', 'Basic 50% of CTC, HRA 50% of Basic, and a special allowance for the rest.');
  } catch (e) {
    feedback.error('Could not add the standard structure', e);
  } finally {
    seeding.value = false;
  }
}

const structureOpen = ref(false);
const editingStructure = ref<SalaryStructure | null>(null);
function openStructure(s: SalaryStructure | null) {
  editingStructure.value = s;
  structureOpen.value = true;
}
async function onStructureSaved() {
  structureOpen.value = false;
  feedback.success('Structure saved');
  await structures.run();
}
async function removeStructure(s: SalaryStructure) {
  if (!(await feedback.confirm({ title: `Delete ${s.name}?`, message: 'The structure is removed. Structures used by employees can only be deactivated.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await payrollApi.removeStructure(s.id);
    feedback.success('Structure deleted');
    await structures.run();
  } catch (e) {
    feedback.error('Could not delete the structure', e);
  }
}

const componentOpen = ref(false);
const editingComponent = ref<SalaryComponentDef | null>(null);
function openComponent(c: SalaryComponentDef | null) {
  editingComponent.value = c;
  componentOpen.value = true;
}
async function onComponentSaved() {
  componentOpen.value = false;
  feedback.success('Component saved');
  await components.run();
}
async function removeComponent(c: SalaryComponentDef) {
  if (!(await feedback.confirm({ title: `Delete ${c.name}?`, message: 'Components used in a structure can only be deactivated.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await payrollApi.removeComponent(c.id);
    feedback.success('Component deleted');
    await components.run();
  } catch (e) {
    feedback.error('Could not delete the component', e);
  }
}

// Statutory settings
const settings = useAsync(() => payrollApi.settings());
const { fieldErrors, formError, handle, reset } = useFormErrors();
const s = reactive({ pfEnabled: true, pfRestrictToCeiling: true, esiEnabled: true, ptEnabled: true, ptState: null as string | null, lopFromAttendance: false, pfEstablishmentCode: '', esiEmployerCode: '', tan: '', overtimeMultiplier: 2 as number | string, overtimeBasis: 'GROSS' as 'BASIC' | 'GROSS' });
const overtimeBasisOptions = [
  { value: 'GROSS', label: 'Monthly gross ÷ 26 ÷ 8' },
  { value: 'BASIC', label: 'Monthly Basic ÷ 26 ÷ 8' },
];
const fromSettings = () => {
  const v = settings.data.value!;
  return { ...v, pfEstablishmentCode: v.pfEstablishmentCode ?? '', esiEmployerCode: v.esiEmployerCode ?? '', tan: v.tan ?? '' };
};
watch(
  () => settings.data.value,
  (v) => {
    if (v) Object.assign(s, fromSettings());
  },
  { immediate: true },
);
const FIELDS = ['pfEnabled', 'pfRestrictToCeiling', 'esiEnabled', 'ptEnabled', 'ptState', 'lopFromAttendance', 'pfEstablishmentCode', 'esiEmployerCode', 'tan', 'overtimeMultiplier', 'overtimeBasis'] as const;
const dirty = computed(() => {
  if (!settings.data.value) return false;
  const saved = fromSettings();
  return FIELDS.some((k) => String(s[k] ?? '') !== String(saved[k] ?? ''));
});
const discard = () => Object.assign(s, fromSettings());
const ptOptions = PROFESSIONAL_TAX_STATES.map((p) => ({ value: p.code, label: p.name }));
const savingSettings = ref(false);
async function saveSettings() {
  reset();
  savingSettings.value = true;
  try {
    settings.data.value = await payrollApi.updateSettings({ ...s, overtimeMultiplier: Number(s.overtimeMultiplier), pfEstablishmentCode: s.pfEstablishmentCode || null, esiEmployerCode: s.esiEmployerCode || null, tan: s.tan || null });
    feedback.success('Payroll settings saved');
  } catch (e) {
    handle(e, 'Could not save the settings');
  } finally {
    savingSettings.value = false;
  }
}

// ---- Overview ----------------------------------------------------------------------------------------------------
const ptName = (code: string | null) => PROFESSIONAL_TAX_STATES.find((p) => p.code === code)?.name ?? null;
const strip = computed<StripItem[]>(() => {
  const st = structures.data.value ?? [];
  const co = components.data.value ?? [];
  const v = settings.data.value;
  return [
    { key: 'structures', label: 'Salary structures', value: st.filter((x) => x.isActive).length, tone: 'brand', hint: `${st.filter((x) => x.inUse).length} in use` },
    { key: 'components', label: 'Components', value: co.filter((x) => x.isActive).length, tone: 'info', hint: `${co.filter((x) => x.isActive && !x.taxable).length} non-taxable` },
    { key: 'pf', label: 'Provident fund', value: v ? (v.pfEnabled ? 'On' : 'Off') : '—', tone: v?.pfEnabled ? 'success' : 'neutral', hint: v?.pfEnabled ? (v.pfRestrictToCeiling ? 'On wages up to ₹15,000' : 'On full PF wages') : 'Not deducted' },
    { key: 'esi', label: 'ESI', value: v ? (v.esiEnabled ? 'On' : 'Off') : '—', tone: v?.esiEnabled ? 'success' : 'neutral', hint: v?.esiEnabled ? 'Gross up to ₹21,000 a month' : 'Not applied' },
    { key: 'pt', label: 'Professional tax', value: v ? (v.ptEnabled ? 'On' : 'Off') : '—', tone: v?.ptEnabled ? 'success' : 'neutral', hint: v?.ptEnabled ? `Default: ${ptName(v.ptState) ?? (v.organizationState ? `${v.organizationState} (organization)` : 'location only')}` : 'Not deducted' },
    { key: 'ot', label: 'Overtime', value: v ? `${v.overtimeMultiplier}×` : '—', tone: 'orange', hint: v ? `Hourly rate from ${v.overtimeBasis === 'BASIC' ? 'Basic' : 'gross'}` : undefined },
  ];
});
/** Details payroll can run without but filings need. */
const missing = computed(() => {
  const v = settings.data.value;
  if (!v) return [];
  return [
    ...(v.pfEnabled && !v.pfEstablishmentCode ? [{ key: 'pf', icon: PiggyBank, text: 'PF establishment code', why: 'It identifies you on the PF return (ECR).' }] : []),
    ...(v.esiEnabled && !v.esiEmployerCode ? [{ key: 'esi', icon: HeartPulse, text: 'ESI employer code', why: 'Needed for ESI contribution returns.' }] : []),
    ...(!v.tan ? [{ key: 'tan', icon: Receipt, text: 'TAN', why: 'Needed to deposit and file TDS on salaries.' }] : []),
  ];
});
const ROLE_TILE = {
  BASIC: { icon: Coins, tile: 'bg-accent-soft text-accent-fg ring-brand-500/15' },
  HRA: { icon: Home, tile: 'bg-sky-50 text-sky-600 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300' },
  OTHER: { icon: Blocks, tile: 'bg-surface-muted text-fg-muted ring-line' },
};
const roleOf = (c: SalaryComponentDef) => ROLE_TILE[c.role ?? 'OTHER'];
const ruleTone = (calculation: string) => (calculation === 'BALANCE' ? 'bg-special-soft text-special-fg' : calculation === 'FIXED' ? 'bg-surface-muted text-fg-muted' : 'bg-accent-soft text-accent-fg');
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Payroll setup" description="Salary components, structures and the statutory rules payroll applies (PF, ESI, professional tax, TDS).">
      <template v-if="canConfigure" #actions>
        <AppButton v-if="tab === 'structures'" :icon="Plus" @click="openStructure(null)">New structure</AppButton>
        <AppButton v-else-if="tab === 'components'" :icon="Plus" @click="openComponent(null)">New component</AppButton>
      </template>
    </AppPageHeader>

    <AppStatStrip :items="strip" :loading="!settings.data.value && settings.loading.value" label="Payroll setup at a glance" />

    <section v-if="missing.length" class="card flex flex-wrap items-center gap-4 border-s-4 border-s-warning px-4 py-3" aria-labelledby="setup-missing">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning-fg" aria-hidden="true"><AlertTriangle :size="17" /></span>
      <div class="min-w-0 flex-1">
        <h2 id="setup-missing" class="text-sm font-semibold text-fg">{{ missing.length === 1 ? 'One detail is' : `${missing.length} details are` }} missing for statutory filings</h2>
        <ul class="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
          <li v-for="m in missing" :key="m.key" class="inline-flex items-center gap-1.5" :title="m.why"><component :is="m.icon" :size="13" aria-hidden="true" /><span class="font-medium text-fg">{{ m.text }}</span> · {{ m.why }}</li>
        </ul>
      </div>
      <AppButton v-if="canConfigure && tab !== 'statutory'" size="sm" variant="secondary" @click="tab = 'statutory'">Fill in</AppButton>
    </section>

    <AppTabs v-model="tab" :tabs="tabs">
      <template v-if="tab === 'structures'">
        <AppSkeleton v-if="structures.loading.value && !structures.data.value" :lines="4" />
        <AppErrorState v-else-if="structures.error.value" :error="structures.error.value" @retry="structures.run" />
        <AppCard v-else-if="!structures.data.value?.length">
          <AppEmptyState :icon="Sparkles" title="No salary structures yet" description="Start with the standard structure (Basic 50% of CTC, HRA 50% of Basic, special allowance for the rest) and adjust it, or build your own.">
            <AppButton v-if="canConfigure" :icon="Sparkles" :loading="seeding" @click="addStandard">Add standard structure</AppButton>
          </AppEmptyState>
        </AppCard>
        <div v-else class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          <section v-for="st in structures.data.value" :key="st.id" :class="['card flex flex-col overflow-hidden', !st.isActive && 'opacity-75']" :aria-label="st.name">
            <header class="flex items-start gap-3 border-b border-line/70 px-4 py-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg ring-1 ring-brand-500/15 ring-inset" aria-hidden="true"><Layers :size="17" /></span>
              <div class="min-w-0 flex-1">
                <h3 class="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                  {{ st.name }}
                  <AppBadge v-if="st.inUse" tone="info" size="sm" dot>In use</AppBadge>
                  <AppBadge v-if="!st.isActive" size="sm">Inactive</AppBadge>
                </h3>
                <p class="line-clamp-2 text-xs text-fg-muted">{{ st.description ?? `${st.lines.length} component${st.lines.length === 1 ? '' : 's'}` }}</p>
              </div>
              <div v-if="canConfigure" class="flex shrink-0 gap-1">
                <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${st.name}`" @click="openStructure(st)" />
                <AppButton v-if="!st.inUse" size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${st.name}`" @click="removeStructure(st)" />
              </div>
            </header>
            <ul class="flex-1 divide-y divide-line/60 px-4 text-sm">
              <li v-for="l in st.lines" :key="l.componentId" class="flex items-center justify-between gap-3 py-2.5">
                <span class="flex min-w-0 items-center gap-2">
                  <span class="truncate text-fg">{{ l.component?.name }}</span>
                  <span v-if="l.component?.role" class="text-2xs font-semibold text-fg-subtle uppercase">{{ l.component.role === 'BASIC' ? 'Basic' : 'HRA' }}</span>
                </span>
                <span :class="['shrink-0 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums', ruleTone(l.calculation)]">{{ lineRule(l.calculation, l.value) }}</span>
              </li>
            </ul>
            <footer class="flex items-center justify-between gap-2 border-t border-line/70 bg-surface-muted/40 px-4 py-2 text-2xs text-fg-muted">
              <span>{{ st.lines.length }} component{{ st.lines.length === 1 ? '' : 's' }}</span>
              <span>{{ st.lines.some((l) => l.calculation === 'BALANCE') ? 'Balance fills the rest of the gross' : 'No balancing component' }}</span>
            </footer>
          </section>
          <AppAddTile v-if="canConfigure" title="New structure" description="Combine components into a template, e.g. for interns or a sales plan." @click="openStructure(null)" />
        </div>
      </template>

      <template v-else-if="tab === 'components'">
        <AppErrorState v-if="components.error.value" :error="components.error.value" @retry="components.run" />
        <AppCard v-else :padded="false">
          <AppSkeleton v-if="components.loading.value && !components.data.value" class="p-4" :lines="4" />
          <AppEmptyState v-else-if="!components.data.value?.length" :icon="Blocks" title="No components yet" description="Adding the standard structure creates Basic, HRA and a special allowance.">
            <AppButton v-if="canConfigure" :icon="Plus" @click="openComponent(null)">New component</AppButton>
          </AppEmptyState>
          <ul v-else class="divide-y divide-line/70">
            <li v-for="c in components.data.value" :key="c.id" :class="['flex flex-wrap items-center gap-3 px-4 py-3', !c.isActive && 'opacity-70']">
              <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', roleOf(c).tile]" aria-hidden="true"><component :is="roleOf(c).icon" :size="16" /></span>
              <div class="min-w-0 flex-1">
                <p class="flex flex-wrap items-center gap-2 font-medium text-fg">
                  {{ c.name }}<span class="rounded bg-surface-muted px-1.5 py-px font-mono text-2xs font-normal text-fg-muted">{{ c.code }}</span>
                </p>
                <p v-if="c.description" class="text-xs text-fg-muted">{{ c.description }}</p>
              </div>
              <div class="flex flex-wrap gap-1">
                <AppBadge v-if="c.role" tone="brand" size="sm">{{ c.role === 'BASIC' ? 'Basic' : 'HRA' }}</AppBadge>
                <AppBadge size="sm" :tone="c.taxable ? 'neutral' : 'success'">{{ c.taxable ? 'Taxable' : 'Non-taxable' }}</AppBadge>
                <AppBadge v-if="c.pfWage" size="sm" tone="info">PF wage</AppBadge>
                <AppBadge v-if="c.esiWage" size="sm" tone="info">ESI wage</AppBadge>
                <AppBadge v-if="!c.isActive" size="sm" tone="warning">Inactive</AppBadge>
              </div>
              <div v-if="canConfigure" class="flex gap-1">
                <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${c.name}`" @click="openComponent(c)" />
                <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${c.name}`" @click="removeComponent(c)" />
              </div>
            </li>
          </ul>
        </AppCard>
      </template>

      <template v-else>
        <AppSkeleton v-if="settings.loading.value && !settings.data.value" :lines="6" />
        <AppErrorState v-else-if="settings.error.value" :error="settings.error.value" @retry="settings.run" />
        <form v-else class="grid items-start gap-4 lg:grid-cols-2" novalidate @submit.prevent="saveSettings">
          <AppAlert v-if="formError" class="lg:col-span-2">{{ formError }}</AppAlert>
          <AppCard title="Provident fund (EPF)" :icon="PiggyBank" description="12% of PF wages from the employee and the employer; 8.33% of the employer share (on up to ₹15,000) goes to the pension scheme.">
            <div class="space-y-4">
              <AppSwitch v-model="s.pfEnabled" :disabled="!canConfigure" label="Deduct provident fund" />
              <AppSwitch v-model="s.pfRestrictToCeiling" :disabled="!canConfigure || !s.pfEnabled" label="Limit contributions to wages of ₹15,000" description="Turn off to contribute on the full PF wages." />
              <AppInput v-model="s.pfEstablishmentCode" :disabled="!canConfigure" label="PF establishment code" placeholder="e.g. KNBNG0012345000" :maxlength="30" />
            </div>
          </AppCard>
          <AppCard title="Employee state insurance (ESI)" :icon="HeartPulse" description="0.75% (employee) and 3.25% (employer) of gross wages for employees earning up to ₹21,000 a month at the start of each contribution period.">
            <div class="space-y-4">
              <AppSwitch v-model="s.esiEnabled" :disabled="!canConfigure" label="Apply ESI" />
              <AppInput v-model="s.esiEmployerCode" :disabled="!canConfigure" label="ESI employer code" :maxlength="30" />
            </div>
          </AppCard>
          <AppCard title="Professional tax" :icon="Building2" description="Deducted by the state of each employee's work location; this state applies when the location has none.">
            <div class="space-y-4">
              <AppSwitch v-model="s.ptEnabled" :disabled="!canConfigure" label="Deduct professional tax" />
              <AppSelect v-model="s.ptState" :disabled="!canConfigure || !s.ptEnabled" label="Default state" :options="ptOptions" :placeholder="settings.data.value?.organizationPtState ? `Organization state (${settings.data.value.organizationState})` : 'None'" :error="fieldErrors.ptState" />
              <p class="text-xs text-fg-muted">Supported: {{ PROFESSIONAL_TAX_STATES.map((p) => p.name).join(', ') }}. States without professional tax (e.g. Delhi) deduct nothing.</p>
            </div>
          </AppCard>
          <AppCard title="Income tax & attendance" :icon="Landmark">
            <div class="space-y-4">
              <AppInput v-model="s.tan" :disabled="!canConfigure" label="TAN" placeholder="BLRA12345B" :maxlength="10" :error="fieldErrors.tan" />
              <AppSwitch
                v-model="s.lopFromAttendance"
                :disabled="!canConfigure"
                label="Loss of pay from attendance"
                description="Absences and half days count as loss of pay, not just unpaid leave. Payroll then waits for the month's attendance to be closed."
              />
              <p class="flex items-center gap-2 text-xs text-fg-muted"><CalendarCheck :size="13" aria-hidden="true" />Unpaid leave always counts as loss of pay.</p>
            </div>
          </AppCard>
          <AppCard title="Overtime pay" :icon="Clock" description="Approved overtime (on shifts that count it) is paid with the next payroll. It is taxable and outside PF and ESI wages.">
            <div class="grid gap-3 sm:grid-cols-2">
              <AppInput v-model="s.overtimeMultiplier" :disabled="!canConfigure" type="number" :min="1" :max="5" :step="0.5" label="Rate" suffix="× hourly" help="The Factories Act sets twice the ordinary rate." :error="fieldErrors.overtimeMultiplier" />
              <AppSelect v-model="s.overtimeBasis" :disabled="!canConfigure" label="Hourly rate" :options="overtimeBasisOptions" :clearable="false" :error="fieldErrors.overtimeBasis" />
            </div>
          </AppCard>
          <div v-if="canConfigure" class="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-pop backdrop-blur lg:col-span-2">
            <p :class="['me-auto text-sm', dirty ? 'font-medium text-warning-fg' : 'text-fg-muted']" aria-live="polite">{{ dirty ? 'You have unsaved changes' : 'All changes saved' }}</p>
            <AppButton v-if="dirty" variant="ghost" @click="discard">Discard</AppButton>
            <AppButton type="submit" :loading="savingSettings">Save settings</AppButton>
          </div>
        </form>
      </template>
    </AppTabs>

    <StructureFormModal :open="structureOpen" :structure="editingStructure" :components="components.data.value ?? []" @close="structureOpen = false" @saved="onStructureSaved" />
    <ComponentFormModal :open="componentOpen" :component="editingComponent" @close="componentOpen = false" @saved="onComponentSaved" />
  </div>
</template>
