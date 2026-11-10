<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { MailCheck, MailX } from '@lucide/vue';
import { notificationsApi } from '@/modules/notifications/api/notifications.api';
import type { NotificationEmailSettings } from '@/modules/notifications/types';
import { AppAlert, AppButton, AppErrorState, AppModal, AppSkeleton, AppSwitch } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const feedback = useFeedbackStore();

const settings = ref<NotificationEmailSettings | null>(null);
const error = ref<unknown>(null);
const email = ref(true);
const muted = ref<string[]>([]);
const saving = ref(false);

async function load() {
  error.value = null;
  try {
    settings.value = await notificationsApi.settings();
    email.value = settings.value.email;
    muted.value = [...settings.value.muted];
  } catch (e) {
    error.value = e;
  }
}
watch(
  () => props.open,
  (open) => {
    if (open) void load();
  },
  { immediate: true },
);

const on = (key: string) => !muted.value.includes(key);
function toggle(key: string, value: boolean) {
  muted.value = value ? muted.value.filter((k) => k !== key) : [...muted.value, key];
}
const emailed = computed(() => settings.value?.categories.filter((c) => on(c.key)).length ?? 0);

async function save() {
  saving.value = true;
  try {
    await notificationsApi.saveSettings({ email: email.value, muted: muted.value });
    feedback.success(email.value ? 'Email choices saved' : 'Notification emails turned off');
    emit('close');
  } catch (e) {
    feedback.error('Could not save email choices', e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Email notifications" description="Everything always shows up here in the app. Choose what's also sent to your inbox." size="md" dialog :guide="false" @close="emit('close')">
    <AppErrorState v-if="error" :error="error" @retry="load" />
    <div v-else-if="!settings" class="space-y-3"><AppSkeleton v-for="i in 5" :key="i" class="h-10" /></div>
    <div v-else class="space-y-4">
      <div class="flex items-center gap-3 rounded-xl border border-line bg-surface-muted/50 p-3">
        <span :class="['grid h-9 w-9 shrink-0 place-items-center rounded-lg', email ? 'bg-brand-500/10 text-brand-600' : 'bg-surface-muted text-fg-subtle']">
          <component :is="email ? MailCheck : MailX" class="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <AppSwitch v-model="email" class="flex-1" label="Send me notification emails" :description="email ? `${emailed} of ${settings.categories.length} kinds are emailed.` : 'Only in the app.'" />
      </div>
      <AppAlert tone="info">Security alerts (new sign-ins, password and bank account changes) are always emailed.</AppAlert>
      <ul :class="['divide-y divide-line/60 rounded-xl border border-line', !email && 'opacity-50']" aria-label="Kinds of notification">
        <li v-for="c in settings.categories" :key="c.key" class="px-3 py-2.5">
          <AppSwitch :model-value="on(c.key)" :disabled="!email" :label="c.label" :description="c.description" @update:model-value="toggle(c.key, $event)" />
        </li>
      </ul>
    </div>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton :loading="saving" :disabled="!settings" @click="save">Save</AppButton>
    </template>
  </AppModal>
</template>
