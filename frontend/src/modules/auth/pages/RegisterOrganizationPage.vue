<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, ArrowRight, Building2, Check, UserRound } from '@lucide/vue';
import { DEFAULT_PASSWORD_POLICY, validatePassword } from '@contracts';
import { AppAlert, AppButton, AppInput, AppPasswordChecklist, AppSelect } from '@/shared/components';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { homePath } from '@/core/navigation/workspaces';
import { useAuthStore } from '@/core/auth/auth.store';
import { COMPANY_SIZE_OPTIONS, COUNTRY_OPTIONS, CURRENCY_OPTIONS, timezoneOptions } from '@/shared/utils/options';

const auth = useAuthStore();
const router = useRouter();
const subject = useAccessSubject();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const submitting = ref(false);
const timezones = timezoneOptions();

const org = reactive({
  name: '',
  country: 'IN',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
  currency: 'INR',
  industry: '',
  companySize: '11-50' as string | null,
});
const admin = reactive({ firstName: '', lastName: '', email: '', password: '' });

const STEPS = [
  { key: 'organization', title: 'Organization', hint: 'Workspace details', icon: Building2 },
  { key: 'account', title: 'Your account', hint: 'Admin sign-in', icon: UserRound },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

const step = ref<StepKey>('organization');
const stepIndex = computed(() => STEPS.findIndex((s) => s.key === step.value));
const formEl = ref<HTMLFormElement | null>(null);
/** Client-side messages; server field errors (fieldErrors) take precedence when present. */
const localErrors = reactive<Record<string, string | undefined>>({});

function errorFor(path: string): string | undefined {
  return fieldErrors.value[path] ?? localErrors[path];
}

function validateOrganization(): boolean {
  localErrors['organization.name'] = org.name.trim().length >= 2 ? undefined : 'Enter your organization name (at least 2 characters)';
  return !localErrors['organization.name'];
}

function validateAccount(): boolean {
  localErrors['admin.firstName'] = admin.firstName.trim() ? undefined : 'Enter your first name';
  localErrors['admin.lastName'] = admin.lastName.trim() ? undefined : 'Enter your last name';
  const email = admin.email.trim();
  localErrors['admin.email'] = !email ? 'Enter your work email' : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? undefined : 'Enter a valid email address';
  localErrors['admin.password'] = !admin.password
    ? 'Choose a password'
    : validatePassword(admin.password, DEFAULT_PASSWORD_POLICY).length
      ? 'The password does not meet the requirements below'
      : undefined;
  return !['admin.firstName', 'admin.lastName', 'admin.email', 'admin.password'].some((k) => localErrors[k]);
}

const organizationDone = computed(() => org.name.trim().length >= 2);
const stepHasErrors = (key: StepKey) =>
  Object.entries({ ...localErrors, ...fieldErrors.value }).some(([path, msg]) => msg && path.startsWith(key === 'organization' ? 'organization.' : 'admin.'));

async function goTo(key: StepKey) {
  if (key === step.value) return;
  if (key === 'account' && !validateOrganization()) return;
  step.value = key;
  await nextTick();
  formEl.value?.querySelector<HTMLInputElement>('input:not([type=hidden]), button[aria-haspopup]')?.focus();
}

async function submit() {
  if (step.value === 'organization') return goTo('account');
  if (!validateOrganization()) return goTo('organization');
  if (!validateAccount()) return;
  reset();
  submitting.value = true;
  try {
    await auth.registerOrganization({
      organization: { ...org, name: org.name.trim(), industry: org.industry.trim() || undefined, companySize: org.companySize ?? undefined },
      admin: { ...admin, firstName: admin.firstName.trim(), lastName: admin.lastName.trim(), email: admin.email.trim() },
    });
    await router.replace(homePath(subject.value));
  } catch (e) {
    handle(e, 'Registration failed');
    if (stepHasErrors('organization')) step.value = 'organization';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="auth-page-tall">
    <h1 class="text-[32px] leading-tight font-semibold tracking-tight">Create your organization</h1>
    <p class="mt-2 text-sm text-fg-muted">Set up your workspace and become its admin.</p>

    <!-- Steps -->
    <nav class="mt-5" aria-label="Sign-up steps">
      <ol class="grid grid-cols-2 gap-1 rounded-2xl bg-surface-muted p-1 ring-1 ring-line ring-inset">
        <li v-for="(s, i) in STEPS" :key="s.key">
          <button
            type="button"
            :aria-current="step === s.key ? 'step' : undefined"
            :class="[
              'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition',
              step === s.key ? 'bg-surface shadow-card ring-1 ring-line' : 'hover:bg-surface/60',
            ]"
            @click="goTo(s.key)"
          >
            <span
              :class="[
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition',
                stepHasErrors(s.key)
                  ? 'bg-red-500/10 text-red-600 ring-1 ring-red-500/30 dark:text-red-400'
                  : step === s.key
                    ? 'bg-brand-600 text-white shadow-[0_4px_12px_-4px_var(--brand-600)]'
                    : i < stepIndex || (s.key === 'organization' && organizationDone)
                      ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300'
                      : 'bg-surface text-fg-subtle ring-1 ring-line',
              ]"
            >
              <Check v-if="i < stepIndex && !stepHasErrors(s.key)" :size="14" aria-hidden="true" />
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="min-w-0">
              <span :class="['block truncate text-sm font-semibold', step === s.key ? 'text-fg' : 'text-fg-muted']">{{ s.title }}</span>
              <span class="block truncate text-xs text-fg-subtle">{{ s.hint }}</span>
            </span>
          </button>
        </li>
      </ol>
      <div class="mt-3 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <div class="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-500 ease-out" :style="{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }" />
      </div>
    </nav>

    <form ref="formEl" class="mt-5" novalidate @submit.prevent="submit">
      <AppAlert v-if="formError" class="mb-5">{{ formError }}</AppAlert>

      <Transition mode="out-in" enter-active-class="transition duration-300 ease-out" enter-from-class="opacity-0 translate-x-3" leave-active-class="transition duration-150" leave-to-class="opacity-0 -translate-x-3">
        <fieldset v-if="step === 'organization'" key="organization" class="space-y-4">
          <legend class="sr-only">Organization</legend>
          <AppInput v-model="org.name" label="Organization name" required autocomplete="organization" :error="errorFor('organization.name')" />
          <div class="grid grid-cols-2 gap-3">
            <AppSelect v-model="org.country" label="Country" :options="COUNTRY_OPTIONS" :error="errorFor('organization.country')" />
            <AppSelect v-model="org.currency" label="Currency" :options="CURRENCY_OPTIONS" :error="errorFor('organization.currency')" />
          </div>
          <AppSelect v-model="org.timezone" label="Time zone" :options="timezones" :error="errorFor('organization.timezone')" />
          <div class="grid grid-cols-2 gap-3">
            <AppInput v-model="org.industry" label="Industry" placeholder="e.g. IT services" :error="errorFor('organization.industry')" />
            <AppSelect v-model="org.companySize" label="Company size" :options="COMPANY_SIZE_OPTIONS" :error="errorFor('organization.companySize')" />
          </div>
        </fieldset>

        <fieldset v-else key="account" class="space-y-4">
          <legend class="sr-only">Your account</legend>
          <div class="grid grid-cols-2 gap-3">
            <AppInput v-model="admin.firstName" label="First name" required autocomplete="given-name" :error="errorFor('admin.firstName')" />
            <AppInput v-model="admin.lastName" label="Last name" required autocomplete="family-name" :error="errorFor('admin.lastName')" />
          </div>
          <AppInput v-model="admin.email" label="Work email" type="email" required autocomplete="email" :error="errorFor('admin.email')" />
          <AppInput
            v-model="admin.password"
            label="Password"
            type="password"
            required
            autocomplete="new-password"
            :error="fieldErrors['admin.password'] ?? fieldErrors.password ?? localErrors['admin.password']"
          />
          <AppPasswordChecklist :password="admin.password" :policy="DEFAULT_PASSWORD_POLICY" />
        </fieldset>
      </Transition>

      <div class="mt-6 flex gap-3">
        <AppButton v-if="step === 'account'" type="button" variant="secondary" size="lg" :icon="ArrowLeft" :disabled="submitting" @click="goTo('organization')">Back</AppButton>
        <AppButton type="submit" block size="lg" :loading="submitting" :icon-right="step === 'organization' ? ArrowRight : undefined" class="flex-1">
          {{ step === 'organization' ? 'Continue' : 'Create organization' }}
        </AppButton>
      </div>
    </form>

    <p class="mt-auto pt-5 text-center text-sm text-fg-muted">
      Already have an account? <RouterLink to="/login" class="font-medium text-brand-600 hover:underline dark:text-brand-400">Sign in</RouterLink>
    </p>
  </div>
</template>
