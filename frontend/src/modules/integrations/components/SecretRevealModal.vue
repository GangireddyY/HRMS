<script setup lang="ts">
import { ref, watch } from 'vue';
import { Check, Copy, TriangleAlert } from '@lucide/vue';
import { AppButton, AppModal } from '@/shared/components';

/** Shows a newly issued API key or signing secret once, with a copy button. */
const props = defineProps<{ open: boolean; title: string; secret: string | null; hint?: string }>();
const emit = defineEmits<{ close: [] }>();
const copied = ref(false);
watch(
  () => props.open,
  () => (copied.value = false),
);
async function copy() {
  if (!props.secret) return;
  await navigator.clipboard.writeText(props.secret);
  copied.value = true;
}
</script>

<template>
  <AppModal :open="open" :title="title" size="md" :dialog="true" @close="emit('close')">
    <div class="space-y-4">
      <p class="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning-fg">
        <TriangleAlert :size="16" class="mt-0.5 shrink-0" aria-hidden="true" />Copy it now and keep it somewhere safe: it won't be shown again.
      </p>
      <div class="flex items-center gap-2">
        <code class="min-w-0 flex-1 rounded-lg bg-surface-muted px-3 py-2.5 font-mono text-sm break-all text-fg ring-1 ring-line" data-testid="secret">{{ secret }}</code>
        <AppButton variant="secondary" :icon="copied ? Check : Copy" :aria-label="copied ? 'Copied' : 'Copy'" @click="copy" />
      </div>
      <p v-if="hint" class="text-xs whitespace-pre-line text-fg-muted">{{ hint }}</p>
    </div>
    <template #footer>
      <AppButton @click="emit('close')">{{ copied ? 'Done' : "I've saved it" }}</AppButton>
    </template>
  </AppModal>
</template>
