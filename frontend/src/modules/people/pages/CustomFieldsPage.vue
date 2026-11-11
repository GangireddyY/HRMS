<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { Archive, ArrowDown, ArrowUp, ListPlus, Lock, Pencil, Plus, RotateCcw, UserPen } from '@lucide/vue';
import { CUSTOM_FIELD_TYPES, type CustomFieldType } from '@contracts';
import { customFieldsApi } from '@/modules/people/api/people.api';
import type { CustomFieldDefinition } from '@/modules/people/types';
import { CUSTOM_FIELD_TYPE_LABELS, bySection } from '@/modules/people/utils/custom-fields';
import { AppAlert, AppBadge, AppButton, AppCheckbox, AppEmptyState, AppErrorState, AppInput, AppModal, AppPageHeader, AppSelect, AppSkeleton, AppSwitch } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Custom employee fields (`employee.fields.manage`): define, order, archive. */
const feedback = useFeedbackStore();
const showArchived = ref(false);
const defs = useAsync(() => customFieldsApi.definitions(showArchived.value));
watch(showArchived, () => void defs.run());
const active = computed(() => (defs.data.value ?? []).filter((d) => !d.archived));
const archived = computed(() => (defs.data.value ?? []).filter((d) => d.archived));
const groups = computed(() => bySection(active.value));

const typeOptions = CUSTOM_FIELD_TYPES.map((t) => ({ value: t, label: CUSTOM_FIELD_TYPE_LABELS[t] }));
const editing = ref<CustomFieldDefinition | 'new' | null>(null);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ key: '', label: '', type: 'TEXT' as CustomFieldType, options: '', required: false, sensitive: false, employeeEditable: false, section: '', helpText: '' });
const keyTouched = ref(false);
function open(d: CustomFieldDefinition | 'new') {
  reset();
  keyTouched.value = d !== 'new';
  Object.assign(
    form,
    d === 'new'
      ? { key: '', label: '', type: 'TEXT', options: '', required: false, sensitive: false, employeeEditable: false, section: '', helpText: '' }
      : { key: d.key, label: d.label, type: d.type, options: d.options.join('\n'), required: d.required, sensitive: d.sensitive, employeeEditable: d.employeeEditable, section: d.section ?? '', helpText: d.helpText ?? '' },
  );
  editing.value = d;
}
watch(
  () => form.label,
  (label) => {
    if (editing.value === 'new' && !keyTouched.value) form.key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40);
  },
);
const choices = computed(() => form.type === 'SELECT' || form.type === 'MULTI_SELECT');
const optionList = computed(() => [...new Set(form.options.split('\n').map((o) => o.trim()).filter(Boolean))]);
const canSave = computed(() => form.label.trim().length >= 2 && /^[a-z][a-z0-9_]{0,39}$/.test(form.key) && (!choices.value || optionList.value.length >= 2));
const saving = ref(false);
async function save() {
  reset();
  saving.value = true;
  const body = { label: form.label.trim(), options: choices.value ? optionList.value : [], required: form.required, sensitive: form.sensitive, employeeEditable: form.employeeEditable, section: form.section || null, helpText: form.helpText || null };
  try {
    if (editing.value === 'new') await customFieldsApi.create({ ...body, key: form.key, type: form.type });
    else await customFieldsApi.update(editing.value!.id, body);
    feedback.success(editing.value === 'new' ? 'Field added' : 'Field saved');
    editing.value = null;
    await defs.run();
  } catch (e) {
    handle(e, 'Could not save the field');
  } finally {
    saving.value = false;
  }
}
async function move(d: CustomFieldDefinition, dir: -1 | 1) {
  const list = active.value;
  const i = list.findIndex((x) => x.id === d.id);
  const other = list[i + dir];
  if (!other) return;
  await Promise.all([customFieldsApi.update(d.id, { sortOrder: other.sortOrder }), customFieldsApi.update(other.id, { sortOrder: d.sortOrder })]);
  await defs.run();
}
async function setArchived(d: CustomFieldDefinition, value: boolean) {
  try {
    await customFieldsApi.update(d.id, { archived: value });
    feedback.success(value ? 'Field archived' : 'Field restored', value ? 'It no longer shows on profiles; values are kept.' : undefined);
    await defs.run();
  } catch (e) {
    feedback.error('Could not update the field', e);
  }
}
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Custom fields" description="Extra fields on every employee profile: badge numbers, T-shirt sizes, licences… HR fills them in; employees can fill in the ones you allow.">
      <template #actions><AppButton :icon="Plus" @click="open('new')">Add field</AppButton></template>
    </AppPageHeader>

    <AppSkeleton v-if="defs.loading.value && !defs.data.value" :lines="6" />
    <AppErrorState v-else-if="defs.error.value" :error="defs.error.value" @retry="defs.run" />
    <div v-else-if="!active.length" class="card">
      <AppEmptyState :icon="ListPlus" title="No custom fields yet" description="Add the details your organization tracks that the standard profile doesn't have.">
        <AppButton size="sm" :icon="Plus" @click="open('new')">Add field</AppButton>
      </AppEmptyState>
    </div>
    <section v-for="g in groups" v-else :key="g.section" class="card overflow-hidden">
      <h2 class="border-b border-line/70 px-4 py-2.5 text-sm font-semibold text-fg">{{ g.section }}</h2>
      <ul class="divide-y divide-line/70">
        <li v-for="d in g.fields" :key="d.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
          <div class="min-w-0 flex-1 basis-60">
            <p class="text-sm font-medium text-fg">{{ d.label }}<span v-if="d.required" class="text-danger-fg"> *</span></p>
            <p class="truncate text-xs text-fg-muted"><span class="font-mono">{{ d.key }}</span> · {{ CUSTOM_FIELD_TYPE_LABELS[d.type] }}<template v-if="d.options.length"> · {{ d.options.join(', ') }}</template></p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <AppBadge v-if="d.sensitive" size="sm" tone="warning"><Lock :size="11" aria-hidden="true" />Sensitive</AppBadge>
            <AppBadge v-if="d.employeeEditable" size="sm" tone="info"><UserPen :size="11" aria-hidden="true" />Employee fills in</AppBadge>
          </div>
          <div class="flex gap-1">
            <AppButton size="sm" variant="ghost" :icon="ArrowUp" :aria-label="`Move ${d.label} up`" @click="move(d, -1)" />
            <AppButton size="sm" variant="ghost" :icon="ArrowDown" :aria-label="`Move ${d.label} down`" @click="move(d, 1)" />
            <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${d.label}`" @click="open(d)" />
            <AppButton size="sm" variant="ghost" :icon="Archive" :aria-label="`Archive ${d.label}`" @click="setArchived(d, true)" />
          </div>
        </li>
      </ul>
    </section>

    <AppSwitch v-model="showArchived" label="Show archived fields" />
    <section v-if="showArchived && archived.length" class="card overflow-hidden">
      <h2 class="border-b border-line/70 px-4 py-2.5 text-sm font-semibold text-fg-muted">Archived</h2>
      <ul class="divide-y divide-line/70">
        <li v-for="d in archived" :key="d.id" class="flex items-center gap-3 px-4 py-2.5">
          <p class="min-w-0 flex-1 truncate text-sm text-fg-muted">{{ d.label }} <span class="font-mono text-xs">{{ d.key }}</span></p>
          <AppButton size="sm" variant="ghost" :icon="RotateCcw" @click="setArchived(d, false)">Restore</AppButton>
        </li>
      </ul>
    </section>

    <AppModal :open="!!editing" :title="editing === 'new' ? 'Add custom field' : 'Edit custom field'" size="md" @close="editing = null">
      <form id="custom-field-form" class="space-y-4" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppInput v-model="form.label" label="Label" required :maxlength="80" placeholder="e.g. T-shirt size" :error="fieldErrors.label" />
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.key" label="Key" required :maxlength="40" :disabled="editing !== 'new'" help="Used in imports, exports and the API" :error="fieldErrors.key" @update:model-value="keyTouched = true" />
          <AppSelect v-model="form.type" label="Type" :options="typeOptions" :clearable="false" :disabled="editing !== 'new'" />
        </div>
        <label v-if="choices" class="block">
          <span class="label">Choices <span class="text-danger-fg">*</span></span>
          <textarea v-model="form.options" rows="4" class="input font-mono text-sm" placeholder="One per line" />
          <span v-if="fieldErrors.options" class="error-text">{{ fieldErrors.options }}</span>
        </label>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.section" label="Section (optional)" :maxlength="60" placeholder="e.g. Swag, Licences" />
          <AppInput v-model="form.helpText" label="Help text (optional)" :maxlength="200" />
        </div>
        <div class="space-y-2 rounded-lg p-3 ring-1 ring-line ring-inset">
          <AppCheckbox v-model="form.required" label="Required (HR must fill it in)" />
          <AppCheckbox v-model="form.employeeEditable" label="Employees can fill it in on their profile" />
          <AppCheckbox v-model="form.sensitive" label="Sensitive: only HR with access to bank and statutory details (and the employee) see it" />
        </div>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="editing = null">Cancel</AppButton>
        <AppButton type="submit" form="custom-field-form" :loading="saving" :disabled="!canSave">Save</AppButton>
      </template>
    </AppModal>
  </div>
</template>
