<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { FileText, KeyRound, Lock, Plus, Save, ShieldCheck, ShieldOff, Trash2, TriangleAlert, UserCog, UserPlus, Users } from '@lucide/vue';
import { PERMISSION_SCOPES, type PermissionScope } from '@contracts';
import { rolesApi } from '@/modules/roles/api/roles.api';
import PermissionMatrix from '@/modules/roles/components/PermissionMatrix.vue';
import { roleVisual } from '@/modules/roles/utils/role-visuals';
import { usersApi } from '@/modules/users/api/users.api';
import type { Member } from '@/modules/users/types';
import {
  AppAlert,
  AppAvatar,
  AppBadge,
  AppButton,
  AppCard,
  AppDataTable,
  AppErrorState,
  AppInput,
  AppPageHeader,
  AppSearchInput,
  AppSelect,
  AppSkeleton,
  AppTabs,
  AppTextarea,
  type SelectOption,
  type TableColumn,
} from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useTable } from '@/shared/composables/use-table';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { appLocale } from '@/core/locale/locale';
import { formatDateTime, timeAgo } from '@/shared/utils/format';
import { MODULE_ICONS } from '@/shared/utils/module-icons';
import { SCOPE_LABELS, membershipTone, statusLabel } from '@/shared/utils/status';

/** One role: permission matrix, the people who hold it, and its details (with deletion for custom roles). */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const role = useAsync(() => rolesApi.get(id.value));
const roles = useAsync(() => rolesApi.list());
const catalog = useAsync(() => rolesApi.catalog());
watch(id, () => role.run());
const num = (n: number) => n.toLocaleString(appLocale());

const tab = ref<'permissions' | 'members' | 'details'>('permissions');
const grants = ref<Record<string, PermissionScope>>({});
const details = reactive({ name: '', description: '' });
const savingGrants = ref(false);
const savingDetails = ref(false);
const grantErrors = useFormErrors();
const detailErrors = useFormErrors();

watch(
  role.data,
  (r) => {
    if (!r) return;
    grants.value = Object.fromEntries(r.permissions.map((p) => [p.key, p.scope]));
    details.name = r.name;
    details.description = r.description ?? '';
    grantErrors.reset();
    detailErrors.reset();
  },
  { immediate: true },
);

const look = computed(() => roleVisual(role.data.value?.key ?? ''));
const canManage = computed(() => auth.can('role.manage'));
const canSeeMembers = computed(() => auth.can('user.view'));
const readonly = computed(() => !canManage.value || !!role.data.value?.isLocked);
const originalGrants = computed<Record<string, PermissionScope>>(() => Object.fromEntries((role.data.value?.permissions ?? []).map((p) => [p.key, p.scope])));
const changeCount = computed(() => {
  const keys = new Set([...Object.keys(originalGrants.value), ...Object.keys(grants.value)]);
  return [...keys].filter((k) => originalGrants.value[k] !== grants.value[k]).length;
});
const grantsDirty = computed(() => changeCount.value > 0);
const detailsDirty = computed(() => !!role.data.value && (details.name !== role.data.value.name || details.description !== (role.data.value.description ?? '')));
const tabs = computed(() => [
  { key: 'permissions', label: 'Permissions', icon: KeyRound, count: Object.keys(grants.value).length },
  ...(canSeeMembers.value ? [{ key: 'members', label: 'Members', icon: Users, count: role.data.value?.memberCount ?? null }] : []),
  { key: 'details', label: 'Details', icon: FileText },
]);

/** System roles first, then custom roles; the current role is always listed even before the list loads. */
const roleOptions = computed<SelectOption<string>[]>(() => {
  const list = roles.data.value ?? (role.data.value ? [{ ...role.data.value, permissionCount: role.data.value.permissions.length }] : []);
  return [...list]
    .sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name))
    .map((r) => ({
      value: r.id,
      label: r.name,
      description: `${r.isSystem ? 'System' : 'Custom'} · ${r.memberCount} ${r.memberCount === 1 ? 'user' : 'users'} · ${r.permissionCount} permissions`,
    }));
});

function switchRole(next: string | null | undefined) {
  if (next && next !== id.value) void router.push(`/admin/roles/${next}`);
}

function discardGrants() {
  grants.value = { ...originalGrants.value };
}

/** Switching to another role or leaving the page must not silently drop unsaved permission changes. */
async function confirmLeave(): Promise<boolean> {
  if (!grantsDirty.value || readonly.value) return true;
  return feedback.confirm({
    title: 'Discard unsaved changes?',
    message: `You have ${changeCount.value} unsaved permission ${changeCount.value === 1 ? 'change' : 'changes'} on “${role.data.value?.name}”.`,
    confirmLabel: 'Discard changes',
    danger: true,
  });
}
onBeforeRouteUpdate(confirmLeave);
onBeforeRouteLeave(confirmLeave);

async function saveGrants() {
  grantErrors.reset();
  savingGrants.value = true;
  try {
    role.data.value = await rolesApi.setPermissions(id.value, Object.entries(grants.value).map(([key, scope]) => ({ key, scope })));
    feedback.success('Permissions saved', 'Changes apply to assigned users immediately.');
    void roles.run();
  } catch (e) {
    grantErrors.handle(e, 'Could not save permissions');
  } finally {
    savingGrants.value = false;
  }
}

async function saveDetails() {
  detailErrors.reset();
  savingDetails.value = true;
  try {
    const description = details.description.trim();
    role.data.value = await rolesApi.update(id.value, role.data.value?.isSystem ? { description } : { name: details.name.trim(), description });
    feedback.success('Role updated');
    void roles.run();
  } catch (e) {
    detailErrors.handle(e, 'Could not update role');
  } finally {
    savingDetails.value = false;
  }
}

function resetDetails() {
  details.name = role.data.value?.name ?? '';
  details.description = role.data.value?.description ?? '';
  detailErrors.reset();
}

async function remove() {
  const r = role.data.value!;
  if (!(await feedback.confirm({ title: `Delete "${r.name}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete role', danger: true, requireText: r.name }))) return;
  try {
    await rolesApi.remove(id.value);
    feedback.success('Role deleted');
    await router.replace('/admin/roles');
  } catch (e) {
    feedback.error('Could not delete role', e);
  }
}

// ---- Members (loaded when the tab is first opened) -------------------------------------------------------------
const members = useTable((q) => usersApi.list({ ...q, roleId: id.value }), { pageSize: 20, sort: 'name:asc', url: false, immediate: false });
let membersFor: string | null = null;
watch([tab, id], ([t, roleId]) => {
  if (t !== 'members' || membersFor === roleId) return;
  membersFor = roleId;
  members.search.value = '';
  if (members.page.value !== 1) members.setPage(1);
  else void members.load();
});
const memberColumns: TableColumn<Member>[] = [
  { key: 'name', label: 'User', sortField: 'name' },
  { key: 'otherRoles', label: 'Other roles' },
  { key: 'status', label: 'Status', sortField: 'status' },
  { key: 'mfa', label: '2FA' },
  { key: 'lastLoginAt', label: 'Last sign-in', sortField: 'lastLoginAt' },
];

// ---- Access summary (from the grants as they are being edited) -------------------------------------------------
const SCOPE_BAR: Record<PermissionScope, string> = { OWN: 'bg-slate-400', TEAM: 'bg-sky-500', DEPARTMENT: 'bg-amber-500', ORGANIZATION: 'bg-brand-500' };
const scopeCounts = computed(() => PERMISSION_SCOPES.map((s) => ({ scope: s, count: Object.values(grants.value).filter((g) => g === s).length })));
const grantTotal = computed(() => Object.keys(grants.value).length);
const moduleCoverage = computed(() =>
  (catalog.data.value?.modules ?? [])
    .map((m) => ({ key: m.key, name: m.name, granted: m.permissions.filter((p) => grants.value[p.key]).length, total: m.permissions.length }))
    .filter((m) => m.granted > 0)
    .sort((a, b) => b.granted / b.total - a.granted / a.total),
);
</script>

<template>
  <!-- Large screens: fixed header and tabs; the side menu and the content scroll on their own (route meta `fill`). -->
  <div class="relative flex min-w-0 flex-col lg:h-full">
    <AppSkeleton v-if="role.loading.value && !role.data.value" :lines="8" />
    <AppErrorState v-else-if="role.error.value" :error="role.error.value" title="Could not load role" @retry="role.run" />
    <template v-else-if="role.data.value">
      <AppPageHeader class="shrink-0 lg:mb-4" :title="role.data.value.name" :description="role.data.value.description ?? undefined" back="/admin/roles" back-label="All roles">
        <template #leading>
          <span :class="['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', look.tile]" aria-hidden="true">
            <component :is="look.icon" :size="22" />
          </span>
        </template>
        <template #badges>
          <AppBadge :tone="role.data.value.isSystem ? 'neutral' : 'info'">{{ role.data.value.isSystem ? 'System role' : 'Custom role' }}</AppBadge>
          <AppBadge v-if="role.data.value.isLocked" tone="warning"><Lock :size="11" /> Locked</AppBadge>
          <span class="text-xs text-fg-muted tabular-nums">{{ num(role.data.value.memberCount) }} {{ role.data.value.memberCount === 1 ? 'user' : 'users' }} · updated {{ timeAgo(role.data.value.updatedAt) }}</span>
        </template>
        <template #actions>
          <AppSelect
            :model-value="id"
            :options="roleOptions"
            aria-label="Switch role"
            searchable
            :clearable="false"
            class="min-w-0 flex-1 sm:w-72 sm:flex-none"
            @update:model-value="switchRole"
          />
          <AppButton v-if="canManage" :icon="Plus" to="/admin/roles?new=1">New role</AppButton>
        </template>
      </AppPageHeader>

      <AppTabs v-model="tab" :tabs="tabs" fill>
        <!-- Permissions -->
        <div v-if="tab === 'permissions'" class="space-y-4 lg:flex lg:h-full lg:flex-col lg:gap-4 lg:space-y-0">
          <AppAlert v-if="role.data.value.isLocked" tone="info" class="shrink-0">This role is locked to prevent administrators from losing access. Create a custom role for different permissions.</AppAlert>
          <AppAlert v-if="grantErrors.formError.value" class="shrink-0">{{ grantErrors.formError.value }}</AppAlert>
          <AppCard v-if="catalog.loading.value"><AppSkeleton :lines="8" /></AppCard>
          <AppErrorState v-else-if="catalog.error.value" :error="catalog.error.value" @retry="catalog.run" />
          <PermissionMatrix v-else-if="catalog.data.value" v-model="grants" :modules="catalog.data.value.modules" :readonly="readonly" :bottom-inset="!readonly && grantsDirty" class="lg:min-h-0 lg:flex-1" />
        </div>

        <!-- Members (scrolls inside the panel on large screens) -->
        <div v-else-if="tab === 'members'" class="lg:h-full lg:overflow-y-auto lg:pe-1 lg:pb-1">
          <section class="card">
            <div class="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
              <AppSearchInput v-model="members.search.value" class="min-w-0 flex-1 sm:max-w-sm" placeholder="Search name or email" aria-label="Search members" />
              <p class="ms-auto text-xs text-fg-muted">Assign or remove this role from a user’s page.</p>
              <AppButton v-if="auth.can('user.update')" variant="secondary" size="sm" :icon="UserPlus" to="/admin/users">Assign to users</AppButton>
            </div>
            <AppDataTable
              v-model:sort="members.sort.value"
              :grid="false"
              :columns="memberColumns"
              :rows="members.rows.value"
              :loading="members.loading.value"
              :error="members.error.value"
              :meta="members.meta.value"
              clickable
              :caption="`Users with the ${role.data.value.name} role`"
              empty-title="Nobody has this role yet"
              empty-description="Open a user and add this role to give them its permissions."
              :filtered="members.isFiltered.value"
              @page="members.setPage"
              @retry="members.load"
              @clear="members.clearFilters()"
              @row-click="(row) => router.push(`/admin/users/${row.id}`)"
            >
              <template #empty><AppButton v-if="auth.can('user.update')" size="sm" :icon="UserPlus" to="/admin/users">Go to users</AppButton></template>
              <template #cell-name="{ row }">
                <div class="flex items-center gap-3">
                  <AppAvatar :name="`${row.firstName} ${row.lastName}`" :src="row.avatarUrl" size="sm" />
                  <div class="min-w-0">
                    <p class="truncate font-medium text-fg">{{ row.firstName }} {{ row.lastName }}</p>
                    <p class="truncate text-xs text-fg-muted">{{ row.email }}</p>
                  </div>
                </div>
              </template>
              <template #cell-otherRoles="{ row }">
                <div class="flex flex-wrap gap-1">
                  <AppBadge v-for="r in row.roles.filter((x) => x.id !== id).slice(0, 2)" :key="r.id" tone="brand">{{ r.name }}</AppBadge>
                  <AppBadge v-if="row.roles.filter((x) => x.id !== id).length > 2">+{{ row.roles.filter((x) => x.id !== id).length - 2 }}</AppBadge>
                  <span v-if="row.roles.length <= 1" class="text-xs text-fg-subtle">—</span>
                </div>
              </template>
              <template #cell-status="{ row }"><AppBadge :tone="membershipTone[row.status]" dot>{{ statusLabel(row.status) }}</AppBadge></template>
              <template #cell-mfa="{ row }">
                <span :class="['inline-flex items-center gap-1 text-xs', row.mfaEnabled ? 'text-success-fg' : 'text-fg-muted']">
                  <component :is="row.mfaEnabled ? ShieldCheck : ShieldOff" :size="13" aria-hidden="true" />{{ row.mfaEnabled ? 'On' : 'Off' }}
                </span>
              </template>
              <template #cell-lastLoginAt="{ row }"><span class="text-fg-muted" :title="formatDateTime(row.lastLoginAt)">{{ timeAgo(row.lastLoginAt) }}</span></template>
            </AppDataTable>
          </section>
        </div>

        <!-- Details (scrolls inside the panel on large screens) -->
        <div v-else class="lg:h-full lg:overflow-y-auto lg:pe-1 lg:pb-1">
          <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div class="min-w-0 space-y-4">
              <AppCard title="Role details" :icon="UserCog" description="How this role appears when you assign it to people.">
                <form novalidate @submit.prevent="saveDetails">
                  <AppAlert v-if="detailErrors.formError.value" class="mb-4">{{ detailErrors.formError.value }}</AppAlert>
                  <div class="divide-y divide-line/70">
                    <div class="grid gap-3 pb-4 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-5">
                      <div>
                        <label for="role-name" class="text-sm font-medium text-fg">Name</label>
                        <p class="mt-0.5 text-sm text-fg-muted">Shown in user lists and invitations.</p>
                      </div>
                      <AppInput
                        id="role-name"
                        v-model="details.name"
                        :required="!role.data.value.isSystem"
                        :disabled="!canManage || role.data.value.isSystem"
                        :icon="role.data.value.isSystem ? Lock : undefined"
                        :help="role.data.value.isSystem ? 'System role names can’t be changed.' : undefined"
                        :error="detailErrors.fieldErrors.value.name"
                      />
                    </div>
                    <div class="grid gap-3 pt-4 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-5">
                      <div>
                        <label for="role-description" class="text-sm font-medium text-fg">Description</label>
                        <p class="mt-0.5 text-sm text-fg-muted">Explain who should get this role.</p>
                      </div>
                      <AppTextarea id="role-description" v-model="details.description" :rows="3" :max-rows="6" :maxlength="500" :disabled="!canManage" :error="detailErrors.fieldErrors.value.description" />
                    </div>
                  </div>
                  <div v-if="canManage" class="-mx-4 -mb-4 mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line/70 bg-surface-muted/40 px-4 py-3">
                    <p v-if="detailsDirty" class="me-auto inline-flex items-center gap-2 text-sm text-fg"><span class="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />Unsaved changes</p>
                    <AppButton variant="ghost" size="sm" :disabled="!detailsDirty || savingDetails" @click="resetDetails">Reset</AppButton>
                    <AppButton type="submit" size="sm" :icon="Save" :loading="savingDetails" :disabled="!detailsDirty || details.name.trim().length < 2">Save details</AppButton>
                  </div>
                </form>
              </AppCard>

              <AppCard title="Access summary" :icon="KeyRound" :description="grantTotal ? `${num(grantTotal)} permissions across ${moduleCoverage.length} modules` : 'This role grants no permissions yet.'">
                <template v-if="grantTotal">
                  <div class="flex h-2.5 overflow-hidden rounded-full bg-surface-muted" role="img" :aria-label="scopeCounts.map((s) => `${SCOPE_LABELS[s.scope]}: ${s.count}`).join(', ')">
                    <span v-for="s in scopeCounts.filter((x) => x.count)" :key="s.scope" :class="['h-full', SCOPE_BAR[s.scope]]" :style="{ width: `${(s.count / grantTotal) * 100}%` }" />
                  </div>
                  <ul class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                    <li v-for="s in scopeCounts" :key="s.scope" class="flex items-center gap-1.5 text-fg-muted">
                      <span :class="['h-2 w-2 shrink-0 rounded-full', SCOPE_BAR[s.scope]]" aria-hidden="true" />
                      <span class="truncate">{{ SCOPE_LABELS[s.scope] }}</span>
                      <span class="ms-auto font-semibold text-fg tabular-nums">{{ s.count }}</span>
                    </li>
                  </ul>
                  <ul v-if="moduleCoverage.length" class="mt-5 grid gap-x-6 gap-y-3 border-t border-line/70 pt-4 sm:grid-cols-2">
                    <li v-for="m in moduleCoverage" :key="m.key" class="flex items-center gap-3">
                      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted" aria-hidden="true"><component :is="MODULE_ICONS[m.key]" :size="14" /></span>
                      <div class="min-w-0 flex-1">
                        <div class="flex items-baseline justify-between gap-2 text-xs">
                          <span class="truncate font-medium text-fg">{{ m.name }}</span>
                          <span class="text-fg-muted tabular-nums">{{ m.granted }}/{{ m.total }}</span>
                        </div>
                        <div class="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                          <div class="h-full rounded-full bg-brand-500/80" :style="{ width: `${(m.granted / m.total) * 100}%` }" />
                        </div>
                      </div>
                    </li>
                  </ul>
                </template>
                <AppButton v-else-if="!readonly" size="sm" variant="secondary" :icon="KeyRound" @click="tab = 'permissions'">Choose permissions</AppButton>
              </AppCard>
            </div>

            <aside class="space-y-4">
              <AppCard title="Role information">
                <dl class="divide-y divide-line/70 text-sm">
                  <div class="flex items-center justify-between gap-3 pb-2.5">
                    <dt class="text-fg-muted">Type</dt>
                    <dd class="flex items-center gap-1.5 font-medium text-fg">
                      <component :is="role.data.value.isSystem ? ShieldCheck : UserCog" :size="14" class="text-fg-subtle" aria-hidden="true" />
                      {{ role.data.value.isSystem ? 'System' : 'Custom' }}{{ role.data.value.isLocked ? ' · Locked' : '' }}
                    </dd>
                  </div>
                  <div class="flex items-center justify-between gap-3 py-2.5"><dt class="text-fg-muted">Key</dt><dd class="truncate font-mono text-xs text-fg">{{ role.data.value.key }}</dd></div>
                  <div class="flex items-center justify-between gap-3 py-2.5"><dt class="text-fg-muted">Assigned users</dt><dd class="font-medium text-fg tabular-nums">{{ num(role.data.value.memberCount) }}</dd></div>
                  <div class="flex items-center justify-between gap-3 py-2.5"><dt class="text-fg-muted">Permissions</dt><dd class="font-medium text-fg tabular-nums">{{ num(role.data.value.permissions.length) }}</dd></div>
                  <div class="flex items-center justify-between gap-3 py-2.5"><dt class="text-fg-muted">Created</dt><dd class="text-fg" :title="formatDateTime(role.data.value.createdAt)">{{ timeAgo(role.data.value.createdAt) }}</dd></div>
                  <div class="flex items-center justify-between gap-3 pt-2.5"><dt class="text-fg-muted">Last updated</dt><dd class="text-fg" :title="formatDateTime(role.data.value.updatedAt)">{{ timeAgo(role.data.value.updatedAt) }}</dd></div>
                </dl>
                <p class="mt-4 rounded-lg bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">
                  {{ role.data.value.isSystem ? 'Provisioned by HRMS for every organization. Its name is fixed; you can tune its permissions unless it is locked.' : 'Created by your organization. You can rename, re-scope or delete it.' }}
                </p>
              </AppCard>

              <section v-if="canManage && !role.data.value.isSystem" class="card overflow-hidden ring-1 ring-danger/25" aria-labelledby="role-danger-title">
                <header class="flex items-center gap-3 border-b border-danger/15 bg-danger-soft/40 px-4 py-3">
                  <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-danger-soft text-danger-fg" aria-hidden="true"><TriangleAlert :size="16" /></span>
                  <h2 id="role-danger-title" class="text-sm font-semibold text-fg">Danger zone</h2>
                </header>
                <div class="space-y-3 p-4">
                  <div>
                    <p class="text-sm font-medium text-fg">Delete role</p>
                    <p class="mt-0.5 text-xs text-fg-muted">
                      {{ role.data.value.memberCount > 0 ? `Remove it from ${role.data.value.memberCount} assigned ${role.data.value.memberCount === 1 ? 'user' : 'users'} before deleting it.` : 'No users have this role, so it can be deleted. This cannot be undone.' }}
                    </p>
                  </div>
                  <AppButton variant="danger" size="sm" :icon="Trash2" :disabled="role.data.value.memberCount > 0" @click="remove">Delete role</AppButton>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </AppTabs>

      <!-- Unsaved permission changes -->
      <Transition enter-active-class="transition duration-200 ease-out" enter-from-class="translate-y-3 opacity-0" leave-active-class="transition duration-150" leave-to-class="translate-y-3 opacity-0">
        <div v-if="!readonly && grantsDirty" class="pointer-events-none sticky bottom-4 z-20 mt-4 lg:absolute lg:inset-x-0 lg:bottom-4 lg:mt-0">
          <div class="pointer-events-auto mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl bg-surface-raised px-4 py-3 shadow-pop ring-1 ring-line">
            <span class="flex h-2 w-2 rounded-full bg-warning" aria-hidden="true" />
            <p class="min-w-0 flex-1 text-sm font-medium text-fg">{{ changeCount }} unsaved {{ changeCount === 1 ? 'change' : 'changes' }}</p>
            <AppButton variant="ghost" size="sm" :disabled="savingGrants" @click="discardGrants">Discard</AppButton>
            <AppButton size="sm" :icon="Save" :loading="savingGrants" @click="saveGrants">Save permissions</AppButton>
          </div>
        </div>
      </Transition>
    </template>
  </div>
</template>
