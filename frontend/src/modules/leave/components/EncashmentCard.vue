<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { Banknote, XCircle } from '@lucide/vue';
import type { LeaveEncashmentStatus } from '@contracts';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { Encashment, EncashmentOption } from '@/modules/leave/types';
import { formatDays } from '@/modules/leave/utils/leave-format';
import { rupees } from '@/modules/payroll/utils/payroll-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppInput, AppModal, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Paid for unused leave: what can be encashed now, asking for it, and past requests (paid with the next salary). */
const emit = defineEmits<{ changed: [] }>();
const feedback = useFeedbackStore();
const options = useAsync(() => leaveApi.encashmentOptions());
const requests = useAsync(() => leaveApi.encashments({ view: 'mine', pageSize: 5 }));
const types = computed(() => options.data.value?.types ?? []);

const STATUS: Record<LeaveEncashmentStatus, { label: string; tone: 'warning' | 'brand' | 'success' | 'danger' | 'neutral' }> = {
  PENDING: { label: 'Waiting for HR', tone: 'warning' },
  APPROVED: { label: 'Paid with next salary', tone: 'brand' },
  PAID: { label: 'Paid', tone: 'success' },
  REJECTED: { label: 'Not approved', tone: 'danger' },
  CANCELLED: { label: 'Withdrawn', tone: 'neutral' },
};
const limitText = (o: EncashmentOption) =>
  [o.keep ? `keep ${formatDays(o.keep)}` : null, o.yearlyLimit !== null ? `${formatDays(o.yearlyLimit)} a year (${formatDays(o.usedThisYear)} used)` : null].filter(Boolean).join(' · ');

const picked = ref<EncashmentOption | null>(null);
const form = reactive({ days: '' as string | number, reason: '' });
const { fieldErrors, formError, handle, reset } = useFormErrors();
function ask(o: EncashmentOption) {
  reset();
  picked.value = o;
  Object.assign(form, { days: o.max, reason: '' });
}
const saving = ref(false);
async function submit() {
  if (!picked.value) return;
  reset();
  saving.value = true;
  try {
    await leaveApi.requestEncashment({ leaveTypeId: picked.value.leaveType.id, days: Number(form.days), reason: form.reason || null });
    feedback.success('Encashment requested', 'HR has been notified.');
    picked.value = null;
    await Promise.all([options.run(), requests.run()]);
  } catch (e) {
    handle(e, 'Could not send the request');
  } finally {
    saving.value = false;
  }
}
async function withdraw(r: Encashment) {
  try {
    await leaveApi.cancelEncashment(r.id);
    feedback.success('Request withdrawn');
    await Promise.all([options.run(), requests.run()]);
    emit('changed');
  } catch (e) {
    feedback.error('Could not withdraw the request', e);
  }
}
</script>

<template>
  <AppCard v-if="types.length || requests.data.value?.items.length" title="Encash leave" :icon="Banknote" :padded="false">
    <p class="px-4 pt-3 text-xs text-fg-muted">Ask to be paid for unused days. Once HR approves, the days leave your balance and are paid with your next salary (taxable).</p>
    <ul v-if="types.length" class="mt-2 divide-y divide-line/70" aria-label="Leave you can encash">
      <li v-for="o in types" :key="o.leaveType.id" class="flex items-center gap-3 px-4 py-2.5">
        <span class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: o.leaveType.color }" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-fg">{{ o.leaveType.name }}</p>
          <p class="text-xs text-fg">{{ o.max > 0 ? `Up to ${formatDays(o.max)} now` : o.blocked }} <span class="text-fg-muted">of {{ formatDays(o.available) }}</span></p>
          <p v-if="limitText(o)" class="text-2xs text-fg-muted">{{ limitText(o) }}</p>
        </div>
        <AppButton size="sm" variant="secondary" :disabled="o.max <= 0" @click="ask(o)">Encash</AppButton>
      </li>
    </ul>
    <ul v-if="requests.data.value?.items.length" class="divide-y divide-line/70 border-t border-line/70" aria-label="Your encashment requests">
      <li v-for="r in requests.data.value.items" :key="r.id" class="flex items-center gap-3 px-4 py-2.5">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm text-fg">{{ r.leaveType?.name }} · {{ formatDays(r.days) }}</p>
          <p class="truncate text-xs text-fg-muted">
            <template v-if="r.status === 'PAID' && r.amount !== null">{{ rupees(r.amount) }} paid {{ formatDate(r.paidAt) }}</template>
            <template v-else-if="r.status === 'REJECTED' && r.reviewNote">“{{ r.reviewNote }}”</template>
            <template v-else>Asked {{ formatDate(r.createdAt) }}</template>
          </p>
        </div>
        <AppBadge size="sm" :tone="STATUS[r.status].tone" dot>{{ STATUS[r.status].label }}</AppBadge>
        <AppButton v-if="r.permissions.cancel" size="xs" variant="ghost" :icon="XCircle" :aria-label="`Withdraw encashment of ${r.leaveType?.name}`" @click="withdraw(r)" />
      </li>
    </ul>

    <AppModal :open="!!picked" :title="picked ? `Encash ${picked.leaveType.name}` : 'Encash leave'" :description="picked ? `Up to ${formatDays(picked.max)} now` : undefined" size="sm" dialog :guide="false" @close="picked = null">
      <form id="encash-form" class="space-y-4" novalidate @submit.prevent="submit">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppInput v-model="form.days" label="Days to encash" type="number" :min="0.5" :max="picked?.max" :step="0.5" required :error="fieldErrors.days" />
        <AppTextarea v-model="form.reason" label="Reason (optional)" :rows="2" :maxlength="500" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="picked = null">Cancel</AppButton>
        <AppButton type="submit" form="encash-form" :loading="saving" :disabled="!(Number(form.days) > 0)">Send to HR</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
