<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { DoorOpen, FileText, Printer, Send, Undo2 } from '@lucide/vue';
import { type ExitReason } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { exitApi } from '@/modules/exit/api/exit.api';
import AlumniCard from '@/modules/exit/components/AlumniCard.vue';
import ClearanceList from '@/modules/exit/components/ClearanceList.vue';
import SettlementStatement from '@/modules/exit/components/SettlementStatement.vue';
import type { ExitDetail } from '@/modules/exit/types';
import { LETTER_LABELS, REASON_LABELS, RESIGNATION_REASONS, STATUS_LABELS, TYPE_LABELS, localIso, statusTone } from '@/modules/exit/utils/exit-format';
import { employeesApi } from '@/modules/people/api/people.api';
import { AppAlert, AppBadge, AppButton, AppCard, AppCheckbox, AppDatePicker, AppErrorState, AppFacts, AppInput, AppPageHeader, AppSelect, AppSkeleton, AppSplit, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const auth = useAuthStore();
const feedback = useFeedbackStore();
const me = useAsync(() => employeesApi.me());
const mine = useAsync(() => exitApi.mine());
const current = computed(() => mine.data.value?.current ?? null);
const settlement = useAsync(() => exitApi.settlement(current.value!.id), { immediate: false });
const letters = useAsync(() => exitApi.letters(current.value!.id), { immediate: false });
watch(
  () => current.value?.id,
  (id) => {
    if (id && (current.value!.status === 'APPROVED' || current.value!.status === 'COMPLETED')) void settlement.run();
    if (id && current.value!.status === 'COMPLETED') void letters.run();
  },
);
const set = (e: ExitDetail) => {
  if (mine.data.value) mine.data.value = { ...mine.data.value, current: e };
};
const today = localIso(new Date());
const noticeDays = computed(() => me.data.value?.noticePeriodDays ?? 30);
const noticeEnds = computed(() => {
  const d = new Date();
  d.setDate(d.getDate() + noticeDays.value - 1);
  return localIso(d);
});

const RESIGN_STEPS = [
  { title: 'Manager and HR are told', text: 'They review your resignation and may talk to you about it.' },
  { title: 'Last working day confirmed', text: 'Usually the end of your notice period; an earlier day may be agreed.' },
  { title: 'Clearance', text: 'Return assets and hand over work; each team signs off here.' },
  { title: 'Full & final settlement', text: 'Pending salary, leave encashment and recoveries, shown on this page.' },
  { title: 'Letters', text: 'Relieving letter and experience certificate, ready to download.' },
];

// ---- Resign ----
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ reason: null as ExitReason | null, reasonDetail: '', requestedLastDay: undefined as string | undefined });
const reasonOptions = RESIGNATION_REASONS.map((r) => ({ value: r, label: REASON_LABELS[r] }));
const busy = ref(false);
async function resign() {
  reset();
  if (!(await feedback.confirm({ title: 'Submit your resignation?', message: `Your notice period is ${noticeDays.value} days. Your manager and HR are told and confirm your last working day.`, confirmLabel: 'Resign' }))) return;
  busy.value = true;
  try {
    const e = await exitApi.resign({ reason: form.reason!, reasonDetail: form.reasonDetail || null, requestedLastDay: form.requestedLastDay ?? null });
    feedback.success('Resignation submitted');
    mine.data.value = { current: e, history: mine.data.value?.history ?? [] };
  } catch (e) {
    handle(e, 'Could not submit your resignation');
  } finally {
    busy.value = false;
  }
}
async function withdraw() {
  if (!current.value || !(await feedback.confirm({ title: 'Withdraw your resignation?', message: 'You carry on as before.', confirmLabel: 'Withdraw' }))) return;
  try {
    await exitApi.withdraw(current.value.id);
    feedback.success('Resignation withdrawn');
    await mine.run();
  } catch (e) {
    feedback.error('Could not withdraw it', e);
  }
}

// ---- Exit survey ----
const survey = reactive({ wouldRecommend: 7 as string | number, wouldRejoin: false, liked: '', improve: '' });
async function sendSurvey() {
  if (!current.value) return;
  busy.value = true;
  try {
    set(await exitApi.feedback(current.value.id, { wouldRecommend: Number(survey.wouldRecommend), wouldRejoin: survey.wouldRejoin, liked: survey.liked || null, improve: survey.improve || null }));
    feedback.success('Thank you for your feedback');
  } catch (e) {
    feedback.error('Could not send your feedback', e);
  } finally {
    busy.value = false;
  }
}
const print = () => window.print();
</script>

<template>
  <div>
    <AppPageHeader title="Resignation & exit" description="Resign, follow your notice period and clearance, and see your full & final settlement." />
    <AppSkeleton v-if="mine.loading.value && !mine.data.value" :lines="6" />
    <AppErrorState v-else-if="mine.error.value" :error="mine.error.value" @retry="mine.run" />
    <template v-else-if="mine.data.value">
      <template v-if="!current">
        <AppAlert v-if="me.data.value === null" tone="info">Only employees can resign here.</AppAlert>
        <AppAlert v-else-if="me.data.value && me.data.value.status !== 'ACTIVE'" tone="info">You are {{ me.data.value.status === 'ON_NOTICE' ? 'already serving notice' : 'no longer active' }}.</AppAlert>
        <AppSplit v-else-if="me.data.value">
          <AppCard title="Resign" :icon="DoorOpen" :description="`Your notice period is ${noticeDays} days: it would end on ${formatDate(noticeEnds)}.`">
            <form id="resign-form" class="space-y-4" novalidate @submit.prevent="resign">
              <AppAlert v-if="formError">{{ formError }}</AppAlert>
              <div class="grid gap-4 md:grid-cols-2">
                <AppSelect v-model="form.reason" label="Main reason" required :options="reasonOptions" :error="fieldErrors.reason" />
                <AppDatePicker v-model="form.requestedLastDay" label="Preferred last working day" :min="today" help="Leaving before the end of your notice period may mean notice pay is recovered, unless it is waived." :error="fieldErrors.requestedLastDay" />
              </div>
              <AppTextarea v-model="form.reasonDetail" label="Anything you'd like to add" :rows="5" :maxlength="2000" />
            </form>
            <template #footer>
              <div class="flex justify-end"><AppButton type="submit" form="resign-form" :icon="Send" :loading="busy" :disabled="!form.reason">Submit resignation</AppButton></div>
            </template>
          </AppCard>
          <template #aside>
            <AppCard title="What happens next">
              <ol class="relative space-y-3 border-l border-line pl-4 text-[13px]">
                <li v-for="(step, i) in RESIGN_STEPS" :key="step.title" class="relative">
                  <span class="absolute top-0 -left-[25px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-brand-600 text-[10px] font-semibold text-white">{{ i + 1 }}</span>
                  <p class="font-medium text-fg">{{ step.title }}</p>
                  <p class="text-xs text-fg-muted">{{ step.text }}</p>
                </li>
              </ol>
            </AppCard>
            <AppCard title="Your notice">
              <AppFacts :items="[{ label: 'Notice period', value: `${noticeDays} days` }, { label: 'Would end on', value: formatDate(noticeEnds), strong: true }]" />
            </AppCard>
          </template>
        </AppSplit>
      </template>

      <div v-else class="space-y-4">
        <AppCard :title="`${TYPE_LABELS[current.type]} · ${REASON_LABELS[current.reason]}`">
          <template #actions>
            <AppBadge :tone="statusTone[current.status]" dot>{{ STATUS_LABELS[current.status] }}</AppBadge>
            <AppButton v-if="current.permissions.withdraw" size="sm" variant="secondary" :icon="Undo2" @click="withdraw">Withdraw</AppButton>
          </template>
          <dl class="grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt class="text-fg-muted">Resigned on</dt>
              <dd class="text-fg">{{ formatDate(current.submittedOn) }}</dd>
            </div>
            <div>
              <dt class="text-fg-muted">Notice ends</dt>
              <dd class="text-fg">{{ formatDate(current.noticeEndsOn) }} ({{ current.noticeDays }} days)</dd>
            </div>
            <div>
              <dt class="text-fg-muted">Last working day</dt>
              <dd class="font-medium text-fg">{{ current.lastWorkingDay ? formatDate(current.lastWorkingDay) : current.requestedLastDay ? `${formatDate(current.requestedLastDay)} (requested)` : 'To be confirmed' }}</dd>
            </div>
            <div>
              <dt class="text-fg-muted">{{ current.status === 'APPROVED' ? 'Days left' : 'Service' }}</dt>
              <dd class="text-fg">{{ current.status === 'APPROVED' ? current.daysLeft : `${current.service.years} years, ${current.service.months} months` }}</dd>
            </div>
          </dl>
          <p v-if="current.decisionNote" class="mt-3 text-sm text-fg-muted">“{{ current.decisionNote }}” — {{ current.decidedBy }}</p>
          <AppAlert v-if="current.status === 'APPROVED' && current.shortfallDays && !current.noticeWaived" tone="warning" class="mt-4">Your last working day is {{ current.shortfallDays }} days before the end of your notice period; notice pay for those days may be recovered in your settlement.</AppAlert>
        </AppCard>

        <ClearanceList v-if="current.clearanceItems.length" :exit="current" @updated="set" />

        <AppCard v-if="current.permissions.feedback" title="Exit survey" description="Your answers go to HR only and help us improve.">
          <div class="grid gap-4 md:grid-cols-2">
            <AppInput v-model="survey.wouldRecommend" label="How likely are you to recommend working here? (0–10)" type="number" :min="0" :max="10" />
            <div class="flex items-end pb-1.5"><AppCheckbox v-model="survey.wouldRejoin" label="I would consider coming back" /></div>
            <AppTextarea v-model="survey.liked" label="What did you like most?" :rows="3" :maxlength="2000" />
            <AppTextarea v-model="survey.improve" label="What should we improve?" :rows="3" :maxlength="2000" />
          </div>
          <template #footer>
            <div class="flex justify-end"><AppButton :loading="busy" @click="sendSurvey">Send feedback</AppButton></div>
          </template>
        </AppCard>
        <p v-else-if="current.feedbackGiven" class="text-sm text-fg-muted">Thank you — you have shared your exit feedback.</p>

        <AppCard v-if="current.status === 'COMPLETED' && current.type !== 'DEATH'" title="Your letters" :icon="FileText" class="print:hidden">
          <ul v-if="letters.data.value?.length" class="divide-y divide-line text-sm">
            <li v-for="l in letters.data.value" :key="l.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p class="font-medium text-fg">{{ LETTER_LABELS[l.type] }}</p>
                <p class="text-xs text-fg-muted">{{ l.reference }} · dated {{ formatDate(l.letterDate) }}</p>
              </div>
              <AppButton size="sm" variant="secondary" :to="`/me/exit/${current.id}/letters/${l.id}`">Open</AppButton>
            </li>
          </ul>
          <p v-else-if="!letters.loading.value" class="text-sm text-fg-muted">Your relieving letter and experience certificate appear here once HR issues them.</p>
        </AppCard>

        <template v-if="settlement.data.value">
          <div class="flex justify-end print:hidden"><AppButton variant="secondary" :icon="Printer" @click="print">Print statement</AppButton></div>
          <SettlementStatement :settlement="settlement.data.value" :organization="auth.organization?.name" />
        </template>
        <AppAlert v-else-if="current.status === 'APPROVED' || current.status === 'COMPLETED'" tone="info">Your full &amp; final settlement appears here once it has been approved.</AppAlert>

        <AlumniCard v-if="current.status === 'COMPLETED'" class="print:hidden" />
      </div>

      <AppCard v-if="mine.data.value.history.length" class="mt-4" title="Earlier">
        <ul class="divide-y divide-line text-sm">
          <li v-for="h in mine.data.value.history" :key="h.id" class="flex flex-wrap justify-between gap-2 py-2">
            <span class="text-fg">{{ TYPE_LABELS[h.type] }} · {{ formatDate(h.submittedOn) }}</span>
            <span class="text-xs text-fg-muted">{{ STATUS_LABELS[h.status] }}{{ h.closedReason ? ` · ${h.closedReason}` : '' }}</span>
          </li>
        </ul>
      </AppCard>
    </template>
  </div>
</template>
