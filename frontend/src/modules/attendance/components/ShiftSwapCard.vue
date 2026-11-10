<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ArrowLeftRight, Ban, Check, Plus, X } from '@lucide/vue';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import type { ShiftSwap } from '@/modules/attendance/types';
import { SWAP_STATUS, swapShift } from '@/modules/attendance/utils/shift-swaps';
import { employeesApi } from '@/modules/people/api/people.api';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import type { Colleague } from '@/modules/performance/types';
import { AppAlert, AppBadge, AppButton, AppCard, AppDatePicker, AppErrorState, AppModal, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { addDaysIso, localToday } from '@/shared/utils/dates';
import { formatDate } from '@/shared/utils/format';

/** Trade a shift with a colleague: ask, answer requests from colleagues, and follow them to the manager's approval. */
const props = defineProps<{ selfId: string | null }>();
const feedback = useFeedbackStore();
const swaps = useAsync(() => attendanceApi.swaps({ view: 'mine', pageSize: 10 }));
const rows = computed(() => swaps.data.value?.items ?? []);
const asksForMe = computed(() => rows.value.filter((s) => s.permissions.respond));

const asking = ref(false);
const form = reactive({ colleagueId: null as string | null, workDate: undefined as string | undefined, reason: '' });
const { fieldErrors, formError, handle, reset } = useFormErrors();
const tomorrow = addDaysIso(localToday(), 1);
function openAsk() {
  reset();
  Object.assign(form, { colleagueId: null, workDate: tomorrow, reason: '' });
  asking.value = true;
}
const search = async (q: string): Promise<Colleague[]> =>
  (await employeesApi.list({ page: 1, pageSize: 20, search: q || undefined, status: 'ACTIVE' })).items
    .filter((e) => e.id !== props.selfId)
    .map((e) => ({ id: e.id, name: e.fullName, employeeCode: e.employeeCode, department: e.department?.name ?? null, designation: e.designation?.name ?? null }));
const saving = ref(false);
async function send() {
  reset();
  saving.value = true;
  try {
    await attendanceApi.requestSwap({ colleagueId: form.colleagueId!, workDate: form.workDate!, reason: form.reason });
    asking.value = false;
    feedback.success('Swap requested', 'Your colleague has been asked.');
    await swaps.run();
  } catch (e) {
    handle(e, 'Could not ask for the swap');
  } finally {
    saving.value = false;
  }
}
async function act(s: ShiftSwap, what: 'accept' | 'decline' | 'cancel') {
  try {
    if (what === 'cancel') await attendanceApi.cancelSwap(s.id);
    else await attendanceApi.respondSwap(s.id, { accept: what === 'accept' });
    feedback.success(what === 'accept' ? 'Agreed — it now goes to the manager' : what === 'decline' ? 'Declined' : 'Swap withdrawn');
    await swaps.run();
  } catch (e) {
    feedback.error('Could not update the swap', e);
  }
}
const other = (s: ShiftSwap) => (s.requester.id === props.selfId ? s.colleague : s.requester);
const mineOf = (s: ShiftSwap) => (s.requester.id === props.selfId ? s.requester : s.colleague);
</script>

<template>
  <AppCard title="Shift swaps" :icon="ArrowLeftRight" :padded="false">
    <template #actions><AppButton size="sm" variant="secondary" :icon="Plus" @click="openAsk">Swap a shift</AppButton></template>
    <AppErrorState v-if="swaps.error.value" :error="swaps.error.value" @retry="swaps.run" />
    <AppSkeleton v-else-if="swaps.loading.value && !swaps.data.value" class="p-4" :lines="2" />
    <template v-else>
      <p class="px-4 pt-3 text-xs text-fg-muted">Trade your shift on a future day with a colleague. They agree first, then your manager approves and the roster is updated.</p>
      <ul v-if="rows.length" class="mt-2 divide-y divide-line/70">
        <li v-for="s in rows" :key="s.id" :class="['px-4 py-2.5', s.permissions.respond ? 'bg-info-soft/40' : '']">
          <div class="flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-fg">{{ formatDate(s.workDate) }} · with {{ other(s).name }}</p>
              <p class="truncate text-xs text-fg-muted">You: {{ swapShift(mineOf(s).shift) }} → {{ swapShift(other(s).shift) }}</p>
            </div>
            <AppBadge size="sm" :tone="SWAP_STATUS[s.status].tone" dot>{{ SWAP_STATUS[s.status].label }}</AppBadge>
          </div>
          <p v-if="s.permissions.respond" class="mt-1 text-xs text-fg">{{ s.requester.name }} asks: “{{ s.reason }}”</p>
          <div v-if="s.permissions.respond || s.permissions.cancel" class="mt-2 flex justify-end gap-2">
            <template v-if="s.permissions.respond">
              <AppButton size="sm" variant="ghost" :icon="X" @click="act(s, 'decline')">Decline</AppButton>
              <AppButton size="sm" :icon="Check" @click="act(s, 'accept')">Agree</AppButton>
            </template>
            <AppButton v-else size="sm" variant="ghost" :icon="Ban" @click="act(s, 'cancel')">Withdraw</AppButton>
          </div>
        </li>
      </ul>
      <p v-else class="px-4 py-4 text-sm text-fg-muted">No shift swaps yet.</p>
      <p v-if="asksForMe.length" class="sr-only" role="status">{{ asksForMe.length }} colleague{{ asksForMe.length === 1 ? '' : 's' }} asked to swap with you</p>
    </template>

    <AppModal :open="asking" dialog title="Swap a shift" description="Your colleague works your shift that day and you work theirs (or their day off)." @close="asking = false">
      <form id="swap-form" class="space-y-4" novalidate @submit.prevent="send">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <ColleaguePicker v-model:value="form.colleagueId" label="Colleague" required :source="search" />
        <AppDatePicker v-model="form.workDate" label="Day" :min="tomorrow" required :error="fieldErrors.workDate" />
        <AppTextarea v-model="form.reason" label="Why?" required :rows="2" :maxlength="500" :error="fieldErrors.reason ?? fieldErrors.colleagueId" />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="asking = false">Cancel</AppButton>
        <AppButton type="submit" form="swap-form" :loading="saving" :disabled="!form.colleagueId || !form.workDate || form.reason.trim().length < 3">Ask colleague</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
