<script setup lang="ts">
import { computed } from 'vue';
import { BadgeCheck, Pencil, Trash2, Users } from '@lucide/vue';
import { SKILL_LEVEL_LABELS } from '@contracts';
import { SKILL_CATEGORY_LABELS } from '@/modules/training/api/skills.api';
import SkillLevel from '@/modules/training/components/SkillLevel.vue';
import type { Skill } from '@/modules/training/types';
import { CATEGORY_VISUALS } from '@/modules/training/utils/skill-visuals';
import { AppBadge, AppButton } from '@/shared/components';

/** A skill in the catalog grid: what it covers, how many people have it, which roles need it (and to what level), and its actions. */
const props = defineProps<{ skill: Skill; roles: { name: string; level: number }[]; maxPeople: number; unused: boolean }>();
const emit = defineEmits<{ edit: []; remove: [] }>();

const s = computed(() => props.skill);
const people = computed(() => s.value.people ?? 0);
const sortedRoles = computed(() => [...props.roles].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)));
const topLevel = computed(() => sortedRoles.value[0]?.level ?? null);
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="flex items-start gap-3">
      <span :class="['grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-1 ring-inset', CATEGORY_VISUALS[s.category].tile]" aria-hidden="true">
        <component :is="CATEGORY_VISUALS[s.category].icon" :size="19" />
      </span>
      <div class="min-w-0 flex-1">
        <h3 :class="['truncate text-sm font-semibold', s.isActive ? 'text-fg' : 'text-fg-muted line-through decoration-fg-subtle/60']">{{ s.name }}</h3>
        <p class="mt-0.5 inline-flex items-center gap-1.5 text-xs text-fg-muted"><span :class="['h-2 w-2 rounded-full', CATEGORY_VISUALS[s.category].dot]" aria-hidden="true" />{{ SKILL_CATEGORY_LABELS[s.category] }}</p>
      </div>
      <AppBadge v-if="!s.isActive" class="shrink-0" size="sm" dot>Inactive</AppBadge>
      <AppBadge v-else-if="unused" class="shrink-0" size="sm" tone="warning" dot>Unused</AppBadge>
      <AppBadge v-else class="shrink-0" size="sm" tone="success" dot>Active</AppBadge>
    </div>

    <p :class="['line-clamp-2 min-h-8 text-xs leading-4', s.description ? 'text-fg-muted' : 'text-fg-subtle italic']">{{ s.description || 'No description' }}</p>

    <dl class="grid grid-cols-2 gap-2">
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><Users :size="11" aria-hidden="true" />People</dt>
        <dd class="mt-0.5 flex items-center gap-2">
          <span :class="['text-base leading-6 font-semibold tabular-nums', people ? 'text-fg' : 'text-fg-subtle']">{{ people }}</span>
          <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <span class="block h-full rounded-full bg-brand-500" :style="{ width: `${(people / Math.max(1, maxPeople)) * 100}%` }" />
          </span>
        </dd>
      </div>
      <div class="rounded-lg bg-surface-muted/50 px-3 py-2">
        <dt class="flex items-center gap-1 text-2xs text-fg-subtle"><BadgeCheck :size="11" aria-hidden="true" />Highest required</dt>
        <dd v-if="topLevel" class="mt-0.5">
          <span class="block truncate text-xs leading-6 font-medium text-fg">{{ SKILL_LEVEL_LABELS[topLevel] }}</span>
          <SkillLevel :model-value="topLevel" size="sm" label="Highest required level" />
        </dd>
        <dd v-else class="mt-0.5 text-xs leading-6 text-fg-subtle">Not required</dd>
      </div>
    </dl>

    <div v-if="roles.length">
      <p class="mb-1.5 text-2xs font-medium text-fg-subtle">Required by {{ roles.length }} role{{ roles.length === 1 ? '' : 's' }}</p>
      <ul class="flex flex-wrap gap-1" :title="sortedRoles.map((r) => `${r.name} (level ${r.level})`).join(', ')">
        <li v-for="r in sortedRoles.slice(0, 3)" :key="r.name" class="inline-flex max-w-full items-center gap-1 rounded-md bg-special-soft px-1.5 py-0.5 text-2xs font-medium text-special-fg">
          <span class="truncate">{{ r.name }}</span><span class="tabular-nums opacity-70">L{{ r.level }}</span><span class="sr-only">, needs level {{ r.level }}</span>
        </li>
        <li v-if="roles.length > 3" class="rounded-md bg-surface-muted px-1.5 py-0.5 text-2xs text-fg-muted">+{{ roles.length - 3 }}</li>
      </ul>
    </div>
    <p v-else class="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-fg-subtle">No role requires it yet</p>

    <div class="mt-auto flex items-center gap-1 border-t border-line/60 pt-3">
      <p class="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
        {{ !s.isActive ? "Can't be added to profiles" : unused ? 'Nobody has or needs it' : people ? `Rated by ${people} ${people === 1 ? 'person' : 'people'}` : 'Not rated yet' }}
      </p>
      <AppButton size="xs" variant="secondary" :icon="Pencil" :aria-label="`Edit ${s.name}`" @click.stop="emit('edit')">Edit</AppButton>
      <AppButton size="xs" variant="ghost" :icon="Trash2" :aria-label="`Delete ${s.name}`" @click.stop="emit('remove')" />
    </div>
  </div>
</template>
