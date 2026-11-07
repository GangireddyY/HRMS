<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Archive, Download, Pencil, RefreshCw, Rocket, Trash2, Users } from '@lucide/vue';
import { benefitsApi } from '@/modules/benefits/api/benefits.api';
import EnrollmentsTable from '@/modules/benefits/components/EnrollmentsTable.vue';
import PlanFormModal from '@/modules/benefits/components/PlanFormModal.vue';
import type { Plan } from '@/modules/benefits/types';
import { PLAN_STATUS_LABELS, RELATION_LABELS, TYPE_LABELS, inr, planTone } from '@/modules/benefits/utils/benefits-format';
import { structureApi } from '@/modules/people/api/people.api';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppPageHeader, AppSkeleton, AppStatCard } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';

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
const eligibility = computed(() => {
  if (!p.value) return [];
  const v = p.value;
  return [
    v.employmentTypes?.length ? v.employmentTypes.map((t) => EMPLOYMENT_TYPE_LABELS[t]).join(', ') : 'All employment types',
    names(v.departmentIds, departments.data.value) ?? 'all departments',
    names(v.locationIds, locations.data.value) ?? 'all locations',
    names(v.gradeIds, grades.data.value) ?? 'all grades',
    v.waitingDays ? `after ${v.waitingDays} days of service` : 'from joining',
    v.maxChildAge ? `children up to ${v.maxChildAge}` : null,
  ].filter(Boolean);
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
</script>

<template>
  <div>
    <AppSkeleton v-if="plan.loading.value && !p" :lines="8" />
    <AppErrorState v-else-if="plan.error.value" :error="plan.error.value" @retry="plan.run" />
    <template v-else-if="p">
      <AppPageHeader :title="p.name" :description="[TYPE_LABELS[p.type], p.provider, p.policyNumber ? `policy ${p.policyNumber}` : null].filter(Boolean).join(' · ')" back="/hr/benefits/plans" back-label="Benefit plans">
        <template #badges>
          <AppBadge :tone="planTone[p.status]" dot>{{ PLAN_STATUS_LABELS[p.status] }}</AppBadge>
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
      <AppAlert v-if="p.renewal" tone="info" class="mb-6">
        Renewed as <RouterLink :to="`/hr/benefits/plans/${p.renewal.id}`" class="font-medium underline">{{ p.renewal.name }}</RouterLink> from {{ formatDate(p.renewal.coverageStartsOn) }} ({{ PLAN_STATUS_LABELS[p.renewal.status].toLowerCase() }}).
      </AppAlert>
      <AppAlert v-if="p.renewedFrom" tone="info" class="mb-6">
        Renewal of <RouterLink :to="`/hr/benefits/plans/${p.renewedFrom.id}`" class="font-medium underline">{{ p.renewedFrom.name }}</RouterLink>, which ends {{ formatDate(p.renewedFrom.coverageEndsOn) }}.
        <template v-if="p.status === 'DRAFT'"> Activating it carries everyone covered then over to this plan.</template>
      </AppAlert>

      <div class="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AppStatCard label="Covered" :value="p.stats?.enrolled ?? 0" />
        <AppStatCard label="Waiting for approval" :value="p.stats?.pending ?? 0" tone="warning" />
        <AppStatCard label="Waived" :value="p.stats?.waived ?? 0" tone="info" />
        <AppStatCard label="Employer cost / month" :value="inr(p.stats?.employerMonthly ?? 0)" tone="success" :hint="`Employees pay ${inr(p.stats?.employeeMonthly ?? 0)}`" />
      </div>

      <div class="mb-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <AppCard title="Coverage options" :padded="false">
          <ul class="divide-y divide-line">
            <li v-for="o in p.options" :key="o.id" class="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div class="min-w-0 flex-1">
                <p class="font-medium text-fg">{{ o.name }} <AppBadge v-if="o.isDefault" size="sm" tone="brand">Default</AppBadge></p>
                <p class="text-xs text-fg-muted">
                  {{ o.coverageAmount ? `Sum insured ${inr(o.coverageAmount)}` : 'No sum insured' }}
                  · {{ o.maxDependents ? `up to ${o.maxDependents} dependant${o.maxDependents === 1 ? '' : 's'}: ${o.allowedRelations.map((r) => RELATION_LABELS[r].toLowerCase()).join(', ')}` : 'employee only' }}
                </p>
              </div>
              <div class="text-right text-xs text-fg-muted">
                <p><span class="font-medium text-fg tabular-nums">{{ inr(o.employeeMonthly) }}</span> employee / month</p>
                <p><span class="font-medium text-fg tabular-nums">{{ inr(o.employerMonthly) }}</span> employer / month</p>
              </div>
            </li>
          </ul>
        </AppCard>
        <AppCard title="Rules">
          <dl class="space-y-3 text-sm">
            <div>
              <dt class="text-fg-muted">Policy period</dt>
              <dd class="text-fg">{{ formatDate(p.coverageStartsOn) }} – {{ formatDate(p.coverageEndsOn) }}</dd>
            </div>
            <div>
              <dt class="text-fg-muted">Open enrolment</dt>
              <dd class="text-fg">{{ p.enrollmentOpensOn ? `${formatDate(p.enrollmentOpensOn)} – ${formatDate(p.enrollmentClosesOn!)}` : 'No window set' }}</dd>
            </div>
            <div>
              <dt class="text-fg-muted">Eligible</dt>
              <dd class="text-fg">{{ eligibility.join('; ') }}</dd>
            </div>
          </dl>
          <p v-if="p.description" class="mt-3 border-t border-line pt-3 text-sm whitespace-pre-line text-fg-muted">{{ p.description }}</p>
        </AppCard>
      </div>

      <h2 class="mb-3 text-base font-semibold text-fg">Enrolments</h2>
      <EnrollmentsTable :key="tableKey" :plan-id="p.id" @changed="plan.run" />
      <PlanFormModal :open="editing" :plan="p" @close="editing = false" @saved="onSaved" />
    </template>
  </div>
</template>
