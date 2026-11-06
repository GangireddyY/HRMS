<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { structureApi, type StructureKind } from '@/modules/people/api/people.api';
import type { Department, Designation, Location } from '@/modules/people/types';
import { AppAlert, AppButton, AppInput, AppModal, AppSelect, AppSwitch, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { COUNTRY_OPTIONS, timezoneOptions } from '@/shared/utils/options';

type Row = Department | Designation | Location;

const props = defineProps<{ open: boolean; kind: StructureKind; row: Row | null; departments: Department[] }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const LABELS: Record<StructureKind, string> = { departments: 'department', designations: 'designation', locations: 'location' };
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const form = reactive({
  name: '',
  code: '',
  parentId: null as string | null,
  description: '',
  level: '' as string | number,
  addressLine1: '',
  city: '',
  state: '',
  country: null as string | null,
  timezone: null as string | null,
  isActive: true,
});

watch(
  () => [props.open, props.row] as const,
  ([open, row]) => {
    if (!open) return;
    reset();
    const r = (row ?? {}) as Partial<Department & Designation & Location>;
    Object.assign(form, {
      name: r.name ?? '',
      code: r.code ?? '',
      parentId: r.parentId ?? null,
      description: r.description ?? '',
      level: r.level ?? '',
      addressLine1: r.addressLine1 ?? '',
      city: r.city ?? '',
      state: r.state ?? '',
      country: r.country ?? null,
      timezone: r.timezone ?? null,
      isActive: r.isActive ?? true,
    });
  },
  { immediate: true },
);

const title = computed(() => `${props.row ? 'Edit' : 'New'} ${LABELS[props.kind]}`);
const parentOptions = computed(() => props.departments.filter((d) => d.id !== props.row?.id).map((d) => ({ value: d.id, label: d.name })));
const timezones = computed(() => timezoneOptions(form.timezone ?? undefined));

function body(): Record<string, unknown> {
  const common = { name: form.name, isActive: form.isActive };
  if (props.kind === 'departments') return { ...common, code: form.code, parentId: form.parentId, description: form.description };
  if (props.kind === 'designations') return { ...common, level: form.level === '' ? null : Number(form.level), description: form.description };
  return { ...common, code: form.code, addressLine1: form.addressLine1, city: form.city, state: form.state, country: form.country, timezone: form.timezone };
}

async function save() {
  reset();
  saving.value = true;
  try {
    if (props.row) await structureApi.update(props.kind, props.row.id, body());
    else await structureApi.create(props.kind, body());
    emit('saved');
  } catch (e) {
    handle(e, `Could not save ${LABELS[props.kind]}`);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="title" @close="emit('close')">
    <form id="structure-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div :class="kind === 'designations' ? 'grid gap-4 sm:grid-cols-[1fr_140px]' : 'grid gap-4 sm:grid-cols-[1fr_160px]'">
        <AppInput v-model="form.name" label="Name" required autofocus :error="fieldErrors.name" />
        <AppInput v-if="kind === 'designations'" v-model="form.level" label="Level" type="number" :min="1" :max="50" help="1 = most junior" :error="fieldErrors.level" />
        <AppInput v-else v-model="form.code" label="Code" placeholder="e.g. ENG" :error="fieldErrors.code" />
      </div>
      <AppSelect v-if="kind === 'departments'" v-model="form.parentId" label="Parent department" placeholder="None (top level)" :options="parentOptions" :error="fieldErrors.parentId" />
      <template v-if="kind === 'locations'">
        <AppInput v-model="form.addressLine1" label="Address" :error="fieldErrors.addressLine1" />
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.city" label="City" :error="fieldErrors.city" />
          <AppInput v-model="form.state" label="State / province" :error="fieldErrors.state" />
          <AppSelect v-model="form.country" label="Country" placeholder="Select…" :options="COUNTRY_OPTIONS" :error="fieldErrors.country" />
          <AppSelect v-model="form.timezone" label="Time zone" placeholder="Organization default" :options="timezones" :error="fieldErrors.timezone" />
        </div>
      </template>
      <AppTextarea v-if="kind !== 'locations'" v-model="form.description" label="Description" :rows="2" :maxlength="500" :error="fieldErrors.description" />
      <AppSwitch v-model="form.isActive" label="Active" description="Inactive entries stay on existing employees but can't be chosen for new ones." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="structure-form" :loading="saving" :disabled="form.name.trim().length < 2">{{ row ? 'Save changes' : `Create ${LABELS[kind]}` }}</AppButton>
    </template>
  </AppModal>
</template>
