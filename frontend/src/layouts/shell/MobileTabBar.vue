<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { Menu, Sparkles } from '@lucide/vue';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { mobileTabItems, visibleSections, type NavItem, type Workspace } from '@/core/navigation/workspaces';
import { useAssistantStore } from '@/modules/assistant/assistant.store';
import { useUiStore } from '@/shared/stores/ui.store';

/** Floating bottom tab bar of the phone / tablet layout: three key pages, Ask AI in the middle, and More. */
const props = defineProps<{ workspace: Workspace }>();
const route = useRoute();
const ui = useUiStore();
const assistant = useAssistantStore();
const subject = useAccessSubject();

const tabs = computed(() => mobileTabItems(props.workspace, subject.value));
const allItems = computed(() => visibleSections(props.workspace, subject.value).flatMap((s) => s.items));

function isActive(item: NavItem): boolean {
  if (ui.moreOpen) return false;
  if (item.exact || item.to === props.workspace.home) return route.path === item.to;
  return route.path === item.to || route.path.startsWith(`${item.to}/`);
}
/** "More" is current on any page that isn't one of the tabs. */
const moreActive = computed(() => ui.moreOpen || (!tabs.value.some(isActive) && allItems.value.some((i) => route.path.startsWith(i.to))));
const tabClass = (active: boolean) => ['relative mx-auto flex w-16 flex-col items-center gap-1 py-2 text-2xs font-medium transition-colors', active ? 'text-accent-fg' : 'text-fg-muted'];
const pillClass = (active: boolean) => ['flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-brand-500/12'];
</script>

<template>
  <nav class="glass fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 rounded-lg border border-line/70 shadow-pop" aria-label="Tabs">
    <ul class="grid h-16 grid-cols-5 items-center">
      <li v-for="slot in [0, 1, 'ai', 2] as const" :key="slot" :class="slot === 'ai' && 'flex justify-center'">
        <button
          v-if="slot === 'ai'"
          type="button"
          class="ai-chip -mt-7 flex h-14 w-14 items-center justify-center rounded-full shadow-[0_8px_22px_-8px_color-mix(in_oklab,var(--brand-500)_70%,transparent)] ring-4 ring-canvas transition active:scale-95"
          aria-label="Ask the HRMS assistant"
          :aria-pressed="assistant.open"
          @click="assistant.open = !assistant.open"
        >
          <Sparkles :size="24" aria-hidden="true" />
        </button>
        <RouterLink
          v-else-if="tabs[slot]"
          :to="tabs[slot].to"
          :class="tabClass(isActive(tabs[slot]))"
          :aria-current="isActive(tabs[slot]) ? 'page' : undefined"
          @click="ui.moreOpen = false"
        >
          <span :class="pillClass(isActive(tabs[slot]))"><component :is="tabs[slot].icon" :size="20" aria-hidden="true" /></span>
          <span class="max-w-full truncate px-0.5">{{ tabs[slot].label }}</span>
        </RouterLink>
      </li>
      <li>
        <button type="button" :class="tabClass(moreActive)" :aria-expanded="ui.moreOpen" aria-controls="mobile-more" @click="ui.moreOpen = !ui.moreOpen">
          <span :class="pillClass(moreActive)"><Menu :size="20" aria-hidden="true" /></span>
          More
        </button>
      </li>
    </ul>
  </nav>
</template>
