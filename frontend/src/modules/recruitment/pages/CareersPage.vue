<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { Briefcase, ChevronRight, MapPin } from '@lucide/vue';
import { apiAssetUrl } from '@/core/http/http-client';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { careersApi } from '@/modules/recruitment/api/recruitment.api';
import { experience } from '@/modules/recruitment/utils/recruitment-format';
import { AppEmptyState, AppErrorState, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { timeAgo } from '@/shared/utils/format';

/** Public careers page of an organization (no sign-in). */
const route = useRoute();
const slug = computed(() => String(route.params.slug));
const page = useAsync(() => careersApi.page(slug.value));
</script>

<template>
  <div class="min-h-dvh bg-canvas">
    <div class="mx-auto max-w-4xl px-4 py-10 sm:py-16">
      <AppSkeleton v-if="page.loading.value && !page.data.value" :lines="6" />
      <AppErrorState v-else-if="page.error.value" :error="page.error.value" title="This careers page isn't available" />
      <template v-else-if="page.data.value">
        <header class="mb-10 flex items-center gap-4">
          <img v-if="page.data.value.organization.logoUrl" :src="apiAssetUrl(page.data.value.organization.logoUrl)!" :alt="page.data.value.organization.name" class="h-14 w-14 rounded-xl object-contain ring-1 ring-line" />
          <div>
            <p class="text-sm font-medium text-brand-600 dark:text-brand-400">Careers</p>
            <h1 class="text-3xl font-semibold tracking-tight text-fg">Join {{ page.data.value.organization.name }}</h1>
          </div>
        </header>
        <AppEmptyState v-if="!page.data.value.jobs.length" class="rounded-2xl bg-surface ring-1 ring-line" :icon="Briefcase" title="No open positions right now" description="Please check back soon." />
        <ul v-else class="space-y-3">
          <li v-for="j in page.data.value.jobs" :key="j.id">
            <RouterLink :to="`/careers/${slug}/jobs/${j.id}`" class="group flex items-center gap-4 rounded-2xl bg-surface p-5 ring-1 ring-line transition hover:ring-brand-400">
              <div class="min-w-0 flex-1">
                <p class="text-lg font-semibold text-fg group-hover:text-brand-600 dark:group-hover:text-brand-400">{{ j.title }}</p>
                <p class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
                  <span v-if="j.department">{{ j.department.name }}</span>
                  <span v-if="j.location" class="inline-flex items-center gap-1"><MapPin :size="14" aria-hidden="true" />{{ j.location.name }}</span>
                  <span>{{ EMPLOYMENT_TYPE_LABELS[j.employmentType] }}</span>
                  <span v-if="experience(j.experienceMin, j.experienceMax)">{{ experience(j.experienceMin, j.experienceMax) }}</span>
                  <span v-if="j.postedAt" class="text-fg-subtle">Posted {{ timeAgo(j.postedAt) }}</span>
                </p>
              </div>
              <ChevronRight :size="18" class="shrink-0 text-fg-subtle transition group-hover:translate-x-0.5" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>
