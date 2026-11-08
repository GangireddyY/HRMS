<script setup lang="ts">
import { BookOpen, Check, CloudMoon, Monitor, Moon, MoonStar, Sun } from '@lucide/vue';
import { computed } from 'vue';
import { useAuthStore } from '@/core/auth/auth.store';
import { useThemeStore } from '../theme.store';
import { ORGANIZATION_THEME, THEME_MODE_INFO, THEME_MODES, type ColorTheme, type SidebarStyle, type ThemeMode } from '../themes';

withDefaults(defineProps<{ variant?: 'compact' | 'full' }>(), { variant: 'compact' });

const theme = useThemeStore();
const auth = useAuthStore();

/** Built-in themes, led by the organization's own brand palette when it has set a brand color. */
const colorOptions = computed<{ key: ColorTheme; label: string; description: string; swatch: string }[]>(() => [
  ...(theme.brandPalette
    ? [{ key: ORGANIZATION_THEME, label: auth.organization?.name ? `${auth.organization.name} brand` : 'Organization brand', description: 'Your organization’s colors', swatch: theme.brandPalette['600'] }]
    : []),
  ...theme.themes,
]);

const ICONS: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor, dim: CloudMoon, black: MoonStar, paper: BookOpen };
const modes = THEME_MODES.map((value) => ({ value, ...THEME_MODE_INFO[value], icon: ICONS[value] }));

/** Static preview colors per mode: side panel, main panel and their placeholder lines. System shows light beside dark. */
const modePreview: Record<ThemeMode, { side: string; main: string; sideLine: string; mainLine: string }> = {
  light: { side: '#f4f4f5', main: '#ffffff', sideLine: '#d4d4d8', mainLine: '#e4e4e7' },
  dark: { side: '#18181b', main: '#27272a', sideLine: 'rgb(255 255 255 / 0.22)', mainLine: 'rgb(255 255 255 / 0.14)' },
  system: { side: '#f4f4f5', main: '#18181b', sideLine: '#d4d4d8', mainLine: 'rgb(255 255 255 / 0.14)' },
  dim: { side: '#22272e', main: '#2d343e', sideLine: 'rgb(227 232 238 / 0.25)', mainLine: 'rgb(227 232 238 / 0.15)' },
  black: { side: '#000000', main: '#0a0a0a', sideLine: 'rgb(255 255 255 / 0.2)', mainLine: 'rgb(255 255 255 / 0.12)' },
  paper: { side: '#efeadf', main: '#fffcf6', sideLine: '#d3c8b2', mainLine: '#e4dccb' },
};

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
      <p class="mb-2 text-xs font-medium text-fg-subtle">Mode</p>
      <div class="grid grid-cols-3 gap-1 rounded-lg bg-surface-muted p-1" role="radiogroup" aria-label="Color mode">
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          role="radio"
          :aria-checked="theme.mode === m.value"
          :title="m.description"
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
      <p class="mb-2 text-xs font-medium text-fg-subtle">Color theme</p>
      <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Color theme">
        <button
          v-for="t in colorOptions"
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
  <div v-else class="space-y-5">
    <section>
      <p class="label">Mode</p>
      <div class="grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Color mode">
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          role="radio"
          :aria-checked="theme.mode === m.value"
          :aria-label="`${m.label}: ${m.description}`"
          :class="[
            'group rounded-xl border p-2 text-start transition',
            theme.mode === m.value ? 'border-brand-500 ring-4 ring-brand-500/15' : 'border-line hover:border-line-strong',
          ]"
          @click="theme.setMode(m.value)"
        >
          <span class="block overflow-hidden rounded-lg ring-1 ring-line" aria-hidden="true">
            <span class="flex h-16">
              <span class="flex w-1/2 flex-col gap-1 p-2" :style="{ backgroundColor: modePreview[m.value].side }">
                <span class="h-1.5 w-8 rounded-full" :style="{ backgroundColor: modePreview[m.value].sideLine }" />
                <span class="h-1.5 w-5 rounded-full opacity-70" :style="{ backgroundColor: modePreview[m.value].sideLine }" />
              </span>
              <span class="flex w-1/2 flex-col gap-1 p-2" :style="{ backgroundColor: modePreview[m.value].main }">
                <span class="h-1.5 w-6 rounded-full bg-brand-500" />
                <span class="h-1.5 w-9 rounded-full" :style="{ backgroundColor: modePreview[m.value].mainLine }" />
              </span>
            </span>
          </span>
          <span class="mt-2 flex items-center gap-2 px-1 text-sm font-medium text-fg">
            <component :is="m.icon" :size="14" class="text-fg-muted" aria-hidden="true" /> {{ m.label }}
            <Check v-if="theme.mode === m.value" :size="14" class="ms-auto text-brand-600 dark:text-brand-400" aria-hidden="true" />
          </span>
          <span class="block px-1 text-xs text-fg-muted">{{ m.description }}</span>
        </button>
      </div>
    </section>

    <section>
      <p class="label">Color theme</p>
      <div class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" role="radiogroup" aria-label="Color theme">
        <button
          v-for="t in colorOptions"
          :key="t.key"
          type="button"
          role="radio"
          :aria-checked="theme.color === t.key"
          :class="[
            'flex items-center gap-3 rounded-xl border p-3 text-start transition',
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
            'rounded-xl border p-2 text-start transition',
            theme.sidebar === s.key ? 'border-brand-500 ring-4 ring-brand-500/15' : 'border-line hover:border-line-strong',
          ]"
          @click="theme.setSidebar(s.key)"
        >
          <span class="flex h-16 overflow-hidden rounded-lg ring-1 ring-line" aria-hidden="true">
            <span :class="['flex w-2/5 flex-col gap-1 p-2', sidebarPreview[s.key].bg]">
              <span :class="['h-1.5 w-6 rounded-full', sidebarPreview[s.key].line]" />
              <span :class="['h-2.5 rounded', sidebarPreview[s.key].active]" />
              <span :class="['h-1.5 w-5 rounded-full', sidebarPreview[s.key].line]" />
            </span>
            <span class="flex flex-1 flex-col gap-1 bg-white p-2">
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
