<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ArrowLeftRight, Building, Pencil, Plus, Star, Trash2, UserPlus, X } from '@lucide/vue';
import { COMMON_CURRENCIES, type LegalEntityView } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { entitiesApi } from '@/modules/organization/api/entities.api';
import { employeesApi } from '@/modules/people/api/people.api';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import type { Colleague } from '@/modules/performance/types';
import { AppAlert, AppBadge, AppButton, AppCard, AppDatePicker, AppEmptyState, AppErrorState, AppInput, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppSwitch } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { localToday } from '@/shared/utils/dates';
import { formatDate } from '@/shared/utils/format';

/** The companies the organization employs people through, and exchange rates into the base currency. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const entities = useAsync(() => entitiesApi.list());
const rates = useAsync(() => entitiesApi.rates());
const canEdit = computed(() => auth.can('organization.update'));
const canRates = computed(() => auth.can('payroll.configure'));
const CURRENCIES = COMMON_CURRENCIES.map((c) => ({ value: c, label: c }));
const regionName = (code: string) => {
  try {
    return new Intl.DisplayNames([], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

// Entity editor.
const editing = ref<LegalEntityView | 'new' | null>(null);
const form = reactive({ name: '', legalName: '', country: 'IN', currency: 'INR', registrations: [] as { label: string; value: string }[], addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', isDefault: false });
function edit(e: LegalEntityView | 'new') {
  reset();
  const x = e === 'new' ? null : e;
  Object.assign(form, {
    name: x?.name ?? '',
    legalName: x?.legalName ?? '',
    country: x?.country ?? 'IN',
    currency: x?.currency ?? 'INR',
    registrations: x ? x.registrations.map((r) => ({ ...r })) : [{ label: 'PAN', value: '' }],
    addressLine1: x?.address.line1 ?? '',
    addressLine2: x?.address.line2 ?? '',
    city: x?.address.city ?? '',
    state: x?.address.state ?? '',
    postalCode: x?.address.postalCode ?? '',
    isDefault: x?.isDefault ?? false,
  });
  editing.value = e;
}
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  try {
    await entitiesApi.save(
      {
        name: form.name,
        legalName: form.legalName,
        country: form.country.toUpperCase(),
        currency: form.currency.toUpperCase(),
        registrations: form.registrations.filter((r) => r.label.trim() && r.value.trim()),
        addressLine1: form.addressLine1 || null,
        addressLine2: form.addressLine2 || null,
        city: form.city || null,
        state: form.state || null,
        postalCode: form.postalCode || null,
        isDefault: form.isDefault,
      },
      editing.value === 'new' ? undefined : editing.value!.id,
    );
    editing.value = null;
    feedback.success('Entity saved');
    await entities.run();
  } catch (e) {
    handle(e, 'Could not save the entity');
  } finally {
    saving.value = false;
  }
}
async function remove(e: LegalEntityView) {
  if (!(await feedback.confirm({ title: `Delete ${e.name}?`, message: 'Only entities without employees or pay groups can be deleted.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await entitiesApi.remove(e.id);
    await entities.run();
  } catch (err) {
    feedback.error('Could not delete the entity', err);
  }
}

// Moving employees.
const moving = reactive({ open: false, target: '' as string, employeeIds: [] as string[] });
const search = async (q: string): Promise<Colleague[]> =>
  (await employeesApi.list({ page: 1, pageSize: 20, search: q || undefined, status: 'ACTIVE' })).items.map((e) => ({ id: e.id, name: e.fullName, employeeCode: e.employeeCode, department: e.department?.name ?? null, designation: e.designation?.name ?? null }));
async function move() {
  saving.value = true;
  try {
    entities.data.value = await entitiesApi.assign(moving.target || null, moving.employeeIds);
    feedback.success(`${moving.employeeIds.length} ${moving.employeeIds.length === 1 ? 'person' : 'people'} moved`);
    moving.open = false;
  } catch (e) {
    feedback.error('Could not move them', e);
  } finally {
    saving.value = false;
  }
}

// Exchange rates.
const rateForm = reactive({ currency: 'USD', rate: '' as string | number, effectiveOn: localToday() as string | undefined, source: '' });
async function addRate() {
  try {
    rates.data.value = await entitiesApi.setRate({ currency: rateForm.currency, rate: Number(rateForm.rate), effectiveOn: rateForm.effectiveOn!, source: rateForm.source || null });
    rateForm.rate = '';
    feedback.success('Rate saved');
  } catch (e) {
    feedback.error('Could not save the rate', e);
  }
}
async function removeRate(id: string) {
  rates.data.value = await entitiesApi.removeRate(id);
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Legal entities & currencies" description="The companies you employ people through. Each pays in its own currency; Indian statutory payroll applies to entities in India only.">
      <template v-if="canEdit" #actions>
        <AppButton variant="secondary" :icon="UserPlus" :disabled="!entities.data.value?.length" @click="Object.assign(moving, { open: true, target: '', employeeIds: [] })">Move people</AppButton>
        <AppButton :icon="Plus" @click="edit('new')">New entity</AppButton>
      </template>
    </AppPageHeader>

    <AppSkeleton v-if="entities.loading.value && !entities.data.value" :lines="4" />
    <AppErrorState v-else-if="entities.error.value" :error="entities.error.value" @retry="entities.run" />
    <AppEmptyState v-else-if="!entities.data.value?.length" :icon="Building" title="One company so far" description="Add entities when you employ people through more than one company or country." />
    <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <article v-for="e in entities.data.value" :key="e.id" class="card flex flex-col p-4">
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm font-semibold text-accent-fg" aria-hidden="true">{{ e.country }}</span>
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-1.5 truncate font-semibold text-fg">{{ e.name }}<Star v-if="e.isDefault" :size="13" class="shrink-0 fill-current text-warning-fg" aria-label="Default" /></p>
            <p class="truncate text-xs text-fg-muted">{{ e.legalName }}</p>
          </div>
          <div v-if="canEdit" class="flex shrink-0 gap-1">
            <AppButton size="xs" variant="ghost" :icon="Pencil" :aria-label="`Edit ${e.name}`" @click="edit(e)" />
            <AppButton v-if="!e.isDefault" size="xs" variant="ghost" :icon="Trash2" :aria-label="`Delete ${e.name}`" @click="remove(e)" />
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <AppBadge size="sm" tone="info">{{ e.currency }}</AppBadge>
          <AppBadge size="sm">{{ regionName(e.country) }}</AppBadge>
          <AppBadge v-if="e.statutory" size="sm" tone="success">Indian statutory payroll</AppBadge>
          <AppBadge v-if="e.isDefault" size="sm" tone="warning">Default</AppBadge>
        </div>
        <dl class="mt-3 space-y-1 text-xs">
          <div v-for="r in e.registrations" :key="r.label" class="flex justify-between gap-2"><dt class="text-fg-muted">{{ r.label }}</dt><dd class="font-mono text-fg">{{ r.value }}</dd></div>
        </dl>
        <p class="mt-auto pt-3 text-xs text-fg-muted">{{ e.employees }} {{ e.employees === 1 ? 'person' : 'people' }} · {{ e.payGroups }} pay group{{ e.payGroups === 1 ? '' : 's' }}<template v-if="e.address.city"> · {{ e.address.city }}</template></p>
      </article>
    </div>

    <AppCard title="Exchange rates" :icon="ArrowLeftRight" :description="rates.data.value ? `Into ${rates.data.value.base}, your base currency. Used for expense receipts in other currencies and consolidated reports.` : undefined">
      <form v-if="canRates" class="mb-4 grid items-end gap-3 sm:grid-cols-[8rem_10rem_11rem_minmax(0,1fr)_auto]" novalidate @submit.prevent="addRate">
        <AppSelect v-model="rateForm.currency" label="Currency" :options="CURRENCIES.filter((c) => c.value !== rates.data.value?.base)" searchable />
        <AppInput v-model="rateForm.rate" label="Rate" type="number" :min="0" :step="0.0001" :suffix="rates.data.value?.base" required />
        <AppDatePicker v-model="rateForm.effectiveOn" label="From" required />
        <AppInput v-model="rateForm.source" label="Source" placeholder="e.g. RBI reference rate" />
        <AppButton type="submit" :icon="Plus" :disabled="!Number(rateForm.rate) || !rateForm.effectiveOn">Add</AppButton>
      </form>
      <p v-if="!rates.data.value?.rates.length" class="text-sm text-fg-muted">No exchange rates yet.</p>
      <ul v-else class="divide-y divide-line/70 rounded-xl ring-1 ring-line ring-inset">
        <li v-for="r in rates.data.value.rates" :key="r.id" class="flex items-center gap-3 px-3 py-2 text-sm">
          <span class="w-12 font-semibold text-fg">{{ r.currency }}</span>
          <span class="flex-1 text-fg tabular-nums">1 {{ r.currency }} = {{ r.rate }} {{ rates.data.value.base }}</span>
          <span class="text-xs text-fg-muted">from {{ formatDate(r.effectiveOn) }}<template v-if="r.source"> · {{ r.source }}</template></span>
          <AppBadge v-if="rates.data.value.latest.some((l) => l.id === r.id)" size="sm" tone="success">In force</AppBadge>
          <AppButton v-if="canRates" size="xs" variant="ghost" :icon="X" :aria-label="`Delete the ${r.currency} rate from ${r.effectiveOn}`" @click="removeRate(r.id)" />
        </li>
      </ul>
    </AppCard>

    <AppModal :open="!!editing" :title="editing === 'new' ? 'New legal entity' : 'Edit legal entity'" size="md" @close="editing = null">
      <form id="entity-form" class="space-y-4" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <div class="grid gap-3 sm:grid-cols-2">
          <AppInput v-model="form.name" label="Short name" required placeholder="e.g. Acme US" :error="fieldErrors.name" />
          <AppInput v-model="form.legalName" label="Registered name" required :error="fieldErrors.legalName" />
          <AppInput v-model="form.country" label="Country (ISO code)" required :maxlength="2" placeholder="IN" :help="form.country.length === 2 ? regionName(form.country.toUpperCase()) : undefined" :error="fieldErrors.country" />
          <AppSelect v-model="form.currency" label="Currency" required :options="CURRENCIES" searchable :error="fieldErrors.currency" />
        </div>
        <fieldset class="space-y-2">
          <legend class="label">Registrations</legend>
          <div v-for="(r, i) in form.registrations" :key="i" class="grid grid-cols-[8rem_minmax(0,1fr)_auto] gap-2">
            <AppInput v-model="r.label" :aria-label="`Registration ${i + 1} type`" placeholder="PAN, EIN…" />
            <AppInput v-model="r.value" :aria-label="`Registration ${i + 1} number`" />
            <AppButton size="sm" variant="ghost" :icon="X" :aria-label="`Remove registration ${i + 1}`" @click="form.registrations.splice(i, 1)" />
          </div>
          <AppButton size="xs" variant="ghost" :icon="Plus" :disabled="form.registrations.length >= 8" @click="form.registrations.push({ label: '', value: '' })">Add registration</AppButton>
        </fieldset>
        <div class="grid gap-3 sm:grid-cols-2">
          <AppInput v-model="form.addressLine1" label="Address" class="sm:col-span-2" />
          <AppInput v-model="form.city" label="City" />
          <AppInput v-model="form.state" label="State / region" />
          <AppInput v-model="form.postalCode" label="Postal code" />
        </div>
        <AppSwitch v-model="form.isDefault" label="Default entity" description="Anyone not assigned to another entity works for this one." :disabled="editing !== 'new' && !!editing && editing.isDefault" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="editing = null">Cancel</AppButton>
        <AppButton form="entity-form" type="submit" :loading="saving" :disabled="form.name.trim().length < 2 || form.legalName.trim().length < 2">Save</AppButton>
      </template>
    </AppModal>

    <AppModal :open="moving.open" dialog title="Move people to an entity" description="They're paid in the entity's currency from their next payroll run." @close="moving.open = false">
      <div class="space-y-4">
        <ColleaguePicker v-model:values="moving.employeeIds" multiple label="People" :source="search" />
        <AppSelect v-model="moving.target" label="Entity" :options="[{ value: '', label: 'The default entity' }, ...(entities.data.value ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.currency})` }))]" :clearable="false" :searchable="false" />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="moving.open = false">Cancel</AppButton>
        <AppButton :loading="saving" :disabled="!moving.employeeIds.length" @click="move">Move</AppButton>
      </template>
    </AppModal>
  </div>
</template>
