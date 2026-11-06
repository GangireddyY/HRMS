<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import { useRouter } from 'vue-router';
import { Building2, CornerDownLeft, Search, User } from '@lucide/vue';
import { platformApi } from '@/modules/platform/api/platform.api';
import { usersApi } from '@/modules/users/api/users.api';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { accessibleWorkspaces, visibleSections } from '@/core/navigation/workspaces';
import { useAuthStore } from '@/core/auth/auth.store';
import { useUiStore } from '@/shared/stores/ui.store';

interface Result {
  id: string;
  label: string;
  hint: string;
  to: string;
  icon: Component;
  group: string;
}

const ui = useUiStore();
const auth = useAuthStore();
const router = useRouter();
const subject = useAccessSubject();
const query = ref('');
const active = ref(0);
const remote = ref<Result[]>([]);
const searching = ref(false);
const input = ref<HTMLInputElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;

const pages = computed<Result[]>(() =>
  accessibleWorkspaces(subject.value).flatMap((ws) =>
    visibleSections(ws, subject.value).flatMap((s) =>
      s.items.map((i) => ({ id: `nav:${i.to}`, label: i.label, hint: ws.label, to: i.to, icon: i.icon, group: 'Pages' })),
    ),
  ),
);

const results = computed(() => {
  const q = query.value.trim().toLowerCase();
  const nav = q ? pages.value.filter((p) => p.label.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q)) : pages.value.slice(0, 8);
  return [...nav.slice(0, 8), ...remote.value];
});

async function searchRemote(q: string) {
  const current = ++sequence;
  if (q.length < 2) {
    remote.value = [];
    return;
  }
  searching.value = true;
  const found: Result[] = [];
  try {
    const tasks: Promise<void>[] = [];
    if (auth.can('user.view')) {
      tasks.push(
        usersApi.list({ search: q, pageSize: 5 }).then((page) => {
          for (const m of page.items) found.push({ id: `user:${m.id}`, label: `${m.firstName} ${m.lastName}`, hint: m.email, to: `/admin/users/${m.id}`, icon: User, group: 'Users' });
        }),
      );
    }
    if (auth.canPlatform('platform.organizations.view')) {
      tasks.push(
        platformApi.organizations({ search: q, pageSize: 5 }).then((page) => {
          for (const o of page.items) found.push({ id: `org:${o.id}`, label: o.name, hint: o.slug, to: `/platform/organizations/${o.id}`, icon: Building2, group: 'Organizations' });
        }),
      );
    }
    await Promise.allSettled(tasks);
    if (current === sequence) remote.value = found;
  } finally {
    if (current === sequence) searching.value = false;
  }
}

watch(query, (q) => {
  active.value = 0;
  clearTimeout(timer);
  timer = setTimeout(() => void searchRemote(q.trim()), 250);
});

watch(
  () => ui.searchOpen,
  async (open) => {
    if (open) {
      query.value = '';
      remote.value = [];
      await nextTick();
      input.value?.focus();
    }
  },
);

function go(r: Result | undefined) {
  if (!r) return;
  ui.searchOpen = false;
  void router.push(r.to);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    active.value = Math.min(active.value + 1, results.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = Math.max(active.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    go(results.value[active.value]);
  } else if (e.key === 'Escape') {
    ui.searchOpen = false;
  }
}

function globalShortcut(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    ui.searchOpen = !ui.searchOpen;
  }
}
onMounted(() => window.addEventListener('keydown', globalShortcut));
onBeforeUnmount(() => window.removeEventListener('keydown', globalShortcut));
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.searchOpen" class="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div class="absolute inset-0 animate-fade-in bg-zinc-950/40 backdrop-blur-sm dark:bg-black/60" aria-hidden="true" @click="ui.searchOpen = false" />
      <div class="relative w-full max-w-xl animate-scale-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
        <div class="flex items-center gap-3 border-b border-line px-4">
          <Search :size="18" class="text-fg-subtle" aria-hidden="true" />
          <input
            ref="input"
            v-model="query"
            type="search"
            placeholder="Search pages, people, organizations…"
            class="h-14 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-subtle"
            role="combobox"
            aria-expanded="true"
            aria-controls="global-search-results"
            :aria-activedescendant="results[active] ? `gs-${results[active].id}` : undefined"
            @keydown="onKey"
          />
          <kbd class="rounded-md border border-line bg-surface-muted px-1.5 py-px text-[10px] font-medium text-fg-subtle">Esc</kbd>
        </div>
        <ul id="global-search-results" role="listbox" class="max-h-[22rem] overflow-y-auto p-2">
          <li v-if="!results.length" class="px-3 py-10 text-center text-sm text-fg-muted">{{ searching ? 'Searching…' : 'No results' }}</li>
          <li
            v-for="(r, i) in results"
            :id="`gs-${r.id}`"
            :key="r.id"
            role="option"
            :aria-selected="i === active"
            :class="['flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors', i === active ? 'bg-surface-muted' : '']"
            @mouseenter="active = i"
            @click="go(r)"
          >
            <span
              :class="[
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
                i === active ? 'bg-brand-50 text-brand-600 ring-brand-600/15 dark:bg-brand-500/15 dark:text-brand-300' : 'bg-surface text-fg-muted ring-line',
              ]"
            >
              <component :is="r.icon" :size="15" aria-hidden="true" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-fg">{{ r.label }}</p>
              <p class="truncate text-xs text-fg-subtle">{{ r.group }} · {{ r.hint }}</p>
            </div>
            <CornerDownLeft v-if="i === active" :size="14" class="text-fg-subtle" aria-hidden="true" />
          </li>
        </ul>
        <div class="flex items-center gap-4 border-t border-line bg-surface-muted/40 px-4 py-2.5 text-[11px] text-fg-subtle">
          <span class="flex items-center gap-1.5"><kbd class="rounded border border-line bg-surface px-1">↑</kbd><kbd class="rounded border border-line bg-surface px-1">↓</kbd> to navigate</span>
          <span class="flex items-center gap-1.5"><kbd class="rounded border border-line bg-surface px-1">↵</kbd> to open</span>
          <span v-if="searching" class="ml-auto">Searching…</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
