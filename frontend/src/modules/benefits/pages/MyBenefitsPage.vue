<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowRight, Building2, CalendarClock, HeartPulse, History, Lightbulb, ShieldCheck, Timer, Users, Wallet } from '@lucide/vue';
import type { DependentRelation } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import { appLocale } from '@/core/locale/locale';
import { benefitsApi } from '@/modules/benefits/api/benefits.api';
import BenefitPlanCard from '@/modules/benefits/components/BenefitPlanCard.vue';
import EnrollModal from '@/modules/benefits/components/EnrollModal.vue';
import type { Enrollment, MyPlan } from '@/modules/benefits/types';
import { BENEFIT_TYPE_VISUALS, daysUntil } from '@/modules/benefits/utils/benefit-visuals';
import { ENROLLMENT_STATUS_LABELS, RELATION_LABELS, enrollmentTone, inr } from '@/modules/benefits/utils/benefits-format';
import { RELATIONSHIP_LABELS } from '@/modules/people/utils/labels';
import { AppAvatar, AppBadge, AppButton, AppCard, AppEmptyState, AppErrorState, AppModal, AppPageHeader, AppSkeleton, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/** Your benefits: what covers you and your family, what it costs each month and who pays, and the enrolment window. */
const auth = useAuthStore();
const feedback = useFeedbackStore();
const mine = useAsync(() => benefitsApi.mine());
const data = computed(() => mine.data.value);

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

// ---- Summary ---------------------------------------------------------------------------------------------------
const you = computed(() => (auth.user ? `${auth.user.firstName} ${auth.user.lastName}`.trim() : 'You'));
const firstName = computed(() => auth.user?.firstName ?? '');
const plans = computed(() => data.value?.plans ?? []);
const coveredPlans = computed(() => plans.value.filter((p) => p.current));
const employerMonthly = computed(() => coveredPlans.value.reduce((s, p) => s + p.current!.employerMonthly, 0));
const totalMonthly = computed(() => (data.value?.monthlyContribution ?? 0) + employerMonthly.value);
const employerShare = computed(() => (totalMonthly.value ? Math.round((employerMonthly.value / totalMonthly.value) * 100) : 0));
const totalCover = computed(() => coveredPlans.value.reduce((s, p) => s + (p.current!.coverageAmount ?? 0), 0));
/** Family members on any of your current enrolments, keyed by their family record. */
const coveredFamily = computed(() => new Set(coveredPlans.value.flatMap((p) => p.current!.dependents.map((d) => d.familyMemberId ?? d.id))));
const coverable = computed(() => (data.value?.dependents ?? []).filter((d) => d.coverable));
const headline = computed(() => {
  if (!coveredPlans.value.length) return plans.value.some(canChange) ? `${firstName.value ? `${firstName.value}, you're` : "You're"} not covered yet` : 'No active cover';
  const n = coveredFamily.value.size;
  return `${firstName.value ? `${firstName.value}, you` : 'You'}${n ? ` and ${n} family member${n === 1 ? '' : 's'}` : ''} are covered`;
});
const openWindow = computed(() => plans.value.filter((p) => p.window && canChange(p)).sort((a, b) => a.window!.closesOn.localeCompare(b.window!.closesOn))[0] ?? null);
const windowDays = computed(() => (openWindow.value ? Math.max(0, daysUntil(openWindow.value.window!.closesOn)) : 0));
const windowPlans = computed(() => plans.value.filter((p) => p.window && canChange(p)));
const windowName = (p: MyPlan) => (p.window?.kind === 'NEW_JOINER' ? 'New joiner enrolment' : 'Open enrolment');
const dateTile = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return { day: d.getDate(), month: d.toLocaleDateString(appLocale(), { month: 'short' }) };
};
const stats = computed(() => [
  { key: 'plans', icon: ShieldCheck, label: 'Plans covering you', value: `${coveredPlans.value.length} of ${plans.value.length}`, hint: totalCover.value ? `${inr(totalCover.value)} total cover` : plans.value.some((p) => p.waived) ? `${plans.value.filter((p) => p.waived).length} waived` : 'Not enrolled yet', tone: 'text-accent-fg bg-accent-soft' },
  { key: 'you', icon: Wallet, label: 'You pay / month', value: inr(data.value?.monthlyContribution ?? 0), hint: 'Deducted from your salary', tone: 'text-info-fg bg-info-soft' },
  { key: 'employer', icon: Building2, label: 'Employer pays / month', value: inr(employerMonthly.value), hint: totalMonthly.value ? `${employerShare.value}% of the total cost` : 'Nothing yet', tone: 'text-success-fg bg-success-soft' },
]);
const relation = (r: string) => RELATION_LABELS[r as DependentRelation] ?? RELATIONSHIP_LABELS[r as keyof typeof RELATIONSHIP_LABELS] ?? r;
</script>

<template>
  <div class="space-y-4">
    <AppPageHeader title="Benefits" description="Insurance and other benefits from your employer, and the family members they cover.">
      <template #actions>
        <AppButton variant="secondary" :icon="Users" to="/me/employment">Family details</AppButton>
        <AppButton v-if="openWindow" :icon="ShieldCheck" @click="enrolling = openWindow">{{ openWindow.current ? 'Review my cover' : 'Enrol now' }}</AppButton>
      </template>
    </AppPageHeader>
    <AppSkeleton v-if="mine.loading.value && !data" :lines="8" />
    <AppErrorState v-else-if="mine.error.value" :error="mine.error.value" @retry="mine.run" />
    <template v-else-if="data">
      <!-- Summary -->
      <section v-if="plans.length" class="card overflow-hidden" aria-labelledby="benefits-headline">
        <div class="relative flex flex-wrap items-center gap-6 bg-gradient-to-br from-brand-700 via-brand-600 to-sky-500 px-6 py-6 text-white">
          <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_-10%,rgba(255,255,255,0.28),transparent_45%),radial-gradient(circle_at_0%_120%,rgba(255,255,255,0.18),transparent_45%)]" aria-hidden="true" />
          <div class="relative min-w-0 flex-1 basis-72">
            <p class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
              <HeartPulse :size="13" aria-hidden="true" />{{ coveredPlans.length ? `${coveredPlans.length} active plan${coveredPlans.length === 1 ? '' : 's'}` : 'Your benefits' }}
            </p>
            <h2 id="benefits-headline" class="mt-3 text-2xl font-semibold tracking-tight">{{ headline }}</h2>
            <p class="mt-1 max-w-2xl text-sm text-white/85">
              <template v-if="coveredPlans.length">Benefits worth {{ inr(totalMonthly) }} a month — your employer pays {{ employerShare }}% of it.</template>
              <template v-else>Choose a plan below to cover yourself and your family.</template>
            </p>
            <ul v-if="coveredPlans.length" class="mt-4 flex flex-wrap gap-2">
              <li v-for="p in coveredPlans" :key="p.id" class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs backdrop-blur">
                <component :is="BENEFIT_TYPE_VISUALS[p.type].icon" :size="12" aria-hidden="true" />{{ p.name }} · {{ p.current!.option?.name }}
              </li>
            </ul>
          </div>
          <div v-if="openWindow" class="relative flex items-center gap-4 rounded-2xl bg-white/15 p-4 ring-1 ring-white/25 backdrop-blur max-sm:w-full">
            <div class="text-center">
              <p class="text-4xl leading-none font-semibold tabular-nums">{{ windowDays }}</p>
              <p class="mt-1 text-2xs text-white/80">day{{ windowDays === 1 ? '' : 's' }} left</p>
            </div>
            <div class="max-w-44 border-s border-white/25 ps-4">
              <p class="text-sm font-semibold">{{ windowName(openWindow) }}</p>
              <p class="text-xs text-white/80">Closes {{ formatDate(openWindow.window!.closesOn) }}. Make changes before then.</p>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-px bg-line/70 xl:grid-cols-4">
          <div v-for="s in stats" :key="s.key" class="flex items-center gap-3 bg-surface px-4 py-3.5 sm:px-5">
            <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', s.tone]" aria-hidden="true"><component :is="s.icon" :size="17" /></span>
            <div class="min-w-0">
              <p class="text-xs text-fg-muted">{{ s.label }}</p>
              <p class="truncate text-lg leading-6 font-semibold text-fg tabular-nums">{{ s.value }}</p>
              <p class="truncate text-2xs text-fg-subtle">{{ s.hint }}</p>
            </div>
          </div>
          <RouterLink to="/me/employment" class="group flex items-center gap-3 bg-surface px-4 py-3.5 sm:px-5 transition hover:bg-surface-muted/60 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none focus-visible:ring-inset">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-special-soft text-special-fg" aria-hidden="true"><Users :size="17" /></span>
            <div class="min-w-0 flex-1">
              <p class="text-xs text-fg-muted">Family members on record</p>
              <p class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ coverable.length }}</p>
              <p class="truncate text-2xs text-fg-subtle">{{ coveredFamily.size }} covered · manage in My employment</p>
            </div>
            <ArrowRight :size="15" class="text-fg-subtle transition group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
          </RouterLink>
        </div>
      </section>

      <AppCard v-if="!plans.length"><AppEmptyState :icon="HeartPulse" title="No benefit plans for you yet" description="When your employer offers a plan you're eligible for, it appears here." /></AppCard>
      <div v-else class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div class="min-w-0 space-y-4">
          <BenefitPlanCard v-for="p in plans" :key="p.id" :plan="p" :you="you" @enrol="enrolling = p" @waive="askWaive(p)" @withdraw="withdraw" />

          <AppCard v-if="data.history.length" title="History" :icon="History" description="Earlier enrolments, waivers and requests." :padded="false">
            <ol class="divide-y divide-line/70">
              <li v-for="h in data.history" :key="h.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
                <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', BENEFIT_TYPE_VISUALS[h.plan.type ?? 'OTHER'].tile]" aria-hidden="true">
                  <component :is="BENEFIT_TYPE_VISUALS[h.plan.type ?? 'OTHER'].icon" :size="15" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-fg">{{ h.plan.name }} <span class="font-normal text-fg-muted">· {{ h.option?.name ?? 'Waived' }}</span></p>
                  <p class="text-xs text-fg-muted tabular-nums">{{ h.effectiveFrom ? formatDate(h.effectiveFrom) : formatDate(h.createdAt) }}{{ h.effectiveTo ? ` – ${formatDate(h.effectiveTo)}` : '' }}</p>
                </div>
                <AppBadge size="sm" :tone="enrollmentTone[h.status]" dot>{{ ENROLLMENT_STATUS_LABELS[h.status] }}</AppBadge>
              </li>
            </ol>
          </AppCard>
        </div>

        <aside class="space-y-4">
          <AppCard v-if="openWindow" :title="windowName(openWindow)" :icon="Timer">
            <div class="flex items-center gap-3">
              <div class="flex w-14 shrink-0 flex-col items-center rounded-lg bg-surface-muted py-1.5">
                <span class="text-2xs font-semibold text-fg-muted uppercase">{{ dateTile(openWindow.window!.closesOn).month }}</span>
                <span class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ dateTile(openWindow.window!.closesOn).day }}</span>
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-fg">{{ windowDays === 0 ? 'Closes today' : `Closes in ${windowDays} day${windowDays === 1 ? '' : 's'}` }}</p>
                <p class="text-xs text-fg-muted">After that, changes need a life event such as marriage or a birth.</p>
              </div>
            </div>
            <ul class="mt-4 space-y-2">
              <li v-for="p in windowPlans" :key="p.id" class="flex items-center gap-2 text-sm">
                <component :is="BENEFIT_TYPE_VISUALS[p.type].icon" :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-fg">{{ p.name }}</span>
                <AppBadge v-if="p.pending" size="sm" tone="warning">Requested</AppBadge>
                <AppBadge v-else-if="p.current" size="sm" tone="success">{{ p.current.option?.name }}</AppBadge>
                <AppBadge v-else-if="p.waived" size="sm">Waived</AppBadge>
                <AppBadge v-else size="sm" tone="warning">Not chosen</AppBadge>
              </li>
            </ul>
            <AppButton class="mt-4 w-full" size="sm" :icon="ShieldCheck" @click="enrolling = openWindow">{{ openWindow.current ? 'Review my cover' : 'Enrol now' }}</AppButton>
          </AppCard>
          <AppCard v-else title="Enrolment is closed" :icon="CalendarClock">
            <p class="text-sm text-fg-muted">You can change your cover within 30 days of a life event such as marriage, the birth of a child or losing other cover. HR reviews the request.</p>
          </AppCard>

          <AppCard title="Your family" :icon="Users">
            <ul v-if="data.dependents.length" class="space-y-3">
              <li v-for="f in data.dependents" :key="f.id" class="flex items-center gap-3">
                <AppAvatar :name="f.name" size="sm" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-fg">{{ f.name }}</p>
                  <p class="text-xs text-fg-muted">{{ relation(f.relationship) }}<template v-if="f.dateOfBirth"> · born {{ formatDate(f.dateOfBirth) }}</template></p>
                </div>
                <AppBadge v-if="coveredFamily.has(f.id)" size="sm" tone="success" dot>Covered</AppBadge>
                <AppBadge v-else-if="f.coverable" size="sm" dot>Not covered</AppBadge>
                <AppBadge v-else size="sm">Not eligible</AppBadge>
              </li>
            </ul>
            <p v-else class="text-sm text-fg-muted">Add your spouse, children or parents to cover them under family plans.</p>
            <AppButton class="mt-4 w-full" size="sm" variant="secondary" :icon-right="ArrowRight" to="/me/employment">Manage family details</AppButton>
          </AppCard>

          <section class="card overflow-hidden">
            <div class="bg-gradient-to-br from-amber-500/10 via-transparent to-sky-500/10 p-4">
              <p class="flex items-center gap-2 text-sm font-semibold text-fg"><Lightbulb :size="15" class="text-amber-500" aria-hidden="true" />Tax tip</p>
              <p class="mt-1 text-xs text-fg-muted">Health insurance premiums you pay for yourself, your family or your parents can be claimed under section 80D in your tax declaration (old tax regime).</p>
              <AppButton class="mt-3 w-full" size="sm" variant="secondary" to="/me/salary">Open tax declaration</AppButton>
            </div>
          </section>
        </aside>
      </div>
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
