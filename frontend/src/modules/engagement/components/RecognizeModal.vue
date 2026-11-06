<script setup lang="ts">
import { ref, watch } from 'vue';
import { RECOGNITION_BADGES, type RecognitionBadge } from '@contracts';
import { engagementApi } from '@/modules/engagement/api/engagement.api';
import BadgeIcon from '@/modules/engagement/components/BadgeIcon.vue';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import { BADGE_LABELS } from '@/modules/engagement/utils/engagement-format';
import { AppAlert, AppButton, AppModal, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Recognise one or more colleagues with a value badge and a message (shown on the wall; they're notified). */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const { fieldErrors, formError, handle, reset } = useFormErrors();
const recipients = ref<string[]>([]);
const badge = ref<RecognitionBadge>('TEAMWORK');
const message = ref('');
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    recipients.value = [];
    badge.value = 'TEAMWORK';
    message.value = '';
  },
);
async function save() {
  reset();
  saving.value = true;
  try {
    await engagementApi.recognize({ recipientIds: recipients.value, badge: badge.value, message: message.value });
    emit('saved');
  } catch (e) {
    handle(e, 'Could not post the recognition');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Recognise a colleague" description="Everyone can see it on the recognition wall." @close="emit('close')">
    <div class="space-y-4">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <ColleaguePicker v-model:values="recipients" label="Who" multiple :source="engagementApi.colleagues" />
      <p v-if="fieldErrors.recipientIds" class="error-text" role="alert">{{ fieldErrors.recipientIds }}</p>
      <fieldset>
        <legend class="label">For</legend>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label v-for="b in RECOGNITION_BADGES" :key="b" class="flex cursor-pointer items-center gap-2 rounded-xl p-2 text-sm ring-1 ring-line has-[:checked]:ring-2 has-[:checked]:ring-brand-500">
            <input v-model="badge" type="radio" name="badge" :value="b" class="sr-only" />
            <BadgeIcon :badge="b" :size="14" />
            {{ BADGE_LABELS[b] }}
          </label>
        </div>
      </fieldset>
      <AppTextarea v-model="message" label="Message" required :rows="3" :maxlength="1000" placeholder="What did they do, and why did it matter?" :error="fieldErrors.message" />
    </div>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton :loading="saving" :disabled="!recipients.length || message.trim().length < 10" @click="save">Post</AppButton>
    </template>
  </AppModal>
</template>
