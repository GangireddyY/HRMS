<script setup lang="ts">
import { Check, Monitor, Moon, Sun } from '@lucide/vue';
import { useThemeStore } from '../theme.store';
import type { SidebarStyle, ThemeMode } from '../themes';

withDefaults(defineProps<{ variant?: 'compact' | 'full' }>(), { variant: 'compact' });

const theme = useThemeStore();

const modes: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** Static preview colors per sidebar style (independent of the current mode). */
const sidebarPreview: Record<SidebarStyle, { bg: string; line: string; active: string }> = {
  light: { bg: 'bg-zinc-100', line: 'bg-zinc-300', active: 'bg-white ring-1 ring-zinc-200' },
  dark: { bg: 'bg-zinc-900', line: 'bg-white/20', active: 'bg-white/15' },
  brand: { bg: 'bg-brand-900', line: 'bg-white/25', active: 'bg-white/20' },
};
</script>

<template>
  <!-- Compact: account menu quick switcher -->
  <div v-if="variant === 'compact'" class="space-y-3">
    <section>
      <p class="mb-1.5 text-xs font-medium text-fg-subtle">Mode</p>
      <div class="grid grid-cols-3 gap-1 rounded-lg bg-surface-muted p-1" role="radiogroup" aria-label="Color mode">
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          role="radio"
          :aria-checked="theme.mode === m.value"
          :class="[
            'flex items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium transition',
            theme.mode === m.value ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-fg-muted hover:text-fg',
          ]"
          @click="theme.setMode(m.value)"
        >
          <component :is="m.icon" :size="12" aria-hidden="true" /> {{ m.label }}
        </button>
      </div>
    </section>
    <section>
      <p class="mb-1.5 text-xs font-medium text-fg-subtle">Color theme</p>
      <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color theme">
        <button
          v-for="t in theme.themes"
          :key="t.key"
          type="button"
          role="radio"
          :aria-checked="theme.color === t.key"
          :aria-label="t.label"
          :title="t.label"
          class="flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-surface-raised transition hover:scale-110"
          :class="theme.color === t.key ? 'ring-2 ring-fg/40' : ''"
          :style="{ backgroundColor: t.swatch }"
          @click="theme.setColor(t.key)"
        >
          <Check v-if="theme.color === t.key" :size="14" class="text-white" aria-hidden="true" />
        </button>
      </div>
    </section>
  </div>

  <!-- Full: Appearance page -->
  <div v-else class="space-y-8">
    <section>
      <p class="label">Mode</p>
      <div class="grid max-w-xl grid-cols-3 gap-3" role="radiogroup" aria-label="Color mode">
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          role="radio"
          :aria-checked="theme.mode === m.value"
          :aria-label="m.label"
          :class="[
            'group rounded-xl border p-2 text-left transition',
            theme.mode === m.value ? 'border-brand-500 ring-4 ring-brand-500/15' : 'border-line hover:border-line-strong',
          ]"
          @click="theme.setMode(m.value)"
        >
          <span class="block overflow-hidden rounded-lg ring-1 ring-line" aria-hidden="true">
            <span class="flex h-16">
              <span :class="['flex w-1/2 flex-col gap-1 p-2', m.value === 'dark' ? 'bg-zinc-900' : 'bg-zinc-100']">
                <span :class="['h-1.5 w-8 rounded-full', m.value === 'dark' ? 'bg-white/25' : 'bg-zinc-300']" />
                <span :class="['h-1.5 w-5 rounded-full', m.value === 'dark' ? 'bg-white/15' : 'bg-zinc-200']" />
              </span>
              <span :class="['flex w-1/2 flex-col gap-1 p-2', m.value === 'light' ? 'bg-white' : m.value === 'dark' ? 'bg-zinc-800' : 'bg-zinc-900']">
                <span class="h-1.5 w-6 rounded-full bg-brand-500" />
                <span :class="['h-1.5 w-9 rounded-full', m.value === 'light' ? 'bg-zinc-200' : 'bg-white/15']" />
              </span>
            </span>
          </span>
          <span class="mt-2 flex items-center gap-1.5 px-1 text-sm font-medium text-fg">
            <component :is="m.icon" :size="14" class="text-fg-muted" aria-hidden="true" /> {{ m.label }}
          </span>
        </button>
      </div>
    </section>

    <section>
      <p class="label">Color theme</p>
      <div class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" role="radiogroup" aria-label="Color theme">
        <button
          v-for="t in theme.themes"
          :key="t.key"
          type="button"
          role="radio"
          :aria-checked="theme.color === t.key"
          :class="[
            'flex items-center gap-3 rounded-xl border p-3 text-left transition',
            theme.color === t.key ? 'border-brand-500 bg-brand-50/60 ring-4 ring-brand-500/15 dark:bg-brand-500/10' : 'border-line hover:border-line-strong',
          ]"
          @click="theme.setColor(t.key)"
        >
          <span class="flex size-9 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]" :style="{ backgroundColor: t.swatch }">
            <Check v-if="theme.color === t.key" :size="16" class="text-white" aria-hidden="true" />
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-medium text-fg">{{ t.label }}</span>
            <span class="block text-xs text-fg-muted">{{ t.description }}</span>
          </span>
        </button>
      </div>
    </section>

    <section>
      <p class="label">Sidebar</p>
      <div class="grid max-w-xl grid-cols-3 gap-3" role="radiogroup" aria-label="Sidebar style">
        <button
          v-for="s in theme.sidebarStyles"
          :key="s.key"
          type="button"
          role="radio"
          :aria-checked="theme.sidebar === s.key"
          :aria-label="`${s.label} sidebar`"
          :class="[
            'rounded-xl border p-2 text-left transition',
            theme.sidebar === s.key ? 'border-brand-500 ring-4 ring-brand-500/15' : 'border-line hover:border-line-strong',
          ]"
          @click="theme.setSidebar(s.key)"
        >
          <span class="flex h-16 overflow-hidden rounded-lg ring-1 ring-line" aria-hidden="true">
            <span :class="['flex w-2/5 flex-col gap-1 p-1.5', sidebarPreview[s.key].bg]">
              <span :class="['h-1.5 w-6 rounded-full', sidebarPreview[s.key].line]" />
              <span :class="['h-2.5 rounded', sidebarPreview[s.key].active]" />
              <span :class="['h-1.5 w-5 rounded-full', sidebarPreview[s.key].line]" />
            </span>
            <span class="flex flex-1 flex-col gap-1 bg-white p-1.5">
              <span class="h-1.5 w-8 rounded-full bg-zinc-200" />
              <span class="h-5 rounded border border-zinc-200" />
            </span>
          </span>
          <span class="mt-2 block px-1 text-sm font-medium text-fg">{{ s.label }}</span>
          <span class="block px-1 text-xs text-fg-muted">{{ s.description }}</span>
        </button>
      </div>
    </section>
  </div>
</template>
