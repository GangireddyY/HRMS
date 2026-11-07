<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId } from 'vue';

const props = withDefaults(defineProps<{ label?: string; length?: number; error?: string; help?: string; disabled?: boolean; autofocus?: boolean }>(), {
  length: 6,
  label: 'Verification code',
});
const model = defineModel<string>({ default: '' });
const id = useId();
const boxes = ref<HTMLInputElement[]>([]);
const digits = computed(() => Array.from({ length: props.length }, (_, i) => model.value[i] ?? ''));

function setDigits(next: string[]) {
  model.value = next.join('').replace(/\D/g, '').slice(0, props.length);
}

async function focusBox(i: number) {
  await nextTick();
  const box = boxes.value[Math.max(0, Math.min(i, props.length - 1))];
  box?.focus();
  box?.select();
}

function onInput(i: number, e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(/\D/g, '');
  const next = [...digits.value];
  if (raw.length > 1) {
    // Autofill (one-time-code) or fast typing delivers several digits at once.
    raw.split('').forEach((d, k) => i + k < props.length && (next[i + k] = d));
    setDigits(next);
    void focusBox(i + raw.length);
    return;
  }
  next[i] = raw;
  setDigits(next);
  (e.target as HTMLInputElement).value = raw;
  if (raw) void focusBox(i + 1);
}

function onKeydown(i: number, e: KeyboardEvent) {
  if (e.key === 'Backspace' && !digits.value[i] && i > 0) {
    e.preventDefault();
    const next = [...digits.value];
    next[i - 1] = '';
    setDigits(next);
    void focusBox(i - 1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    void focusBox(i - 1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    void focusBox(i + 1);
  }
}

function onPaste(e: ClipboardEvent) {
  const pasted = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, props.length);
  if (!pasted) return;
  e.preventDefault();
  model.value = pasted;
  void focusBox(pasted.length);
}

onMounted(() => props.autofocus && void focusBox(0));
</script>

<template>
  <div>
    <p :id="`${id}-label`" class="label">{{ label }}</p>
    <div role="group" :aria-labelledby="`${id}-label`" :aria-describedby="error ? `${id}-error` : help ? `${id}-help` : undefined" class="flex gap-2 sm:gap-3">
      <input
        v-for="(d, i) in digits"
        :key="i"
        :ref="(el) => (boxes[i] = el as HTMLInputElement)"
        :value="d"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        :autocomplete="i === 0 ? 'one-time-code' : 'off'"
        :maxlength="i === 0 ? length : 1"
        :disabled="disabled"
        :aria-label="`Digit ${i + 1} of ${length}`"
        :aria-invalid="!!error || undefined"
        :class="[
          'h-12 w-full min-w-0 rounded-xl border bg-surface text-center text-lg font-semibold tabular-nums text-fg shadow-xs transition',
          'focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none disabled:opacity-50',
          error ? 'border-red-500' : d ? 'border-line-strong' : 'border-line',
        ]"
        @input="onInput(i, $event)"
        @keydown="onKeydown(i, $event)"
        @paste="onPaste"
        @focus="($event.target as HTMLInputElement).select()"
      />
    </div>
    <p v-if="error" :id="`${id}-error`" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="help" :id="`${id}-help`" class="help-text">{{ help }}</p>
  </div>
</template>
