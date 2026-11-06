<script setup lang="ts">
import { ref } from 'vue';
import { ArrowLeft, ArrowRight, KeyRound, Mail } from '@lucide/vue';
import { authApi } from '@/modules/auth/api/auth.api';
import { AppAlert, AppButton, AppInput } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

const email = ref('');
const sent = ref(false);
const submitting = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();

async function submit() {
  reset();
  submitting.value = true;
  try {
    await authApi.forgotPassword(email.value);
    sent.value = true;
  } catch (e) {
    handle(e, 'Could not send reset link');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <RouterLink to="/login" class="group mb-8 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-fg-muted transition hover:text-fg">
      <ArrowLeft :size="14" class="transition group-hover:-translate-x-0.5" /> Back to sign in
    </RouterLink>
    <span class="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-600/15 ring-inset dark:bg-brand-500/12 dark:text-brand-300">
      <KeyRound :size="22" aria-hidden="true" />
    </span>
    <h1 class="text-[32px] leading-tight font-semibold tracking-tight">Reset your password</h1>
    <p class="mt-2 text-[15px] text-fg-muted">We'll email you a secure link to choose a new password.</p>
    <AppAlert v-if="sent" tone="success" title="Check your inbox" class="mt-8">
      If an account exists for <strong>{{ email }}</strong>, a reset link is on its way. The link expires in 30 minutes.
    </AppAlert>
    <form v-else class="mt-8 space-y-5" novalidate @submit.prevent="submit">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppInput v-model="email" label="Work email" type="email" autocomplete="email" size="lg" :icon="Mail" placeholder="you@company.com" :error="fieldErrors.email" />
      <AppButton type="submit" block size="lg" :icon-right="ArrowRight" :loading="submitting" :disabled="!email">Send reset link</AppButton>
    </form>
  </div>
</template>
