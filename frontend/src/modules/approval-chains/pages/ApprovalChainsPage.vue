<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronRight, Clock, GitBranch, Pencil, Plus, Trash2 } from '@lucide/vue';
import { APPROVAL_SUBJECT_LABELS, APPROVAL_SUBJECTS, type ApprovalSubject } from '@contracts';
import { approvalChainsApi, type ApprovalChainRow } from '@/modules/approval-chains/api/approval-chains.api';
import ChainEditorModal from '@/modules/approval-chains/components/ChainEditorModal.vue';
import { AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppPageHeader, AppSkeleton, AppTabs } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatMoney } from '@/shared/utils/format';

/** Approval chains (`approvals.configure`): which steps a kind of request goes through, and when. */
const feedback = useFeedbackStore();
const chains = useAsync(() => approvalChainsApi.list());
const tab = ref<ApprovalSubject>('LEAVE');
const tabs = computed(() => APPROVAL_SUBJECTS.map((s) => ({ key: s, label: APPROVAL_SUBJECT_LABELS[s], count: (chains.data.value ?? []).filter((c) => c.subject === s).length || null })));
const shown = computed(() => (chains.data.value ?? []).filter((c) => c.subject === tab.value));

const APPROVER: Record<string, string> = { MANAGER: 'Manager', SKIP_MANAGER: "Manager's manager", PERMISSION: 'Permission holders', USER: 'Named person' };
const who = (s: ApprovalChainRow['steps'][number]) => (s.approver === 'USER' ? (s.approverName ?? 'Named person') : s.approver === 'PERMISSION' ? `Holders of ${s.permission}` : APPROVER[s.approver]);
const when = (c: ApprovalChainRow) => {
  const parts = [c.conditions.minDays !== undefined && `${c.conditions.minDays}+ days`, c.conditions.minAmount !== undefined && `${formatMoney(c.conditions.minAmount)} or more`].filter(Boolean);
  return parts.length ? `When ${parts.join(' and ')}` : 'Every request';
};

const editing = ref<ApprovalChainRow | null>(null);
const editorOpen = ref(false);
function open(c: ApprovalChainRow | null) {
  editing.value = c;
  editorOpen.value = true;
}
async function saved() {
  editorOpen.value = false;
  feedback.success(editing.value ? 'Approval chain saved' : 'Approval chain created');
  await chains.run();
}
async function remove(c: ApprovalChainRow) {
  const ok = await feedback.confirm({ title: `Delete "${c.name}"?`, message: c.pending ? `${c.pending} request${c.pending === 1 ? '' : 's'} in progress finish with it; new requests use the next matching chain.` : 'New requests use the next matching chain, or the built-in approval.', confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  try {
    await approvalChainsApi.remove(c.id);
    feedback.success('Approval chain deleted');
    await chains.run();
  } catch (e) {
    feedback.error('Could not delete the chain', e);
  }
}
</script>

<template>
  <div>
    <AppPageHeader title="Approval chains" description="Multi-level approval for each kind of request. The first active chain that matches a request, in priority order, decides who approves it and how fast.">
      <template #actions><AppButton :icon="Plus" @click="open(null)">New chain</AppButton></template>
    </AppPageHeader>
    <AppTabs v-model="tab" class="mb-4" :tabs="tabs" />
    <AppErrorState v-if="chains.error.value" :error="chains.error.value" @retry="chains.run" />
    <AppSkeleton v-else-if="!chains.data.value" :lines="6" />
    <AppCard v-else-if="!shown.length" :padded="false">
      <AppEmptyState :icon="GitBranch" :title="`No chains for ${APPROVAL_SUBJECT_LABELS[tab].toLowerCase()}`" description="Requests use the built-in approval (for leave: the levels set on each leave type). Add a chain for more levels, deadlines and escalation.">
        <AppButton :icon="Plus" @click="open(null)">New chain</AppButton>
      </AppEmptyState>
    </AppCard>
    <div v-else class="space-y-3">
      <AppCard v-for="c in shown" :key="c.id" :padded="false">
        <div class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
          <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-muted text-xs font-semibold text-fg-muted tabular-nums" :title="`Priority ${c.priority}`">{{ c.priority }}</span>
          <div class="min-w-0 flex-1">
            <p class="font-medium text-fg">{{ c.name }}</p>
            <p class="text-xs text-fg-muted">{{ when(c) }}<template v-if="c.pending"> · {{ c.pending }} in progress</template></p>
          </div>
          <AppBadge :tone="c.isActive ? 'success' : 'neutral'" dot>{{ c.isActive ? 'Active' : 'Inactive' }}</AppBadge>
          <AppButton size="sm" variant="ghost" :icon="Pencil" @click="open(c)">Edit</AppButton>
          <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${c.name}`" @click="remove(c)" />
        </div>
        <ol class="flex flex-wrap items-center gap-2 px-4 py-3" :aria-label="`Steps of ${c.name}`">
          <template v-for="(s, i) in c.steps" :key="i">
            <li class="flex items-center gap-2 rounded-lg bg-surface-muted/60 px-3 py-2 ring-1 ring-line ring-inset">
              <span class="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-2xs font-semibold text-white">{{ i + 1 }}</span>
              <span>
                <span class="block text-sm font-medium text-fg">{{ s.label }}</span>
                <span class="block text-2xs text-fg-muted">{{ who(s) }}<template v-if="s.slaHours"> · <Clock :size="10" class="inline" aria-hidden="true" /> {{ s.slaHours }} h</template></span>
              </span>
            </li>
            <ChevronRight v-if="i < c.steps.length - 1" :size="15" class="text-fg-subtle" aria-hidden="true" />
          </template>
        </ol>
      </AppCard>
    </div>
    <ChainEditorModal :open="editorOpen" :chain="editing" :default-subject="tab" @close="editorOpen = false" @saved="saved" />
  </div>
</template>
