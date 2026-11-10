<script setup lang="ts">
import { reactive, ref } from 'vue';
import { Banknote, Check, X } from '@lucide/vue';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { Encashment } from '@/modules/leave/types';
import { formatDays } from '@/modules/leave/utils/leave-format';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppErrorState, AppModal, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { timeAgo } from '@/shared/utils/format';

/** Leave encashment requests for HR: approve (the days leave the balance; payroll pays them) or decline. */
const emit = defineEmits<{ changed: [] }>();
const feedback = useFeedbackStore();
const list = useAsync(() => leaveApi.encashments({ view: 'all', pageSize: 20 }));
const decision = reactive({ request: null as Encashment | null, mode: 'approve' as 'approve' | 'reject', note: '', error: '' });
function open(r: Encashment, mode: 'approve' | 'reject') {
  Object.assign(decision, { request: r, mode, note: '', error: '' });
}
const saving = ref(false);
async function decide() {
  const r = decision.request!;
  saving.value = true;
  decision.error = '';
  try {
    await (decision.mode === 'approve' ? leaveApi.approveEncashment(r.id, decision.note || undefined) : leaveApi.rejectEncashment(r.id, decision.note));
    feedback.success(decision.mode === 'approve' ? 'Encashment approved' : 'Encashment declined', r.employee?.name);
    decision.request = null;
    await list.run();
    emit('changed');
  } catch (e) {
    decision.error = e instanceof Error ? e.message : 'Something went wrong';
  } finally {
    saving.value = false;
  }
}
const STATUS = { PENDING: ['Waiting', 'warning'], APPROVED: ['To be paid', 'brand'], PAID: ['Paid', 'success'], REJECTED: ['Declined', 'danger'], CANCELLED: ['Withdrawn', 'neutral'] } as const;
</script>

<template>
  <AppCard v-if="list.error.value || list.data.value?.items.length" title="Encashment requests" :icon="Banknote" :padded="false" description="Approved days leave the balance and are paid with the next payroll run.">
    <AppErrorState v-if="list.error.value" :error="list.error.value" @retry="list.run" />
    <AppSkeleton v-else-if="list.loading.value && !list.data.value" class="p-4" :lines="2" />
    <ul v-else class="divide-y divide-line/70">
      <li v-for="r in list.data.value!.items" :key="r.id" class="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <AppAvatar :name="r.employee?.name ?? '?'" size="sm" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-fg">{{ r.employee?.name }} <span class="font-normal text-fg-muted">· {{ formatDays(r.days) }} of {{ r.leaveType?.name }}</span></p>
          <p class="truncate text-xs text-fg-muted">{{ r.reason ?? 'No reason given' }} · {{ timeAgo(r.createdAt) }}{{ r.amount !== null ? ` · ${rupees(r.amount)}` : '' }}</p>
        </div>
        <AppBadge size="sm" :tone="STATUS[r.status][1]" dot>{{ STATUS[r.status][0] }}</AppBadge>
        <template v-if="r.permissions.review">
          <AppButton size="sm" variant="ghost" :icon="X" @click="open(r, 'reject')">Decline</AppButton>
          <AppButton size="sm" :icon="Check" @click="open(r, 'approve')">Approve</AppButton>
        </template>
      </li>
    </ul>

    <AppModal
      :open="!!decision.request"
      dialog
      :title="decision.mode === 'approve' ? 'Approve encashment' : 'Decline encashment'"
      :description="decision.request ? `${decision.request.employee?.name}: ${formatDays(decision.request.days)} of ${decision.request.leaveType?.name}` : undefined"
      @close="decision.request = null"
    >
      <form id="encash-decision" class="space-y-4" novalidate @submit.prevent="decide">
        <AppAlert v-if="decision.error">{{ decision.error }}</AppAlert>
        <AppTextarea v-model="decision.note" :label="decision.mode === 'approve' ? 'Note (optional)' : 'Why not?'" :required="decision.mode === 'reject'" :rows="2" :maxlength="500" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="decision.request = null">Cancel</AppButton>
        <AppButton type="submit" form="encash-decision" :variant="decision.mode === 'reject' ? 'danger' : 'primary'" :loading="saving" :disabled="decision.mode === 'reject' && decision.note.trim().length < 3">{{
          decision.mode === 'approve' ? 'Approve' : 'Decline'
        }}</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
