<script setup lang="ts">
import { reactive, ref } from 'vue';
import { AppWindow } from '@lucide/vue';
import { integrationsApi } from '@/modules/integrations/integrations.api';
import { useVectorStore } from '@/modules/integrations/vector.store';
import { AppAlert, AppBadge, AppButton, AppInput } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Sign in with the caller’s Vector account and open the embedded workspace. */
const emit = defineEmits<{ open: [session: { url: string; title: string }] }>();
const vector = useVectorStore();
const feedback = useFeedbackStore();
const connect = reactive({ email: '', password: '' });
const { fieldErrors, formError, handle, reset } = useFormErrors();
const connecting = ref(false);

async function openVector() {
  reset();
  connecting.value = true;
  try {
    const result = await integrationsApi.connectVector({ email: connect.email.trim(), password: connect.password });
    connect.password = '';
    emit('open', {
      url: result.embedUrl,
      title: result.organization?.name ? `${result.organization.name} · Vector` : 'Vector workspace',
    });
    if (result.organization) await vector.refresh();
    feedback.success(result.organization ? `Opened ${result.organization.name}` : 'Vector opened');
  } catch (e) {
    handle(e, 'Could not open Vector');
  } finally {
    connecting.value = false;
  }
}
</script>

<template>
  <section class="card" aria-labelledby="vector-open-title">
    <header class="flex min-h-14 flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg ring-1 ring-accent/15 ring-inset" aria-hidden="true"><AppWindow :size="17" /></span>
      <div class="min-w-0 flex-1">
        <h2 id="vector-open-title" class="text-sm font-semibold text-fg">Open Vector</h2>
        <p class="text-xs text-fg-muted">
          Sign in with your <span class="font-medium text-fg">Vector</span> email and password
          <template v-if="vector.orgLabel"> for {{ vector.orgLabel }}</template>
          — not your HRMS password. The workspace fills this page.
        </p>
      </div>
      <AppBadge tone="success" dot>Ready</AppBadge>
    </header>
    <form class="space-y-4 px-5 py-6" novalidate @submit.prevent="openVector">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 md:grid-cols-2">
        <AppInput v-model="connect.email" type="email" label="Vector email" required autocomplete="username" :error="fieldErrors.email" />
        <AppInput v-model="connect.password" type="password" label="Vector password" required autocomplete="current-password" :error="fieldErrors.password" />
      </div>
      <div class="flex justify-end">
        <AppButton type="submit" :icon="AppWindow" :loading="connecting" :disabled="!connect.email.trim() || !connect.password">Open full workspace</AppButton>
      </div>
    </form>
  </section>
</template>
