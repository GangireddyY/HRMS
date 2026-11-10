<script setup lang="ts">
import { reactive, ref } from 'vue';
import { Pencil, Plus, Trash2, UserPlus, UsersRound } from '@lucide/vue';
import { payrollApi } from '@/modules/payroll/api/payroll.api';
import type { PayGroup } from '@/modules/payroll/types';
import { employeesApi } from '@/modules/people/api/people.api';
import ColleaguePicker from '@/modules/performance/components/ColleaguePicker.vue';
import type { Colleague } from '@/modules/performance/types';
import { AppAlert, AppBadge, AppButton, AppCard, AppErrorState, AppInput, AppModal, AppSelect, AppSkeleton, AppSwitch, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFeedbackStore } from '@/shared/stores/feedback.store';

/** Pay groups: people paid in their own payroll runs. Everyone else is in the main payroll. */
defineProps<{ canConfigure: boolean }>();
const feedback = useFeedbackStore();
const groups = useAsync(() => payrollApi.payGroups());

const editing = ref<PayGroup | 'new' | null>(null);
const form = reactive({ name: '', description: '', isActive: true, error: '' });
function edit(g: PayGroup | 'new') {
  Object.assign(form, g === 'new' ? { name: '', description: '', isActive: true, error: '' } : { name: g.name, description: g.description ?? '', isActive: g.isActive, error: '' });
  editing.value = g;
}
const saving = ref(false);
async function save() {
  saving.value = true;
  form.error = '';
  try {
    const body = { name: form.name, description: form.description || null };
    if (editing.value === 'new') await payrollApi.createPayGroup(body);
    else await payrollApi.updatePayGroup(editing.value!.id, { ...body, isActive: form.isActive });
    editing.value = null;
    await groups.run();
  } catch (e) {
    form.error = e instanceof Error ? e.message : 'Something went wrong';
  } finally {
    saving.value = false;
  }
}
async function remove(g: PayGroup) {
  if (!(await feedback.confirm({ title: `Delete ${g.name}?`, message: 'Groups with payroll history can only be made inactive.', confirmLabel: 'Delete', danger: true }))) return;
  try {
    await payrollApi.removePayGroup(g.id);
    await groups.run();
  } catch (e) {
    feedback.error('Could not delete the pay group', e);
  }
}

const moving = reactive({ open: false, employeeIds: [] as string[], target: '' as string, error: '' });
const search = async (q: string): Promise<Colleague[]> =>
  (await employeesApi.list({ page: 1, pageSize: 20, search: q || undefined, status: 'ACTIVE' })).items.map((e) => ({ id: e.id, name: e.fullName, employeeCode: e.employeeCode, department: e.department?.name ?? null, designation: e.designation?.name ?? null }));
function openMove(target = '') {
  Object.assign(moving, { open: true, employeeIds: [], target, error: '' });
}
async function move() {
  saving.value = true;
  moving.error = '';
  try {
    groups.data.value = await payrollApi.assignPayGroup(moving.employeeIds, moving.target || null);
    feedback.success(`${moving.employeeIds.length} ${moving.employeeIds.length === 1 ? 'person' : 'people'} moved`);
    moving.open = false;
  } catch (e) {
    moving.error = e instanceof Error ? e.message : 'Something went wrong';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppCard title="Pay groups" :icon="UsersRound" description="People paid in their own payroll runs — contractors, a subsidiary, a different pay day. Everyone else is in the main payroll.">
    <template v-if="canConfigure" #actions>
      <AppButton size="sm" variant="ghost" :icon="UserPlus" :disabled="!groups.data.value?.groups.length" @click="openMove()">Move people</AppButton>
      <AppButton size="sm" variant="secondary" :icon="Plus" @click="edit('new')">New group</AppButton>
    </template>
    <AppErrorState v-if="groups.error.value" :error="groups.error.value" @retry="groups.run" />
    <AppSkeleton v-else-if="!groups.data.value" :lines="2" />
    <ul v-else class="divide-y divide-line/70 rounded-xl ring-1 ring-line ring-inset">
      <li class="flex items-center gap-3 px-3 py-2.5">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-fg">Main payroll</p>
          <p class="text-xs text-fg-muted">Everyone without a pay group</p>
        </div>
        <AppBadge size="sm">{{ groups.data.value.mainEmployees }} people</AppBadge>
      </li>
      <li v-for="g in groups.data.value.groups" :key="g.id" class="flex items-center gap-3 px-3 py-2.5">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-fg">{{ g.name }} <AppBadge v-if="!g.isActive" size="sm">Inactive</AppBadge></p>
          <p class="truncate text-xs text-fg-muted">{{ g.description ?? 'Own monthly payroll runs' }}</p>
        </div>
        <AppBadge size="sm" tone="brand">{{ g.employees }} {{ g.employees === 1 ? 'person' : 'people' }}</AppBadge>
        <template v-if="canConfigure">
          <AppButton size="xs" variant="ghost" :icon="UserPlus" :aria-label="`Add people to ${g.name}`" :disabled="!g.isActive" @click="openMove(g.id)" />
          <AppButton size="xs" variant="ghost" :icon="Pencil" :aria-label="`Edit ${g.name}`" @click="edit(g)" />
          <AppButton size="xs" variant="ghost" :icon="Trash2" :aria-label="`Delete ${g.name}`" @click="remove(g)" />
        </template>
      </li>
    </ul>

    <AppModal :open="!!editing" dialog :title="editing === 'new' ? 'New pay group' : 'Edit pay group'" @close="editing = null">
      <form id="pay-group-form" class="space-y-4" novalidate @submit.prevent="save">
        <AppAlert v-if="form.error">{{ form.error }}</AppAlert>
        <AppInput v-model="form.name" label="Name" placeholder="e.g. Contractors" required />
        <AppTextarea v-model="form.description" label="Description" :rows="2" :maxlength="300" placeholder="e.g. Paid on the 5th" />
        <AppSwitch v-if="editing !== 'new'" v-model="form.isActive" label="Active" description="Inactive groups can't start new runs." />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="editing = null">Cancel</AppButton>
        <AppButton type="submit" form="pay-group-form" :loading="saving" :disabled="form.name.trim().length < 2">Save</AppButton>
      </template>
    </AppModal>

    <AppModal :open="moving.open" dialog title="Move people" description="They're paid by the group's runs from the next run. People in a run that's in progress can't move until it's finished." @close="moving.open = false">
      <div class="space-y-4">
        <AppAlert v-if="moving.error">{{ moving.error }}</AppAlert>
        <ColleaguePicker v-model:values="moving.employeeIds" multiple label="People" :source="search" />
        <AppSelect
          v-model="moving.target"
          label="Move to"
          :options="[{ value: '', label: 'Main payroll' }, ...(groups.data.value?.groups ?? []).filter((g) => g.isActive).map((g) => ({ value: g.id, label: g.name }))]"
          :clearable="false"
          :searchable="false"
        />
      </div>
      <template #footer>
        <AppButton variant="secondary" @click="moving.open = false">Cancel</AppButton>
        <AppButton :loading="saving" :disabled="!moving.employeeIds.length" @click="move">Move</AppButton>
      </template>
    </AppModal>
  </AppCard>
</template>
