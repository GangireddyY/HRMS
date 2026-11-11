<script setup lang="ts">
import { computed, ref } from 'vue';
import { MessageCircle } from '@lucide/vue';
import { notificationsApi } from '@/modules/notifications/api/notifications.api';
import type { NotificationEmailSettings } from '@/modules/notifications/types';
import { AppButton, AppInput, AppSwitch } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** WhatsApp messages: add a number, confirm it with the code sent there, then switch the messages on or off. */
const props = defineProps<{ settings: NotificationEmailSettings }>();
const on = defineModel<boolean>({ required: true });
const emit = defineEmits<{ changed: [settings: NotificationEmailSettings] }>();
const feedback = useFeedbackStore();

const wa = computed(() => props.settings.whatsapp);
const number = ref('');
const code = ref('');
const changing = ref(false);
const busy = ref<'send' | 'confirm' | 'remove' | null>(null);
const numberError = ref<string | undefined>();
const codeError = ref<string | undefined>();

async function call(key: 'send' | 'confirm' | 'remove', fn: () => Promise<NotificationEmailSettings>, success: string) {
  busy.value = key;
  numberError.value = codeError.value = undefined;
  try {
    const next = await fn();
    emit('changed', next);
    on.value = next.whatsapp.on;
    feedback.success(success);
    if (key !== 'send') changing.value = false;
    code.value = '';
  } catch (e) {
    const issue = (e as { details?: { field: string; message: string }[] }).details?.[0];
    if (issue?.field === 'number') numberError.value = issue.message;
    else if (issue?.field === 'code') codeError.value = issue.message;
    else feedback.error('Could not update WhatsApp', e);
  } finally {
    busy.value = null;
  }
}
const send = () => call('send', () => notificationsApi.whatsappVerify(number.value || wa.value.pendingNumber || ''), 'Code sent on WhatsApp');
const confirm = () => call('confirm', () => notificationsApi.whatsappConfirm(code.value), 'WhatsApp number confirmed');
const remove = () => call('remove', () => notificationsApi.whatsappRemove(), 'WhatsApp number removed');
</script>

<template>
  <div v-if="wa.available" class="space-y-3 rounded-xl border border-line bg-surface-muted/50 p-3">
    <div class="flex items-center gap-3">
      <span :class="['grid h-9 w-9 shrink-0 place-items-center rounded-lg', wa.on ? 'bg-success-soft text-success-fg' : 'bg-surface-muted text-fg-subtle']" aria-hidden="true"><MessageCircle class="h-4.5 w-4.5" /></span>
      <AppSwitch v-if="wa.verified && !changing" v-model="on" class="flex-1" label="WhatsApp messages" :description="`To ${wa.number}. The same kinds as your emails; just the title and a link.`" />
      <div v-else class="min-w-0 flex-1">
        <p class="text-sm font-medium text-fg">WhatsApp messages</p>
        <p class="text-xs text-fg-muted">Get approvals and updates on WhatsApp too. We send a code to confirm the number is yours.</p>
      </div>
    </div>

    <form v-if="wa.pendingNumber && !changing" class="flex flex-wrap items-end gap-2" novalidate @submit.prevent="confirm">
      <AppInput v-model="code" class="w-40" label="Code" inputmode="numeric" autocomplete="one-time-code" :maxlength="6" :error="codeError" :help="`Sent to ${wa.pendingNumber}`" />
      <AppButton type="submit" size="sm" :loading="busy === 'confirm'" :disabled="code.length !== 6">Confirm</AppButton>
      <AppButton size="sm" variant="ghost" :loading="busy === 'send'" @click="send">Send again</AppButton>
      <AppButton size="sm" variant="ghost" @click="changing = true">Use another number</AppButton>
    </form>
    <form v-else-if="!wa.verified || changing" class="flex flex-wrap items-end gap-2" novalidate @submit.prevent="send">
      <AppInput v-model="number" class="min-w-52 flex-1" label="WhatsApp number" type="tel" inputmode="tel" autocomplete="tel" placeholder="+91 98765 43210" :error="numberError" />
      <AppButton type="submit" size="sm" :loading="busy === 'send'" :disabled="number.trim().length < 8">Send code</AppButton>
      <AppButton v-if="changing" size="sm" variant="ghost" @click="changing = false">Cancel</AppButton>
    </form>
    <div v-else class="flex justify-end gap-2">
      <AppButton size="xs" variant="ghost" @click="changing = true">Change number</AppButton>
      <AppButton size="xs" variant="ghost" :loading="busy === 'remove'" @click="remove">Remove</AppButton>
    </div>
  </div>
</template>
