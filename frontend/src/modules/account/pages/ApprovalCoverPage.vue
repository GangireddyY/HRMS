<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ArrowRightLeft, CalendarRange, Check, Handshake, UserRoundCheck } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { delegationsApi, type Delegation, type DelegationStatus } from '@/modules/account/api/delegations.api';
import { AppAlert, AppBadge, AppButton, AppCard, AppDatePicker, AppEmptyState, AppErrorState, AppPageHeader, AppSelect, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { addDaysIso, localToday } from '@/shared/utils/dates';
import { formatDate } from '@/shared/utils/format';

/** Hand your team approvals to a colleague while you're away, and see whom you're covering for. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const overview = useAsync(() => delegationsApi.overview());
const today = localToday();

const STATUS: Record<DelegationStatus, { label: string; tone: 'success' | 'info' | 'neutral' | 'danger' }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  ENDED: { label: 'Ended', tone: 'neutral' },
  REVOKED: { label: 'Ended early', tone: 'neutral' },
};

const people = ref<{ value: string; label: string; description?: string }[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
function search(q: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      people.value = (await delegationsApi.candidates(q)).map((c) => ({ value: c.employeeId, label: c.name, description: [c.employeeCode, c.designation].filter(Boolean).join(' · ') }));
    } catch {
      people.value = [];
    }
  }, 250);
}
search('');

const form = reactive({ delegateEmployeeId: null as string | null, startsOn: today as string | undefined, endsOn: addDaysIso(today, 4) as string | undefined, reason: '' });
const saving = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();
const canSave = computed(() => !!form.delegateEmployeeId && !!form.startsOn && !!form.endsOn);

async function save() {
  reset();
  saving.value = true;
  try {
    const d = await delegationsApi.create({ delegateEmployeeId: form.delegateEmployeeId!, startsOn: form.startsOn!, endsOn: form.endsOn!, reason: form.reason || null });
    feedback.success(`${d.delegate} covers your approvals`, `${formatDate(d.startsOn)} – ${formatDate(d.endsOn)}. They've been notified.`);
    Object.assign(form, { delegateEmployeeId: null, reason: '' });
    await overview.run();
  } catch (e) {
    handle(e, 'Could not set up the cover');
  } finally {
    saving.value = false;
  }
}

async function end(d: Delegation, received: boolean) {
  const ok = await feedback.confirm({
    title: received ? `Stop covering for ${d.delegator}?` : `End ${d.delegate}'s cover now?`,
    message: received ? 'Their approvals go back to them straight away.' : 'Your approvals come back to you straight away.',
    confirmLabel: received ? 'Stop covering' : 'End cover',
  });
  if (!ok) return;
  try {
    await delegationsApi.revoke(d.id);
    feedback.success('Cover ended');
    await Promise.all([overview.run(), auth.loadContext()]);
  } catch (e) {
    feedback.error('Could not end the cover', e);
  }
}

const active = computed(() => (overview.data.value?.received ?? []).filter((d) => d.status === 'ACTIVE'));
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Approval cover" description="Going on leave? Hand your team's approvals to a colleague for those days. Payroll, salary and loan approvals always stay with you." />

    <AppSkeleton v-if="overview.loading.value && !overview.data.value" :lines="6" />
    <AppErrorState v-else-if="overview.error.value" :error="overview.error.value" @retry="overview.run" />
    <template v-else-if="overview.data.value">
      <AppAlert v-for="d in active" :key="d.id" tone="info" :title="`You're approving for ${d.delegator}`">
        Until {{ formatDate(d.endsOn) }}. Their team's requests are in your approval inboxes, marked “on behalf of {{ d.delegator }}”.
      </AppAlert>

      <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <AppCard v-if="overview.data.value.canDelegate" title="Hand over approvals" :icon="ArrowRightLeft" description="Your colleague approves for your team on these days; you keep your access too.">
          <form id="cover-form" class="space-y-4" novalidate @submit.prevent="save">
            <AppAlert v-if="formError">{{ formError }}</AppAlert>
            <AppSelect
              v-model="form.delegateEmployeeId"
              label="Colleague"
              required
              :options="people"
              placeholder="Search by name…"
              searchable
              remote
              :error="fieldErrors.delegateEmployeeId"
              @search="search"
            />
            <div class="grid gap-4 sm:grid-cols-2">
              <AppDatePicker v-model="form.startsOn" label="From" required :min="today" :error="fieldErrors.startsOn" />
              <AppDatePicker v-model="form.endsOn" label="Until (inclusive)" required :min="form.startsOn ?? today" :error="fieldErrors.endsOn" />
            </div>
            <AppTextarea v-model="form.reason" label="Note for your colleague" :rows="2" :maxlength="300" placeholder="e.g. On leave, back on the 28th" />
            <div class="rounded-xl bg-surface-muted/60 p-3">
              <p class="text-xs font-medium text-fg">What they'll approve</p>
              <ul class="mt-1.5 flex flex-wrap gap-1.5">
                <li v-for="p in overview.data.value.delegable" :key="p.key"><AppBadge size="sm" tone="neutral"><Check :size="11" aria-hidden="true" />{{ p.label }}</AppBadge></li>
              </ul>
              <p class="mt-2 text-xs text-fg-muted">Up to {{ overview.data.value.maxDays }} days at a time. Never your own requests.</p>
            </div>
            <div class="flex justify-end"><AppButton type="submit" :icon="Handshake" :loading="saving" :disabled="!canSave">Set up cover</AppButton></div>
          </form>
        </AppCard>

        <div class="space-y-4">
          <AppCard v-if="overview.data.value.canDelegate" title="Your cover" :icon="CalendarRange" :padded="false">
            <AppEmptyState v-if="!overview.data.value.given.length" compact title="No cover set up" description="Set one up before you go on leave." />
            <ul v-else class="divide-y divide-line/70">
              <li v-for="d in overview.data.value.given" :key="d.id" class="flex items-center gap-3 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-fg">{{ d.delegate }}</p>
                  <p class="text-xs text-fg-muted">{{ formatDate(d.startsOn) }} – {{ formatDate(d.endsOn) }}<template v-if="d.reason"> · {{ d.reason }}</template></p>
                </div>
                <AppBadge size="sm" :tone="STATUS[d.status].tone" dot>{{ STATUS[d.status].label }}</AppBadge>
                <AppButton v-if="d.canEnd" size="xs" variant="ghost" @click="end(d, false)">End</AppButton>
              </li>
            </ul>
          </AppCard>

          <AppCard title="Covering for others" :icon="UserRoundCheck" :padded="false">
            <AppEmptyState v-if="!overview.data.value.received.length" compact title="Nobody has asked you" description="When a colleague hands you their approvals, it shows here." />
            <ul v-else class="divide-y divide-line/70">
              <li v-for="d in overview.data.value.received" :key="d.id" class="flex items-center gap-3 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-fg">{{ d.delegator }}</p>
                  <p class="text-xs text-fg-muted">{{ formatDate(d.startsOn) }} – {{ formatDate(d.endsOn) }}<template v-if="d.reason"> · {{ d.reason }}</template></p>
                </div>
                <AppBadge size="sm" :tone="STATUS[d.status].tone" dot>{{ STATUS[d.status].label }}</AppBadge>
                <AppButton v-if="d.canEnd" size="xs" variant="ghost" @click="end(d, true)">Decline</AppButton>
              </li>
            </ul>
          </AppCard>
        </div>
      </div>
    </template>
  </div>
</template>
