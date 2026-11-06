<script setup lang="ts">
import { computed, ref, useId, type Component } from 'vue';
import { ArrowBigUp, Eye, EyeOff, Minus, Plus } from '@lucide/vue';
import AppFormField from '@/shared/components/forms/AppFormField.vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    type?: string;
    placeholder?: string;
    error?: string;
    help?: string;
    required?: boolean;
    disabled?: boolean;
    autocomplete?: string;
    id?: string;
    inputmode?: 'text' | 'numeric' | 'email' | 'tel' | 'search' | 'url';
    maxlength?: number;
    min?: number;
    max?: number;
    /** Leading icon, e.g. Search or Mail. */
    icon?: Component;
    ariaLabel?: string;
    /** Unit shown inside the field on the right, e.g. "days". */
    suffix?: string;
    step?: number;
    size?: 'md' | 'lg';
  }>(),
  { type: 'text', step: 1, size: 'md' },
);

/** Password fields warn when Caps Lock is on (a common cause of failed sign-ins). */
const capsLock = ref(false);
function trackCapsLock(e: KeyboardEvent) {
  if (props.type === 'password' && typeof e.getModifierState === 'function') capsLock.value = e.getModifierState('CapsLock');
}

const model = defineModel<string | number | null>();
const autoId = useId();
const inputId = computed(() => props.id ?? autoId);
const reveal = ref(false);
const isNumber = computed(() => props.type === 'number');
const effectiveType = computed(() => (props.type === 'password' && reveal.value ? 'text' : props.type));

function onInput(e: Event) {
  const value = (e.target as HTMLInputElement).value;
  model.value = isNumber.value ? (value === '' ? null : Number(value)) : value;
}

function stepBy(direction: 1 | -1) {
  const current = typeof model.value === 'number' ? model.value : Number(model.value) || 0;
  let next = Math.round((current + direction * props.step) * 1000) / 1000;
  if (props.min !== undefined) next = Math.max(props.min, next);
  if (props.max !== undefined) next = Math.min(props.max, next);
  model.value = next;
}

const atMin = computed(() => props.min !== undefined && typeof model.value === 'number' && model.value <= props.min);
const atMax = computed(() => props.max !== undefined && typeof model.value === 'number' && model.value >= props.max);
const stepper = 'flex h-full w-7 items-center justify-center text-fg-subtle transition hover:bg-surface-muted hover:text-fg disabled:pointer-events-none disabled:opacity-30';
</script>

<template>
  <AppFormField :id="inputId" :label="label" :error="error" :help="help" :required="required">
    <template v-if="$slots['label-action']" #label-action><slot name="label-action" /></template>
    <template #default="{ describedby, invalid }">
      <div class="relative">
        <component :is="icon" v-if="icon" :size="16" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
        <input
          :id="inputId"
          :type="effectiveType"
          :value="model ?? ''"
          :placeholder="placeholder"
          :required="required"
          :disabled="disabled"
          :autocomplete="autocomplete"
          :inputmode="inputmode"
          :maxlength="maxlength"
          :min="min"
          :max="max"
          :step="isNumber ? step : undefined"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedby"
          :aria-label="label ? undefined : ariaLabel"
          :class="[
            'input-base',
            size === 'lg' && 'min-h-11 rounded-xl text-[15px]',
            invalid && 'input-invalid',
            type === 'password' && 'pr-10',
            icon && 'pl-10',
            isNumber && 'pr-16 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
            isNumber && suffix && 'pr-28',
            !isNumber && suffix && 'pr-16',
          ]"
          @input="onInput"
          @keydown="trackCapsLock"
          @keyup="trackCapsLock"
          @blur="capsLock = false"
        />
        <span
          v-if="suffix"
          :class="['pointer-events-none absolute top-1/2 -translate-y-1/2 text-sm text-fg-subtle', isNumber ? 'right-17' : 'right-3']"
          aria-hidden="true"
        >
          {{ suffix }}
        </span>
        <div v-if="isNumber && !disabled" class="absolute inset-y-px right-px flex overflow-hidden rounded-r-[7px] border-l border-line">
          <button type="button" :class="stepper" tabindex="-1" :disabled="atMin" :aria-label="`Decrease ${label ?? ariaLabel ?? 'value'}`" @click="stepBy(-1)">
            <Minus :size="14" />
          </button>
          <button type="button" :class="[stepper, 'border-l border-line']" tabindex="-1" :disabled="atMax" :aria-label="`Increase ${label ?? ariaLabel ?? 'value'}`" @click="stepBy(1)">
            <Plus :size="14" />
          </button>
        </div>
        <button
          v-if="type === 'password'"
          type="button"
          class="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-fg-subtle transition hover:text-fg"
          :aria-label="reveal ? 'Hide password' : 'Show password'"
          @click="reveal = !reveal"
        >
          <EyeOff v-if="reveal" :size="16" />
          <Eye v-else :size="16" />
        </button>
      </div>
      <p v-if="capsLock" class="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400" role="status">
        <ArrowBigUp :size="14" aria-hidden="true" /> Caps Lock is on
      </p>
    </template>
  </AppFormField>
</template>
