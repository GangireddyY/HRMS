<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowRight, Check, Circle, X } from '@lucide/vue';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { useAuthStore } from '@/core/auth/auth.store';
import { isAllowed, type AccessRule } from '@/core/navigation/access-rules';
import { attendanceApi } from '@/modules/attendance/api/attendance.api';
import { leaveApi } from '@/modules/leave/api/leave.api';
import { organizationApi } from '@/modules/organization/api/organization.api';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import { employeesApi, structureApi } from '@/modules/people/api/people.api';
import { usersApi } from '@/modules/users/api/users.api';
import { AppButton } from '@/shared/components';

/**
 * First-run guide for administrators: the setup steps a new organization needs, each checked against real data
 * (so it ticks itself off) and shown only when the admin can open the page that does it. Hidden per organization.
 */
interface Step {
  key: string;
  title: string;
  description: string;
  to: string;
  check: () => Promise<boolean>;
}

const auth = useAuthStore();
const router = useRouter();
const subject = useAccessSubject();
const year = new Date().getFullYear();

const STEPS: Step[] = [
  { key: 'profile', title: 'Complete the company profile', description: 'Legal name and address appear on payslips and letters.', to: '/admin/organization', check: async () => { const o = await organizationApi.get(); return !!(o.legalName && o.addressLine1 && o.city); } },
  { key: 'brand', title: 'Add your logo and brand color', description: 'Everyone sees your brand in the sidebar and theme.', to: '/admin/organization', check: async () => { const o = await organizationApi.get(); return !!(o.logoUrl || o.brandColor); } },
  { key: 'structure', title: 'Set up departments and designations', description: 'Used for reporting lines, approvals and reports.', to: '/admin/structure', check: async () => (await structureApi.departments()).length > 0 },
  { key: 'holidays', title: `Publish ${year} holidays`, description: 'Holidays shape attendance, leave and the calendars.', to: '/admin/holidays', check: async () => (await attendanceApi.holidays(year)).length > 0 },
  { key: 'leave', title: 'Choose leave types', description: 'Start from the recommended set and adjust the rules.', to: '/hr/leave/types', check: async () => (await leaveApi.types()).length > 0 },
  { key: 'people', title: 'Add your employees', description: 'Add them one by one or import a spreadsheet.', to: '/hr/employees', check: async () => (await employeesApi.list({ page: 1, pageSize: 1 })).meta.total > 1 },
  { key: 'invite', title: 'Invite your team', description: 'People sign in to apply for leave, see payslips and more.', to: '/admin/users', check: async () => (await usersApi.list({ page: 1, pageSize: 1 })).meta.total > 1 },
  { key: 'payroll', title: 'Set up payroll', description: 'Salary components and structures for monthly runs.', to: '/hr/payroll/setup', check: async () => (await payrollApi.structures()).length > 0 },
  { key: 'security', title: 'Require two-factor sign-in', description: 'Protects payroll and personal data from stolen passwords.', to: '/admin/organization', check: async () => (await organizationApi.securityPolicy()).mfaRequired },
];

const hiddenKey = computed(() => `hrms.setupHidden.${auth.organization?.id ?? ''}`);
const hidden = ref(false);
const results = ref<Record<string, boolean>>({});
const loaded = ref(false);

/** Steps the admin can act on (page access) whose check could run. */
const steps = computed(() =>
  STEPS.filter((s) => {
    const access = router.resolve(s.to).meta.access as AccessRule | undefined;
    return isAllowed(access, subject.value) && s.key in results.value;
  }),
);
const done = computed(() => steps.value.filter((s) => results.value[s.key]).length);
const complete = computed(() => loaded.value && steps.value.length > 0 && done.value === steps.value.length);
const nextStep = computed(() => steps.value.find((s) => !results.value[s.key]));

onMounted(async () => {
  try {
    hidden.value = localStorage.getItem(hiddenKey.value) === '1';
  } catch {
    hidden.value = false;
  }
  if (hidden.value) return;
  const checked = await Promise.all(
    STEPS.map(async (s) => {
      const access = router.resolve(s.to).meta.access as AccessRule | undefined;
      if (!isAllowed(access, subject.value)) return [s.key, null] as const;
      try {
        return [s.key, await s.check()] as const;
      } catch {
        return [s.key, null] as const;
      }
    }),
  );
  results.value = Object.fromEntries(checked.filter(([, v]) => v !== null)) as Record<string, boolean>;
  loaded.value = true;
});

function hide() {
  hidden.value = true;
  try {
    localStorage.setItem(hiddenKey.value, '1');
  } catch {
    // Storage unavailable: hidden for this visit only.
  }
}
</script>

<template>
  <section v-if="!hidden && loaded && steps.length" class="card overflow-hidden" aria-labelledby="setup-title">
    <header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line/70 px-4 py-3">
      <div class="min-w-0 flex-1">
        <h2 id="setup-title" class="text-sm font-semibold text-fg">{{ complete ? 'Setup complete' : `Set up ${auth.organization?.name ?? 'your organization'}` }}</h2>
        <p class="text-xs text-fg-muted">{{ complete ? 'Everything essential is in place. You can hide this guide.' : `${done} of ${steps.length} done · next: ${nextStep?.title.toLowerCase()}` }}</p>
      </div>
      <div class="flex w-40 items-center gap-2" role="progressbar" :aria-valuenow="done" :aria-valuemin="0" :aria-valuemax="steps.length" aria-label="Setup progress">
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted"><span class="block h-full rounded-full bg-success transition-[width] duration-500" :style="{ width: `${(done / steps.length) * 100}%` }" /></span>
        <span class="text-xs font-medium text-fg-muted tabular-nums">{{ Math.round((done / steps.length) * 100) }}%</span>
      </div>
      <AppButton size="sm" variant="ghost" :icon="X" @click="hide">Hide</AppButton>
    </header>
    <template v-if="!complete">
      <ol class="divide-y divide-line/70" aria-label="Steps to do">
        <li v-for="s in steps.filter((x) => !results[x.key])" :key="s.key" :class="['flex items-center gap-3 px-4 py-2.5', s.key === nextStep?.key && 'bg-accent-soft/40']">
          <span :class="['flex h-6 w-6 shrink-0 items-center justify-center', s.key === nextStep?.key ? 'text-accent-fg' : 'text-fg-subtle']" aria-hidden="true"><Circle :size="18" /></span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-fg">{{ s.title }}<span class="sr-only"> (to do)</span></p>
            <p class="text-xs text-fg-muted">{{ s.description }}</p>
          </div>
          <AppButton size="sm" :variant="s.key === nextStep?.key ? 'primary' : 'secondary'" :icon-right="ArrowRight" :to="s.to">Set up</AppButton>
        </li>
      </ol>
      <div v-if="done" class="flex flex-wrap items-center gap-1.5 border-t border-line/70 bg-surface-muted/40 px-4 py-2.5">
        <span class="me-1 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">Done</span>
        <ul class="contents" aria-label="Completed steps">
          <li v-for="s in steps.filter((x) => results[x.key])" :key="s.key" class="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-2xs font-medium text-success-fg">
            <Check :size="11" :stroke-width="3" aria-hidden="true" />{{ s.title }}
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
