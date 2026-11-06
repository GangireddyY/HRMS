<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { FileUp } from '@lucide/vue';
import { DOCUMENT_MAX_BYTES, type DocumentCategory } from '@contracts';
import { documentsApi } from '@/modules/people/api/people.api';
import type { EmployeeDocument } from '@/modules/people/types';
import { documentCategoryOptions, formatBytes } from '@/modules/people/utils/labels';
import { AppAlert, AppButton, AppDatePicker, AppInput, AppModal, AppSelect } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Upload a new document, or edit the title / category / expiry of an existing one. */
const props = defineProps<{ open: boolean; employeeId: string; document: EmployeeDocument | null; selfService: boolean }>();
const emit = defineEmits<{ close: []; saved: [doc: EmployeeDocument] }>();

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const file = ref<File | null>(null);
const input = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const form = reactive({ category: null as DocumentCategory | null, title: '', expiryDate: undefined as string | undefined });

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    file.value = null;
    Object.assign(form, { category: props.document?.category ?? null, title: props.document?.title ?? '', expiryDate: props.document?.expiryDate ?? undefined });
  },
  { immediate: true },
);

function pick(f: File | null | undefined) {
  if (!f) return;
  reset();
  if (f.size > DOCUMENT_MAX_BYTES) {
    fieldErrors.value = { ...fieldErrors.value, file: 'Documents must be 10 MB or smaller' };
    return;
  }
  file.value = f;
  if (!form.title) form.title = f.name.replace(/\.[^.]+$/, '').slice(0, 200);
}
function onDrop(e: DragEvent) {
  dragging.value = false;
  pick(e.dataTransfer?.files?.[0]);
}

const canSave = computed(() => !!form.category && form.title.trim().length >= 2 && (!!props.document || !!file.value));

async function save() {
  reset();
  saving.value = true;
  const body = { category: form.category!, title: form.title, expiryDate: form.expiryDate ?? null };
  try {
    emit('saved', props.document ? await documentsApi.update(props.employeeId, props.document.id, body) : await documentsApi.upload(props.employeeId, file.value!, body));
  } catch (e) {
    handle(e, props.document ? 'Could not save the document' : 'Could not upload the document');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="document ? 'Edit document' : 'Upload document'" :description="document ? undefined : 'PDF, PNG, JPG or WebP, up to 10 MB.'" @close="emit('close')">
    <form id="document-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppAlert v-if="!document && selfService" tone="info">HR will verify the document after you upload it.</AppAlert>
      <div v-if="!document">
        <button
          type="button"
          class="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors"
          :class="dragging ? 'border-brand-500 bg-brand-500/5' : fieldErrors.file ? 'border-red-500/60' : 'border-line hover:border-brand-400 hover:bg-surface-muted/50'"
          @click="input?.click()"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <FileUp class="h-6 w-6 text-fg-subtle" aria-hidden="true" />
          <span v-if="file" class="text-sm font-medium text-fg">{{ file.name }} <span class="font-normal text-fg-muted">· {{ formatBytes(file.size) }}</span></span>
          <span v-else class="text-sm text-fg-muted"><span class="font-medium text-brand-600 dark:text-brand-400">Choose a file</span> or drag it here</span>
        </button>
        <input ref="input" type="file" class="sr-only" :accept="ACCEPT" aria-label="Document file" @change="pick(($event.target as HTMLInputElement).files?.[0]); ($event.target as HTMLInputElement).value = ''" />
        <p v-if="fieldErrors.file" class="error-text" role="alert">{{ fieldErrors.file }}</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <AppSelect v-model="form.category" label="Category" required :options="documentCategoryOptions" :error="fieldErrors.category" />
        <AppDatePicker v-model="form.expiryDate" label="Expires on" placeholder="Doesn't expire" :error="fieldErrors.expiryDate" />
      </div>
      <AppInput v-model="form.title" label="Title" required placeholder="e.g. Passport" :error="fieldErrors.title" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="document-form" :loading="saving" :disabled="!canSave">{{ document ? 'Save changes' : 'Upload' }}</AppButton>
    </template>
  </AppModal>
</template>
