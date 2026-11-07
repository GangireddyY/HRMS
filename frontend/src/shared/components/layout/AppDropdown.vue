<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

withDefaults(defineProps<{ align?: 'left' | 'right'; width?: string; label?: string }>(), { align: 'right', width: 'w-56' });
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false;
}
watch(open, (v) => {
  if (v) {
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
  } else {
    document.removeEventListener('mousedown', onDocClick);
    document.removeEventListener('keydown', onKey);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick);
  document.removeEventListener('keydown', onKey);
});
const close = () => (open.value = false);
</script>

<template>
  <div ref="root" class="relative">
    <slot name="trigger" :open="open" :toggle="() => (open = !open)" />
    <Transition
      enter-active-class="transition duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
      enter-from-class="opacity-0 scale-95 -translate-y-1"
      leave-active-class="transition duration-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="open"
        role="menu"
        :aria-label="label"
        :class="[
          'absolute z-40 mt-2 rounded-xl border border-line bg-surface-raised p-2 shadow-pop',
          width,
          align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left',
        ]"
        @click="close"
      >
        <slot :close="close" />
      </div>
    </Transition>
  </div>
</template>
