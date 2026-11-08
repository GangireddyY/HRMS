<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { AlertTriangle } from '@lucide/vue';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import AppButton from '@/shared/components/forms/AppButton.vue';
import AppInput from '@/shared/components/forms/AppInput.vue';
import AppModal from '@/shared/components/feedback/AppModal.vue';

const feedback = useFeedbackStore();
const typed = ref('');
const pending = computed(() => feedback.confirmation);
const canConfirm = computed(() => !pending.value?.requireText || typed.value === pending.value.requireText);

watch(pending, () => {
  typed.value = '';
});
</script>

<template>
  <AppModal :open="!!pending" :title="pending?.title ?? ''" size="sm" dialog :guard-changes="false" @close="feedback.settle(false)">
    <div class="flex gap-3">
      <div v-if="pending?.danger" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger-fg ring-1 ring-danger/15 ring-inset">
        <AlertTriangle :size="18" aria-hidden="true" />
      </div>
      <div class="space-y-3 text-sm text-fg-muted">
        <p>{{ pending?.message }}</p>
        <AppInput v-if="pending?.requireText" v-model="typed" :label="`Type ${pending.requireText} to confirm`" autocomplete="off" />
      </div>
    </div>
    <template #footer>
      <AppButton variant="secondary" @click="feedback.settle(false)">{{ pending?.cancelLabel ?? 'Cancel' }}</AppButton>
      <AppButton :variant="pending?.danger ? 'danger' : 'primary'" :disabled="!canConfirm" autofocus @click="feedback.settle(true)">
        {{ pending?.confirmLabel ?? 'Confirm' }}
      </AppButton>
    </template>
  </AppModal>
</template>
