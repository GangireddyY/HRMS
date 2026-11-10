<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Building2, CalendarClock, CalendarPlus, Contact, CornerDownLeft, Download, Fingerprint, Loader2, Receipt, Search, Sparkles, User, UserPlus, UserRound, X } from '@lucide/vue';
import { useAssistantStore } from '@/modules/assistant/assistant.store';
import { employeesApi } from '@/modules/people/api/people.api';
import { platformApi } from '@/modules/platform/api/platform.api';
import { recruitmentApi } from '@/modules/recruitment/api/recruitment.api';
import { usersApi } from '@/modules/users/api/users.api';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { isAllowed, type AccessRule } from '@/core/navigation/access-rules';
import { accessibleWorkspaces, visibleSections } from '@/core/navigation/workspaces';
import { useAuthStore } from '@/core/auth/auth.store';
import { t } from '@/core/i18n/i18n';
import { useUiStore } from '@/shared/stores/ui.store';

/**
 * Search box in the top bar with its results in a dropdown underneath (pages, people, organizations). Ctrl/⌘+K
 * focuses it; on small screens the search button expands it across the top bar.
 */
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
const assistant = useAssistantStore();
const router = useRouter();
const route = useRoute();
const subject = useAccessSubject();
const query = ref('');
const active = ref(0);
const remote = ref<Result[]>([]);
const searching = ref(false);
const focused = ref(false);
const root = ref<HTMLElement | null>(null);
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

/** Things people come to do, offered when the words match (and only when the user may open the page). */
const ACTIONS: { label: string; hint: string; words: string; to: string; icon: Component }[] = [
  { label: 'Apply for leave', hint: 'Request time off', words: 'leave time off vacation holiday sick', to: '/me/leave?apply=1', icon: CalendarPlus },
  { label: "Fill in this week's timesheet", hint: 'Log hours by project', words: 'timesheet hours log project', to: '/me/timesheets', icon: CalendarClock },
  { label: 'Mark attendance', hint: 'Punch in or out', words: 'punch in out attendance clock check', to: '/me/attendance', icon: Fingerprint },
  { label: 'Claim an expense', hint: 'Submit a reimbursement with the receipt', words: 'reimbursement expense claim bill receipt', to: '/me/reimbursements', icon: Receipt },
  { label: 'Add an employee', hint: 'Create an employee record', words: 'new hire employee create onboard', to: '/hr/employees/new', icon: UserPlus },
  { label: 'Download my data', hint: 'Everything the organization holds about you', words: 'privacy export personal data dpdp', to: '/me/security', icon: Download },
];
const canOpen = (to: string) => isAllowed(router.resolve(to).meta.access as AccessRule | undefined, subject.value);
const actions = computed<Result[]>(() => ACTIONS.filter((a) => canOpen(a.to)).map((a) => ({ id: `do:${a.to}`, label: a.label, hint: a.hint, to: a.to, icon: a.icon, group: 'Actions' })));
const GROUP_ORDER = ['Employees', 'Candidates', 'Users', 'Organizations'];

/** Records opened from search, for this tab only (names stay off the device once it's closed). */
const RECENT_KEY = 'hrms.searchRecent';
const RECENT_ICONS: Record<string, Component> = { emp: UserRound, cand: Contact, user: User, org: Building2 };
const recent = ref<Result[]>(
  (() => {
    try {
      return (JSON.parse(sessionStorage.getItem(RECENT_KEY) ?? '[]') as Omit<Result, 'icon'>[]).map((r) => ({ ...r, icon: RECENT_ICONS[r.id.split(':')[0]!] ?? User, group: 'Recent' }));
    } catch {
      return [];
    }
  })(),
);
function remember(r: Result) {
  if (!/^(emp|cand|user|org):/.test(r.id)) return;
  recent.value = [{ ...r, group: 'Recent' }, ...recent.value.filter((x) => x.id !== r.id)].slice(0, 5);
  sessionStorage.setItem(RECENT_KEY, JSON.stringify(recent.value.map(({ icon: _i, ...rest }) => rest)));
}

const results = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [...recent.value, ...actions.value.slice(0, 3), ...pages.value.slice(0, 6)];
  const nav = pages.value.filter((p) => p.label.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q));
  const todo = actions.value.filter((a) => a.label.toLowerCase().includes(q) || ACTIONS.find((x) => `do:${x.to}` === a.id)!.words.includes(q));
  const askAi: Result[] = q.length >= 3 ? [{ id: 'ask', label: `Ask AI: “${query.value.trim()}”`, hint: 'Assistant', to: '', icon: Sparkles, group: 'Assistant' }] : [];
  return [...todo.slice(0, 3), ...nav.slice(0, 6), ...remote.value, ...askAi];
});
/** `ui.searchOpen`: the dropdown is showing (and on small screens, the box is expanded). */
const open = computed(() => ui.searchOpen);

async function searchRemote(q: string) {
  const current = ++sequence;
  if (q.length < 2) {
    remote.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  const found: Result[] = [];
  try {
    const tasks: Promise<void>[] = [];
    if (auth.can('employee.view', 'TEAM')) {
      tasks.push(
        employeesApi.list({ search: q, pageSize: 6 }).then((page) => {
          for (const e of page.items) {
            found.push({ id: `emp:${e.id}`, label: e.fullName, hint: [e.employeeCode, e.designation?.name, e.department?.name].filter(Boolean).join(' · '), to: `/hr/employees/${e.id}`, icon: UserRound, group: 'Employees' });
          }
        }),
      );
    }
    if (auth.can('recruitment.view') && auth.hasFeature('recruitment')) {
      tasks.push(
        recruitmentApi.candidates({ search: q, pageSize: 4 }).then((page) => {
          for (const c of page.items) found.push({ id: `cand:${c.id}`, label: `${c.firstName} ${c.lastName}`.trim(), hint: c.currentTitle ?? c.email, to: `/hr/recruitment/candidates/${c.id}`, icon: Contact, group: 'Candidates' });
        }),
      );
    }
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
    if (current === sequence) remote.value = found.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  } finally {
    if (current === sequence) searching.value = false;
  }
}

watch(query, (q) => {
  active.value = 0;
  if (document.activeElement === input.value) ui.searchOpen = true;
  clearTimeout(timer);
  timer = setTimeout(() => void searchRemote(q.trim()), 250);
});

async function openSearch() {
  ui.searchOpen = true;
  await nextTick();
  input.value?.focus();
  input.value?.select();
}

function closeSearch() {
  ui.searchOpen = false;
  input.value?.blur();
}

function go(r: Result | undefined) {
  if (!r) return;
  const question = query.value.trim();
  closeSearch();
  query.value = '';
  remote.value = [];
  remember(r);
  if (r.id === 'ask') assistant.ask(question);
  else void router.push(r.to);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    ui.searchOpen = true;
    active.value = Math.min(active.value + 1, results.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = Math.max(active.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    go(results.value[active.value]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearch();
  }
}

// Keep the highlighted result in view while moving with the arrow keys.
watch(active, async (i) => {
  await nextTick();
  root.value?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' });
});

function onOutside(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) ui.searchOpen = false;
}
function globalShortcut(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (open.value && document.activeElement === input.value) closeSearch();
    else void openSearch();
  }
}
watch(() => route.fullPath, () => (ui.searchOpen = false));
onMounted(() => {
  window.addEventListener('keydown', globalShortcut);
  document.addEventListener('mousedown', onOutside);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', globalShortcut);
  document.removeEventListener('mousedown', onOutside);
});

const groupStart = (i: number) => i === 0 || results.value[i - 1]!.group !== results.value[i]!.group;
</script>

<template>
  <!-- Small screens: an icon until opened, then the box spans the top bar. -->
  <button
    type="button"
    class="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition hover:bg-surface-muted hover:text-fg md:hidden"
    aria-label="Search"
    @click="openSearch"
  >
    <Search :size="17" />
  </button>
  <div
    ref="root"
    :class="[
      'md:relative md:block md:w-64 lg:w-80',
      open ? 'absolute inset-x-2 top-1/2 z-30 block -translate-y-1/2 md:inset-auto md:top-auto md:translate-y-0' : 'hidden',
    ]"
  >
    <div class="relative">
      <Search :size="15" class="pointer-events-none absolute top-1/2 start-2.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
      <input
        ref="input"
        v-model="query"
        type="search"
        :placeholder="t('search.placeholder')"
        autocomplete="off"
        class="h-8 w-full card pe-14 ps-8 text-sm text-fg transition outline-none placeholder:text-fg-subtle hover:border-line-strong focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 [&::-webkit-search-cancel-button]:hidden"
        role="combobox"
        aria-label="Search"
        aria-autocomplete="list"
        :aria-expanded="open"
        aria-controls="global-search-results"
        :aria-activedescendant="open && results[active] ? `gs-${results[active].id}` : undefined"
        @focus="focused = true; ui.searchOpen = true"
        @blur="focused = false"
        @keydown="onKey"
      />
      <span class="absolute top-1/2 end-2 flex -translate-y-1/2 items-center gap-1">
        <Loader2 v-if="searching" :size="13" class="animate-spin text-fg-subtle" aria-hidden="true" />
        <button v-if="query" type="button" class="rounded-sm p-0.5 text-fg-subtle hover:text-fg" aria-label="Clear search" @mousedown.prevent @click="query = ''; input?.focus()">
          <X :size="13" />
        </button>
        <kbd v-else-if="!focused" class="hidden rounded-sm border border-line bg-surface-muted px-1 py-px font-sans text-2xs font-medium text-fg-subtle md:block">Ctrl K</kbd>
        <button v-else type="button" class="rounded-sm p-0.5 text-fg-subtle hover:text-fg md:hidden" aria-label="Close search" @mousedown.prevent @click="closeSearch">
          <X :size="13" />
        </button>
      </span>
    </div>

    <div v-if="open" class="absolute top-full end-0 z-40 mt-1 w-full min-w-[20rem] overflow-hidden rounded-md border border-line bg-surface shadow-pop max-md:start-0 max-md:min-w-0 md:w-[26rem]">
      <ul id="global-search-results" role="listbox" aria-label="Search results" class="max-h-[60vh] overflow-y-auto p-1">
        <li v-if="!results.length" class="px-3 py-6 text-center text-sm text-fg-muted" role="presentation">{{ searching ? t('search.searching') : t('search.noResults') }}</li>
        <template v-for="(r, i) in results" :key="r.id">
          <li v-if="groupStart(i)" class="px-2 pt-2 pb-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase" role="presentation">{{ r.group }}</li>
          <li
            :id="`gs-${r.id}`"
            role="option"
            :data-index="i"
            :aria-selected="i === active"
            :class="['flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 transition-colors', i === active ? 'bg-surface-muted' : '']"
            @mouseenter="active = i"
            @mousedown.prevent
            @click="go(r)"
          >
            <span :class="['flex h-7 w-7 shrink-0 items-center justify-center rounded-md', i === active ? 'bg-accent-soft text-accent-fg' : 'bg-surface-muted text-fg-muted']">
              <component :is="r.icon" :size="14" aria-hidden="true" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-fg">{{ r.label }}</p>
              <p class="truncate text-xs text-fg-subtle">{{ r.hint }}</p>
            </div>
            <CornerDownLeft v-if="i === active" :size="13" class="shrink-0 text-fg-subtle" aria-hidden="true" />
          </li>
        </template>
      </ul>
      <div class="flex items-center gap-3 border-t border-line bg-surface-muted/40 px-3 py-2 text-2xs text-fg-subtle max-md:hidden">
        <span>{{ t('search.hintMove') }}</span><span>{{ t('search.hintOpen') }}</span><span>{{ t('search.hintClose') }}</span>
      </div>
    </div>
  </div>
</template>
