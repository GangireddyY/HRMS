<script setup lang="ts">
import { ref, watch } from 'vue';
import { FileUp } from '@lucide/vue';
import { FILING_FILE_MAX_BYTES } from '@contracts';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import type { CalendarItem } from '@/modules/compliance/types';
import { localIso } from '@/modules/compliance/utils/compliance-format';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { formatDate } from '@/shared/utils/format';

/** Records that a due date was filed / paid, with the reference number and optionally the receipt. */
const props = defineProps<{ item: CalendarItem | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const today = localIso(new Date());
const completedOn = ref<string | undefined>(today);
const reference = ref('');
const note = ref('');
const file = ref<File | null>(null);
const input = ref<HTMLInputElement | null>(null);
const saving = ref(false);
watch(
  () => props.item,
  (i) => {
    if (!i) return;
    reset();
    completedOn.value = today;
    reference.value = '';
    note.value = '';
    file.value = null;
  },
);
function pick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  if (f.size > FILING_FILE_MAX_BYTES) {
    fieldErrors.value = { ...fieldErrors.value, file: 'The file must be 5 MB or smaller' };
    return;
  }
  fieldErrors.value = { ...fieldErrors.value, file: '' };
  file.value = f;
}
async function save() {
  if (!props.item || !completedOn.value) return;
  reset();
  saving.value = true;
  try {
    await complianceApi.file(props.item.obligation.id, { dueOn: props.item.dueOn, completedOn: completedOn.value, reference: reference.value || null, note: note.value || null }, file.value);
    emit('saved');
  } catch (e) {
    handle(e, 'Could not record the filing');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="!!item" :title="item ? `Mark filed · ${item.obligation.title}` : ''" :description="item ? `Due ${formatDate(item.dueOn)}${item.obligation.authority ? ` · ${item.obligation.authority}` : ''}` : undefined" @close="emit('close')">
    <form id="filing-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppDatePicker v-model="completedOn" label="Filed / paid on" required :max="today" :error="fieldErrors.completedOn" />
        <AppInput v-model="reference" label="Reference" :maxlength="120" placeholder="Challan or acknowledgement no." :error="fieldErrors.reference" />
      </div>
      <AppTextarea v-model="note" label="Note" :rows="2" :maxlength="1000" />
      <div>
        <p class="label">Receipt</p>
        <button type="button" class="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-line px-4 py-3 text-start transition hover:border-brand-400" @click="input?.click()">
          <FileUp :size="18" class="text-fg-subtle" aria-hidden="true" />
          <span class="text-sm" :class="file ? 'font-medium text-fg' : 'text-fg-muted'">{{ file ? file.name : 'PDF, PNG, JPG or WebP, up to 5 MB' }}</span>
        </button>
        <input ref="input" type="file" class="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp" aria-label="Receipt file" @change="pick" />
        <p v-if="fieldErrors.file" class="error-text" role="alert">{{ fieldErrors.file }}</p>
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="filing-form" :loading="saving" :disabled="!completedOn">Save</AppButton>
    </template>
  </AppModal>
</template>
