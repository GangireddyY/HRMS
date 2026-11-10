<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { CalendarHeart, XCircle } from '@lucide/vue';
import { leaveApi } from '@/modules/leave/api/leave.api';
import type { CompOffEligibility, CompOffRequest } from '@/modules/leave/types';
import { LEAVE_STATUS_LABELS, formatDays, leaveStatusTone } from '@/modules/leave/utils/leave-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppModal, AppSegmented, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Worked a holiday or weekly off? Ask for the day back; approved days land in the comp-off balance. */
const emit = defineEmits<{ changed: [] }>();
const feedback = useFeedbackStore();
const eligibility = useAsync(() => leaveApi.compOffEligible());
const requests = useAsync(() => leaveApi.compOffs({ view: 'mine', pageSize: 5 }));

const claimable = computed(() => (eligibility.data.value?.days ?? []).filter((d) => !d.request));
const hours = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
const describe = (d: { kind: string; label: string | null }) => (d.kind === 'HOLIDAY' ? (d.label ?? 'Holiday') : 'Weekly off');

const open = ref(false);
const day = ref<CompOffEligibility['days'][number] | null>(null);
const form = reactive({ amount: 'full' as 'full' | 'half', reason: '' });
const saving = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const dayOptions = computed(() => [...(day.value?.maxDays === 1 ? [{ value: 'full' as const, label: 'Full day' }] : []), { value: 'half' as const, label: 'Half day' }]);

function ask(d: CompOffEligibility['days'][number]) {
  reset();
  day.value = d;
  Object.assign(form, { amount: d.maxDays === 1 ? 'full' : 'half', reason: '' });
  open.value = true;
}

async function submit() {
  if (!day.value) return;
  reset();
  saving.value = true;
  try {
    await leaveApi.requestCompOff({ workDate: day.value.date, days: form.amount === 'full' ? 1 : 0.5, reason: form.reason });
    open.value = false;
    feedback.success('Comp-off requested', 'Your manager has been notified.');
    await Promise.all([eligibility.run(), requests.run()]);
  } catch (e) {
    handle(e, 'Could not request comp-off');
  } finally {
    saving.value = false;
  }
}

async function withdraw(r: CompOffRequest) {
  try {
    await leaveApi.cancelCompOff(r.id);
    feedback.success('Request withdrawn');
    await Promise.all([eligibility.run(), requests.run()]);
    emit('changed');
  } catch (e) {
    feedback.error('Could not withdraw the request', e);
  }
}
</script>

<template>
  <AppCard v-if="eligibility.error.value || eligibility.data.value?.enabled" title="Comp-off" :icon="CalendarHeart" :padded="false">
    <AppErrorState v-if="eligibility.error.value" :error="eligibility.error.value" @retry="eligibility.run" />
    <template v-else-if="eligibility.data.value">
      <p class="px-4 pt-3 text-xs text-fg-muted">
        Worked on a holiday or weekly off? Ask for the day back within {{ eligibility.data.value.windowDays }} days. Approved days are added to
        {{ eligibility.data.value.leaveType?.name }} and can be used for {{ eligibility.data.value.leaveType?.validityDays }} days after the day you worked.
      </p>
      <ul v-if="claimable.length" class="mt-2 divide-y divide-line/70" aria-label="Days you can claim">
        <li v-for="d in claimable" :key="d.date" class="flex items-center gap-3 px-4 py-2.5">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-fg">{{ formatDate(d.date) }} · {{ describe(d) }}</p>
            <p class="text-xs text-fg-muted">Worked {{ hours(d.workedMinutes) }} · up to {{ formatDays(d.maxDays) }}</p>
          </div>
          <AppButton size="sm" variant="secondary" @click="ask(d)">Request</AppButton>
        </li>
      </ul>
      <p v-else class="px-4 py-3 text-sm text-fg-muted">No unclaimed days off worked recently.</p>

      <div class="border-t border-line/70">
        <AppSkeleton v-if="requests.loading.value && !requests.data.value" class="p-4" :lines="2" />
        <ul v-else-if="requests.data.value?.items.length" class="divide-y divide-line/70" aria-label="Your comp-off requests">
          <li v-for="r in requests.data.value.items" :key="r.id" class="flex items-center gap-3 px-4 py-2.5">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm text-fg">{{ formatDate(r.workDate) }} · {{ formatDays(r.days) }}</p>
              <p class="truncate text-xs text-fg-muted">
                <template v-if="r.status === 'APPROVED' && r.expiresOn">Use by {{ formatDate(r.expiresOn) }}</template>
                <template v-else-if="r.status === 'REJECTED' && r.reviewNote">“{{ r.reviewNote }}”</template>
                <template v-else>{{ describe({ kind: r.dayKind, label: r.dayLabel }) }}</template>
              </p>
            </div>
            <AppBadge size="sm" :tone="leaveStatusTone[r.status]" dot>{{ LEAVE_STATUS_LABELS[r.status] }}</AppBadge>
            <AppButton v-if="r.permissions.cancel" size="xs" variant="ghost" :icon="XCircle" :aria-label="`Withdraw comp-off for ${r.workDate}`" @click="withdraw(r)" />
          </li>
        </ul>
      </div>
    </template>

    <AppModal :open="open" :title="day ? `Comp-off for ${formatDate(day.date)}` : 'Comp-off'" :description="day ? `${describe(day)} · worked ${hours(day.workedMinutes)}` : undefined" size="sm" dialog :guide="false" @close="open = false">
      <form id="comp-off-form" class="space-y-4" novalidate @submit.prevent="submit">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppSegmented v-model="form.amount" :options="dayOptions" label="How much" />
        <p v-if="day?.maxDays === 0.5" class="-mt-2 text-xs text-fg-muted">You worked less than a full shift, which earns half a day.</p>
        <AppTextarea v-model="form.reason" label="What you worked on" required :rows="3" :maxlength="500" placeholder="e.g. Release support for the payments launch" :error="fieldErrors.reason ?? fieldErrors.workDate ?? fieldErrors.days" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="open = false">Cancel</AppButton>
        <AppButton type="submit" form="comp-off-form" :loading="saving" :disabled="form.reason.trim().length < 3">Request comp-off</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
