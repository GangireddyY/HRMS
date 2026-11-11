<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { BellOff, BellRing, MonitorSmartphone } from '@lucide/vue';
import { notificationsApi } from '@/modules/notifications/api/notifications.api';
import type { PushStatus } from '@/modules/notifications/types';
import { currentSubscription, pushSupport, subscribeBrowser, subscriptionBody, type PushSupport } from '@/modules/notifications/utils/web-push';
import { AppButton } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Browser notifications for this device: on/off, with the account-wide switch turned back on when needed. */
const emit = defineEmits<{ changed: [status: PushStatus] }>();
const feedback = useFeedbackStore();
const status = ref<PushStatus | null>(null);
const support = ref<PushSupport>(pushSupport());
const here = ref(false);
const busy = ref(false);

onMounted(async () => {
  try {
    status.value = await notificationsApi.pushStatus();
    here.value = support.value === 'supported' && !!(await currentSubscription());
  } catch {
    status.value = null;
  }
});

const active = computed(() => here.value && !!status.value?.on);
const description = computed(() => {
  if (support.value === 'unsupported') return "This browser can't show notifications from HRMS.";
  if (support.value === 'blocked') return 'Notifications are blocked for this site. Allow them in the browser’s site settings, then try again.';
  if (active.value) return `On for this browser${status.value && status.value.devices > 1 ? ` and ${status.value.devices - 1} other device${status.value.devices > 2 ? 's' : ''}` : ''}. Same kinds as your emails.`;
  return 'Get a notification on this device even when HRMS isn’t open. The same kinds as your emails.';
});

async function turnOn() {
  if (!status.value?.publicKey) return;
  busy.value = true;
  try {
    const sub = await subscribeBrowser(status.value.publicKey);
    support.value = pushSupport();
    if (!sub) return;
    let next = await notificationsApi.subscribe(subscriptionBody(sub));
    if (!next.on) {
      const s = await notificationsApi.settings();
      await notificationsApi.saveSettings({ email: s.email, muted: s.muted, push: true });
      next = { ...next, on: true };
    }
    status.value = next;
    here.value = true;
    emit('changed', next);
    feedback.success('Browser notifications turned on');
  } catch (e) {
    feedback.error('Could not turn on browser notifications', e);
  } finally {
    busy.value = false;
  }
}

async function turnOff() {
  busy.value = true;
  try {
    const sub = await currentSubscription();
    if (sub) {
      status.value = await notificationsApi.unsubscribe(sub.endpoint);
      await sub.unsubscribe();
    }
    here.value = false;
    if (status.value) emit('changed', status.value);
    feedback.success('Browser notifications turned off for this browser');
  } catch (e) {
    feedback.error('Could not turn off browser notifications', e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="status?.enabled" class="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-muted/50 p-3">
    <span :class="['grid h-9 w-9 shrink-0 place-items-center rounded-lg', active ? 'bg-brand-500/10 text-brand-600' : 'bg-surface-muted text-fg-subtle']" aria-hidden="true">
      <component :is="active ? BellRing : support === 'supported' ? MonitorSmartphone : BellOff" class="h-4.5 w-4.5" />
    </span>
    <div class="min-w-0 flex-1 basis-52">
      <p class="text-sm font-medium text-fg">Browser notifications</p>
      <p class="text-xs text-fg-muted">{{ description }}</p>
    </div>
    <AppButton v-if="support === 'supported' && !active" size="sm" :loading="busy" @click="turnOn">Turn on here</AppButton>
    <AppButton v-else-if="active" size="sm" variant="secondary" :loading="busy" @click="turnOff">Turn off here</AppButton>
  </div>
</template>
