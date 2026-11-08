<script setup lang="ts">
import { computed, ref } from 'vue';
import { Check, X } from '@lucide/vue';
import AppButton from '@/shared/components/forms/AppButton.vue';
import AppTextarea from '@/shared/components/forms/AppTextarea.vue';
import AppModal from '@/shared/components/feedback/AppModal.vue';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/**
 * Approve or reject several requests at once (inside AppDataTable's `bulk` slot). Approving asks for confirmation;
 * rejecting asks once for a reason that is sent with every request. The page runs the calls (see `runBulk`).
 */
const props = defineProps<{ count: number; noun: string; busy?: boolean; reasonRequired?: boolean }>();
const emit = defineEmits<{ approve: []; reject: [reason: string] }>();
const feedback = useFeedbackStore();
const label = computed(() => `${props.count} ${props.noun}${props.count === 1 ? '' : 's'}`);

const rejecting = ref(false);
const reason = ref('');
const needsReason = computed(() => props.reasonRequired !== false);

async function approve() {
  const ok = await feedback.confirm({ title: `Approve ${label.value}?`, message: 'Each person is notified, as if you had approved them one by one.', confirmLabel: `Approve ${props.count}` });
  if (ok) emit('approve');
}
function openReject() {
  reason.value = '';
  rejecting.value = true;
}
function reject() {
  rejecting.value = false;
  emit('reject', reason.value.trim());
}
</script>

<template>
  <AppButton size="sm" variant="secondary" :icon="X" :disabled="busy" @click="openReject">Reject {{ count }}</AppButton>
  <AppButton size="sm" :icon="Check" :loading="busy" @click="approve">Approve {{ count }}</AppButton>
  <AppModal :open="rejecting" dialog size="sm" :title="`Reject ${label}?`" description="The reason is sent to everyone in the selection." @close="rejecting = false">
    <AppTextarea v-model="reason" label="Reason" :required="needsReason" :rows="3" :maxlength="500" placeholder="Why are these rejected?" />
    <template #footer>
      <AppButton variant="secondary" @click="rejecting = false">Cancel</AppButton>
      <AppButton variant="danger" :disabled="needsReason && reason.trim().length < 3" @click="reject">Reject {{ count }}</AppButton>
    </template>
  </AppModal>
</template>
