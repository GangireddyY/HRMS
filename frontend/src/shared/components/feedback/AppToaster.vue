<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from '@lucide/vue';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

const feedback = useFeedbackStore();
const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const tones = {
  success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  error: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400',
  info: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
};
</script>

<template>
  <!-- Phones and tablets: at the top, clear of the tab bar and the thumb; desktop: bottom right. -->
  <div
    class="pointer-events-none fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 px-3 lg:inset-x-auto lg:top-auto lg:right-5 lg:bottom-5 lg:items-end"
    aria-live="polite"
    aria-relevant="additions"
  >
    <TransitionGroup
      enter-active-class="transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      enter-from-class="opacity-0 -translate-y-3 scale-95 lg:translate-y-3"
      leave-active-class="transition duration-150"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-for="t in feedback.toasts"
        :key="t.id"
        :role="t.kind === 'error' ? 'alert' : 'status'"
        class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-line bg-surface-raised/95 p-3.5 shadow-pop backdrop-blur"
      >
        <span :class="['flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', tones[t.kind]]">
          <component :is="icons[t.kind]" :size="16" aria-hidden="true" />
        </span>
        <div class="min-w-0 flex-1 pt-0.5">
          <p class="text-sm font-medium text-fg">{{ t.title }}</p>
          <p v-if="t.message" class="mt-0.5 text-xs break-words text-fg-muted">{{ t.message }}</p>
        </div>
        <button type="button" class="rounded-lg p-1 text-fg-subtle transition hover:bg-surface-muted hover:text-fg" aria-label="Dismiss notification" @click="feedback.dismiss(t.id)">
          <X :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
