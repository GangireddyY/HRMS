<script setup lang="ts">
import { Bell, LayoutDashboard, RotateCcw, Search, Users } from '@lucide/vue';
import ThemeSwitcher from '@/core/theme/components/ThemeSwitcher.vue';
import { useThemeStore } from '@/core/theme/theme.store';
import { AppBadge, AppButton, AppCard, AppPageHeader } from '@/shared/components';

const theme = useThemeStore();
</script>

<template>
  <div>
    <AppPageHeader title="Appearance" description="Choose how the application looks on this device.">
      <template #actions>
        <AppButton variant="secondary" :icon="RotateCcw" @click="theme.reset()">Reset to default</AppButton>
      </template>
    </AppPageHeader>

    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <AppCard title="Theme" description="Saved in this browser. Other devices keep their own setting.">
        <ThemeSwitcher variant="full" />
      </AppCard>

      <div class="space-y-3 xl:sticky xl:top-4 xl:self-start">
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold text-fg">Live preview</p>
          <AppBadge tone="brand" dot>{{ theme.current.label }} · {{ theme.isDark ? 'Dark' : 'Light' }}</AppBadge>
        </div>
        <!-- Rendered with the real tokens, so it follows every setting. -->
        <div class="overflow-hidden rounded-2xl border border-line bg-sidebar shadow-card" data-testid="theme-preview" aria-hidden="true">
          <div class="flex h-64">
            <div class="flex w-24 flex-col gap-1.5 p-2.5">
              <div class="mb-1 flex items-center gap-1.5">
                <span class="h-5 w-5 rounded-md bg-gradient-to-br from-brand-500 to-brand-700" />
                <span class="h-1.5 w-10 rounded-full bg-sidebar-section/50" />
              </div>
              <span class="flex h-6 items-center gap-1.5 rounded-md bg-sidebar-active px-1.5 ring-1 ring-sidebar-line">
                <LayoutDashboard :size="11" class="text-sidebar-icon-active" />
                <span class="h-1.5 w-9 rounded-full bg-sidebar-fg-strong/40" />
              </span>
              <span class="flex h-6 items-center gap-1.5 px-1.5"><Users :size="11" class="text-sidebar-section" /><span class="h-1.5 w-8 rounded-full bg-sidebar-fg/30" /></span>
              <span class="flex h-6 items-center gap-1.5 px-1.5"><Bell :size="11" class="text-sidebar-section" /><span class="h-1.5 w-7 rounded-full bg-sidebar-fg/30" /></span>
            </div>
            <div class="my-1.5 mr-1.5 flex flex-1 flex-col overflow-hidden rounded-xl border border-line bg-canvas">
              <div class="flex h-8 items-center gap-2 border-b border-line px-2.5">
                <span class="h-1.5 w-14 rounded-full bg-fg/15" />
                <span class="ml-auto flex h-4 w-16 items-center gap-1 rounded border border-line bg-surface px-1"><Search :size="8" class="text-fg-subtle" /></span>
              </div>
              <div class="space-y-2 p-2.5">
                <span class="block h-2 w-20 rounded-full bg-fg/25" />
                <div class="grid grid-cols-2 gap-1.5">
                  <div class="rounded-lg border border-line bg-surface p-2">
                    <span class="block h-1.5 w-8 rounded-full bg-fg/15" />
                    <span class="mt-1.5 block h-2.5 w-6 rounded bg-fg/40" />
                  </div>
                  <div class="rounded-lg border border-line bg-surface p-2">
                    <span class="block h-1.5 w-8 rounded-full bg-fg/15" />
                    <span class="mt-1.5 block h-2.5 w-6 rounded bg-fg/40" />
                  </div>
                </div>
                <div class="flex h-16 items-end gap-1 rounded-lg border border-line bg-surface p-2">
                  <span v-for="h in [40, 65, 30, 80, 55, 90, 45]" :key="h" class="flex-1 rounded-sm bg-brand-500" :style="{ height: `${h}%` }" />
                </div>
                <div class="flex gap-1.5">
                  <span class="h-5 w-14 rounded-md bg-gradient-to-b from-brand-500 to-brand-600" />
                  <span class="h-5 w-12 rounded-md border border-line bg-surface" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          <AppButton size="sm">Primary</AppButton>
          <AppButton size="sm" variant="secondary">Secondary</AppButton>
          <AppButton size="sm" variant="subtle">Subtle</AppButton>
        </div>
      </div>
    </div>
  </div>
</template>
