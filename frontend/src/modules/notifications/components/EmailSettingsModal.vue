<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { MailCheck, MailX } from '@lucide/vue';
import { EMAIL_DIGEST_LABELS, EMAIL_DIGESTS, type EmailDigest } from '@contracts';
import { notificationsApi } from '@/modules/notifications/api/notifications.api';
import type { NotificationEmailSettings } from '@/modules/notifications/types';
import BrowserNotifications from '@/modules/notifications/components/BrowserNotifications.vue';
import CalendarFeed from '@/modules/notifications/components/CalendarFeed.vue';
import WhatsAppNotifications from '@/modules/notifications/components/WhatsAppNotifications.vue';
import { AppAlert, AppButton, AppErrorState, AppModal, AppSegmented, AppSelect, AppSkeleton, AppSwitch } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const feedback = useFeedbackStore();

const settings = ref<NotificationEmailSettings | null>(null);
const error = ref<unknown>(null);
const email = ref(true);
const muted = ref<string[]>([]);
const digest = ref<EmailDigest>('OFF');
const digestHour = ref(9);
const digestDay = ref(1);
const whatsapp = ref(false);
const calendarInvites = ref(true);
const saving = ref(false);

const DIGEST_OPTIONS = EMAIL_DIGESTS.map((d) => ({ value: d, label: EMAIL_DIGEST_LABELS[d] }));
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }) }));
const DAYS = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: new Date(2024, 0, d).toLocaleDateString([], { weekday: 'long' }) }));
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function apply(s: NotificationEmailSettings) {
  settings.value = s;
  email.value = s.email;
  muted.value = [...s.muted];
  digest.value = s.emailDigest;
  digestHour.value = s.digestHour;
  digestDay.value = s.digestDay;
  whatsapp.value = s.whatsapp.on;
  calendarInvites.value = s.calendarInvites;
}

async function load() {
  error.value = null;
  try {
    apply(await notificationsApi.settings());
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
    await notificationsApi.saveSettings({
      email: email.value,
      muted: muted.value,
      emailDigest: digest.value,
      digestHour: digestHour.value,
      digestDay: digestDay.value,
      timezone: browserZone,
      calendarInvites: calendarInvites.value,
      ...(settings.value?.whatsapp.verified ? { whatsapp: whatsapp.value } : {}),
    });
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
  <AppModal :open="open" title="Notification settings" description="Everything always shows up here in the app. Choose what's also sent to your inbox and this browser." size="md" dialog :guide="false" @close="emit('close')">
    <AppErrorState v-if="error" :error="error" @retry="load" />
    <div v-else-if="!settings" class="space-y-3"><AppSkeleton v-for="i in 5" :key="i" class="h-10" /></div>
    <div v-else class="space-y-4">
      <BrowserNotifications />
      <div class="flex items-center gap-3 rounded-xl border border-line bg-surface-muted/50 p-3">
        <span :class="['grid h-9 w-9 shrink-0 place-items-center rounded-lg', email ? 'bg-brand-500/10 text-brand-600' : 'bg-surface-muted text-fg-subtle']">
          <component :is="email ? MailCheck : MailX" class="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <AppSwitch v-model="email" class="flex-1" label="Send me notification emails" :description="email ? `${emailed} of ${settings.categories.length} kinds are emailed.` : 'Only in the app.'" />
      </div>
      <fieldset v-if="email" class="space-y-3 rounded-xl border border-line p-3">
        <legend class="px-1 text-sm font-medium text-fg">How often</legend>
        <AppSegmented v-model="digest" :options="DIGEST_OPTIONS" label="How often notification emails are sent" size="sm" />
        <div v-if="digest !== 'OFF'" class="grid gap-3 sm:grid-cols-2">
          <AppSelect v-if="digest === 'WEEKLY'" v-model="digestDay" label="On" :options="DAYS" size="sm" />
          <AppSelect v-model="digestHour" label="At" :options="HOURS" size="sm" :help="`Your time (${browserZone})`" />
        </div>
        <p class="text-xs text-fg-muted">{{ digest === 'OFF' ? 'An email for each notification, as it happens.' : 'One email listing what you haven’t read yet, instead of one per notification.' }}</p>
      </fieldset>
      <WhatsAppNotifications v-model="whatsapp" :settings="settings" @changed="apply" />
      <div class="rounded-xl border border-line p-3">
        <AppSwitch v-model="calendarInvites" label="Calendar invites" description="Approved leave, interviews and 1:1s arrive as invites your calendar adds, updates and removes." />
      </div>
      <CalendarFeed />
      <AppAlert tone="info">Security alerts (new sign-ins, password and bank account changes) are always emailed.</AppAlert>
      <p class="text-xs text-fg-muted">Kinds you turn off here are also left out of browser notifications.</p>
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
