<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import AppSelect from './AppSelect.vue';

/** Choose several items from a list: a picker plus removable chips (nothing chosen = the placeholder, e.g. "Everywhere"). */
const props = defineProps<{ label: string; options: { value: string; label: string }[]; placeholder?: string; help?: string; error?: string; disabled?: boolean }>();
const model = defineModel<string[]>({ default: () => [] });

const pick = ref<string | null>(null);
watch(pick, (id) => {
  if (id && !model.value.includes(id)) model.value = [...model.value, id];
  pick.value = null;
});
const available = computed(() => props.options.filter((o) => !model.value.includes(o.value)));
const nameOf = (id: string) => props.options.find((o) => o.value === id)?.label ?? '…';
</script>

<template>
  <div>
    <AppSelect v-model="pick" :label="label" :placeholder="placeholder" :help="help" :error="error" :disabled="disabled" :options="available" />
    <ul v-if="model.length" class="mt-2 flex flex-wrap gap-2" :aria-label="label">
      <li v-for="id in model" :key="id" class="inline-flex items-center gap-2 rounded-full bg-surface-muted py-1 ps-3 pe-2 text-sm text-fg">
        {{ nameOf(id) }}
        <button
          type="button"
          class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg"
          :disabled="disabled"
          :aria-label="`Remove ${nameOf(id)}`"
          @click="model = model.filter((x) => x !== id)"
        >
          <X :size="13" />
        </button>
      </li>
    </ul>
  </div>
</template>
