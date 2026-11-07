<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { structureApi, type StructureKind } from '@/modules/people/api/people.api';
import type { CostCenter, Department, Designation, Grade, Location } from '@/modules/people/types';
import { AppAlert, AppButton, AppInput, AppModal, AppSelect, AppSwitch, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { COUNTRY_OPTIONS, timezoneOptions } from '@/shared/utils/options';

type Row = Department | Designation | Location | Grade | CostCenter;

const props = defineProps<{ open: boolean; kind: StructureKind; row: Row | null; departments: Department[] }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const LABELS: Record<StructureKind, string> = { departments: 'department', designations: 'designation', locations: 'location', grades: 'grade', 'cost-centers': 'cost center' };
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
  latitude: '' as string | number,
  longitude: '' as string | number,
  geofenceRadiusM: '' as string | number,
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
      latitude: r.latitude ?? '',
      longitude: r.longitude ?? '',
      geofenceRadiusM: r.geofenceRadiusM ?? '',
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
  if (props.kind === 'grades') return { ...common, code: form.code, level: form.level === '' ? null : Number(form.level), description: form.description };
  if (props.kind === 'cost-centers') return { ...common, code: form.code, description: form.description };
  const num = (v: string | number) => (v === '' || v === null ? null : Number(v));
  return { ...common, code: form.code, addressLine1: form.addressLine1, city: form.city, state: form.state, country: form.country, timezone: form.timezone, latitude: num(form.latitude), longitude: num(form.longitude), geofenceRadiusM: num(form.geofenceRadiusM) };
}
const locating = ref(false);
function useMyPosition() {
  if (!('geolocation' in navigator)) return;
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    (p) => {
      form.latitude = Number(p.coords.latitude.toFixed(6));
      form.longitude = Number(p.coords.longitude.toFixed(6));
      locating.value = false;
    },
    () => (locating.value = false),
    { timeout: 10_000, enableHighAccuracy: true },
  );
}
const canSave = computed(() => (props.kind === 'grades' ? form.name.trim().length >= 1 : form.name.trim().length >= 2) && (props.kind !== 'cost-centers' || !!form.code.trim()));

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
      <div :class="kind === 'designations' ? 'grid gap-4 sm:grid-cols-[1fr_140px]' : kind === 'grades' ? 'grid gap-4 sm:grid-cols-[1fr_120px_110px]' : 'grid gap-4 sm:grid-cols-[1fr_160px]'">
        <AppInput v-model="form.name" label="Name" required autofocus :placeholder="kind === 'grades' ? 'e.g. L3 – Senior' : undefined" :error="fieldErrors.name" />
        <AppInput v-if="kind !== 'designations'" v-model="form.code" label="Code" :required="kind === 'cost-centers'" :placeholder="kind === 'cost-centers' ? 'e.g. CC-100' : kind === 'grades' ? 'e.g. L3' : 'e.g. ENG'" :error="fieldErrors.code" />
        <AppInput v-if="kind === 'designations' || kind === 'grades'" v-model="form.level" label="Level" type="number" :min="1" :max="50" help="1 = most junior" :error="fieldErrors.level" />
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
        <fieldset class="rounded-xl border border-line p-4">
          <legend class="px-1 text-sm font-medium text-fg">Punch geofence</legend>
          <p class="mb-3 text-xs text-fg-muted">Web punch-ins of people at this location must come from within the radius, except on approved work-from-home days. Leave the radius empty to allow punching from anywhere.</p>
          <div class="grid gap-4 sm:grid-cols-3">
            <AppInput v-model="form.latitude" label="Latitude" type="number" :min="-90" :max="90" :step="0.000001" :error="fieldErrors.latitude" />
            <AppInput v-model="form.longitude" label="Longitude" type="number" :min="-180" :max="180" :step="0.000001" :error="fieldErrors.longitude" />
            <AppInput v-model="form.geofenceRadiusM" label="Radius" type="number" :min="25" :max="50000" suffix="m" :error="fieldErrors.geofenceRadiusM" />
          </div>
          <AppButton class="mt-3" size="sm" variant="secondary" :loading="locating" @click="useMyPosition">Use my current position</AppButton>
        </fieldset>
      </template>
      <AppTextarea v-if="kind !== 'locations'" v-model="form.description" label="Description" :rows="2" :maxlength="500" :error="fieldErrors.description" />
      <AppSwitch v-model="form.isActive" label="Active" description="Inactive entries stay on existing employees but can't be chosen for new ones." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="structure-form" :loading="saving" :disabled="!canSave">{{ row ? 'Save changes' : `Create ${LABELS[kind]}` }}</AppButton>
    </template>
  </AppModal>
</template>
