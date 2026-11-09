<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { Award, Briefcase, CalendarClock, CalendarX2, ChevronRight, FileSignature, FileText, FilterX, GraduationCap, IdCard, MapPinHouse, ScrollText, SearchX, ShieldCheck, Stethoscope, TriangleAlert } from '@lucide/vue';
import type { DocumentCategory } from '@contracts';
import { documentsApi } from '@/modules/people/api/people.api';
import type { ExpiringDocument } from '@/modules/people/types';
import { daysUntil, relativeDays } from '@/modules/people/utils/dates';
import { DOCUMENT_CATEGORY_LABELS } from '@/modules/people/utils/labels';
import { AppAvatar, AppButton, AppEmptyState, AppErrorState, AppPageHeader, AppSearchInput, AppSelect, AppStatStrip, type StripItem } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';

/** Employee documents that have expired or expire soon, grouped by urgency so the most pressing renewals come first. */
const days = ref(30);
const docs = useAsync(() => documentsApi.expiring(days.value));
watch(days, () => void docs.run());

const windowOptions = [
  { value: 0, label: 'Expired only' },
  { value: 30, label: 'Expired or within 30 days' },
  { value: 60, label: 'Expired or within 60 days' },
  { value: 90, label: 'Expired or within 90 days' },
];

type Bucket = 'expired' | 'week' | 'month' | 'later';
const bucketOf = (d: ExpiringDocument): Bucket => {
  if (d.expired) return 'expired';
  const n = daysUntil(d.expiryDate);
  return n <= 7 ? 'week' : n <= 30 ? 'month' : 'later';
};
const BUCKETS: { key: Bucket; title: string; description: string; icon: Component; tile: string; tone: StripItem['tone']; pill: string }[] = [
  { key: 'expired', title: 'Expired', description: 'No longer valid. Ask for a renewed copy now.', icon: CalendarX2, tile: 'bg-danger-soft text-danger-fg', tone: 'danger', pill: 'bg-danger-soft text-danger-fg' },
  { key: 'week', title: 'This week', description: 'Expire within 7 days.', icon: TriangleAlert, tile: 'bg-caution-soft text-caution-fg', tone: 'orange', pill: 'bg-caution-soft text-caution-fg' },
  { key: 'month', title: 'This month', description: 'Expire within 30 days.', icon: CalendarClock, tile: 'bg-warning-soft text-warning-fg', tone: 'warning', pill: 'bg-warning-soft text-warning-fg' },
  { key: 'later', title: 'Later', description: 'Expire later in the selected window.', icon: CalendarClock, tile: 'bg-info-soft text-info-fg', tone: 'info', pill: 'bg-info-soft text-info-fg' },
];

const CATEGORY_ICONS: Record<DocumentCategory, Component> = {
  IDENTITY: IdCard,
  ADDRESS: MapPinHouse,
  EDUCATION: GraduationCap,
  EXPERIENCE: Briefcase,
  OFFER_LETTER: FileSignature,
  CONTRACT: ScrollText,
  CERTIFICATION: Award,
  MEDICAL: Stethoscope,
  OTHER: FileText,
};

// ---- Filters (all client-side: the list is already loaded in full) -------------------------------------------
const bucket = ref<Bucket | null>(null);
const search = ref('');
const category = ref<DocumentCategory | null>(null);
const all = computed(() => docs.data.value ?? []);
const counts = computed(() => Object.fromEntries(BUCKETS.map((b) => [b.key, all.value.filter((d) => bucketOf(d) === b.key).length])) as Record<Bucket, number>);
const stripItems = computed<StripItem[]>(() =>
  BUCKETS.filter((b) => b.key !== 'later' || days.value > 30).map((b) => ({
    key: b.key,
    label: b.title,
    value: counts.value[b.key],
    tone: b.tone,
    hint: b.key === 'expired' ? 'Renew now' : b.key === 'week' ? 'Within 7 days' : b.key === 'month' ? '8 to 30 days' : `31 to ${days.value} days`,
  })),
);
const categoryOptions = computed(() =>
  [...new Set(all.value.map((d) => d.category))].map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABELS[c] })).sort((a, b) => a.label.localeCompare(b.label)),
);
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return all.value.filter(
    (d) =>
      (!bucket.value || bucketOf(d) === bucket.value) &&
      (!category.value || d.category === category.value) &&
      (!q || [d.title, d.employee.name, d.employee.employeeCode, d.employee.department ?? ''].some((s) => s.toLowerCase().includes(q))),
  );
});
const groups = computed(() => BUCKETS.map((b) => ({ ...b, rows: filtered.value.filter((d) => bucketOf(d) === b.key) })).filter((g) => g.rows.length));
const isFiltered = computed(() => !!bucket.value || !!category.value || !!search.value.trim());
function clearFilters() {
  bucket.value = null;
  category.value = null;
  search.value = '';
}
watch(days, () => {
  if (bucket.value === 'later' && days.value <= 30) bucket.value = null;
});

function when(d: ExpiringDocument): string {
  const n = daysUntil(d.expiryDate);
  if (n === 0) return d.expired ? 'Expired today' : 'Expires today';
  if (n < 0) return Math.abs(n) < 45 ? `${-n} day${n === -1 ? '' : 's'} overdue` : `Expired ${relativeDays(d.expiryDate)}`;
  return `Expires ${relativeDays(d.expiryDate)}`;
}
const peopleAffected = computed(() => new Set(all.value.map((d) => d.employee.id)).size);
</script>

<template>
  <div>
    <AppPageHeader title="Document expiry" description="Passports, visas, certifications and other employee documents that have expired or expire soon.">
      <template #actions>
        <AppSelect v-model="days" class="w-64 max-sm:w-full" :options="windowOptions" :clearable="false" aria-label="Expiry window" />
      </template>
    </AppPageHeader>

    <AppStatStrip
      class="mb-4"
      label="Documents by urgency"
      :items="stripItems"
      :loading="docs.loading.value && !docs.data.value"
      selectable
      :selected="bucket"
      @select="(k) => (bucket = k as Bucket | null)"
    />

    <section class="card overflow-hidden">
      <div class="grid gap-3 border-b border-line/70 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <AppSearchInput v-model="search" placeholder="Search employee, code or document" aria-label="Search documents" />
        <AppSelect v-model="category" :options="categoryOptions" placeholder="All categories" aria-label="Filter by category" />
      </div>
      <div class="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/70 bg-surface-muted/40 px-4 py-2 text-xs text-fg-muted">
        <span class="font-medium text-fg tabular-nums" aria-live="polite">{{ filtered.length }} document{{ filtered.length === 1 ? '' : 's' }}</span>
        <span v-if="all.length">· {{ peopleAffected }} {{ peopleAffected === 1 ? 'person' : 'people' }} affected</span>
        <AppButton v-if="isFiltered" class="ms-auto" size="xs" variant="ghost" :icon="FilterX" @click="clearFilters">Clear filters</AppButton>
      </div>

      <AppErrorState v-if="docs.error.value && !docs.loading.value" :error="docs.error.value" @retry="docs.run" />
      <div v-else-if="docs.loading.value && !docs.data.value" class="divide-y divide-line/70" aria-busy="true" aria-label="Loading documents">
        <div v-for="i in 5" :key="i" class="flex items-center gap-4 px-4 py-3.5">
          <div class="skeleton h-9 w-9 rounded-lg" />
          <div class="flex-1 space-y-1.5"><div class="skeleton h-3.5 w-1/3 rounded-full" /><div class="skeleton h-3 w-1/4 rounded-full" /></div>
          <div class="skeleton h-6 w-24 rounded-full" />
        </div>
      </div>
      <AppEmptyState v-else-if="!all.length" :icon="ShieldCheck" title="Nothing expiring" :description="days === 0 ? 'No documents in your scope have expired.' : `No documents in your scope have expired or expire in the next ${days} days.`">
        <AppButton v-if="days < 90" variant="secondary" size="sm" @click="days = 90">Look 90 days ahead</AppButton>
      </AppEmptyState>
      <AppEmptyState v-else-if="!groups.length" :icon="SearchX" title="No matches" description="Nothing matches your search or filters.">
        <AppButton variant="secondary" size="sm" :icon="FilterX" @click="clearFilters">Clear filters</AppButton>
      </AppEmptyState>
      <div v-else :class="docs.loading.value && 'opacity-60'">
        <section v-for="g in groups" :key="g.key" :aria-label="g.title">
          <header class="flex items-center gap-3 border-b border-line/70 bg-surface-muted/60 px-4 py-2">
            <span :class="['flex h-6 w-6 items-center justify-center rounded-md', g.tile]" aria-hidden="true"><component :is="g.icon" :size="13" /></span>
            <h2 class="text-sm font-semibold text-fg">{{ g.title }}</h2>
            <span class="rounded-full bg-surface px-1.5 text-2xs leading-4 font-semibold text-fg-muted tabular-nums ring-1 ring-line">{{ g.rows.length }}</span>
            <p class="truncate text-xs text-fg-muted max-sm:hidden">{{ g.description }}</p>
          </header>
          <ul class="divide-y divide-line/70 border-b border-line/70 last:border-b-0">
            <li v-for="d in g.rows" :key="d.id">
              <RouterLink
                :to="{ path: `/hr/employees/${d.employee.id}`, query: { tab: 'documents' } }"
                class="group grid items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-accent-soft/50 focus-visible:bg-accent-soft/50 focus-visible:outline-none sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto_auto]"
              >
                <div class="flex min-w-0 items-center gap-3">
                  <span :class="['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', g.tile]" aria-hidden="true"><component :is="CATEGORY_ICONS[d.category] ?? FileText" :size="17" /></span>
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-fg group-hover:text-accent-fg">{{ d.title }}</p>
                    <p class="truncate text-xs text-fg-muted">{{ DOCUMENT_CATEGORY_LABELS[d.category] }}</p>
                  </div>
                </div>
                <div class="flex min-w-0 items-center gap-2.5 max-sm:ps-12">
                  <AppAvatar :name="d.employee.name" size="sm" />
                  <div class="min-w-0">
                    <p class="truncate text-sm text-fg">{{ d.employee.name }}</p>
                    <p class="truncate text-xs text-fg-muted"><span class="font-mono">{{ d.employee.employeeCode }}</span><template v-if="d.employee.department"> · {{ d.employee.department }}</template></p>
                  </div>
                </div>
                <div class="text-end max-sm:ps-12 max-sm:text-start">
                  <span :class="['inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', g.pill]">
                    <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{{ when(d) }}
                  </span>
                  <p class="mt-0.5 text-xs text-fg-muted tabular-nums">{{ formatDate(d.expiryDate) }}</p>
                </div>
                <span class="inline-flex items-center gap-1 text-xs font-medium text-accent-fg max-sm:hidden">
                  Open<ChevronRight :size="15" class="transition group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden="true" />
                </span>
              </RouterLink>
            </li>
          </ul>
        </section>
      </div>
    </section>
  </div>
</template>
