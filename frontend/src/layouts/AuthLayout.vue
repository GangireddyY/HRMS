<script setup lang="ts">
import { Moon, ShieldCheck, Sun } from '@lucide/vue';
import { useThemeStore } from '@/core/theme/theme.store';
import ProductMindMap from '@/modules/auth/components/ProductMindMap.vue';
import { AppLogo } from '@/shared/components';

const theme = useThemeStore();
const appName = import.meta.env.VITE_APP_NAME || 'HRMS';
const year = new Date().getFullYear();
</script>

<template>
  <!-- Full-screen brand canvas (light or dark with the theme); the form card floats on top of it. -->
  <div class="relative isolate min-h-full overflow-hidden bg-hero-canvas text-hero-ink transition-colors duration-300">
    <div class="pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
      <div class="absolute -top-1/4 -left-1/4 h-[75%] w-[75%] animate-aurora rounded-full bg-brand-300/45 blur-[120px] dark:bg-brand-500/55" />
      <div class="absolute -right-1/4 -bottom-1/4 h-[70%] w-[70%] animate-aurora rounded-full bg-brand-200/60 blur-[130px] [animation-delay:-6s] dark:bg-brand-400/35" />
      <div class="absolute top-1/3 left-1/3 h-1/3 w-1/3 animate-aurora rounded-full bg-fuchsia-300/25 blur-[100px] [animation-delay:-11s] dark:bg-fuchsia-400/20" />
      <div
        class="absolute inset-0 [background-image:linear-gradient(color-mix(in_oklab,var(--hero-ink)_6%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_oklab,var(--hero-ink)_6%,transparent)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_25%,transparent_80%)]"
      />
    </div>

    <div class="flex min-h-full w-full flex-col px-4 py-4 sm:px-8 lg:px-12 lg:py-8 2xl:px-16">
      <!-- Top bar -->
      <header class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <AppLogo :size="40" class="drop-shadow-[0_8px_20px_color-mix(in_oklab,var(--brand-600)_35%,transparent)] dark:drop-shadow-[0_8px_20px_rgb(0_0_0/0.35)]" />
          <span class="text-lg font-semibold tracking-tight">{{ appName }}</span>
          <span class="ml-2 hidden rounded-full bg-hero-panel px-3 py-1 text-xs font-medium text-hero-ink/80 ring-1 ring-hero-ink/10 backdrop-blur sm:inline dark:bg-white/10 dark:ring-white/15">
            Enterprise HR platform
          </span>
        </div>
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-hero-panel text-hero-ink/80 ring-1 ring-hero-ink/10 backdrop-blur transition hover:text-hero-ink dark:bg-white/10 dark:ring-white/20 dark:hover:bg-white/20"
          :aria-label="theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="theme.toggleMode()"
        >
          <Sun v-if="theme.isDark" :size="16" />
          <Moon v-else :size="16" />
        </button>
      </header>

      <div class="grid flex-1 items-center gap-10 py-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-14 xl:gap-20 2xl:grid-cols-[minmax(0,1fr)_480px] 2xl:gap-24">
        <!-- What the platform covers (large screens) -->
        <section class="hidden min-w-0 lg:block" aria-label="What HRMS covers">
          <h2 class="max-w-3xl text-[44px] leading-[1.05] font-semibold tracking-tight xl:text-[54px] 2xl:max-w-4xl min-[1800px]:text-[64px]">
            The whole employee journey,
            <span class="bg-gradient-to-r from-brand-600 via-brand-500 to-fuchsia-500 bg-clip-text text-transparent dark:from-white dark:via-brand-200 dark:to-brand-300">in one workspace.</span>
          </h2>
          <p class="mt-4 max-w-xl text-base text-hero-ink/70 xl:text-lg 2xl:max-w-2xl 2xl:text-xl">Hire, onboard, pay, grow and offboard your people — with security built into every step.</p>
          <ProductMindMap class="mt-4" />
        </section>

        <!-- Form card on top of the canvas -->
        <main class="relative w-full justify-self-center lg:justify-self-end">
          <div class="absolute -inset-6 -z-10 rounded-[40px] bg-brand-400/20 blur-3xl dark:bg-brand-500/25" aria-hidden="true" />
          <div
            class="auth-card mx-auto w-full max-w-[440px] animate-slide-up rounded-3xl bg-surface p-7 text-fg shadow-[0_30px_80px_-24px_color-mix(in_oklab,var(--brand-700)_35%,transparent)] ring-1 ring-hero-ink/[0.06] sm:p-9 lg:mr-0 2xl:max-w-[480px] dark:shadow-[0_30px_80px_-20px_rgb(0_0_0/0.45),inset_0_1px_0_rgb(255_255_255/0.08)] dark:ring-brand-300/20"
          >
            <RouterView />
          </div>
        </main>
      </div>

      <footer class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-hero-ink/60 lg:justify-between">
        <span>© {{ year }} {{ appName }}</span>
        <span class="inline-flex items-center gap-1.5"><ShieldCheck :size="13" aria-hidden="true" /> Your data is isolated per organization</span>
      </footer>
    </div>
  </div>
</template>
