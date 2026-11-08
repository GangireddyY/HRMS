<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue';
import AppFormField from '@/shared/components/forms/AppFormField.vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    placeholder?: string;
    error?: string;
    help?: string;
    required?: boolean;
    disabled?: boolean;
    rows?: number;
    maxlength?: number;
    id?: string;
    /** Grow with the content up to this many rows. */
    maxRows?: number;
  }>(),
  { rows: 3, maxRows: 10 },
);
const model = defineModel<string | null>();
const autoId = useId();
const fieldId = computed(() => props.id ?? autoId);
const el = ref<HTMLTextAreaElement | null>(null);
const count = computed(() => (model.value ?? '').length);

function resize() {
  const area = el.value;
  if (!area) return;
  const line = parseFloat(getComputedStyle(area).lineHeight) || 20;
  area.style.height = 'auto';
  area.style.height = `${Math.min(area.scrollHeight + 2, line * props.maxRows + 18)}px`;
}

watch(model, () => void nextTick(resize));
onMounted(resize);
</script>

<template>
  <AppFormField :id="fieldId" :label="label" :error="error" :help="help" :required="required">
    <template #default="{ describedby, invalid }">
      <div class="relative">
        <textarea
          :id="fieldId"
          ref="el"
          :value="model ?? ''"
          :rows="rows"
          :maxlength="maxlength"
          :placeholder="placeholder"
          :required="required"
          :disabled="disabled"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedby"
          :class="['input-base resize-none leading-relaxed', maxlength && 'pb-6', invalid && 'input-invalid']"
          @input="model = ($event.target as HTMLTextAreaElement).value"
        />
        <span
          v-if="maxlength"
          :class="['pointer-events-none absolute end-3 bottom-2 text-2xs tabular-nums', count >= maxlength ? 'text-danger-fg' : 'text-fg-subtle']"
          aria-hidden="true"
        >
          {{ count }} / {{ maxlength }}
        </span>
      </div>
    </template>
  </AppFormField>
</template>
