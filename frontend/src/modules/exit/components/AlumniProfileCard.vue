<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRight, Building2, CalendarRange, ExternalLink, Mail, MapPin, Phone } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import type { AlumniRow } from '@/modules/exit/types';
import { TYPE_LABELS } from '@/modules/exit/utils/exit-format';
import { AppAvatar, AppBadge, AppButton } from '@/shared/components';
import { profileCover } from '@/shared/utils/profile-cover';

/** A former employee in the alumni grid: cover, photo, where they are now, time with us and how to reach them. */
const props = defineProps<{ row: AlumniRow; manage: boolean }>();

const now = computed(() => [props.row.alumni?.currentTitle, props.row.alumni?.currentCompany].filter(Boolean).join(' at '));
const formerly = computed(() => [props.row.designation, props.row.department].filter(Boolean).join(' · '));
const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString(appLocale(), { month: 'short', year: 'numeric' });
const tenure = computed(() => {
  const from = Date.parse(props.row.dateOfJoining);
  const to = props.row.exitDate ? Date.parse(props.row.exitDate) : Date.now();
  const months = Math.max(0, Math.round((to - from) / (30.44 * 86_400_000)));
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} yr${y === 1 ? '' : 's'}` : null, m ? `${m} mo${m === 1 ? '' : 's'}` : null].filter(Boolean).join(' ') || 'Under a month';
});
const rehire = computed(() => {
  const v = props.row.exit?.eligibleForRehire;
  return v === true ? { tone: 'success' as const, label: 'Rehire: eligible' } : v === false ? { tone: 'danger' as const, label: 'Rehire: not eligible' } : { tone: 'neutral' as const, label: 'Rehire: not decided' };
});

const cover = computed(() => profileCover(props.row.employeeCode));
</script>

<template>
  <article class="card flex h-full flex-col overflow-hidden transition hover:shadow-lift" :aria-label="row.name">
    <div class="relative h-16 border-b border-line/50" :style="cover" aria-hidden="true">
      <span v-if="row.alumni?.openToOpportunities" class="absolute end-2 top-2 rounded-full bg-surface shadow-xs">
        <AppBadge tone="brand" size="sm" dot>Open to opportunities</AppBadge>
      </span>
    </div>

    <div class="flex flex-1 flex-col items-center px-4 pb-4 text-center">
      <div class="relative z-10 -mt-10 rounded-full bg-surface p-1 shadow-xs">
        <AppAvatar :name="row.name" size="2xl" />
      </div>
      <h3 class="mt-2 w-full truncate text-base font-semibold text-fg">{{ row.name }}</h3>
      <p v-if="now" class="mt-0.5 line-clamp-2 text-sm font-medium text-fg">{{ now }}</p>
      <p v-else class="mt-0.5 text-sm text-fg-subtle">{{ row.optedIn ? 'Current role not shared' : 'Not in the alumni network' }}</p>
      <p class="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
        <span v-if="row.alumni?.city" class="inline-flex items-center gap-1"><MapPin :size="12" aria-hidden="true" />{{ row.alumni.city }}</span>
        <span v-if="formerly" class="inline-flex min-w-0 items-center gap-1"><Building2 :size="12" class="shrink-0" aria-hidden="true" /><span class="truncate">Formerly {{ formerly }}</span></span>
      </p>

      <div class="mt-3 w-full rounded-lg bg-surface-muted/60 px-3 py-2 text-start text-xs">
        <p class="flex items-center gap-1.5 font-medium text-fg"><CalendarRange :size="12" class="text-fg-muted" aria-hidden="true" />{{ monthYear(row.dateOfJoining) }} – {{ row.exitDate ? monthYear(row.exitDate) : 'now' }} · {{ tenure }}</p>
        <p class="mt-0.5 text-fg-muted">{{ row.exit ? TYPE_LABELS[row.exit.type] : 'No exit record' }} · {{ row.employeeCode }}</p>
      </div>
      <div v-if="manage && row.exit" class="mt-2"><AppBadge :tone="rehire.tone" size="sm" dot>{{ rehire.label }}</AppBadge></div>

      <div class="mt-auto w-full pt-4">
        <div v-if="row.alumni && (row.alumni.personalEmail || row.alumni.phone || row.alumni.linkedinUrl)" class="flex items-center justify-center gap-2 border-t border-line/70 pt-3">
          <a v-if="row.alumni.personalEmail" :href="`mailto:${row.alumni.personalEmail}`" class="inline-flex h-8 w-8 items-center justify-center rounded-full text-fg-muted ring-1 ring-line transition hover:bg-accent-soft hover:text-accent-fg" :title="row.alumni.personalEmail" :aria-label="`Email ${row.name}`"><Mail :size="14" aria-hidden="true" /></a>
          <a v-if="row.alumni.phone" :href="`tel:${row.alumni.phone}`" class="inline-flex h-8 w-8 items-center justify-center rounded-full text-fg-muted ring-1 ring-line transition hover:bg-accent-soft hover:text-accent-fg" :title="row.alumni.phone" :aria-label="`Call ${row.name}`"><Phone :size="14" aria-hidden="true" /></a>
          <a
            v-if="row.alumni.linkedinUrl"
            :href="row.alumni.linkedinUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-fg-muted ring-1 ring-line transition hover:bg-accent-soft hover:text-accent-fg"
            :aria-label="`${row.name} on LinkedIn (opens in a new tab)`"
          >
            <span class="rounded-[3px] bg-[#0a66c2] px-1 text-2xs leading-4 font-bold text-white" aria-hidden="true">in</span>LinkedIn<ExternalLink :size="11" aria-hidden="true" />
          </a>
        </div>
        <p v-else class="border-t border-line/70 pt-3 text-xs text-fg-subtle">{{ row.optedIn ? 'No contact details shared' : 'Contact details are shared only by network members' }}</p>
        <AppButton v-if="manage && row.exit" class="mt-3" block size="sm" variant="secondary" :icon-right="ArrowRight" :to="`/hr/exits/${row.exit.id}`">View exit</AppButton>
      </div>
    </div>
  </article>
</template>
