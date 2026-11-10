<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ShieldCheck } from '@lucide/vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { settleStepUp, stepUp } from '@/core/auth/step-up';
import { http } from '@/core/http/http-client';
import { AppAlert, AppButton, AppInput, AppModal } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Re-confirm identity before a sensitive action (decrypted exports, deleting audit records). Valid for 15 minutes. */
const auth = useAuthStore();
const withCode = computed(() => !!auth.context?.user.mfaEnabled);
const value = ref('');
const busy = ref(false);
const { formError, handle, reset } = useFormErrors();

watch(
  () => stepUp.open,
  (open) => {
    if (!open) return;
    value.value = '';
    reset();
  },
);

async function confirm() {
  busy.value = true;
  reset();
  try {
    await http.post('/auth/step-up', withCode.value ? { code: value.value.trim() } : { password: value.value });
    settleStepUp(true);
  } catch (e) {
    handle(e, withCode.value ? 'That code did not work' : 'That password did not work');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppModal :open="stepUp.open" title="Confirm it's you" :description="stepUp.message || 'This action handles sensitive data.'" size="sm" dialog @close="settleStepUp(false)">
    <form id="step-up-form" class="space-y-4" novalidate @submit.prevent="confirm">
      <p class="flex items-start gap-2 text-sm text-fg-muted">
        <ShieldCheck :size="16" class="mt-0.5 shrink-0 text-accent-fg" aria-hidden="true" />
        You won't be asked again for 15 minutes on this device.
      </p>
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppInput
        v-if="withCode"
        v-model="value"
        label="Authenticator code"
        inputmode="numeric"
        autocomplete="one-time-code"
        :maxlength="6"
        placeholder="123456"
        required
      />
      <AppInput v-else v-model="value" type="password" label="Password" autocomplete="current-password" required />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="settleStepUp(false)">Cancel</AppButton>
      <AppButton type="submit" form="step-up-form" :loading="busy" :disabled="withCode ? !/^\d{6}$/.test(value.trim()) : !value">Confirm</AppButton>
    </template>
  </AppModal>
</template>
