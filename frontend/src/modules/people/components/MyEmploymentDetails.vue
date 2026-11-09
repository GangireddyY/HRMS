<script setup lang="ts">
import { computed, reactive, ref, watch, type Component } from 'vue';
import {
  BadgeCheck,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Droplet,
  Hash,
  HeartPulse,
  Hourglass,
  Layers,
  Lock,
  Mail,
  MapPin,
  Phone,
  PartyPopper,
  Save,
  UserRound,
  UsersRound,
} from '@lucide/vue';
import type { BloodGroup, MaritalStatus } from '@contracts';
import { employeesApi } from '@/modules/people/api/people.api';
import type { Employee } from '@/modules/people/types';
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, GENDER_LABELS, bloodGroupOptions, employeeStatusTone, maritalStatusOptions } from '@/modules/people/utils/labels';
import { AppAlert, AppAvatar, AppBadge, AppButton, AppCard, AppCheckbox, AppInput, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDate } from '@/shared/utils/format';
import { profileCover } from '@/shared/utils/profile-cover';

type EmploymentTab = 'details' | 'background' | 'documents';

/** The self-service employment record: profile header, job facts (HR-maintained), personal details form and a side panel. */
const props = defineProps<{ employee: Employee; canEdit: boolean; counts: { family: number; education: number; experience: number; documents: number } | null }>();
const emit = defineEmits<{ updated: [employee: Employee]; go: [tab: EmploymentTab] }>();
const feedback = useFeedbackStore();

// ---- Dates -----------------------------------------------------------------------------------------------------
const DAY = 86_400_000;
const today = new Date();
const atMidnight = (iso: string) => new Date(`${iso}T00:00:00`);
function tenure(from: string): string {
  const start = atMidnight(from);
  let months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
  if (today.getDate() < start.getDate()) months--;
  if (months < 1) return 'Less than a month';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y && `${y} yr${y === 1 ? '' : 's'}`, m && `${m} mo${m === 1 ? '' : 's'}`].filter(Boolean).join(' ');
}
const nextAnniversary = computed(() => {
  const start = atMidnight(props.employee.dateOfJoining);
  const next = new Date(today.getFullYear(), start.getMonth(), start.getDate());
  if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) next.setFullYear(next.getFullYear() + 1);
  const years = next.getFullYear() - start.getFullYear();
  const inDays = Math.round((next.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / DAY);
  return years > 0 ? { date: next, years, inDays } : null;
});
const probation = computed(() => {
  const e = props.employee;
  if (e.confirmedOn) return { label: 'Confirmed', date: e.confirmedOn, done: true };
  if (e.probationEndDate) return { label: atMidnight(e.probationEndDate) < today ? 'Probation ended' : 'Probation ends', date: e.probationEndDate, done: atMidnight(e.probationEndDate) < today };
  return null;
});

// ---- Job facts (read-only) -------------------------------------------------------------------------------------
const facts = computed<{ label: string; value: string; icon: Component; mono?: boolean }[]>(() => {
  const e = props.employee;
  return [
    { label: 'Employee ID', value: e.employeeCode, icon: Hash, mono: true },
    { label: 'Designation', value: e.designation?.name ?? '—', icon: BadgeCheck },
    { label: 'Department', value: e.department?.name ?? '—', icon: Building2 },
    { label: 'Grade', value: e.grade?.name ?? '—', icon: Layers },
    { label: 'Location', value: e.location?.name ?? '—', icon: MapPin },
    { label: 'Employment type', value: EMPLOYMENT_TYPE_LABELS[e.employmentType], icon: UserRound },
    { label: 'Work email', value: e.workEmail ?? '—', icon: Mail },
    { label: 'Shift', value: e.shift?.name ?? 'Default shift', icon: Clock },
    { label: 'Cost center', value: e.costCenter ? `${e.costCenter.name} (${e.costCenter.code})` : '—', icon: CircleDollarSign },
    { label: 'Date of joining', value: formatDate(e.dateOfJoining), icon: CalendarDays },
    { label: 'Notice period', value: e.noticePeriodDays === null ? '—' : `${e.noticePeriodDays} days`, icon: Hourglass },
    { label: 'Reports to', value: e.manager?.name ?? '—', icon: UsersRound },
  ];
});

// ---- Personal details form -------------------------------------------------------------------------------------
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const FIELDS = ['personalEmail', 'phone', 'address', 'permanentAddress', 'emergencyContactName', 'emergencyContactPhone'] as const;
const form = reactive({
  personalEmail: '',
  phone: '',
  address: '',
  permanentAddress: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  maritalStatus: null as MaritalStatus | null,
  bloodGroup: null as BloodGroup | null,
});
/** An empty permanent address means "the same as the current one". */
const sameAddress = ref(true);
function load(e: Employee) {
  for (const k of FIELDS) form[k] = e[k] ?? '';
  form.maritalStatus = e.maritalStatus;
  form.bloodGroup = e.bloodGroup;
  sameAddress.value = !e.permanentAddress;
}
watch(() => props.employee, load, { immediate: true });
watch(sameAddress, (same) => same && (form.permanentAddress = ''));
const dirty = computed(() => {
  const e = props.employee;
  return FIELDS.some((k) => form[k] !== (e[k] ?? '')) || form.maritalStatus !== e.maritalStatus || form.bloodGroup !== e.bloodGroup;
});
async function save() {
  reset();
  saving.value = true;
  try {
    const updated = await employeesApi.updateMe({
      ...Object.fromEntries(FIELDS.map((k) => [k, form[k] || null])),
      maritalStatus: form.maritalStatus,
      bloodGroup: form.bloodGroup,
    });
    emit('updated', updated);
    feedback.success('Your details were updated');
  } catch (e) {
    handle(e, 'Could not update your details');
  } finally {
    saving.value = false;
  }
}

// ---- Profile completeness --------------------------------------------------------------------------------------
const checklist = computed<{ label: string; done: boolean; tab?: EmploymentTab }[]>(() => {
  const e = props.employee;
  const c = props.counts;
  return [
    { label: 'Personal email', done: !!e.personalEmail },
    { label: 'Phone number', done: !!e.phone },
    { label: 'Current address', done: !!e.address },
    { label: 'Emergency contact', done: !!(e.emergencyContactName && e.emergencyContactPhone) },
    { label: 'Blood group', done: !!e.bloodGroup },
    { label: 'Family members', done: !!c?.family, tab: 'background' },
    { label: 'Education', done: !!c?.education, tab: 'background' },
    { label: 'Documents', done: !!c?.documents, tab: 'documents' },
  ];
});
const completeness = computed(() => Math.round((checklist.value.filter((i) => i.done).length / checklist.value.length) * 100));
const ringTone = computed(() => (completeness.value >= 80 ? 'text-success' : completeness.value >= 50 ? 'text-warning' : 'text-danger'));
const CIRCUMFERENCE = 2 * Math.PI * 18;
</script>

<template>
  <div class="space-y-4">
    <!-- Profile header -->
    <section class="card overflow-hidden">
      <div class="h-24 border-b border-line/50" :style="profileCover(employee.id)" aria-hidden="true" />
      <div class="flex flex-wrap items-end gap-x-5 gap-y-4 px-5 pb-5">
        <div class="relative z-10 -mt-12 rounded-full bg-surface p-1 shadow-sm">
          <AppAvatar :name="employee.fullName" :src="employee.avatarUrl" size="2xl" />
        </div>
        <div class="min-w-0 flex-1 pt-3">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="truncate text-xl font-semibold tracking-tight text-fg">{{ employee.fullName }}</h2>
            <AppBadge :tone="employeeStatusTone[employee.status]" dot>{{ EMPLOYEE_STATUS_LABELS[employee.status] }}</AppBadge>
          </div>
          <p class="mt-0.5 text-sm text-fg-muted">{{ [employee.designation?.name, employee.department?.name].filter(Boolean).join(' · ') || 'No designation yet' }}</p>
          <ul class="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-fg-muted">
            <li class="inline-flex items-center gap-1.5"><Hash :size="13" aria-hidden="true" /><span class="font-mono text-fg">{{ employee.employeeCode }}</span></li>
            <li v-if="employee.location" class="inline-flex items-center gap-1.5"><MapPin :size="13" aria-hidden="true" />{{ employee.location.name }}</li>
            <li v-if="employee.workEmail" class="inline-flex items-center gap-1.5"><Mail :size="13" aria-hidden="true" />{{ employee.workEmail }}</li>
            <li class="inline-flex items-center gap-1.5"><CalendarDays :size="13" aria-hidden="true" />Joined {{ formatDate(employee.dateOfJoining) }} · <span class="font-medium text-fg">{{ tenure(employee.dateOfJoining) }}</span></li>
          </ul>
        </div>
        <div class="flex items-center gap-3 rounded-xl bg-surface-muted/70 px-4 py-3 ring-1 ring-line/60 ring-inset">
          <svg class="h-12 w-12 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
            <circle cx="22" cy="22" r="18" fill="none" stroke-width="4" class="stroke-line" />
            <circle cx="22" cy="22" r="18" fill="none" stroke-width="4" stroke-linecap="round" :class="['stroke-current transition-[stroke-dashoffset] duration-700', ringTone]" :stroke-dasharray="CIRCUMFERENCE" :stroke-dashoffset="CIRCUMFERENCE * (1 - completeness / 100)" />
          </svg>
          <div>
            <p class="text-lg leading-6 font-semibold text-fg tabular-nums">{{ completeness }}%</p>
            <p class="text-xs text-fg-muted">Profile complete</p>
          </div>
        </div>
      </div>
    </section>

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div class="space-y-4">
        <!-- Job information -->
        <AppCard title="Job information" :icon="BadgeCheck" description="Maintained by HR. If something here is wrong, let your HR team know.">
          <template #actions><span class="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-medium text-fg-muted"><Lock :size="11" aria-hidden="true" />Read only</span></template>
          <dl class="grid gap-px overflow-hidden rounded-lg bg-line/60 ring-1 ring-line/60 sm:grid-cols-2 2xl:grid-cols-3">
            <div v-for="f in facts" :key="f.label" class="flex min-w-0 items-start gap-3 bg-surface px-3.5 py-3">
              <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><component :is="f.icon" :size="14" /></span>
              <div class="min-w-0">
                <dt class="text-2xs font-medium text-fg-muted">{{ f.label }}</dt>
                <dd :class="['mt-0.5 truncate text-sm text-fg', f.mono && 'font-mono']" :title="f.value">{{ f.value }}</dd>
              </div>
            </div>
          </dl>
        </AppCard>

        <!-- Personal & contact details (not an AppCard: the save bar must be able to stick, so nothing here clips overflow). -->
        <section class="card">
          <header class="flex min-h-12 items-center gap-3 border-b border-line/70 px-4 py-2">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-gradient-to-b from-surface to-surface-muted text-accent-fg shadow-xs" aria-hidden="true"><UserRound :size="16" /></span>
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-fg">Personal & contact details</h2>
              <p class="text-xs text-fg-muted">{{ canEdit ? 'Only you and HR can see these. Keep them current so HR can reach you or your family.' : 'Only you and HR can see these.' }}</p>
            </div>
          </header>
          <div class="p-4">
          <dl class="mb-5 grid gap-3 rounded-lg bg-surface-muted/60 px-4 py-3 text-sm sm:grid-cols-3">
            <div><dt class="text-2xs font-medium text-fg-muted">Date of birth</dt><dd class="mt-0.5 text-fg">{{ employee.dateOfBirth ? formatDate(employee.dateOfBirth) : '—' }}</dd></div>
            <div><dt class="text-2xs font-medium text-fg-muted">Gender</dt><dd class="mt-0.5 text-fg">{{ employee.gender ? GENDER_LABELS[employee.gender] : '—' }}</dd></div>
            <div><dt class="text-2xs font-medium text-fg-muted">Nationality</dt><dd class="mt-0.5 text-fg">{{ employee.nationality ?? '—' }}</dd></div>
          </dl>
          <form id="my-details" class="space-y-6" novalidate @submit.prevent="save">
            <AppAlert v-if="formError">{{ formError }}</AppAlert>
            <fieldset :disabled="!canEdit" class="space-y-3">
              <legend class="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-muted uppercase"><Phone :size="13" aria-hidden="true" />Contact</legend>
              <div class="grid gap-4 sm:grid-cols-2">
                <AppInput v-model="form.personalEmail" label="Personal email" type="email" autocomplete="email" placeholder="name@example.com" :error="fieldErrors.personalEmail" />
                <AppInput v-model="form.phone" label="Mobile phone" type="tel" autocomplete="tel" placeholder="+91 98765 43210" :error="fieldErrors.phone" />
              </div>
            </fieldset>
            <fieldset :disabled="!canEdit" class="space-y-3">
              <legend class="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-muted uppercase"><Droplet :size="13" aria-hidden="true" />Personal</legend>
              <div class="grid gap-4 sm:grid-cols-2">
                <AppSelect v-model="form.maritalStatus" label="Marital status" placeholder="Not specified" :options="maritalStatusOptions" :error="fieldErrors.maritalStatus" />
                <AppSelect v-model="form.bloodGroup" label="Blood group" placeholder="Not specified" :options="bloodGroupOptions" help="Shared with first aiders in an emergency." :error="fieldErrors.bloodGroup" />
              </div>
            </fieldset>
            <fieldset :disabled="!canEdit" class="space-y-3">
              <legend class="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-muted uppercase"><HeartPulse :size="13" aria-hidden="true" />Emergency contact</legend>
              <div class="grid gap-4 sm:grid-cols-2">
                <AppInput v-model="form.emergencyContactName" label="Name and relationship" placeholder="e.g. Rahul Patel (spouse)" :error="fieldErrors.emergencyContactName" />
                <AppInput v-model="form.emergencyContactPhone" label="Phone" type="tel" placeholder="+91 98765 43210" :error="fieldErrors.emergencyContactPhone" />
              </div>
            </fieldset>
            <fieldset :disabled="!canEdit" class="space-y-3">
              <legend class="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-muted uppercase"><MapPin :size="13" aria-hidden="true" />Addresses</legend>
              <AppTextarea v-model="form.address" label="Current address" :rows="2" :maxlength="500" placeholder="House / flat, street, area, city, state, PIN code" :error="fieldErrors.address" />
              <AppCheckbox v-model="sameAddress" label="My permanent address is the same as my current address" :disabled="!canEdit" />
              <AppTextarea v-if="!sameAddress" v-model="form.permanentAddress" label="Permanent address" :rows="2" :maxlength="500" :error="fieldErrors.permanentAddress" />
            </fieldset>
          </form>
          <!-- Appears only with unsaved changes, and stays in view while scrolling. -->
          <div v-if="canEdit && dirty" class="sticky bottom-0 z-10 -mx-4 -mb-4 mt-5 flex flex-wrap items-center gap-3 rounded-b-md border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
            <span class="me-auto inline-flex items-center gap-2 text-sm text-fg-muted"><span class="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />You have unsaved changes</span>
            <AppButton variant="ghost" @click="load(employee)">Discard</AppButton>
            <AppButton type="submit" form="my-details" :icon="Save" :loading="saving">Save changes</AppButton>
          </div>
          </div>
        </section>
      </div>

      <aside class="space-y-4">
        <!-- Profile checklist -->
        <AppCard title="Complete your profile">
          <div class="mb-3 flex items-center justify-between text-xs text-fg-muted">
            <span>{{ checklist.filter((i) => i.done).length }} of {{ checklist.length }} done</span>
            <span class="font-semibold text-fg tabular-nums">{{ completeness }}%</span>
          </div>
          <div class="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <div :class="['h-full rounded-full bg-current transition-[width] duration-700', ringTone]" :style="{ width: `${completeness}%` }" />
          </div>
          <ul class="-mx-1 space-y-0.5">
            <li v-for="i in checklist" :key="i.label">
              <component
                :is="i.tab && !i.done ? 'button' : 'div'"
                :type="i.tab && !i.done ? 'button' : undefined"
                :class="['flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-start text-sm', i.tab && !i.done && 'cursor-pointer hover:bg-surface-muted']"
                @click="i.tab && !i.done && emit('go', i.tab)"
              >
                <span v-if="i.done" class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-fg" aria-hidden="true"><Check :size="12" :stroke-width="3" /></span>
                <span v-else class="h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-line-strong" aria-hidden="true" />
                <span :class="['flex-1', i.done ? 'text-fg-muted line-through decoration-fg-subtle/50' : 'text-fg']">{{ i.label }}</span>
                <span class="sr-only">{{ i.done ? 'done' : 'to do' }}</span>
                <ChevronRight v-if="i.tab && !i.done" :size="14" class="text-fg-subtle" aria-hidden="true" />
              </component>
            </li>
          </ul>
        </AppCard>

        <!-- Reporting line -->
        <AppCard title="Reporting line">
          <ol class="space-y-0">
            <li v-if="employee.manager" class="flex items-center gap-3">
              <AppAvatar :name="employee.manager.name" size="md" />
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-fg">{{ employee.manager.name }}</p>
                <p class="text-xs text-fg-muted">Manager · <span class="font-mono">{{ employee.manager.employeeCode }}</span></p>
              </div>
            </li>
            <li v-if="employee.manager" class="ms-[18px] h-5 border-s-2 border-dashed border-line" aria-hidden="true" />
            <li class="flex items-center gap-3">
              <AppAvatar :name="employee.fullName" :src="employee.avatarUrl" size="md" class="ring-brand-500/40" />
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-fg">{{ employee.fullName }} <span class="text-xs font-normal text-fg-muted">(you)</span></p>
                <p class="truncate text-xs text-fg-muted">{{ employee.designation?.name ?? '—' }}</p>
              </div>
            </li>
          </ol>
          <p v-if="!employee.manager" class="mt-3 text-xs text-fg-muted">No manager is set on your record.</p>
        </AppCard>

        <!-- Key dates -->
        <AppCard title="Key dates">
          <ol class="relative space-y-4 border-s border-line ps-5">
            <li class="relative">
              <span class="absolute -start-[29px] flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 ring-4 ring-surface" aria-hidden="true"><CalendarCheck :size="9" class="text-white" /></span>
              <p class="text-sm font-medium text-fg">Joined</p>
              <p class="text-xs text-fg-muted">{{ formatDate(employee.dateOfJoining) }} · {{ tenure(employee.dateOfJoining) }} ago</p>
            </li>
            <li v-if="probation" class="relative">
              <span :class="['absolute -start-[29px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-surface', probation.done ? 'bg-success' : 'bg-warning']" aria-hidden="true"><Hourglass :size="9" class="text-white" /></span>
              <p class="text-sm font-medium text-fg">{{ probation.label }}</p>
              <p class="text-xs text-fg-muted">{{ formatDate(probation.date) }}</p>
            </li>
            <li v-if="nextAnniversary" class="relative">
              <span class="absolute -start-[29px] flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 ring-4 ring-surface" aria-hidden="true"><PartyPopper :size="9" class="text-white" /></span>
              <p class="text-sm font-medium text-fg">{{ nextAnniversary.years }}-year work anniversary</p>
              <p class="text-xs text-fg-muted">{{ formatDate(nextAnniversary.date) }} · {{ nextAnniversary.inDays === 0 ? 'today' : `in ${nextAnniversary.inDays} days` }}</p>
            </li>
            <li v-if="employee.exitDate" class="relative">
              <span class="absolute -start-[29px] flex h-4 w-4 items-center justify-center rounded-full bg-danger ring-4 ring-surface" aria-hidden="true"><CalendarClock :size="9" class="text-white" /></span>
              <p class="text-sm font-medium text-fg">Last working day</p>
              <p class="text-xs text-fg-muted">{{ formatDate(employee.exitDate) }}</p>
            </li>
          </ol>
        </AppCard>
      </aside>
    </div>
  </div>
</template>
