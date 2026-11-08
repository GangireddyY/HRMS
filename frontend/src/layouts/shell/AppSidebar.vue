<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Building2, Check, ChevronDown, ChevronsUpDown, PanelLeftClose, PanelLeftOpen, X } from '@lucide/vue';
import { useAccessSubject } from '@/core/auth/use-access-subject';
import { accessibleWorkspaces, homePath, visibleSections, type NavItem, type Workspace } from '@/core/navigation/workspaces';
import { useAuthStore } from '@/core/auth/auth.store';
import { apiAssetUrl } from '@/core/http/http-client';
import { useThemeStore } from '@/core/theme/theme.store';
import { contrastRatio, cssColorLuminance, useLogoAppearance } from '@/shared/composables/use-logo-appearance';
import { AppDropdown, AppLogo } from '@/shared/components';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { useUiStore } from '@/shared/stores/ui.store';

const props = defineProps<{ workspace: Workspace }>();
const ui = useUiStore();
const theme = useThemeStore();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const route = useRoute();
const router = useRouter();
const subject = useAccessSubject();
const switching = ref(false);

const sections = computed(() => visibleSections(props.workspace, subject.value));
const workspaces = computed(() => accessibleWorkspaces(subject.value).filter((ws) => visibleSections(ws, subject.value).length));
const organizations = computed(() => auth.context?.organizations ?? []);
const expanded = computed(() => !ui.sidebarCollapsed || ui.mobileNavOpen);
const orgName = computed(() => auth.organization?.name ?? 'HRMS Platform');
const orgInitial = computed(() => orgName.value.trim().charAt(0).toUpperCase() || 'H');
const orgLogo = computed(() => apiAssetUrl(auth.organization?.logoUrl));
/** An organization logo gets its own brand area at the top of the expanded sidebar. */
const showBrand = computed(() => !!orgLogo.value && expanded.value);
const logo = useLogoAppearance(orgLogo);
/** Wordmark-style logos (much wider than tall) don't fit the collapsed sidebar's square tile. */
const logoWide = computed(() => (logo.value?.aspect ?? 1) > 1.6);

const aside = ref<HTMLElement | null>(null);
const sidebarLuminance = ref<number | null>(null);
watch(
  () => [theme.isDark, theme.sidebar, aside.value] as const,
  async () => {
    await nextTick();
    sidebarLuminance.value = aside.value ? cssColorLuminance(getComputedStyle(aside.value).backgroundColor) : null;
  },
  { immediate: true },
);

/**
 * How the brand logo sits on the sidebar:
 * - a logo with its own background becomes a compact badge in that background colour;
 * - a transparent logo is placed directly on the sidebar, with a contrasting backdrop only when it would be hard to see.
 */
const brandBackdrop = computed<{ class: string; style?: Record<string, string> }>(() => {
  const a = logo.value;
  if (!a) return { class: 'opacity-0' };
  if (a.opaque) return { class: 'rounded-lg px-3 py-2', style: { backgroundColor: a.edgeColor } };
  const bg = sidebarLuminance.value;
  if (bg === null || contrastRatio(a.luminance, bg) >= 2.2) return { class: '' };
  return { class: bg < 0.2 ? 'rounded-lg bg-white px-3 py-2' : 'rounded-lg bg-zinc-900 px-3 py-2' };
});

function isActive(item: NavItem): boolean {
  return item.exact ? route.path === item.to : route.path === item.to || route.path.startsWith(`${item.to}/`);
}

// Titled sections fold away (remembered per workspace); the one holding the current page always stays open.
const CLOSED_KEY = 'hrms.nav.closed';
const closed = ref(new Set<string>(JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as string[]));
const sectionKey = (title: string) => `${props.workspace.key}:${title}`;
function sectionOpen(section: { title?: string; items: NavItem[] }): boolean {
  if (!section.title || !expanded.value) return true;
  return section.items.some(isActive) || !closed.value.has(sectionKey(section.title));
}
function toggleSection(title: string) {
  const key = sectionKey(title);
  const next = new Set(closed.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  closed.value = next;
  localStorage.setItem(CLOSED_KEY, JSON.stringify([...next]));
}

function workspaceHome(ws: Workspace): string {
  return visibleSections(ws, subject.value)[0]?.items[0]?.to ?? ws.home;
}

async function switchOrg(id: string) {
  if (id === auth.organization?.id || switching.value) return;
  switching.value = true;
  try {
    await auth.switchOrganization(id);
    await router.push(homePath(subject.value));
    feedback.success(`Switched to ${auth.organization?.name}`);
  } catch (e) {
    feedback.error('Could not switch organization', e);
  } finally {
    switching.value = false;
  }
}

const closeButton = ref<HTMLButtonElement | null>(null);

watch(
  () => ui.mobileNavOpen,
  async (open) => {
    if (!open) return;
    await nextTick();
    closeButton.value?.focus();
  },
);
watch(() => route.fullPath, () => (ui.mobileNavOpen = false));

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && ui.mobileNavOpen) ui.mobileNavOpen = false;
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <!-- Mobile backdrop -->
  <div v-if="ui.mobileNavOpen" class="fixed inset-0 z-30 animate-fade-in bg-scrim/40 backdrop-blur-sm lg:hidden" aria-hidden="true" @click="ui.mobileNavOpen = false" />
  <aside
    ref="aside"
    :class="[
      'fixed inset-y-0 start-0 z-40 flex max-w-[85vw] flex-col bg-sidebar text-sidebar-fg transition-[width,transform] duration-200',
      'max-lg:border-e max-lg:border-sidebar-line max-lg:shadow-pop lg:static lg:visible lg:max-w-none lg:translate-x-0',
      ui.sidebarCollapsed ? 'lg:w-16' : 'lg:w-60',
      // A closed drawer is also invisible so its links are not reachable by keyboard or screen readers.
      ui.mobileNavOpen ? 'visible w-72 translate-x-0' : 'invisible w-72 -translate-x-full',
    ]"
  >
    <!-- Brand logo in its own area at the top; the backdrop adapts to the logo and the sidebar colour. -->
    <div v-if="showBrand" class="shrink-0 px-4 pt-4 pb-1">
      <RouterLink
        :to="workspaceHome(workspace)"
        class="flex h-16 w-full items-center justify-center rounded-xl transition hover:opacity-85"
        :aria-label="`${orgName} – go to ${workspace.label} home`"
      >
        <span :class="['inline-flex max-h-full max-w-full items-center justify-center transition-opacity duration-300', brandBackdrop.class]" :style="brandBackdrop.style">
          <img :src="orgLogo!" :alt="`${orgName} logo`" class="max-h-12 max-w-full object-contain" />
        </span>
      </RouterLink>
    </div>

    <!-- Workspace / organization switcher -->
    <div class="flex h-12 shrink-0 items-center gap-2 px-3">
      <AppDropdown width="w-72" align="left" label="Switch workspace" class="min-w-0 flex-1">
        <template #trigger="{ toggle, open }">
          <button
            type="button"
            :class="[
              'flex w-full min-w-0 items-center gap-3 rounded-md p-1 text-start transition hover:bg-sidebar-hover',
              open && 'bg-sidebar-hover',
              !expanded && 'justify-center',
            ]"
            :aria-label="expanded ? undefined : `${orgName}, ${workspace.label}. Switch workspace`"
            @click="toggle"
          >
            <span v-if="expanded" class="sr-only">Switch workspace:</span>
            <AppLogo v-if="!auth.organization" :size="32" />
            <!-- The brand area above already shows the logo, so the switcher shows the workspace. -->
            <span
              v-else-if="showBrand"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-active text-sidebar-icon-active ring-1 ring-sidebar-line"
            >
              <component :is="workspace.icon" :size="16" aria-hidden="true" />
            </span>
            <!-- Collapsed sidebar: square logos fit the tile; wide wordmarks would be unreadable, so use the initial. -->
            <span v-else-if="orgLogo && !logoWide" class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-sidebar-line">
              <img :src="orgLogo" alt="" class="h-full w-full object-contain p-0.5" />
            </span>
            <span
              v-else
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]"
              aria-hidden="true"
            >
              {{ orgInitial }}
            </span>
            <span v-if="expanded && showBrand" class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold text-sidebar-fg-strong">{{ workspace.label }}</span>
              <span class="block truncate text-xs text-sidebar-fg">{{ orgName }}</span>
            </span>
            <span v-else-if="expanded" class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold text-sidebar-fg-strong">{{ orgName }}</span>
              <span class="block truncate text-xs text-sidebar-fg">{{ workspace.label }}</span>
            </span>
            <ChevronsUpDown v-if="expanded" :size="15" class="shrink-0 text-sidebar-section" aria-hidden="true" />
          </button>
        </template>
        <p class="px-3 pt-1 pb-2 text-xs font-medium text-fg-subtle">Workspaces</p>
        <RouterLink
          v-for="ws in workspaces"
          :key="ws.key"
          :to="workspaceHome(ws)"
          role="menuitem"
          class="flex items-start gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-surface-muted"
        >
          <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-fg-muted ring-1 ring-line ring-inset">
            <component :is="ws.icon" :size="15" aria-hidden="true" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium text-fg">{{ ws.label }}</span>
            <span class="block text-xs text-fg-muted">{{ ws.description }}</span>
          </span>
          <Check v-if="ws.key === workspace.key" :size="15" class="mt-1 text-accent-fg" aria-hidden="true" />
        </RouterLink>
        <template v-if="organizations.length > 1">
          <div class="my-2 border-t border-line" />
          <p class="px-3 pt-1 pb-2 text-xs font-medium text-fg-subtle">Organizations</p>
          <button
            v-for="org in organizations"
            :key="org.id"
            type="button"
            role="menuitem"
            :disabled="switching"
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm font-medium text-fg transition-colors hover:bg-surface-muted disabled:opacity-50"
            @click="switchOrg(org.id)"
          >
            <Building2 :size="15" class="text-fg-subtle" aria-hidden="true" />
            <span class="flex-1 truncate">{{ org.name }}</span>
            <Check v-if="org.id === auth.organization?.id" :size="14" class="text-accent-fg" aria-hidden="true" />
          </button>
        </template>
      </AppDropdown>
      <button
        ref="closeButton"
        type="button"
        class="rounded-lg p-2 text-sidebar-fg transition hover:bg-sidebar-hover hover:text-sidebar-fg-strong lg:hidden"
        aria-label="Close navigation"
        @click="ui.mobileNavOpen = false"
      >
        <X :size="18" />
      </button>
    </div>

    <nav class="flex-1 space-y-4 overflow-y-auto px-3 pt-1 pb-3" aria-label="Primary navigation">
      <div v-for="(section, si) in sections" :key="si">
        <button
          v-if="section.title && expanded"
          type="button"
          class="group mb-1 flex w-full items-center justify-between rounded-sm px-3 text-xs font-medium text-sidebar-section transition hover:text-sidebar-fg-strong"
          :aria-expanded="sectionOpen(section)"
          @click="toggleSection(section.title)"
        >
          {{ section.title }}
          <ChevronDown :size="13" :class="['opacity-0 transition group-hover:opacity-100', !sectionOpen(section) && '-rotate-90 opacity-100']" aria-hidden="true" />
        </button>
        <div v-else-if="section.title" class="mx-auto mb-2 h-px w-6 bg-sidebar-line" aria-hidden="true" />
        <ul v-show="sectionOpen(section)" class="space-y-0.5">
          <li v-for="item in section.items" :key="item.to">
            <RouterLink
              :to="item.to"
              :title="!expanded ? item.label : undefined"
              :aria-current="isActive(item) ? 'page' : undefined"
              :class="[
                'group flex h-8 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                isActive(item)
                  ? 'bg-sidebar-active text-sidebar-active-fg shadow-card ring-1 ring-sidebar-line'
                  : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg-strong',
                !expanded ? 'lg:justify-center lg:px-0' : '',
              ]"
              @click="ui.mobileNavOpen = false"
            >
              <component
                :is="item.icon"
                :size="16"
                :class="['shrink-0 transition-colors', isActive(item) ? 'text-sidebar-icon-active' : 'text-sidebar-section group-hover:text-sidebar-fg-strong']"
                aria-hidden="true"
              />
              <span :class="!expanded ? 'lg:sr-only' : 'truncate'">{{ item.label }}</span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>

    <div class="hidden p-3 lg:block">
      <button
        type="button"
        :class="[
          'flex h-8 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-fg transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg-strong',
          ui.sidebarCollapsed && 'justify-center px-0',
        ]"
        :aria-label="ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-expanded="!ui.sidebarCollapsed"
        @click="ui.sidebarCollapsed = !ui.sidebarCollapsed"
      >
        <PanelLeftOpen v-if="ui.sidebarCollapsed" :size="17" />
        <template v-else><PanelLeftClose :size="17" /> Collapse</template>
      </button>
    </div>
  </aside>
</template>
