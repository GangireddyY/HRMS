<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import { AppSelect } from '@/shared/components';

/** Pick several items from a list; shown as removable chips. Empty means "everyone". */
const props = defineProps<{ label: string; placeholder: string; options: { value: string; label: string }[]; disabled?: boolean }>();
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
    <AppSelect v-model="pick" :label="label" :placeholder="placeholder" :options="available" :disabled="disabled" />
    <ul v-if="model.length" class="mt-2 flex flex-wrap gap-2">
      <li v-for="id in model" :key="id" class="inline-flex items-center gap-1.5 rounded-full bg-surface-muted py-1 pr-1.5 pl-3 text-sm text-fg">
        {{ nameOf(id) }}
        <button v-if="!disabled" type="button" class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" :aria-label="`Remove ${nameOf(id)}`" @click="model = model.filter((x) => x !== id)"><X :size="13" /></button>
      </li>
    </ul>
  </div>
</template>
