<script setup lang="ts">
import { SKILL_LEVEL_LABELS } from '@contracts';

/** Proficiency 1–5 as five segments; interactive when `editable` (a radio group with arrow-key support). */
const props = withDefaults(defineProps<{ modelValue: number | null; editable?: boolean; label?: string; required?: number | null; size?: 'sm' | 'md' }>(), { editable: false, required: null, size: 'md' });
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();
const levels = [1, 2, 3, 4, 5];
function key(e: KeyboardEvent) {
  const current = props.modelValue ?? 0;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') emit('update:modelValue', Math.min(5, current + 1));
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') emit('update:modelValue', Math.max(1, current - 1));
  else return;
  e.preventDefault();
}
const tone = (n: number) => {
  const v = props.modelValue ?? 0;
  if (n > v) return props.required && n <= props.required ? 'bg-amber-500/25 ring-1 ring-inset ring-amber-500/40' : 'bg-surface-muted';
  return props.required && v < props.required ? 'bg-amber-500' : 'bg-brand-500';
};
</script>

<template>
  <div
    :role="editable ? 'radiogroup' : 'img'"
    :aria-label="editable ? (label ?? 'Level') : `${label ? `${label}: ` : ''}${modelValue ? `${modelValue} of 5, ${SKILL_LEVEL_LABELS[modelValue]}` : 'not rated'}${required ? `, needs ${required}` : ''}`"
    class="inline-flex items-center gap-1"
    @keydown="editable && key($event)"
  >
    <component
      :is="editable ? 'button' : 'span'"
      v-for="n in levels"
      :key="n"
      :type="editable ? 'button' : undefined"
      :role="editable ? 'radio' : undefined"
      :aria-checked="editable ? modelValue === n : undefined"
      :aria-label="editable ? `${n} – ${SKILL_LEVEL_LABELS[n]}` : undefined"
      :tabindex="editable ? (modelValue === n || (!modelValue && n === 1) ? 0 : -1) : undefined"
      :title="SKILL_LEVEL_LABELS[n]"
      :class="['rounded-full transition', size === 'sm' ? 'h-1.5 w-3.5' : 'h-2.5 w-6', tone(n), editable && 'cursor-pointer hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500']"
      @click="editable && emit('update:modelValue', n)"
    />
  </div>
</template>
