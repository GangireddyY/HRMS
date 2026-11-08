<script setup lang="ts">
import { computed, ref } from 'vue';
import { HeartPulse, Pencil, ShieldOff, Undo2 } from '@lucide/vue';
import { benefitsApi } from '@/modules/benefits/api/benefits.api';
import EnrollModal from '@/modules/benefits/components/EnrollModal.vue';
import type { Enrollment, MyPlan } from '@/modules/benefits/types';
import { ENROLLMENT_STATUS_LABELS, LIFE_EVENT_LABELS, RELATION_LABELS, TYPE_LABELS, enrollmentTone, inr } from '@/modules/benefits/utils/benefits-format';
import { AppAlert, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSkeleton, AppStatCard, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

const feedback = useFeedbackStore();
const mine = useAsync(() => benefitsApi.mine());
const data = computed(() => mine.data.value);
const covered = computed(() => (data.value?.plans ?? []).filter((p) => p.current).length);

const enrolling = ref<MyPlan | null>(null);
async function onSaved(e: Enrollment) {
  enrolling.value = null;
  feedback.success(e.status === 'PENDING' ? 'Request sent' : 'Enrolled', e.status === 'PENDING' ? 'HR will review it.' : `Covered from ${formatDate(e.effectiveFrom!)}.`);
  await mine.run();
}
async function withdraw(e: Enrollment) {
  if (!(await feedback.confirm({ title: 'Withdraw the request?', message: 'Your current choice stays as it is.', confirmLabel: 'Withdraw' }))) return;
  try {
    await benefitsApi.cancel(e.id);
    feedback.success('Request withdrawn');
    await mine.run();
  } catch (err) {
    feedback.error('Could not withdraw the request', err);
  }
}
const waiving = ref<MyPlan | null>(null);
const waiveNote = ref('');
const busy = ref(false);
function askWaive(p: MyPlan) {
  waiveNote.value = '';
  waiving.value = p;
}
async function waive() {
  if (!waiving.value) return;
  busy.value = true;
  try {
    await benefitsApi.waive(waiving.value.id, waiveNote.value || null);
    feedback.success(`${waiving.value.name} waived`);
    waiving.value = null;
    await mine.run();
  } catch (e) {
    feedback.error('Could not waive the plan', e);
  } finally {
    busy.value = false;
  }
}
const canChange = (p: MyPlan) => !p.ineligible && p.options.length > 0;
</script>

<template>
  <div>
    <AppPageHeader title="Benefits" description="Insurance and other benefits from your employer, and the family members they cover." />
    <AppSkeleton v-if="mine.loading.value && !data" :lines="8" />
    <AppErrorState v-else-if="mine.error.value" :error="mine.error.value" @retry="mine.run" />
    <template v-else-if="data">
      <div class="mb-4 grid gap-4 sm:grid-cols-3">
        <AppStatCard label="Plans you're covered by" :value="covered" />
        <AppStatCard label="Your contribution / month" :value="inr(data.monthlyContribution)" tone="info" hint="Deducted from your salary" />
        <AppStatCard label="Family members on record" :value="data.dependents.filter((d) => d.coverable).length" tone="success" :to="'/me/employment'" />
      </div>
      <AppCard v-if="!data.plans.length"><AppEmptyState :icon="HeartPulse" title="No benefit plans for you yet" description="When your employer offers a plan you're eligible for, it appears here." /></AppCard>
      <div v-else class="space-y-4">
        <AppCard v-for="p in data.plans" :key="p.id" :title="p.name" :description="[TYPE_LABELS[p.type], p.provider, `policy ${formatDate(p.coverageStartsOn)} – ${formatDate(p.coverageEndsOn)}`].filter(Boolean).join(' · ')">
          <template #actions>
            <AppBadge v-if="p.mandatory" tone="info">Provided to everyone</AppBadge>
            <AppBadge v-if="p.window" tone="success" dot>{{ p.window.kind === 'NEW_JOINER' ? 'New joiner enrolment' : 'Open enrolment' }} until {{ formatDate(p.window.closesOn) }}</AppBadge>
          </template>
          <p v-if="p.description" class="mb-4 text-sm whitespace-pre-line text-fg-muted">{{ p.description }}</p>
          <AppAlert v-if="p.ineligible" tone="warning" class="mb-4">{{ p.ineligible }}.</AppAlert>

          <div class="grid gap-4 lg:grid-cols-2">
            <div class="rounded-xl p-4 ring-1 ring-line">
              <p class="mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">Your cover</p>
              <template v-if="p.current">
                <p class="font-medium text-fg">{{ p.current.option?.name }} <AppBadge size="sm" :tone="enrollmentTone[p.current.status]">{{ ENROLLMENT_STATUS_LABELS[p.current.status] }}</AppBadge></p>
                <p class="text-sm text-fg-muted">
                  <template v-if="p.current.coverageAmount">Sum insured {{ inr(p.current.coverageAmount) }} · </template>
                  {{ p.current.employeeMonthly ? `${inr(p.current.employeeMonthly)}/month from your salary` : 'no cost to you' }}
                </p>
                <p class="text-sm text-fg-muted">From {{ formatDate(p.current.effectiveFrom!) }}{{ p.current.effectiveTo ? ` until ${formatDate(p.current.effectiveTo)}` : '' }}</p>
                <ul v-if="p.current.dependents.length" class="mt-2 space-y-0.5 text-sm text-fg">
                  <li v-for="d in p.current.dependents" :key="d.id">{{ d.name }} <span class="text-fg-muted">· {{ RELATION_LABELS[d.relationship] }}</span></li>
                </ul>
              </template>
              <p v-else-if="p.waived" class="text-sm text-fg-muted">You waived this plan.</p>
              <p v-else class="text-sm text-fg-muted">Not enrolled.</p>
            </div>
            <div v-if="p.pending" class="rounded-xl bg-warning-soft p-4 ring-1 ring-warning/35">
              <p class="mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">Waiting for HR</p>
              <p class="font-medium text-fg">{{ p.pending.option?.name }}</p>
              <p class="text-sm text-fg-muted">
                From {{ formatDate(p.pending.effectiveFrom!) }}<template v-if="p.pending.lifeEvent"> · {{ LIFE_EVENT_LABELS[p.pending.lifeEvent] }} on {{ formatDate(p.pending.lifeEventDate!) }}</template>
              </p>
              <ul v-if="p.pending.dependents.length" class="mt-2 space-y-0.5 text-sm text-fg">
                <li v-for="d in p.pending.dependents" :key="d.id">{{ d.name }} <span class="text-fg-muted">· {{ RELATION_LABELS[d.relationship] }}</span></li>
              </ul>
              <AppButton class="mt-3" size="sm" variant="secondary" :icon="Undo2" @click="withdraw(p.pending)">Withdraw request</AppButton>
            </div>
          </div>
          <template v-if="canChange(p)" #footer>
            <div class="flex flex-wrap items-center gap-3">
              <AppButton size="sm" :icon="Pencil" @click="enrolling = p">{{ p.current ? 'Change cover' : 'Enrol' }}</AppButton>
              <AppButton v-if="p.canWaive && !p.waived" size="sm" variant="secondary" :icon="ShieldOff" @click="askWaive(p)">Waive</AppButton>
              <span v-if="!p.window" class="text-xs text-fg-muted">Enrolment is closed — changes are possible within 30 days of a life event.</span>
            </div>
          </template>
        </AppCard>
        <p class="text-xs text-fg-muted">Health insurance premiums you pay for yourself, your family or your parents can be claimed under section 80D in your tax declaration (old tax regime).</p>
      </div>

      <AppCard v-if="data.history.length" class="mt-4" title="History">
        <ul class="divide-y divide-line text-sm">
          <li v-for="h in data.history" :key="h.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
            <span class="text-fg">{{ h.plan.name }} · {{ h.option?.name ?? 'Waived' }}</span>
            <span class="flex items-center gap-2 text-xs text-fg-muted">
              {{ h.effectiveFrom ? formatDate(h.effectiveFrom) : formatDate(h.createdAt) }}{{ h.effectiveTo ? ` – ${formatDate(h.effectiveTo)}` : '' }}
              <AppBadge size="sm" :tone="enrollmentTone[h.status]">{{ ENROLLMENT_STATUS_LABELS[h.status] }}</AppBadge>
            </span>
          </li>
        </ul>
      </AppCard>
    </template>
    <EnrollModal :open="!!enrolling" :plan="enrolling" :family="data?.dependents ?? []" @close="enrolling = null" @saved="onSaved" />
    <AppModal :open="!!waiving" :title="`Waive ${waiving?.name ?? ''}?`" description="You won't be covered. You can enrol again while enrolment is open." size="sm" @close="waiving = null">
      <AppTextarea v-model="waiveNote" label="Reason (optional)" placeholder="e.g. covered by my spouse's policy" :rows="2" :maxlength="1000" />
      <template #footer>
        <AppButton variant="secondary" @click="waiving = null">Cancel</AppButton>
        <AppButton :loading="busy" @click="waive">Waive</AppButton>
      </template>
    </AppModal>
  </div>
</template>
