<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import { performanceApi } from '@/modules/performance/api/performance.api';
import type { Colleague } from '@/modules/performance/types';
import { AppSelect } from '@/shared/components';

/**
 * Search active colleagues by name or code; picks one (v-model) or several (`multiple`, shown as chips).
 * `source` is the lookup to use (defaults to the performance module's).
 */
const props = defineProps<{ label: string; multiple?: boolean; exclude?: string[]; placeholder?: string; required?: boolean; source?: (search: string) => Promise<Colleague[]> }>();
const single = defineModel<string | null>('value', { default: null });
const many = defineModel<string[]>('values', { default: () => [] });

const results = ref<Colleague[]>([]);
const known = ref(new Map<string, Colleague>());
let timer: ReturnType<typeof setTimeout> | undefined;
async function search(q: string) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      results.value = await (props.source ?? performanceApi.colleagues)(q);
      for (const c of results.value) known.value.set(c.id, c);
    } catch {
      results.value = [];
    }
  }, 250);
}
void search('');

const pick = ref<string | null>(null);
watch(pick, (id) => {
  if (!props.multiple || !id) return;
  if (!many.value.includes(id)) many.value = [...many.value, id];
  pick.value = null;
});
const options = computed(() =>
  results.value
    .filter((c) => !(props.exclude ?? []).includes(c.id) && !(props.multiple && many.value.includes(c.id)))
    .map((c) => ({ value: c.id, label: c.name, description: [c.employeeCode, c.designation, c.department].filter(Boolean).join(' · ') })),
);
</script>

<template>
  <div>
    <AppSelect v-if="multiple" v-model="pick" :label="label" :required="required" :options="options" :placeholder="placeholder ?? 'Search by name…'" searchable remote @search="search" />
    <AppSelect v-else v-model="single" :label="label" :required="required" :options="options" :placeholder="placeholder ?? 'Search by name…'" searchable remote @search="search" />
    <ul v-if="multiple && many.length" class="mt-2 flex flex-wrap gap-2">
      <li v-for="id in many" :key="id" class="inline-flex items-center gap-2 rounded-full bg-surface-muted py-1 pe-2 ps-3 text-sm text-fg">
        {{ known.get(id)?.name ?? 'Colleague' }}
        <button type="button" class="rounded-full p-0.5 text-fg-subtle hover:bg-surface hover:text-fg" :aria-label="`Remove ${known.get(id)?.name}`" @click="many = many.filter((x) => x !== id)"><X :size="13" /></button>
      </li>
    </ul>
  </div>
</template>
