<script setup lang="ts">
defineProps<{
  id: string;
  label?: string;
  error?: string;
  help?: string;
  required?: boolean;
}>();
</script>

<template>
  <div>
    <div v-if="label" class="mb-1.5 flex items-center justify-between gap-3">
      <label :id="`${id}-label`" :for="id" class="text-sm font-medium text-fg">
        {{ label }}<span v-if="required" class="ml-0.5 text-red-500" aria-hidden="true"> *</span>
      </label>
      <!-- Kept outside <label> so links here never become part of the field's accessible name. -->
      <slot name="label-action" />
    </div>
    <slot :describedby="error ? `${id}-error` : help ? `${id}-help` : undefined" :invalid="!!error" />
    <p v-if="error" :id="`${id}-error`" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="help" :id="`${id}-help`" class="help-text">{{ help }}</p>
  </div>
</template>
