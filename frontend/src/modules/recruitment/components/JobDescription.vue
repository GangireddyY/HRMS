<script setup lang="ts">
import { computed } from 'vue';

/**
 * Plain-text job copy as readable blocks: blank lines separate paragraphs, and lines starting with "-", "*", "•" or
 * "1." become a list. Text only (no HTML), so nothing typed into a posting can inject markup.
 */
const props = defineProps<{ text: string }>();

type Block = { kind: 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] };
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

const blocks = computed<Block[]>(() => {
  const out: Block[] = [];
  for (const chunk of props.text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    let para: string[] = [];
    const flush = () => {
      if (para.length) out.push({ kind: 'p', text: para.join(' ') });
      para = [];
    };
    for (const line of lines) {
      if (BULLET.test(line)) {
        flush();
        const kind = /^\s*\d/.test(line) ? 'ol' : 'ul';
        const last = out.at(-1);
        const item = line.replace(BULLET, '');
        if (last && last.kind === kind) last.items.push(item);
        else out.push({ kind, items: [item] });
      } else para.push(line.trim());
    }
    flush();
  }
  return out;
});
</script>

<template>
  <div class="space-y-3 text-sm leading-7 text-fg-muted">
    <template v-for="(b, i) in blocks" :key="i">
      <p v-if="b.kind === 'p'">{{ b.text }}</p>
      <component :is="b.kind" v-else :class="['space-y-1.5 ps-5', b.kind === 'ul' ? 'list-disc marker:text-brand-500' : 'list-decimal marker:font-medium marker:text-fg-subtle']">
        <li v-for="(item, j) in b.items" :key="j" class="ps-1">{{ item }}</li>
      </component>
    </template>
  </div>
</template>
