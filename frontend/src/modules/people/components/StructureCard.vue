<script setup lang="ts">
import { computed, type Component } from 'vue';
import { ChartNoAxesColumnIncreasing, Clock, GitBranch, Globe, LocateFixed, Pencil, Trash2, Users } from '@lucide/vue';
import { appLocale } from '@/core/locale/locale';
import type { StructureKind } from '@/modules/people/api/people.api';
import type { CostCenter, Department, Designation, Grade, Location } from '@/modules/people/types';
import { STRUCTURE_VISUALS } from '@/modules/people/utils/structure-visuals';
import { AppBadge, AppButton } from '@/shared/components';

/** A department, designation, location, grade or cost center in the Structure grid. */
const props = defineProps<{ kind: StructureKind; row: Department | Designation | Location | Grade | CostCenter; canManage: boolean }>();
const emit = defineEmits<{ edit: []; remove: [] }>();

const look = computed(() => STRUCTURE_VISUALS[props.kind]);
const code = computed(() => ('code' in props.row ? props.row.code : null));
const description = computed(() => ('description' in props.row ? props.row.description : null));

/** What sets this record apart, per kind (parent department, level, place, time zone…). */
const details = computed<{ icon: Component; text: string }[]>(() => {
  const r = props.row;
  const out: { icon: Component; text: string }[] = [];
  if (props.kind === 'departments' && 'parentId' in r) out.push({ icon: GitBranch, text: r.parentName ? `Part of ${r.parentName}` : 'Top-level department' });
  if ((props.kind === 'designations' || props.kind === 'grades') && 'level' in r && r.level) out.push({ icon: ChartNoAxesColumnIncreasing, text: `Level ${r.level}` });
  if (props.kind === 'locations' && 'city' in r) {
    const place = [r.city, r.state, r.country].filter(Boolean).join(', ');
    if (place) out.push({ icon: Globe, text: place });
    if (r.timezone) out.push({ icon: Clock, text: r.timezone });
    if (r.latitude && r.longitude) out.push({ icon: LocateFixed, text: r.geofenceRadiusM ? `Geofence ${r.geofenceRadiusM.toLocaleString(appLocale())} m` : 'Map pin set' });
  }
  return out;
});
</script>

<template>
  <article :class="['group card flex h-full flex-col overflow-hidden transition hover:shadow-lift', !row.isActive && 'opacity-75']">
    <div :class="['h-1 bg-gradient-to-r', look.strip]" aria-hidden="true" />
    <div class="flex flex-1 flex-col p-4">
      <div class="flex items-start gap-3">
        <span :class="['flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', look.tile]" aria-hidden="true">
          <component :is="look.icon" :size="20" />
        </span>
        <div class="min-w-0 flex-1">
          <h3 class="truncate font-semibold text-fg" :title="row.name">{{ row.name }}</h3>
          <div class="mt-1 flex flex-wrap items-center gap-1.5">
            <span v-if="code" class="rounded bg-surface-muted px-1.5 font-mono text-2xs leading-5 text-fg-muted ring-1 ring-line ring-inset">{{ code }}</span>
            <AppBadge size="sm" :tone="row.isActive ? 'success' : 'neutral'" dot>{{ row.isActive ? 'Active' : 'Inactive' }}</AppBadge>
          </div>
        </div>
        <div v-if="canManage" class="-me-1 -mt-1 flex shrink-0 gap-0.5 opacity-100 transition sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <AppButton size="sm" variant="ghost" :icon="Pencil" :aria-label="`Edit ${row.name}`" @click="emit('edit')" />
          <AppButton size="sm" variant="ghost" :icon="Trash2" :aria-label="`Delete ${row.name}`" @click="emit('remove')" />
        </div>
      </div>

      <p v-if="description" class="mt-3 line-clamp-2 text-sm text-fg-muted">{{ description }}</p>

      <ul v-if="details.length" class="mt-3 space-y-1.5">
        <li v-for="d in details" :key="d.text" class="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
          <component :is="d.icon" :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
          <span class="truncate">{{ d.text }}</span>
        </li>
      </ul>

      <div class="mt-auto pt-4">
        <div class="flex items-center justify-between gap-2 border-t border-line/70 pt-3 text-xs text-fg-muted">
          <span class="inline-flex items-center gap-1.5"><Users :size="13" aria-hidden="true" />Employees</span>
          <span class="text-base font-semibold text-fg tabular-nums">{{ row.employeeCount.toLocaleString(appLocale()) }}</span>
        </div>
      </div>
    </div>
  </article>
</template>
