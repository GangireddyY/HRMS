<script setup lang="ts">
import { computed, ref } from 'vue';
import { Lock, ListPlus, Pencil } from '@lucide/vue';
import type { CustomFieldValue } from '@contracts';
import { ApiError } from '@/core/http/http-client';
import { customFieldsApi } from '@/modules/people/api/people.api';
import { bySection, customFieldText } from '@/modules/people/utils/custom-fields';
import { AppAlert, AppButton, AppCard, AppCheckbox, AppDatePicker, AppErrorState, AppInput, AppModal, AppMultiPick, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** The organization's custom fields on a profile (HR's view of an employee, or the employee's own with `me`). */
const props = defineProps<{ employeeId: string | 'me' }>();
const feedback = useFeedbackStore();
const fields = useAsync(() => customFieldsApi.values(props.employeeId));
const sections = computed(() => bySection(fields.data.value ?? []));
/** No employee record (e.g. an admin without one): nothing to show. */
const missing = computed(() => fields.error.value instanceof ApiError && fields.error.value.status === 404);
const editable = computed(() => (fields.data.value ?? []).filter((f) => f.editable));

const open = ref(false);
const draft = ref<Record<string, CustomFieldValue>>({});
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
function edit() {
  reset();
  draft.value = Object.fromEntries(editable.value.map((f) => [f.key, f.type === 'MULTI_SELECT' ? ((f.value as string[] | null) ?? []) : f.type === 'BOOLEAN' ? f.value === true : (f.value ?? (f.type === 'DATE' ? undefined : ''))])) as Record<string, CustomFieldValue>;
  open.value = true;
}
const text = (key: string) => draft.value[key] as string | number | null;
const choice = (key: string) => (draft.value[key] as string | null) ?? null;
const put = (key: string, v: CustomFieldValue | undefined) => (draft.value[key] = v ?? null);
const date = (key: string) => (draft.value[key] as string | undefined) ?? undefined;
const many = (key: string) => (draft.value[key] as string[]) ?? [];
async function save() {
  reset();
  saving.value = true;
  try {
    fields.data.value = await customFieldsApi.setValues(props.employeeId, draft.value);
    open.value = false;
    feedback.success('Details saved');
  } catch (e) {
    handle(e, 'Could not save the details');
  } finally {
    saving.value = false;
  }
}
const options = (list: string[]) => list.map((o) => ({ value: o, label: o }));
</script>

<template>
  <AppCard v-if="!missing && (fields.loading.value || fields.error.value || (fields.data.value?.length ?? 0) > 0)" title="Additional details" :icon="ListPlus" description="Fields your organization keeps for everyone.">
    <template v-if="editable.length" #actions><AppButton size="sm" variant="secondary" :icon="Pencil" @click="edit">Edit</AppButton></template>
    <AppSkeleton v-if="fields.loading.value && !fields.data.value" :lines="3" />
    <AppErrorState v-else-if="fields.error.value" :error="fields.error.value" @retry="fields.run" />
    <div v-else class="space-y-5">
      <section v-for="g in sections" :key="g.section">
        <h3 v-if="sections.length > 1" class="mb-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">{{ g.section }}</h3>
        <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div v-for="f in g.fields" :key="f.key" class="min-w-0">
            <dt class="text-xs text-fg-muted">{{ f.label }}<span v-if="f.required" class="text-danger-fg"> *</span></dt>
            <dd class="mt-0.5 text-sm break-words text-fg">
              <span v-if="f.hidden" class="inline-flex items-center gap-1 text-fg-subtle"><Lock :size="12" aria-hidden="true" />Restricted</span>
              <a v-else-if="f.type === 'URL' && f.value" :href="String(f.value)" target="_blank" rel="noopener noreferrer" class="text-accent-fg hover:underline">{{ f.value }}</a>
              <template v-else>{{ customFieldText(f.type, f.value) }}</template>
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <AppModal :open="open" title="Edit additional details" size="md" @close="open = false">
      <form id="custom-fields-form" class="space-y-4" novalidate @submit.prevent="save">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <template v-for="f in editable" :key="f.key">
          <AppCheckbox v-if="f.type === 'BOOLEAN'" :model-value="draft[f.key] === true" :label="f.label" @update:model-value="(v: boolean) => (draft[f.key] = v)" />
          <AppSelect v-else-if="f.type === 'SELECT'" :model-value="choice(f.key)" :label="f.label" :required="f.required" :options="options(f.options)" :help="f.helpText ?? undefined" :error="fieldErrors[f.key]" @update:model-value="(v) => put(f.key, v)" />
          <AppMultiPick v-else-if="f.type === 'MULTI_SELECT'" :model-value="many(f.key)" :label="f.label" :options="options(f.options)" :help="f.helpText ?? undefined" :error="fieldErrors[f.key]" @update:model-value="(v: string[]) => put(f.key, v)" />
          <AppDatePicker v-else-if="f.type === 'DATE'" :model-value="date(f.key)" :label="f.label" :required="f.required" :error="fieldErrors[f.key]" @update:model-value="(v) => put(f.key, v)" />
          <AppTextarea v-else-if="f.type === 'LONG_TEXT'" :model-value="String(text(f.key) ?? '')" :label="f.label" :required="f.required" :rows="3" :maxlength="4000" :help="f.helpText ?? undefined" :error="fieldErrors[f.key]" @update:model-value="(v) => put(f.key, v)" />
          <AppInput
            v-else
            :model-value="text(f.key)"
            :label="f.label"
            :required="f.required"
            :type="f.type === 'NUMBER' ? 'number' : f.type === 'EMAIL' ? 'email' : f.type === 'URL' ? 'url' : 'text'"
            :maxlength="500"
            :help="f.helpText ?? undefined"
            :error="fieldErrors[f.key]"
            @update:model-value="(v) => put(f.key, v)"
          />
        </template>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton type="submit" form="custom-fields-form" :loading="saving">Save</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
