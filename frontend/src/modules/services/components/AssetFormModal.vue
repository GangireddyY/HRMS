<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABELS, ASSET_CONDITIONS, type AssetCategory, type AssetCondition } from '@contracts';
import { structureApi } from '@/modules/people/api/people.api';
import { assetsApi } from '@/modules/services/api/services.api';
import type { AssetDetail } from '@/modules/services/types';
import { ASSET_CONDITION_LABELS } from '@/modules/services/utils/services-format';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Add an asset to the register, or edit one. The tag is generated (AST-0001…) when left empty. */
const props = defineProps<{ open: boolean; asset?: AssetDetail | null }>();
const emit = defineEmits<{ close: []; saved: [asset: AssetDetail] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const blank = () => ({
  tag: '',
  name: '',
  category: 'LAPTOP' as AssetCategory,
  serialNumber: '',
  model: '',
  purchaseDate: undefined as string | undefined,
  purchaseCost: '' as string | number,
  warrantyUntil: undefined as string | undefined,
  condition: 'NEW' as AssetCondition,
  locationId: null as string | null,
  notes: '',
});
const form = reactive(blank());
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const a = props.asset;
    Object.assign(
      form,
      a
        ? {
            tag: a.tag,
            name: a.name,
            category: a.category,
            serialNumber: a.serialNumber ?? '',
            model: a.model ?? '',
            purchaseDate: a.purchaseDate ?? undefined,
            purchaseCost: a.purchaseCost ?? '',
            warrantyUntil: a.warrantyUntil ?? undefined,
            condition: a.condition,
            locationId: a.location?.id ?? null,
            notes: a.notes ?? '',
          }
        : blank(),
    );
  },
);
const locations = useAsync(() => structureApi.locations());
const locationOptions = computed(() => (locations.data.value ?? []).map((l) => ({ value: l.id, label: l.name })));
const categoryOptions = ASSET_CATEGORIES.map((c) => ({ value: c, label: ASSET_CATEGORY_LABELS[c] }));
const conditionOptions = ASSET_CONDITIONS.map((c) => ({ value: c, label: ASSET_CONDITION_LABELS[c] }));

const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  try {
    const body = {
      tag: form.tag.trim() || null,
      name: form.name,
      category: form.category,
      serialNumber: form.serialNumber || null,
      model: form.model || null,
      purchaseDate: form.purchaseDate || null,
      purchaseCost: form.purchaseCost === '' ? null : Number(form.purchaseCost),
      warrantyUntil: form.warrantyUntil || null,
      condition: form.condition,
      locationId: form.locationId,
      notes: form.notes || null,
    };
    emit('saved', props.asset ? await assetsApi.update(props.asset.id, body) : await assetsApi.create(body));
  } catch (e) {
    handle(e, 'Could not save the asset');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="asset ? `Edit ${asset.tag}` : 'Add an asset'" description="Equipment the company owns and hands to employees." @close="emit('close')">
    <form id="asset-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-[1fr_200px]">
        <AppInput v-model="form.name" label="Name" placeholder="e.g. MacBook Pro 14″" required :error="fieldErrors.name" />
        <AppSelect v-model="form.category" label="Category" :options="categoryOptions" :clearable="false" />
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppInput v-model="form.tag" label="Asset tag" :placeholder="asset ? '' : 'Generated'" help="Printed on the label" :error="fieldErrors.tag" />
        <AppInput v-model="form.serialNumber" label="Serial number" :error="fieldErrors.serialNumber" />
        <AppInput v-model="form.model" label="Make & model" :error="fieldErrors.model" />
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppDatePicker v-model="form.purchaseDate" label="Purchased on" :error="fieldErrors.purchaseDate" />
        <AppInput v-model="form.purchaseCost" label="Cost (₹)" type="number" :min="0" :error="fieldErrors.purchaseCost" />
        <AppDatePicker v-model="form.warrantyUntil" label="Warranty until" :error="fieldErrors.warrantyUntil" />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect v-model="form.condition" label="Condition" :options="conditionOptions" :clearable="false" />
        <AppSelect v-model="form.locationId" label="Location" :options="locationOptions" placeholder="Not set" />
      </div>
      <AppTextarea v-model="form.notes" label="Notes" :rows="2" :maxlength="1000" :error="fieldErrors.notes" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="asset-form" :loading="saving" :disabled="form.name.trim().length < 2">{{ asset ? 'Save changes' : 'Add asset' }}</AppButton>
    </template>
  </AppModal>
</template>
