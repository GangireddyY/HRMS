<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { BadgeCheck, Download, Eye, FileImage, FileText, FolderOpen, MoreHorizontal, Pencil, Trash2, Upload, XCircle } from '@lucide/vue';
import { documentsApi } from '@/modules/people/api/people.api';
import DocumentUploadModal from '@/modules/people/components/DocumentUploadModal.vue';
import type { EmployeeDocument } from '@/modules/people/types';
import { DOCUMENT_CATEGORY_LABELS, DOCUMENT_STATUS_LABELS, documentStatusTone, formatBytes } from '@/modules/people/utils/labels';
import { AppBadge, AppButton, AppCard, AppDropdown, AppEmptyState, AppErrorState, AppMenuItem, AppModal, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/**
 * Employee documents. On the employee's own profile (`selfService`) they upload documents for HR to verify and can
 * change their unverified uploads; HR with employee.document.manage uploads, verifies, rejects, edits and deletes.
 */
const props = defineProps<{ employeeId: string; selfService: boolean }>();

const auth = useAuthStore();
const feedback = useFeedbackStore();
const docs = useAsync(() => documentsApi.list(props.employeeId));
watch(() => props.employeeId, () => void docs.run());

const canManage = computed(() => !props.selfService && auth.can('employee.document.manage'));
const canUpload = computed(() => canManage.value || (props.selfService && auth.can('self.profile.update')));
const canChange = (d: EmployeeDocument) => canManage.value || (props.selfService && d.uploadedById === auth.user?.id && d.status !== 'VERIFIED' && auth.can('self.profile.update'));

const today = new Date().toISOString().slice(0, 10);
const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const expiry = (d: EmployeeDocument) => (!d.expiryDate ? null : d.expiryDate < today ? 'expired' : d.expiryDate <= soon ? 'soon' : 'ok');

const modalOpen = ref(false);
const editing = ref<EmployeeDocument | null>(null);
function openUpload(doc: EmployeeDocument | null = null) {
  editing.value = doc;
  modalOpen.value = true;
}
async function onSaved() {
  feedback.success(editing.value ? 'Document updated' : props.selfService ? 'Document uploaded. HR will verify it.' : 'Document uploaded');
  modalOpen.value = false;
  await docs.run();
}

const busy = ref<string | null>(null);
async function view(doc: EmployeeDocument) {
  busy.value = doc.id;
  const tab = window.open('', '_blank');
  try {
    const blob = await documentsApi.blob(props.employeeId, doc.id);
    const url = URL.createObjectURL(new Blob([blob], { type: doc.contentType }));
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    feedback.error('Could not open the document', e);
  } finally {
    busy.value = null;
  }
}
async function download(doc: EmployeeDocument) {
  try {
    await documentsApi.download(props.employeeId, doc);
  } catch (e) {
    feedback.error('Could not download the document', e);
  }
}
async function remove(doc: EmployeeDocument) {
  if (!(await feedback.confirm({ title: `Delete "${doc.title}"?`, message: 'The file is removed permanently.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await documentsApi.remove(props.employeeId, doc.id);
    feedback.success('Document deleted');
    await docs.run();
  } catch (e) {
    feedback.error('Could not delete the document', e);
  }
}

const reviewing = ref<EmployeeDocument | null>(null);
const rejectNote = ref('');
async function verify(doc: EmployeeDocument) {
  try {
    await documentsApi.review(props.employeeId, doc.id, 'VERIFIED');
    feedback.success('Document verified');
    await docs.run();
  } catch (e) {
    feedback.error('Could not verify the document', e);
  }
}
async function reject() {
  const doc = reviewing.value!;
  busy.value = doc.id;
  try {
    await documentsApi.review(props.employeeId, doc.id, 'REJECTED', rejectNote.value);
    feedback.success('Document rejected', 'The employee has been notified.');
    reviewing.value = null;
    await docs.run();
  } catch (e) {
    feedback.error('Could not reject the document', e);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <AppCard title="Documents" :description="selfService ? 'Identity proofs, certificates and letters. HR verifies what you upload.' : 'Identity proofs, certificates, letters and contracts.'" :icon="FolderOpen">
    <template v-if="canUpload" #actions>
      <AppButton size="sm" variant="secondary" :icon="Upload" @click="openUpload()">Upload</AppButton>
    </template>
    <AppSkeleton v-if="docs.loading.value && !docs.data.value" :lines="3" />
    <AppErrorState v-else-if="docs.error.value" :error="docs.error.value" @retry="docs.run" />
    <AppEmptyState v-else-if="!docs.data.value?.length" compact :icon="FolderOpen" title="No documents yet" />
    <ul v-else class="divide-y divide-line">
      <li v-for="d in docs.data.value" :key="d.id" class="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
        <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg-muted" aria-hidden="true">
          <FileText v-if="d.contentType === 'application/pdf'" class="h-4.5 w-4.5" />
          <FileImage v-else class="h-4.5 w-4.5" />
        </span>
        <div class="min-w-0 flex-1 text-sm">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button type="button" class="truncate text-left font-medium text-fg hover:text-brand-600 hover:underline dark:hover:text-brand-400" :disabled="busy === d.id" @click="view(d)">{{ d.title }}</button>
            <AppBadge :tone="documentStatusTone[d.status]" size="sm" dot>{{ DOCUMENT_STATUS_LABELS[d.status] }}</AppBadge>
            <AppBadge v-if="expiry(d) === 'expired'" tone="danger" size="sm">Expired {{ formatDate(d.expiryDate) }}</AppBadge>
            <AppBadge v-else-if="expiry(d) === 'soon'" tone="warning" size="sm">Expires {{ formatDate(d.expiryDate) }}</AppBadge>
          </div>
          <p class="mt-0.5 truncate text-xs text-fg-muted">
            {{ DOCUMENT_CATEGORY_LABELS[d.category] }} · {{ formatBytes(d.byteSize) }}<template v-if="expiry(d) === 'ok'"> · Expires {{ formatDate(d.expiryDate) }}</template>
            · {{ d.uploadedBy ? `Uploaded by ${d.uploadedBy}` : 'Uploaded' }} {{ formatDate(d.createdAt) }}
          </p>
          <p v-if="d.status === 'REJECTED' && d.reviewNote" class="mt-1 text-xs text-red-600 dark:text-red-400">Rejected{{ d.reviewedBy ? ` by ${d.reviewedBy}` : '' }}: “{{ d.reviewNote }}”</p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <template v-if="canManage && d.status === 'PENDING'">
            <AppButton size="sm" variant="secondary" :icon="BadgeCheck" @click="verify(d)">Verify</AppButton>
          </template>
          <AppDropdown label="Document actions" width="w-48">
            <template #trigger="{ toggle }">
              <AppButton size="sm" variant="ghost" :icon="MoreHorizontal" :aria-label="`Actions for ${d.title}`" @click="toggle" />
            </template>
            <template #default="{ close }">
              <AppMenuItem :icon="Eye" @select="close(); view(d)">View</AppMenuItem>
              <AppMenuItem :icon="Download" @select="close(); download(d)">Download</AppMenuItem>
              <AppMenuItem v-if="canManage && d.status === 'PENDING'" :icon="XCircle" @select="close(); reviewing = d; rejectNote = ''">Reject…</AppMenuItem>
              <AppMenuItem v-if="canChange(d)" :icon="Pencil" @select="close(); openUpload(d)">Edit details</AppMenuItem>
              <AppMenuItem v-if="canChange(d)" :icon="Trash2" danger @select="close(); remove(d)">Delete</AppMenuItem>
            </template>
          </AppDropdown>
        </div>
      </li>
    </ul>

    <DocumentUploadModal :open="modalOpen" :employee-id="employeeId" :document="editing" :self-service="selfService" @close="modalOpen = false" @saved="onSaved" />
    <AppModal :open="!!reviewing" :title="`Reject “${reviewing?.title ?? ''}”?`" description="The employee is notified with your reason and can upload a corrected document." size="sm" @close="reviewing = null">
      <AppTextarea v-model="rejectNote" label="Reason" required :rows="3" :maxlength="500" placeholder="e.g. The scan is unreadable; please upload a clearer copy." />
      <template #footer>
        <AppButton variant="secondary" @click="reviewing = null">Cancel</AppButton>
        <AppButton variant="danger" :loading="busy === reviewing?.id" :disabled="!rejectNote.trim()" @click="reject">Reject document</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
