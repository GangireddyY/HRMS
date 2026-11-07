<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { validatePassword } from '@contracts';
import { authApi } from '@/modules/auth/api/auth.api';
import { AppAlert, AppButton, AppInput, AppPasswordChecklist, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const token = typeof route.query.token === 'string' ? route.query.token : '';
const inspection = useAsync(() => authApi.inspectToken(token, 'INVITATION'));
const firstName = ref('');
const lastName = ref('');
const password = ref('');
const confirm = ref('');
const submitting = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();

watch(inspection.data, (d) => {
  if (d) {
    firstName.value = d.firstName;
    lastName.value = d.lastName;
  }
});

const existing = computed(() => inspection.data.value?.existingAccount ?? false);
const valid = computed(() => {
  const d = inspection.data.value;
  if (!d) return false;
  if (existing.value) return password.value.length > 0;
  return !!firstName.value.trim() && !!lastName.value.trim() && validatePassword(password.value, d.passwordPolicy).length === 0 && password.value === confirm.value;
});

async function submit() {
  reset();
  submitting.value = true;
  try {
    const { email } = await authApi.acceptInvitation({
      token,
      password: password.value,
      ...(existing.value ? {} : { firstName: firstName.value.trim(), lastName: lastName.value.trim() }),
    });
    if (auth.isAuthenticated) await auth.logout();
    feedback.success(`You've joined ${inspection.data.value?.organizationName}`, 'Sign in to continue.');
    await router.replace({ name: 'login', query: { email } });
  } catch (e) {
    handle(e, 'Could not accept invitation');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <h1 class="text-[32px] leading-tight font-semibold tracking-tight">Accept your invitation</h1>
    <div class="mt-4">
      <AppSkeleton v-if="inspection.loading.value" :lines="5" />
      <AppAlert v-else-if="inspection.error.value || !token">This invitation link is invalid, already used, or has expired. Ask your administrator to resend it.</AppAlert>
      <form v-else-if="inspection.data.value" class="space-y-4" novalidate @submit.prevent="submit">
        <p class="text-sm text-fg-muted">
          You've been invited to join <strong class="text-fg">{{ inspection.data.value.organizationName }}</strong> as
          <strong class="text-fg">{{ inspection.data.value.email }}</strong>.
        </p>
        <AppAlert v-if="formError">{{ formError }}</AppAlert>
        <template v-if="existing">
          <AppAlert tone="info">You already have an HRMS account. Confirm your current password to join this organization.</AppAlert>
          <AppInput v-model="password" label="Current password" type="password" autocomplete="current-password" required :error="fieldErrors.password" />
        </template>
        <template v-else>
          <div class="grid grid-cols-2 gap-3">
            <AppInput v-model="firstName" label="First name" autocomplete="given-name" required :error="fieldErrors.firstName" />
            <AppInput v-model="lastName" label="Last name" autocomplete="family-name" required :error="fieldErrors.lastName" />
          </div>
          <AppInput v-model="password" label="Create password" type="password" autocomplete="new-password" required :error="fieldErrors.password" />
          <AppPasswordChecklist :password="password" :policy="inspection.data.value.passwordPolicy" />
          <AppInput v-model="confirm" label="Confirm password" type="password" autocomplete="new-password" required :error="confirm && confirm !== password ? 'Passwords do not match' : undefined" />
        </template>
        <AppButton type="submit" block size="lg" :loading="submitting" :disabled="!valid">Join organization</AppButton>
      </form>
    </div>
  </div>
</template>
