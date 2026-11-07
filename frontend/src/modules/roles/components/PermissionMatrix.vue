<script setup lang="ts">
import { computed, ref } from 'vue';
import { SearchX, ShieldAlert } from '@lucide/vue';
import { PERMISSION_SCOPES, type PermissionScope } from '@contracts';
import type { CatalogModule, CatalogPermission } from '@/modules/roles/types';
import { AppBadge, AppButton, AppEmptyState, AppSearchInput } from '@/shared/components';
import { humanize } from '@/shared/utils/format';
import { MODULE_ICONS } from '@/shared/utils/module-icons';
import { SCOPE_LABELS } from '@/shared/utils/status';

/** `bottomInset`: leave room at the bottom of the list for an overlaid bar (e.g. unsaved changes). */
const props = defineProps<{ modules: CatalogModule[]; readonly?: boolean; bottomInset?: boolean }>();
const pane = ref<HTMLElement | null>(null);
/** permission key -> scope */
const model = defineModel<Record<string, PermissionScope>>({ required: true });
const filter = ref('');
const selected = ref(props.modules.find((m) => m.entitled)?.key ?? props.modules[0]?.key);

const SCOPE_SHORT: Record<PermissionScope, string> = { OWN: 'Own', TEAM: 'Team', DEPARTMENT: 'Department', ORGANIZATION: 'Organization' };

const query = computed(() => filter.value.trim().toLowerCase());
const matches = (p: CatalogPermission) => !query.value || p.key.toLowerCase().includes(query.value) || p.description.toLowerCase().includes(query.value);

/** Searching shows matches from every module; otherwise only the selected module. */
const shown = computed(() =>
  query.value
    ? props.modules.map((m) => ({ ...m, permissions: m.permissions.filter(matches) })).filter((m) => m.permissions.length)
    : props.modules.filter((m) => m.key === selected.value),
);

const totalPermissions = computed(() => props.modules.reduce((n, m) => n + m.permissions.length, 0));
const totalGranted = computed(() => props.modules.reduce((n, m) => n + grantedCount(m), 0));

function grantedCount(m: CatalogModule) {
  return m.permissions.filter((p) => model.value[p.key]).length;
}
function matchCount(m: CatalogModule) {
  return m.permissions.filter(matches).length;
}

/** Permissions grouped by the page they belong to, in catalogue order. */
function groups(permissions: CatalogPermission[]) {
  const map = new Map<string, CatalogPermission[]>();
  for (const p of permissions) map.set(p.page, [...(map.get(p.page) ?? []), p]);
  return [...map].map(([page, items]) => ({ page, label: humanize(page.split('.').slice(1).join(' ') || page), items }));
}

function choose(key: CatalogModule['key']) {
  selected.value = key;
  filter.value = '';
  pane.value?.scrollTo?.({ top: 0 });
}

function setGrant(p: CatalogPermission, on: boolean) {
  const next = { ...model.value };
  if (on) next[p.key] = next[p.key] ?? (p.scopable ? 'OWN' : 'ORGANIZATION');
  else delete next[p.key];
  model.value = next;
}

/** Choosing a scope also grants the permission. */
function setScope(p: CatalogPermission, scope: PermissionScope) {
  model.value = { ...model.value, [p.key]: scope };
}

function onScopeKey(e: KeyboardEvent, p: CatalogPermission, index: number) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const nextIndex = (index + step + PERMISSION_SCOPES.length) % PERMISSION_SCOPES.length;
  setScope(p, PERMISSION_SCOPES[nextIndex]!);
  const group = (e.currentTarget as HTMLElement).parentElement;
  (group?.children[nextIndex] as HTMLElement | undefined)?.focus();
}

function setAll(m: CatalogModule, on: boolean) {
  const next = { ...model.value };
  for (const p of m.permissions) {
    if (p.restricted) continue;
    if (on) next[p.key] = next[p.key] ?? 'ORGANIZATION';
    else delete next[p.key];
  }
  model.value = next;
}

const editable = (m: CatalogModule) => !props.readonly && m.entitled;
</script>

<template>
  <!-- Sized by its container (not the viewport): a side menu when there is room, chips on top otherwise. -->
  <!-- Large screens: fills its parent's height; the side menu and the permission list scroll independently. -->
  <div class="@container/matrix lg:flex lg:flex-col">
  <div
    class="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl/matrix:grid-cols-[17.5rem_minmax(0,1fr)] lg:min-h-0 lg:flex-1 lg:grid-rows-[auto_minmax(0,1fr)] @3xl/matrix:lg:grid-rows-[minmax(0,1fr)]"
  >
    <!-- Module navigator (side menu) -->
    <aside class="card min-w-0 self-start overflow-hidden @3xl/matrix:sticky @3xl/matrix:top-6 lg:flex lg:min-h-0 lg:flex-col @3xl/matrix:lg:static @3xl/matrix:lg:self-stretch">
      <div class="shrink-0 space-y-3 p-4">
        <AppSearchInput v-model="filter" placeholder="Search all permissions…" aria-label="Filter permissions" />
        <div>
          <div class="flex items-center justify-between text-xs">
            <span class="font-medium text-fg-muted">Granted</span>
            <span class="font-semibold text-fg tabular-nums">{{ totalGranted }} / {{ totalPermissions }}</span>
          </div>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div class="h-full rounded-full bg-brand-500 transition-[width] duration-300" :style="{ width: `${(totalGranted / Math.max(totalPermissions, 1)) * 100}%` }" />
          </div>
        </div>
      </div>
      <nav
        aria-label="Permission modules"
        class="flex gap-1 overflow-x-auto px-3 pb-3 @3xl/matrix:max-h-[calc(100vh-15rem)] @3xl/matrix:flex-col @3xl/matrix:overflow-y-auto @3xl/matrix:pb-4 lg:min-h-0 @3xl/matrix:lg:max-h-none @3xl/matrix:lg:flex-1"
      >
        <button
          v-for="m in modules"
          :key="m.key"
          type="button"
          :aria-current="!query && m.key === selected ? 'true' : undefined"
          :class="[
            'group flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-start ring-1 ring-line transition @3xl/matrix:w-full @3xl/matrix:ring-0',
            !query && m.key === selected ? 'bg-brand-50 ring-1 ring-brand-600/15 dark:bg-brand-500/12' : 'hover:bg-surface-muted',
            query && !matchCount(m) && 'opacity-40',
          ]"
          @click="choose(m.key)"
        >
          <span
            :class="[
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition',
              !query && m.key === selected ? 'bg-brand-600 text-white ring-brand-600' : 'bg-surface text-fg-muted ring-line',
            ]"
          >
            <component :is="MODULE_ICONS[m.key]" :size="15" aria-hidden="true" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2">
              <span :class="['truncate text-sm font-medium', !query && m.key === selected ? 'text-brand-700 dark:text-brand-300' : 'text-fg']">{{ m.name }}</span>
            </span>
            <span class="mt-1 hidden items-center gap-2 @3xl/matrix:flex">
              <span class="h-1 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <span class="block h-full rounded-full bg-brand-500/80 transition-[width] duration-300" :style="{ width: `${(grantedCount(m) / Math.max(m.permissions.length, 1)) * 100}%` }" />
              </span>
            </span>
          </span>
          <span class="shrink-0 text-2xs font-medium text-fg-subtle tabular-nums">
            <template v-if="query">{{ matchCount(m) }}</template>
            <template v-else-if="!m.entitled">Off</template>
            <template v-else>{{ grantedCount(m) }}/{{ m.permissions.length }}</template>
          </span>
        </button>
      </nav>
    </aside>

    <!-- Permissions of the selected module (or all search matches) -->
    <div
      ref="pane"
      :class="['card @container/pane min-w-0 self-start overflow-hidden lg:h-full lg:self-stretch lg:overflow-y-auto lg:overscroll-contain', bottomInset && 'lg:pb-20']"
    >
      <AppEmptyState v-if="!shown.length" :icon="SearchX" title="No permissions match" :description="`Nothing matches “${filter}”.`" class="py-16" />

      <section v-for="m in shown" :key="m.key" :aria-label="`${m.name} permissions`" class="border-line [&+&]:border-t">
        <header class="flex flex-wrap items-center gap-x-4 gap-y-3 bg-surface px-4 py-4 sm:px-4 lg:sticky lg:top-0 lg:z-10 lg:mb-1 lg:border-b lg:border-line/70">

          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-600/15 ring-inset dark:bg-brand-500/12 dark:text-brand-300">
            <component :is="MODULE_ICONS[m.key]" :size="18" aria-hidden="true" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-base font-semibold text-fg">{{ m.name }}</h3>
              <AppBadge v-if="!m.entitled" tone="neutral">Not in plan</AppBadge>
              <span class="text-xs font-medium text-fg-subtle tabular-nums">{{ grantedCount(m) }} of {{ m.permissions.length }} granted</span>
            </div>
            <p class="mt-0.5 text-sm text-fg-muted">{{ m.description }}</p>
          </div>
          <div v-if="editable(m) && !query" class="flex w-full gap-2 ps-14 @lg/pane:w-auto @lg/pane:ps-0">
            <AppButton size="sm" variant="secondary" @click="setAll(m, true)">Grant all</AppButton>
            <AppButton size="sm" variant="ghost" :disabled="!grantedCount(m)" @click="setAll(m, false)">Clear</AppButton>
          </div>
        </header>

        <div v-for="g in groups(m.permissions)" :key="g.page" class="px-3 pb-3 sm:px-4">
          <p class="px-2 pt-1 pb-2 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{{ g.label }}</p>
          <ul class="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
            <li
              v-for="p in g.items"
              :key="p.key"
              :class="['flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors @xl/pane:flex-nowrap', model[p.key] ? 'bg-brand-50/50 dark:bg-brand-500/[0.06]' : 'bg-surface', !m.entitled && 'opacity-60']"
            >
              <label :for="`perm-${p.key}`" class="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                <span class="relative mt-0.5 inline-flex h-5 w-9 shrink-0">
                  <input
                    :id="`perm-${p.key}`"
                    type="checkbox"
                    role="switch"
                    class="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                    :checked="!!model[p.key]"
                    :disabled="!editable(m) || p.restricted"
                    @change="setGrant(p, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="absolute inset-0 rounded-full bg-zinc-300 transition-colors peer-checked:bg-brand-600 peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/25 peer-disabled:opacity-50 dark:bg-zinc-700" />
                  <span class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] peer-checked:translate-x-4" />
                </span>
                <span class="min-w-0">
                  <span class="block text-sm font-medium text-fg">{{ p.description }}</span>
                  <span class="block font-mono text-2xs break-all text-fg-subtle">{{ p.key }}</span>
                </span>
              </label>

              <div class="w-full shrink-0 ps-12 @xl/pane:w-auto @xl/pane:ps-0">
                <AppBadge v-if="p.restricted" tone="warning"><ShieldAlert :size="11" /> Restricted</AppBadge>
                <div
                  v-else-if="p.scopable"
                  role="radiogroup"
                  :aria-label="`Scope for ${p.key}`"
                  :class="['inline-flex rounded-lg bg-surface-muted p-0.5 ring-1 ring-line ring-inset transition-opacity', !model[p.key] && 'opacity-55']"
                >
                  <button
                    v-for="(s, i) in PERMISSION_SCOPES"
                    :key="s"
                    type="button"
                    role="radio"
                    :aria-checked="model[p.key] === s"
                    :aria-label="SCOPE_LABELS[s] ?? s"
                    :title="SCOPE_LABELS[s] ?? s"
                    :tabindex="model[p.key] ? (model[p.key] === s ? 0 : -1) : i === 0 ? 0 : -1"
                    :disabled="!editable(m)"
                    :class="[
                      'rounded-md px-3 py-1 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none disabled:cursor-not-allowed',
                      model[p.key] === s ? 'bg-surface text-brand-700 shadow-card ring-1 ring-line dark:text-brand-300' : 'text-fg-muted enabled:hover:text-fg',
                    ]"
                    @click="setScope(p, s)"
                    @keydown="onScopeKey($event, p, i)"
                  >
                    {{ SCOPE_SHORT[s] }}
                  </button>
                </div>
                <span v-else :class="['text-xs', model[p.key] ? 'font-medium text-fg-muted' : 'text-fg-subtle']">Organization-wide</span>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </div>
  </div>
</template>
