<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { Lock, Plus, Save, ShieldCheck, Trash2, UserCog } from '@lucide/vue';
import type { PermissionScope } from '@contracts';
import { rolesApi } from '@/modules/roles/api/roles.api';
import PermissionMatrix from '@/modules/roles/components/PermissionMatrix.vue';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppInput, AppPageHeader, AppSelect, AppSkeleton, AppTabs, AppTextarea, type SelectOption } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { useAuthStore } from '@/core/auth/auth.store';
import { useFeedbackStore } from '@/shared/stores/feedback.store';
import { formatDateTime, timeAgo } from '@/shared/utils/format';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const feedback = useFeedbackStore();
const id = computed(() => String(route.params.id));
const role = useAsync(() => rolesApi.get(id.value));
const roles = useAsync(() => rolesApi.list());
const catalog = useAsync(() => rolesApi.catalog());
watch(id, () => role.run());

const tab = ref<'permissions' | 'details'>('permissions');
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

const canManage = computed(() => auth.can('role.manage'));
const readonly = computed(() => !canManage.value || !!role.data.value?.isLocked);
const originalGrants = computed<Record<string, PermissionScope>>(() => Object.fromEntries((role.data.value?.permissions ?? []).map((p) => [p.key, p.scope])));
const changeCount = computed(() => {
  const keys = new Set([...Object.keys(originalGrants.value), ...Object.keys(grants.value)]);
  return [...keys].filter((k) => originalGrants.value[k] !== grants.value[k]).length;
});
const grantsDirty = computed(() => changeCount.value > 0);
const detailsDirty = computed(() => !!role.data.value && (details.name !== role.data.value.name || details.description !== (role.data.value.description ?? '')));
const tabs = computed(() => [
  { key: 'permissions', label: `Permissions · ${Object.keys(grants.value).length}` },
  { key: 'details', label: 'Details' },
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
</script>

<template>
  <!-- Large screens: fixed header and tabs; the side menu and the content scroll on their own (route meta `fill`). -->
  <div class="relative flex min-w-0 flex-col lg:h-full">
      <AppSkeleton v-if="role.loading.value && !role.data.value" :lines="8" />
      <AppErrorState v-else-if="role.error.value" :error="role.error.value" title="Could not load role" @retry="role.run" />
      <template v-else-if="role.data.value">
        <AppPageHeader
          class="shrink-0 lg:mb-4"
          :title="role.data.value.name"
          :description="role.data.value.description ?? undefined"
          back="/admin/roles"
          back-label="All roles"
        >
          <template #badges>
            <AppBadge :tone="role.data.value.isSystem ? 'neutral' : 'info'">{{ role.data.value.isSystem ? 'System role' : 'Custom role' }}</AppBadge>
            <AppBadge v-if="role.data.value.isLocked" tone="warning"><Lock :size="11" /> Locked</AppBadge>
            <AppBadge>{{ role.data.value.memberCount }} {{ role.data.value.memberCount === 1 ? 'user' : 'users' }}</AppBadge>
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
          <div v-if="tab === 'permissions'" class="space-y-4 lg:flex lg:h-full lg:flex-col lg:space-y-0 lg:gap-4">
            <AppAlert v-if="role.data.value.isLocked" tone="info" class="shrink-0">This role is locked to prevent administrators from losing access. Create a custom role for different permissions.</AppAlert>
            <AppAlert v-if="grantErrors.formError.value" class="shrink-0">{{ grantErrors.formError.value }}</AppAlert>
            <AppCard v-if="catalog.loading.value"><AppSkeleton :lines="8" /></AppCard>
            <AppErrorState v-else-if="catalog.error.value" :error="catalog.error.value" @retry="catalog.run" />
            <PermissionMatrix v-else-if="catalog.data.value" v-model="grants" :modules="catalog.data.value.modules" :readonly="readonly" :bottom-inset="!readonly && grantsDirty" class="lg:min-h-0 lg:flex-1" />
          </div>

          <!-- Details (scrolls inside the panel on large screens) -->
          <div v-else class="space-y-4 lg:h-full lg:overflow-y-auto lg:pe-1 lg:pb-1">
            <AppCard title="Role details" description="How this role appears when you assign it to people.">
              <form novalidate @submit.prevent="saveDetails">
                <AppAlert v-if="detailErrors.formError.value" class="mb-4">{{ detailErrors.formError.value }}</AppAlert>
                <div class="divide-y divide-line/70">
                  <div class="grid gap-3 pb-4 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-5">
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
                  <div class="grid gap-3 py-4 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-5">
                    <div>
                      <label for="role-description" class="text-sm font-medium text-fg">Description</label>
                      <p class="mt-0.5 text-sm text-fg-muted">Explain who should get this role.</p>
                    </div>
                    <AppTextarea id="role-description" v-model="details.description" :rows="3" :max-rows="6" :maxlength="500" :disabled="!canManage" :error="detailErrors.fieldErrors.value.description" />
                  </div>
                  <div class="grid gap-3 pt-4 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-5">
                    <div>
                      <p class="text-sm font-medium text-fg">Role information</p>
                      <p class="mt-0.5 text-sm text-fg-muted">Managed by HRMS.</p>
                    </div>
                    <dl class="grid grid-cols-2 gap-x-4 gap-y-4 rounded-xl bg-surface-muted/60 p-4 ring-1 ring-line/70 sm:grid-cols-3">
                      <div>
                        <dt class="text-xs text-fg-muted">Type</dt>
                        <dd class="mt-1 flex items-center gap-2 text-sm font-medium text-fg">
                          <component :is="role.data.value.isSystem ? ShieldCheck : UserCog" :size="14" class="text-fg-subtle" aria-hidden="true" />
                          {{ role.data.value.isSystem ? 'System' : 'Custom' }}{{ role.data.value.isLocked ? ' · Locked' : '' }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-xs text-fg-muted">Key</dt>
                        <dd class="mt-1 truncate font-mono text-sm text-fg">{{ role.data.value.key }}</dd>
                      </div>
                      <div>
                        <dt class="text-xs text-fg-muted">Assigned users</dt>
                        <dd class="mt-1 text-sm font-medium text-fg tabular-nums">{{ role.data.value.memberCount }}</dd>
                      </div>
                      <div>
                        <dt class="text-xs text-fg-muted">Permissions</dt>
                        <dd class="mt-1 text-sm font-medium text-fg tabular-nums">{{ role.data.value.permissions.length }}</dd>
                      </div>
                      <div>
                        <dt class="text-xs text-fg-muted">Created</dt>
                        <dd class="mt-1 text-sm text-fg" :title="formatDateTime(role.data.value.createdAt)">{{ timeAgo(role.data.value.createdAt) }}</dd>
                      </div>
                      <div>
                        <dt class="text-xs text-fg-muted">Last updated</dt>
                        <dd class="mt-1 text-sm text-fg" :title="formatDateTime(role.data.value.updatedAt)">{{ timeAgo(role.data.value.updatedAt) }}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
                <div v-if="canManage" class="mt-4 flex justify-end gap-2 border-t border-line/70 pt-4">
                  <AppButton variant="ghost" :disabled="!detailsDirty || savingDetails" @click="resetDetails">Reset</AppButton>
                  <AppButton type="submit" :loading="savingDetails" :disabled="!detailsDirty || details.name.trim().length < 2">Save details</AppButton>
                </div>
              </form>
            </AppCard>

            <AppCard v-if="canManage && !role.data.value.isSystem" title="Delete role" description="Permanently remove this custom role.">
              <div class="flex flex-wrap items-center justify-between gap-4">
                <p class="text-sm text-fg-muted">
                  {{ role.data.value.memberCount > 0 ? `Remove it from ${role.data.value.memberCount} assigned ${role.data.value.memberCount === 1 ? 'user' : 'users'} before deleting it.` : 'No users have this role, so it can be deleted.' }}
                </p>
                <AppButton variant="danger" :icon="Trash2" :disabled="role.data.value.memberCount > 0" @click="remove">Delete role</AppButton>
              </div>
            </AppCard>
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
