<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Archive, CalendarRange, Download, FileText, Layers, Pencil, RefreshCw, Rocket, ShieldCheck, Timer, Trash2, UserCheck, Users } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import { benefitsApi } from '@/modules/benefits/api/benefits.api';
import EnrollmentsTable from '@/modules/benefits/components/EnrollmentsTable.vue';
import PlanFormModal from '@/modules/benefits/components/PlanFormModal.vue';
import type { Plan, PlanOption } from '@/modules/benefits/types';
import { BENEFIT_TYPE_VISUALS } from '@/modules/benefits/utils/benefit-visuals';
import { PLAN_STATUS_LABELS, RELATION_LABELS, TYPE_LABELS, inr, planTone } from '@/modules/benefits/utils/benefits-format';
import { enrolmentWindow, policyTiming } from '@/modules/benefits/utils/plan-window';
import { structureApi } from '@/modules/people/api/people.api';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppFacts, AppPageHeader, AppSkeleton, AppStatStrip, type Fact, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

/**
 * One benefit plan for HR: status and actions in the header, coverage and cost at a glance, the options with their
 * cost split, the enrolment window, policy facts and eligibility on the side, and every enrolment below.
 */
const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const plan = useAsync(() => benefitsApi.plan(id.value));
watch(id, () => void plan.run());
const p = computed(() => plan.data.value);
const departments = useAsync(() => structureApi.departments());
const locations = useAsync(() => structureApi.locations());
const grades = useAsync(() => structureApi.grades());
const names = (ids: string[] | null, rows: { id: string; name: string }[] | null | undefined) => (ids?.length ? ids.map((x) => rows?.find((r) => r.id === x)?.name ?? '…').join(', ') : null);
/** Eligibility as labelled rows for the side panel; "everyone" rows are muted. */
const eligibilityRows = computed(() => {
  if (!p.value) return [];
  const v = p.value;
  return [
    { label: 'Employment', value: v.employmentTypes?.length ? v.employmentTypes.map((t) => EMPLOYMENT_TYPE_LABELS[t]).join(', ') : 'All types', open: !v.employmentTypes?.length },
    { label: 'Departments', value: names(v.departmentIds, departments.data.value) ?? 'All', open: !v.departmentIds?.length },
    { label: 'Locations', value: names(v.locationIds, locations.data.value) ?? 'All', open: !v.locationIds?.length },
    { label: 'Grades', value: names(v.gradeIds, grades.data.value) ?? 'All', open: !v.gradeIds?.length },
    { label: 'Waiting period', value: v.waitingDays ? `${v.waitingDays} days of service` : 'From joining', open: !v.waitingDays },
    ...(v.maxChildAge ? [{ label: 'Children', value: `Up to age ${v.maxChildAge}`, open: false }] : []),
  ];
});

const editing = ref(false);
async function onSaved(next: Plan) {
  editing.value = false;
  plan.data.value = next;
  feedback.success('Plan saved');
}
const busy = ref<string | null>(null);
async function act(key: string, fn: () => Promise<Plan>, success: string, description?: string) {
  busy.value = key;
  try {
    plan.data.value = await fn();
    feedback.success(success, description);
  } catch (e) {
    feedback.error('Could not complete the action', e);
  } finally {
    busy.value = null;
  }
}
async function activate() {
  const renewal = !!p.value?.renewedFrom;
  const message = renewal
    ? `Everyone still covered by ${p.value!.renewedFrom!.name} at the end of its policy continues in the same option (or the default one) from ${formatDate(p.value!.coverageStartsOn)}, and is told.`
    : 'Eligible employees can see it and enrol in their windows.';
  if (!(await feedback.confirm({ title: `Activate ${p.value?.name}?`, message, confirmLabel: 'Activate' }))) return;
  busy.value = 'activate';
  try {
    const next = await benefitsApi.activate(id.value);
    plan.data.value = next;
    feedback.success('Plan activated', next.carriedOver ? `${next.carriedOver.carried} enrolment${next.carriedOver.carried === 1 ? '' : 's'} carried over${next.carriedOver.skipped ? `; ${next.carriedOver.skipped} not eligible any more` : ''}.` : undefined);
    tableKey.value++;
  } catch (e) {
    feedback.error('Could not activate the plan', e);
  } finally {
    busy.value = null;
  }
}
async function renew() {
  if (!(await feedback.confirm({ title: `Renew ${p.value?.name}?`, message: 'A draft for the next policy period is created with the same options and a renewal enrolment window. Review its costs, then activate it to carry current enrolments over.', confirmLabel: 'Create renewal' }))) return;
  busy.value = 'renew';
  try {
    const next = await benefitsApi.renew(id.value);
    feedback.success('Renewal drafted', `${formatDate(next.coverageStartsOn)} – ${formatDate(next.coverageEndsOn)}.`);
    await router.push(`/hr/benefits/plans/${next.id}`);
  } catch (e) {
    feedback.error('Could not renew the plan', e);
  } finally {
    busy.value = null;
  }
}
async function archive() {
  if (!(await feedback.confirm({ title: `Archive ${p.value?.name}?`, message: 'Coverage ends today (or at the end of the policy) and pending requests are cancelled.', confirmLabel: 'Archive', danger: true }))) return;
  await act('archive', () => benefitsApi.archive(id.value), 'Plan archived');
}
async function remove() {
  if (!(await feedback.confirm({ title: `Delete ${p.value?.name}?`, message: 'The draft is deleted.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await benefitsApi.removePlan(id.value);
    feedback.success('Draft deleted');
    await router.push('/hr/benefits/plans');
  } catch (e) {
    feedback.error('Could not delete the plan', e);
  }
}
const tableKey = ref(0);
async function enrollEligible() {
  if (!(await feedback.confirm({ title: 'Enrol everyone eligible?', message: 'Employees not yet covered are enrolled in the default option and told. Run it again later to cover new joiners.', confirmLabel: 'Enrol' }))) return;
  busy.value = 'eligible';
  try {
    const r = await benefitsApi.enrollEligible(id.value);
    feedback.success(`${r.enrolled} employee${r.enrolled === 1 ? '' : 's'} enrolled`);
    await plan.run();
    tableKey.value++;
  } catch (e) {
    feedback.error('Could not enrol employees', e);
  } finally {
    busy.value = null;
  }
}
async function census() {
  if (!p.value) return;
  try {
    await benefitsApi.census(p.value);
  } catch (e) {
    feedback.error('Could not download the census', e);
  }
}

// ---- Presentation -------------------------------------------------------------------------------------------------
const visual = computed(() => (p.value ? BENEFIT_TYPE_VISUALS[p.value.type] : null));
const win = computed(() => (p.value ? enrolmentWindow(p.value) : null));
const strip = computed<StripItem[]>(() => {
  const s = p.value?.stats;
  const employer = s?.employerMonthly ?? 0;
  const employee = s?.employeeMonthly ?? 0;
  return [
    { key: 'covered', label: 'Covered', value: s?.enrolled ?? 0, tone: 'success', hint: 'Employees with active cover' },
    { key: 'pending', label: 'Waiting for approval', value: s?.pending ?? 0, tone: 'warning', hint: s?.pending ? 'Review in the list below' : 'Nothing to review' },
    { key: 'waived', label: 'Waived', value: s?.waived ?? 0, tone: 'neutral', hint: 'Chose not to enrol' },
    { key: 'employer', label: 'Employer pays / month', value: inr(employer), tone: 'violet', hint: `${inr(employer * 12)} a year` },
    { key: 'employee', label: 'Employees pay / month', value: inr(employee), tone: 'brand', hint: 'Deducted from salaries' },
  ];
});
const optionTotal = (o: PlanOption) => o.employeeMonthly + o.employerMonthly;
const employeePct = (o: PlanOption) => (optionTotal(o) ? Math.round((o.employeeMonthly / optionTotal(o)) * 100) : 0);
const who = (o: PlanOption) => (o.maxDependents ? `Employee + up to ${o.maxDependents} dependant${o.maxDependents === 1 ? '' : 's'}` : 'Employee only');
const facts = computed<Fact[]>(() => {
  if (!p.value) return [];
  const v = p.value;
  return [
    { label: 'Type', value: TYPE_LABELS[v.type] },
    { label: 'Provider', value: v.provider },
    { label: 'Policy number', value: v.policyNumber, mono: true },
    { label: 'Policy period', value: `${formatDate(v.coverageStartsOn)} – ${formatDate(v.coverageEndsOn)}` },
    { label: 'Mandatory', value: v.mandatory ? 'Yes, provided to everyone' : 'No, employees choose' },
    { label: 'Changes approved by HR', value: v.requiresApproval ? 'Yes' : 'No, automatic' },
    { label: 'Last updated', value: formatDate(v.updatedAt) },
  ];
});
const dateTile = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return { day: d.getDate(), month: d.toLocaleDateString(appLocale(), { month: 'short' }) };
};
</script>

<template>
  <div>
    <AppSkeleton v-if="plan.loading.value && !p" :lines="8" />
    <AppErrorState v-else-if="plan.error.value" :error="plan.error.value" @retry="plan.run" />
    <template v-else-if="p">
      <AppPageHeader :title="p.name" :description="[TYPE_LABELS[p.type], p.provider, p.policyNumber ? `policy ${p.policyNumber}` : null].filter(Boolean).join(' · ')" back="/hr/benefits/plans" back-label="Benefit plans">
        <template #leading>
          <span v-if="visual" :class="['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', visual.tile]" aria-hidden="true"><component :is="visual.icon" :size="22" /></span>
        </template>
        <template #badges>
          <AppBadge :tone="planTone[p.status]" dot>{{ PLAN_STATUS_LABELS[p.status] }}</AppBadge>
          <AppBadge v-if="win && p.status !== 'ARCHIVED'" :tone="win.tone" :dot="win.state === 'open'">{{ win.label }}{{ win.state === 'open' ? ` · ${win.detail}` : '' }}</AppBadge>
          <AppBadge v-if="p.mandatory" tone="info">Mandatory</AppBadge>
          <AppBadge v-if="p.requiresApproval">HR approves</AppBadge>
        </template>
        <template #actions>
          <AppButton v-if="p.status === 'ACTIVE'" variant="secondary" :icon="Download" @click="census">Census</AppButton>
          <AppButton v-if="p.status === 'ACTIVE' && p.mandatory" variant="secondary" :icon="Users" :loading="busy === 'eligible'" @click="enrollEligible">Enrol everyone eligible</AppButton>
          <AppButton v-if="p.status !== 'ARCHIVED'" variant="secondary" :icon="Pencil" @click="editing = true">Edit</AppButton>
          <AppButton v-if="p.status === 'DRAFT'" variant="ghost" :icon="Trash2" aria-label="Delete plan" @click="remove" />
          <AppButton v-if="p.status === 'ACTIVE'" variant="ghost" :icon="Archive" :loading="busy === 'archive'" @click="archive">Archive</AppButton>
          <AppButton v-if="p.status === 'ACTIVE' && !p.renewal" variant="secondary" :icon="RefreshCw" :loading="busy === 'renew'" @click="renew">Renew</AppButton>
          <AppButton v-if="p.status === 'DRAFT'" :icon="Rocket" :loading="busy === 'activate'" @click="activate">Activate</AppButton>
        </template>
      </AppPageHeader>

      <div class="space-y-4">
        <AppAlert v-if="p.renewal" tone="info">
          Renewed as <RouterLink :to="`/hr/benefits/plans/${p.renewal.id}`" class="font-medium underline">{{ p.renewal.name }}</RouterLink> from {{ formatDate(p.renewal.coverageStartsOn) }} ({{ PLAN_STATUS_LABELS[p.renewal.status].toLowerCase() }}).
        </AppAlert>
        <AppAlert v-if="p.renewedFrom" tone="info">
          Renewal of <RouterLink :to="`/hr/benefits/plans/${p.renewedFrom.id}`" class="font-medium underline">{{ p.renewedFrom.name }}</RouterLink>, which ends {{ formatDate(p.renewedFrom.coverageEndsOn) }}.
          <template v-if="p.status === 'DRAFT'"> Activating it carries everyone covered then over to this plan.</template>
        </AppAlert>
        <AppAlert v-if="p.status === 'DRAFT' && !p.renewedFrom" tone="warning">This plan is a draft. Employees can't see it until you activate it.</AppAlert>

        <AppStatStrip :items="strip" label="Coverage and cost" />

        <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
          <div class="min-w-0 space-y-4">
            <AppCard title="Coverage options" :icon="Layers" :description="`${p.options.length} option${p.options.length === 1 ? '' : 's'} employees choose from`">
              <p v-if="!p.options.length" class="text-sm text-fg-muted">No options yet. Edit the plan to add what employees can choose.</p>
              <ul v-else class="grid gap-3 md:grid-cols-2">
                <li v-for="o in p.options" :key="o.id" :class="['rounded-xl p-4 ring-1 ring-inset', o.isDefault ? 'bg-accent-soft/40 ring-brand-500/30' : 'ring-line']">
                  <div class="flex items-start justify-between gap-2">
                    <p class="font-semibold text-fg">{{ o.name }}</p>
                    <AppBadge v-if="o.isDefault" size="sm" tone="brand">Default</AppBadge>
                  </div>
                  <p class="mt-2 text-xs text-fg-muted">{{ o.coverageAmount ? 'Sum insured' : 'Cover' }}</p>
                  <p class="text-2xl leading-8 font-semibold tracking-tight text-fg tabular-nums">{{ o.coverageAmount ? inr(o.coverageAmount) : 'No sum insured' }}</p>

                  <div class="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                    <div class="h-full bg-brand-500" :style="{ width: `${employeePct(o)}%` }" />
                    <div class="h-full bg-violet-400 dark:bg-violet-500" :style="{ width: `${optionTotal(o) ? 100 - employeePct(o) : 0}%` }" />
                  </div>
                  <dl class="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt class="flex items-center gap-1.5 text-fg-muted"><span class="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />Employee / month</dt>
                      <dd class="mt-0.5 text-sm font-semibold text-fg tabular-nums">{{ o.employeeMonthly ? inr(o.employeeMonthly) : 'No cost' }}</dd>
                    </div>
                    <div>
                      <dt class="flex items-center gap-1.5 text-fg-muted"><span class="h-1.5 w-1.5 rounded-full bg-violet-400 dark:bg-violet-500" aria-hidden="true" />Employer / month</dt>
                      <dd class="mt-0.5 text-sm font-semibold text-fg tabular-nums">{{ inr(o.employerMonthly) }}</dd>
                    </div>
                  </dl>

                  <div class="mt-3 border-t border-line/70 pt-3">
                    <p class="flex items-center gap-1.5 text-xs font-medium text-fg"><UserCheck :size="13" class="text-fg-subtle" aria-hidden="true" />{{ who(o) }}</p>
                    <ul v-if="o.maxDependents && o.allowedRelations.length" class="mt-1.5 flex flex-wrap gap-1">
                      <li v-for="r in o.allowedRelations" :key="r" class="rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted ring-1 ring-line ring-inset">{{ RELATION_LABELS[r] }}</li>
                    </ul>
                  </div>
                </li>
              </ul>
            </AppCard>

            <EnrollmentsTable :key="tableKey" :plan-id="p.id" title="Enrolments" compact @changed="plan.run" />
          </div>

          <aside class="space-y-4">
            <AppCard v-if="win" title="Open enrolment" :icon="Timer">
              <div v-if="p.enrollmentOpensOn && p.enrollmentClosesOn" class="flex items-center gap-3">
                <div class="flex w-14 shrink-0 flex-col items-center rounded-lg bg-surface-muted py-1.5">
                  <span class="text-2xs font-semibold text-fg-muted uppercase">{{ dateTile(win.state === 'upcoming' ? p.enrollmentOpensOn : p.enrollmentClosesOn).month }}</span>
                  <span class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ dateTile(win.state === 'upcoming' ? p.enrollmentOpensOn : p.enrollmentClosesOn).day }}</span>
                </div>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-fg">
                    <template v-if="win.state === 'open'">{{ win.daysLeft ? `Closes in ${win.daysLeft} day${win.daysLeft === 1 ? '' : 's'}` : 'Closes today' }}</template>
                    <template v-else-if="win.state === 'upcoming'">Opens {{ win.detail }}</template>
                    <template v-else>Closed</template>
                  </p>
                  <p class="text-xs text-fg-muted tabular-nums">{{ formatDate(p.enrollmentOpensOn) }} – {{ formatDate(p.enrollmentClosesOn) }}</p>
                </div>
                <AppBadge class="ms-auto" size="sm" :tone="win.tone" :dot="win.state === 'open'">{{ win.state === 'open' ? 'Open' : win.state === 'upcoming' ? 'Upcoming' : 'Closed' }}</AppBadge>
              </div>
              <p v-else class="text-sm text-fg-muted">No open enrolment window is set. Employees can still change their cover within 30 days of a life event.</p>
              <p v-if="win.state === 'closed' || win.state === 'open'" class="mt-3 text-xs text-fg-muted">After the window, changes need a life event such as marriage or a birth.</p>
            </AppCard>

            <AppCard title="Policy" :icon="FileText">
              <p class="mb-3 inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-fg-muted ring-1 ring-line ring-inset">
                <CalendarRange :size="12" aria-hidden="true" />{{ policyTiming(p) }}
              </p>
              <AppFacts :items="facts" />
            </AppCard>

            <AppCard title="Who is eligible" :icon="ShieldCheck">
              <dl class="space-y-2 text-sm">
                <div v-for="r in eligibilityRows" :key="r.label" class="flex items-baseline justify-between gap-3">
                  <dt class="shrink-0 text-fg-muted">{{ r.label }}</dt>
                  <dd :class="['min-w-0 text-end', r.open ? 'text-fg-subtle' : 'font-medium text-fg']">{{ r.value }}</dd>
                </div>
              </dl>
            </AppCard>

            <AppCard v-if="p.description" title="About this plan">
              <p class="text-sm whitespace-pre-line text-fg-muted">{{ p.description }}</p>
            </AppCard>
          </aside>
        </div>
      </div>
      <PlanFormModal :open="editing" :plan="p" @close="editing = false" @saved="onSaved" />
    </template>
  </div>
</template>
