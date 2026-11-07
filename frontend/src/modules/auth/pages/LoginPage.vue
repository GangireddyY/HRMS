<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, ArrowRight, Building2, KeyRound, Lock, LogIn, Mail, ShieldCheck } from '@lucide/vue';
import { AppAlert, AppButton, AppInput, AppOtpInput } from '@/shared/components';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { homePath } from '@/core/navigation/workspaces';
import { useAuthStore } from '@/core/auth/auth.store';
import { safeRedirect } from '@/shared/utils/redirect';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const subject = useAccessSubject();
const { fieldErrors, formError, handle, reset } = useFormErrors();

const step = ref<'credentials' | 'mfa'>('credentials');
const email = ref(typeof route.query.email === 'string' ? route.query.email : '');
const password = ref('');
const code = ref('');
const recoveryCode = ref('');
const useRecovery = ref(false);
const challengeToken = ref('');
const submitting = ref(false);

async function finish() {
  await router.replace(safeRedirect(route.query.redirect) ?? homePath(subject.value));
}

/** Instant feedback for empty or malformed fields; the server remains the authority. */
function validateCredentials(): boolean {
  const errors: Record<string, string> = {};
  const value = email.value.trim();
  if (!value) errors.email = 'Enter your work email';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.email = 'Enter a valid email address';
  if (!password.value) errors.password = 'Enter your password';
  fieldErrors.value = errors;
  return Object.keys(errors).length === 0;
}

async function submitCredentials() {
  reset();
  if (!validateCredentials()) return;
  submitting.value = true;
  try {
    const result = await auth.login(email.value, password.value);
    if (result.status === 'MFA_REQUIRED') {
      challengeToken.value = result.challengeToken;
      step.value = 'mfa';
      password.value = '';
      return;
    }
    await finish();
  } catch (e) {
    handle(e, 'Sign-in failed');
  } finally {
    submitting.value = false;
  }
}

async function submitMfa() {
  reset();
  submitting.value = true;
  try {
    await auth.verifyMfa(challengeToken.value, useRecovery.value ? { recoveryCode: recoveryCode.value.trim() } : { code: code.value.trim() });
    await finish();
  } catch (e) {
    handle(e, 'Verification failed');
    code.value = '';
  } finally {
    submitting.value = false;
  }
}

function backToCredentials() {
  step.value = 'credentials';
  code.value = '';
  recoveryCode.value = '';
  reset();
}
</script>

<template>
  <div :class="step === 'credentials' && 'auth-page-tall'">
    <template v-if="step === 'credentials'">
      <span class="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br short:hidden from-brand-500 to-brand-700 text-white shadow-[0_8px_24px_-6px_var(--brand-500),inset_0_1px_0_rgb(255_255_255/0.25)]">
        <LogIn :size="22" aria-hidden="true" />
      </span>
      <h1 class="text-2xl leading-tight font-semibold tracking-tight sm:text-[32px] short:text-2xl">Welcome back</h1>
      <p class="mt-2 text-base text-fg-muted short:mt-1 short:text-sm">Sign in to continue to your workspace.</p>

      <form class="mt-4 space-y-5 short:space-y-3" novalidate @submit.prevent="submitCredentials">
        <AppAlert v-if="formError" title="Couldn't sign you in">{{ formError }}</AppAlert>
        <AppInput
          v-model="email"
          label="Work email"
          type="email"
          autocomplete="username"
          inputmode="email"
          size="lg"
          :icon="Mail"
          placeholder="you@company.com"
          :error="fieldErrors.email"
        />
        <AppInput v-model="password" label="Password" type="password" autocomplete="current-password" size="lg" :icon="Lock" placeholder="Enter your password" :error="fieldErrors.password">
          <template #label-action>
            <RouterLink to="/forgot-password" class="rounded text-sm font-medium text-brand-600 transition hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">Forgot password?</RouterLink>
          </template>
        </AppInput>
        <AppButton type="submit" block size="lg" :loading="submitting" :icon-right="ArrowRight" class="group">Sign in</AppButton>
      </form>

      <div class="mt-auto pt-6 short:pt-4">
        <div class="mb-6 flex items-center gap-3 text-xs text-fg-subtle short:mb-3" aria-hidden="true">
          <span class="h-px flex-1 bg-line" /> New to HRMS? <span class="h-px flex-1 bg-line" />
        </div>
        <AppButton to="/register" variant="secondary" block size="lg" :icon="Building2">Create an organization</AppButton>
      </div>
    </template>

    <template v-else>
      <button type="button" class="mb-4 inline-flex items-center gap-1 rounded-md text-sm font-medium text-fg-muted transition hover:text-fg" @click="backToCredentials">
        <ArrowLeft :size="14" /> Back
      </button>
      <span class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-600/15 ring-inset dark:bg-brand-500/12 dark:text-brand-300">
        <ShieldCheck :size="22" aria-hidden="true" />
      </span>
      <h1 class="text-2xl leading-tight font-semibold tracking-tight sm:text-[32px]">Two-factor verification</h1>
      <p class="mt-2 text-base text-fg-muted">
        {{ useRecovery ? 'Enter one of your one-time recovery codes.' : 'Enter the 6-digit code from your authenticator app.' }}
      </p>
      <form class="mt-4 space-y-4" novalidate @submit.prevent="submitMfa">
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppOtpInput v-if="!useRecovery" v-model="code" label="Authentication code" :error="fieldErrors.code" autofocus />
        <AppInput v-else v-model="recoveryCode" label="Recovery code" autocomplete="off" placeholder="XXXX-XXXX-XXXX" size="lg" :icon="KeyRound" required :error="fieldErrors.recoveryCode" />
        <AppButton type="submit" block size="lg" :loading="submitting" :disabled="useRecovery ? recoveryCode.length < 12 : code.length !== 6">Verify</AppButton>
        <button type="button" class="w-full text-center text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" @click="useRecovery = !useRecovery; reset()">
          {{ useRecovery ? 'Use authenticator code instead' : 'Use a recovery code' }}
        </button>
      </form>
    </template>
  </div>
</template>
