<script setup lang="ts">
import { computed, ref } from 'vue';
import { BadgeCheck, Check, CircleCheck, Circle, Clock, Eye, FileUp, MoreHorizontal, RotateCcw, SkipForward, Trash2, XCircle } from '@lucide/vue';
import { DOCUMENT_MAX_BYTES } from '@contracts';
import { onboardingApi } from '@/modules/onboarding/api/onboarding.api';
import type { CaseDetail, OnboardingTask } from '@/modules/onboarding/types';
import { ASSIGNEE_LABELS, PHASE_LABELS, TASK_STATE_LABELS, assigneeTone, phaseOf, taskStateTone } from '@/modules/onboarding/utils/onboarding-format';
import { AppBadge, AppButton, AppDropdown, AppEmptyState, AppMenuItem, AppModal, AppTextarea } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** The checklist of one onboarding case; actions are offered only to whoever may take them. */
const props = defineProps<{ detail: CaseDetail }>();
const emit = defineEmits<{ updated: [detail: CaseDetail] }>();

const feedback = useFeedbackStore();
const open = computed(() => props.detail.status === 'IN_PROGRESS');
const p = computed(() => props.detail.permissions);
const finished = (t: OnboardingTask) => t.state === 'DONE' || t.state === 'SKIPPED';

const canAct = (t: OnboardingTask) => open.value && (p.value.manage || (t.assignee === 'EMPLOYEE' && p.value.isSelf) || (t.assignee === 'MANAGER' && p.value.isManager));
const canUpload = (t: OnboardingTask) => open.value && !!t.documentCategory && (t.state === 'PENDING' || t.state === 'REJECTED') && (p.value.isSelf || p.value.manage);
const canVerify = (t: OnboardingTask) => open.value && p.value.verify && t.state === 'SUBMITTED';

const groups = computed(() => {
  const order = ['before', 'first-day', 'first-week', 'later'] as const;
  return order
    .map((key) => ({ key, label: PHASE_LABELS[key], tasks: props.detail.tasks.filter((t) => phaseOf(t.dueDate, props.detail.joiningDate) === key) }))
    .filter((g) => g.tasks.length);
});

const busy = ref<string | null>(null);
async function run(task: OnboardingTask, fn: () => Promise<CaseDetail>, success: string) {
  busy.value = task.id;
  try {
    emit('updated', await fn());
    feedback.success(success);
  } catch (e) {
    feedback.error('Could not update the task', e);
  } finally {
    busy.value = null;
  }
}

const fileInput = ref<HTMLInputElement | null>(null);
const uploadFor = ref<OnboardingTask | null>(null);
function chooseFile(task: OnboardingTask) {
  uploadFor.value = task;
  fileInput.value?.click();
}
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const task = uploadFor.value;
  if (!file || !task) return;
  if (file.size > DOCUMENT_MAX_BYTES) {
    feedback.error('This file is too large', 'Documents must be 10 MB or smaller.');
    return;
  }
  await run(task, () => onboardingApi.uploadDocument(task.id, file), p.value.isSelf ? 'Document uploaded. HR will verify it.' : 'Document uploaded');
}

async function view(task: OnboardingTask) {
  const tab = window.open('', '_blank');
  try {
    const blob = await onboardingApi.documentBlob(task.id);
    const url = URL.createObjectURL(new Blob([blob], { type: task.document?.contentType }));
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    feedback.error('Could not open the document', e);
  }
}

const noteFor = ref<{ task: OnboardingTask; action: 'skip' | 'reject' } | null>(null);
const note = ref('');
function askNote(task: OnboardingTask, action: 'skip' | 'reject') {
  noteFor.value = { task, action };
  note.value = '';
}
async function submitNote() {
  const n = noteFor.value!;
  noteFor.value = null;
  if (n.action === 'skip') await run(n.task, () => onboardingApi.skipTask(n.task.id, note.value), 'Task skipped');
  else await run(n.task, () => onboardingApi.verifyDocument(n.task.id, 'REJECTED', note.value), 'Document rejected; the employee has been notified');
}

async function remove(task: OnboardingTask) {
  if (!(await feedback.confirm({ title: `Remove "${task.title}"?`, message: 'The task is removed from this checklist.', confirmLabel: 'Remove', danger: true }))) return;
  await run(task, () => onboardingApi.removeTask(task.id), 'Task removed');
}
</script>

<template>
  <div>
    <AppEmptyState v-if="!detail.tasks.length" compact title="No tasks in this checklist" />
    <section v-for="g in groups" :key="g.key" class="mb-6 last:mb-0">
      <h3 class="mb-2 text-xs font-semibold tracking-wide text-fg-subtle uppercase">{{ g.label }}</h3>
      <ul class="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
        <li v-for="t in g.tasks" :key="t.id" class="flex flex-wrap items-start gap-3 bg-surface px-4 py-3" :class="finished(t) && 'bg-surface-muted/30'">
          <span class="mt-0.5 shrink-0" aria-hidden="true">
            <CircleCheck v-if="t.state === 'DONE'" :size="18" class="text-emerald-500" />
            <SkipForward v-else-if="t.state === 'SKIPPED'" :size="18" class="text-fg-subtle" />
            <Clock v-else-if="t.state === 'SUBMITTED'" :size="18" class="text-amber-500" />
            <XCircle v-else-if="t.state === 'REJECTED'" :size="18" class="text-red-500" />
            <Circle v-else :size="18" class="text-fg-subtle" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium" :class="finished(t) ? 'text-fg-muted line-through decoration-fg-subtle/50' : 'text-fg'">
              {{ t.title }}<span v-if="!t.isRequired" class="ml-1.5 text-xs font-normal text-fg-subtle no-underline">(optional)</span>
            </p>
            <p v-if="t.description" class="mt-0.5 text-xs text-fg-muted">{{ t.description }}</p>
            <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              <AppBadge :tone="assigneeTone[t.assignee]" size="sm">{{ ASSIGNEE_LABELS[t.assignee] }}</AppBadge>
              <AppBadge v-if="t.state !== 'PENDING'" :tone="taskStateTone[t.state]" size="sm" dot>{{ TASK_STATE_LABELS[t.state] }}</AppBadge>
              <span :class="t.overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-fg-subtle'">{{ t.overdue ? 'Overdue · ' : 'Due ' }}{{ formatDate(t.dueDate) }}</span>
              <span v-if="t.completedBy && finished(t)" class="text-fg-subtle">· {{ t.state === 'SKIPPED' ? 'Skipped' : 'Done' }} by {{ t.completedBy }}</span>
            </div>
            <p v-if="t.document" class="mt-1 text-xs text-fg-muted">
              {{ t.document.fileName }}<template v-if="t.document.status === 'REJECTED' && t.document.reviewNote"> · <span class="text-red-600 dark:text-red-400">“{{ t.document.reviewNote }}”</span></template>
            </p>
            <p v-if="t.note && finished(t)" class="mt-1 text-xs text-fg-muted italic">“{{ t.note }}”</p>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <AppButton v-if="canUpload(t)" size="sm" variant="secondary" :icon="FileUp" :loading="busy === t.id" @click="chooseFile(t)">{{ t.state === 'REJECTED' ? 'Upload again' : 'Upload' }}</AppButton>
            <template v-if="canVerify(t)">
              <AppButton size="sm" variant="secondary" :icon="Eye" @click="view(t)">View</AppButton>
              <AppButton size="sm" :icon="BadgeCheck" :loading="busy === t.id" @click="run(t, () => onboardingApi.verifyDocument(t.id, 'VERIFIED'), 'Document verified')">Verify</AppButton>
            </template>
            <AppButton v-else-if="!t.documentCategory && t.state === 'PENDING' && canAct(t)" size="sm" variant="secondary" :icon="Check" :loading="busy === t.id" @click="run(t, () => onboardingApi.completeTask(t.id), 'Task completed')">Mark done</AppButton>
            <AppDropdown v-if="(open && (p.manage || p.verify || canAct(t))) || t.document" label="Task actions" width="w-52">
              <template #trigger="{ toggle }">
                <AppButton size="sm" variant="ghost" :icon="MoreHorizontal" :aria-label="`More actions for ${t.title}`" @click="toggle" />
              </template>
              <template #default="{ close }">
                <AppMenuItem v-if="t.document && (p.isSelf || p.verify || p.manage)" :icon="Eye" @select="close(); view(t)">View document</AppMenuItem>
                <AppMenuItem v-if="canVerify(t)" :icon="XCircle" @select="close(); askNote(t, 'reject')">Reject document…</AppMenuItem>
                <AppMenuItem v-if="finished(t) && open && (t.state === 'SKIPPED' || t.documentCategory ? p.manage : canAct(t))" :icon="RotateCcw" @select="close(); run(t, () => onboardingApi.reopenTask(t.id), 'Task reopened')">Reopen</AppMenuItem>
                <AppMenuItem v-if="!finished(t) && open && p.manage" :icon="SkipForward" @select="close(); askNote(t, 'skip')">Skip…</AppMenuItem>
                <AppMenuItem v-if="open && p.manage" :icon="Trash2" danger @select="close(); remove(t)">Remove</AppMenuItem>
              </template>
            </AppDropdown>
          </div>
        </li>
      </ul>
    </section>
    <input ref="fileInput" type="file" class="sr-only" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" aria-label="Document file" @change="onFile" />

    <AppModal :open="!!noteFor" :title="noteFor?.action === 'skip' ? 'Skip task' : 'Reject document'" :description="noteFor?.task.title" size="sm" @close="noteFor = null">
      <AppTextarea v-model="note" :label="noteFor?.action === 'skip' ? 'Why is it skipped?' : 'Reason (shown to the employee)'" required :rows="3" :maxlength="500" />
      <template #footer>
        <AppButton variant="secondary" @click="noteFor = null">Cancel</AppButton>
        <AppButton :variant="noteFor?.action === 'reject' ? 'danger' : 'primary'" :disabled="note.trim().length < 3" @click="submitNote">{{ noteFor?.action === 'skip' ? 'Skip task' : 'Reject' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>
