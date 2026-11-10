<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { integrationsApi } from '@/modules/integrations/integrations.api';
import type { WebhookRow } from '@/modules/integrations/types';
import { AppAlert, AppButton, AppCheckbox, AppInput, AppModal } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Add a webhook (the signing secret is shown once after saving), or change its URL and events. */
const props = defineProps<{ open: boolean; webhook?: WebhookRow | null; groups: { key: string; label: string; pattern: string }[] }>();
const emit = defineEmits<{ close: []; saved: [w: WebhookRow & { secret?: string }] }>();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ url: '', description: '', all: false, patterns: [] as string[], extra: '' });
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const w = props.webhook;
    const known = new Set(props.groups.map((g) => g.pattern));
    Object.assign(form, {
      url: w?.url ?? '',
      description: w?.description ?? '',
      all: w?.events.includes('*') ?? false,
      patterns: (w?.events ?? []).filter((e) => known.has(e)),
      extra: (w?.events ?? []).filter((e) => e !== '*' && !known.has(e)).join(', '),
    });
  },
  { immediate: true },
);
const events = computed(() => (form.all ? ['*'] : [...form.patterns, ...form.extra.split(/[\s,]+/).map((e) => e.trim()).filter(Boolean)]));
function toggle(pattern: string, on: boolean) {
  form.patterns = on ? [...form.patterns, pattern] : form.patterns.filter((p) => p !== pattern);
}
const canSave = computed(() => /^https?:\/\/.+/i.test(form.url.trim()) && events.value.length > 0);
async function save() {
  reset();
  saving.value = true;
  try {
    const body = { url: form.url.trim(), description: form.description || null, events: [...new Set(events.value)] };
    emit('saved', props.webhook ? await integrationsApi.updateWebhook(props.webhook.id, body) : await integrationsApi.createWebhook(body));
  } catch (e) {
    handle(e, 'Could not save the webhook');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="webhook ? 'Edit webhook' : 'Add webhook'" description="We POST a signed JSON event to this URL whenever something it subscribes to happens." size="lg" @close="emit('close')">
    <form id="webhook-form" class="space-y-5" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppInput v-model="form.url" label="Endpoint URL" required placeholder="https://hooks.example.com/hrms" :maxlength="500" :error="fieldErrors.url" />
      <AppInput v-model="form.description" label="Description (optional)" :maxlength="200" placeholder="e.g. Sync new joiners to the IT service desk" />
      <fieldset>
        <legend class="label">Events</legend>
        <p v-if="fieldErrors.events" class="error-text" role="alert">{{ fieldErrors.events }}</p>
        <AppCheckbox v-model="form.all" label="Everything (except sign-ins and confidential cases)" />
        <div v-if="!form.all" class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg p-3 ring-1 ring-line ring-inset sm:grid-cols-3">
          <AppCheckbox v-for="g in groups" :key="g.key" :model-value="form.patterns.includes(g.pattern)" :label="g.label" @update:model-value="(v: boolean) => toggle(g.pattern, v)" />
        </div>
        <AppInput v-if="!form.all" v-model="form.extra" class="mt-3" label="Specific events (optional)" placeholder="e.g. leave.request_approved, exit.settlement_paid" help="Exact event names, separated by commas. Every event is named like the audit log action." />
      </fieldset>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="webhook-form" :loading="saving" :disabled="!canSave">{{ webhook ? 'Save' : 'Add webhook' }}</AppButton>
    </template>
  </AppModal>
</template>
