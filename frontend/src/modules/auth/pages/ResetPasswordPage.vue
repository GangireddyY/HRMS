<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { validatePassword } from '@contracts';
import { authApi } from '@/modules/auth/api/auth.api';
import { AppAlert, AppButton, AppInput, AppPasswordChecklist, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const route = useRoute();
const router = useRouter();
const feedback = useFeedbackStore();
const token = typeof route.query.token === 'string' ? route.query.token : '';
const inspection = useAsync(() => authApi.inspectToken(token, 'PASSWORD_RESET'));
const password = ref('');
const confirm = ref('');
const submitting = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();

const valid = computed(() => !!inspection.data.value && validatePassword(password.value, inspection.data.value.passwordPolicy).length === 0 && password.value === confirm.value);

async function submit() {
  reset();
  submitting.value = true;
  try {
    await authApi.resetPassword(token, password.value);
    feedback.success('Password updated', 'Sign in with your new password.');
    await router.replace({ name: 'login', query: { email: inspection.data.value?.email } });
  } catch (e) {
    handle(e, 'Could not reset password');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <h1 class="text-[32px] leading-tight font-semibold tracking-tight">Choose a new password</h1>
    <div class="mt-8">
      <AppSkeleton v-if="inspection.loading.value" :lines="4" />
      <AppAlert v-else-if="inspection.error.value || !token">
        This reset link is invalid or has expired.
        <RouterLink to="/forgot-password" class="font-medium underline">Request a new link</RouterLink>
      </AppAlert>
      <form v-else-if="inspection.data.value" class="space-y-4" novalidate @submit.prevent="submit">
        <p class="text-sm text-fg-muted">Resetting password for <strong class="text-fg">{{ inspection.data.value.email }}</strong>. All active sessions will be signed out.</p>
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <AppInput v-model="password" label="New password" type="password" autocomplete="new-password" required :error="fieldErrors.password" />
        <AppPasswordChecklist :password="password" :policy="inspection.data.value.passwordPolicy" />
        <AppInput v-model="confirm" label="Confirm password" type="password" autocomplete="new-password" required :error="confirm && confirm !== password ? 'Passwords do not match' : undefined" />
        <AppButton type="submit" block size="lg" :loading="submitting" :disabled="!valid">Update password</AppButton>
      </form>
    </div>
  </div>
</template>
