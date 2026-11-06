<script setup lang="ts">
import { ref } from 'vue';
import { Download, FileUp, Lock, Send } from '@lucide/vue';
import { GRIEVANCE_ATTACHMENT_MAX_BYTES } from '@contracts';
import { grievanceApi } from '@/modules/grievance/api/grievance.api';
import type { CaseDetail, CaseFile } from '@/modules/grievance/types';
import { fileSize } from '@/modules/grievance/utils/grievance-format';
import { AppBadge, AppButton, AppCard, AppCheckbox, AppTextarea } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

/** Messages and evidence of a case. Handlers can mark notes and files internal (hidden from the complainant). */
const props = defineProps<{ grievance: CaseDetail; canNote: boolean; canAttach: boolean }>();
const emit = defineEmits<{ updated: [c: CaseDetail] }>();

const feedback = useFeedbackStore();
const handler = props.grievance.role === 'HANDLER';
const body = ref('');
const internal = ref(false);
const sending = ref(false);
const uploading = ref(false);
const input = ref<HTMLInputElement | null>(null);

async function send() {
  if (!body.value.trim()) return;
  sending.value = true;
  try {
    emit('updated', await grievanceApi.addNote(props.grievance.id, body.value, handler && internal.value ? 'INTERNAL' : 'SHARED'));
    body.value = '';
    feedback.success(handler && internal.value ? 'Internal note added' : 'Message sent');
  } catch (e) {
    feedback.error('Could not send the message', e);
  } finally {
    sending.value = false;
  }
}
async function upload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  if (file.size > GRIEVANCE_ATTACHMENT_MAX_BYTES) {
    feedback.error('The file is too large', 'Files must be 5 MB or smaller.');
    return;
  }
  uploading.value = true;
  try {
    emit('updated', await grievanceApi.upload(props.grievance.id, file, handler && internal.value ? 'INTERNAL' : 'SHARED'));
    feedback.success('File added');
  } catch (err) {
    feedback.error('Could not add the file', err);
  } finally {
    uploading.value = false;
  }
}
async function download(f: CaseFile) {
  try {
    await grievanceApi.download(props.grievance.id, f);
  } catch (e) {
    feedback.error('Could not download the file', e);
  }
}
</script>

<template>
  <div class="space-y-6">
    <AppCard title="Messages" :description="handler ? 'Shared messages are seen by the complainant; internal notes are not.' : 'Your conversation with the people handling your case.'">
      <p v-if="!grievance.notes.length" class="text-sm text-fg-muted">No messages yet.</p>
      <ol v-else class="space-y-3">
        <li
          v-for="n in grievance.notes"
          :key="n.id"
          class="rounded-xl px-4 py-3 text-sm ring-1"
          :class="n.visibility === 'INTERNAL' ? 'bg-amber-50 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/30' : n.fromComplainant ? 'bg-surface-muted/60 ring-line' : 'bg-brand-50/60 ring-brand-200/60 dark:bg-brand-500/10 dark:ring-brand-500/20'"
        >
          <p class="mb-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span class="font-medium text-fg">{{ n.author }}</span>
            <span v-if="n.fromComplainant && handler">· complainant</span>
            <AppBadge v-if="n.visibility === 'INTERNAL'" size="sm" tone="warning">Internal</AppBadge>
            <span :title="formatDateTime(n.createdAt)">{{ timeAgo(n.createdAt) }}</span>
          </p>
          <p class="whitespace-pre-line text-fg">{{ n.body }}</p>
        </li>
      </ol>
      <form v-if="canNote" class="mt-4 space-y-3 border-t border-line pt-4" @submit.prevent="send">
        <AppTextarea v-model="body" :label="handler ? 'Add a message or note' : 'Message'" :rows="3" :maxlength="5000" />
        <div class="flex flex-wrap items-center justify-between gap-3">
          <AppCheckbox v-if="handler" v-model="internal" label="Internal — hidden from the complainant" />
          <span v-else />
          <AppButton type="submit" size="sm" :icon="internal && handler ? Lock : Send" :loading="sending" :disabled="!body.trim()">{{ internal && handler ? 'Add internal note' : 'Send' }}</AppButton>
        </div>
      </form>
    </AppCard>

    <AppCard title="Evidence" :description="`${grievance.attachments.length} file${grievance.attachments.length === 1 ? '' : 's'}`">
      <template v-if="canAttach" #actions>
        <AppButton size="sm" variant="secondary" :icon="FileUp" :loading="uploading" @click="input?.click()">{{ handler && internal ? 'Add internal file' : 'Add file' }}</AppButton>
        <input ref="input" type="file" class="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp" aria-label="Evidence file" @change="upload" />
      </template>
      <p v-if="!grievance.attachments.length" class="text-sm text-fg-muted">No files.</p>
      <ul v-else class="divide-y divide-line">
        <li v-for="f in grievance.attachments" :key="f.id" class="flex flex-wrap items-center gap-3 py-2 text-sm">
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-fg">{{ f.fileName }}</p>
            <p class="text-xs text-fg-muted">{{ fileSize(f.size) }} · {{ f.uploadedBy }} · {{ timeAgo(f.createdAt) }}</p>
          </div>
          <AppBadge v-if="f.visibility === 'INTERNAL'" size="sm" tone="warning">Internal</AppBadge>
          <AppButton size="sm" variant="ghost" :icon="Download" :aria-label="`Download ${f.fileName}`" @click="download(f)" />
        </li>
      </ul>
    </AppCard>
  </div>
</template>
