<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { EMPLOYMENT_TYPES, POLICY_CATEGORIES, type EmploymentType, type PolicyCategory } from '@contracts';
import { useAuthStore } from '@/core/auth/auth.store';
import ChipPicker from '@/modules/benefits/components/ChipPicker.vue';
import { complianceApi } from '@/modules/compliance/api/compliance.api';
import type { PolicyDetail } from '@/modules/compliance/types';
import { POLICY_CATEGORY_LABELS } from '@/modules/compliance/utils/compliance-format';
import { structureApi } from '@/modules/people/api/people.api';
import { EMPLOYMENT_TYPE_LABELS } from '@/modules/people/utils/labels';
import { usersApi } from '@/modules/users/api/users.api';
import { AppAlert, AppButton, AppCheckbox, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { useFormErrors } from '@/shared/composables/use-form-errors';

/** Policy settings: title, category, owner, audience, acknowledgement and review; the first version's text when creating. */
const props = defineProps<{ open: boolean; policy: PolicyDetail | null }>();
const emit = defineEmits<{ close: []; saved: [p: PolicyDetail] }>();

const auth = useAuthStore();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const departments = useAsync(() => structureApi.departments(), { immediate: false });
const locations = useAsync(() => structureApi.locations(), { immediate: false });
const members = useAsync(() => usersApi.list({ page: 1, pageSize: 100, status: 'ACTIVE' }), { immediate: false });
const form = reactive({
  title: '',
  category: 'HR' as PolicyCategory,
  summary: '',
  ownerUserId: null as string | null,
  departmentIds: [] as string[],
  locationIds: [] as string[],
  employmentTypes: [] as EmploymentType[],
  requiresAck: true,
  ackDueDays: 14 as string | number,
  reviewMonths: 12 as string | number,
  content: '',
});
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    for (const s of [departments, locations]) if (!s.data.value) void s.run();
    if (auth.can('user.view', 'ORGANIZATION') && !members.data.value) void members.run();
    const p = props.policy;
    Object.assign(form, {
      title: p?.title ?? '',
      category: p?.category ?? 'HR',
      summary: p?.summary ?? '',
      ownerUserId: p?.owner?.id ?? null,
      departmentIds: [...(p?.departmentIds ?? [])],
      locationIds: [...(p?.locationIds ?? [])],
      employmentTypes: [...(p?.employmentTypes ?? [])],
      requiresAck: p?.requiresAck ?? true,
      ackDueDays: p?.ackDueDays ?? 14,
      reviewMonths: p ? (p.reviewMonths ?? '') : 12,
      content: '',
    });
  },
  { immediate: true },
);
const categoryOptions = POLICY_CATEGORIES.map((c) => ({ value: c, label: POLICY_CATEGORY_LABELS[c] }));
const toOptions = (rows: { id: string; name: string; isActive?: boolean }[] | null | undefined) => (rows ?? []).filter((r) => r.isActive !== false).map((r) => ({ value: r.id, label: r.name }));
const ownerOptions = computed(() => (members.data.value?.items ?? []).map((m) => ({ value: m.userId, label: `${m.firstName} ${m.lastName}`.trim(), description: m.email })));
function toggleType(t: EmploymentType, on: boolean) {
  form.employmentTypes = on ? [...form.employmentTypes, t] : form.employmentTypes.filter((x) => x !== t);
}
const canSave = computed(() => form.title.trim().length >= 3);

async function save() {
  reset();
  saving.value = true;
  const body = {
    title: form.title,
    category: form.category,
    summary: form.summary || null,
    ownerUserId: form.ownerUserId,
    departmentIds: form.departmentIds.length ? form.departmentIds : null,
    locationIds: form.locationIds.length ? form.locationIds : null,
    employmentTypes: form.employmentTypes.length ? form.employmentTypes : null,
    requiresAck: form.requiresAck,
    ackDueDays: Number(form.ackDueDays) || 14,
    reviewMonths: form.reviewMonths === '' ? null : Number(form.reviewMonths),
  };
  try {
    emit('saved', props.policy ? await complianceApi.updatePolicy(props.policy.id, body) : await complianceApi.createPolicy({ ...body, content: form.content || null }));
  } catch (e) {
    handle(e, 'Could not save the policy');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="policy ? `Settings · ${policy.title}` : 'New policy'" :description="policy ? undefined : 'Saved as a draft; publish it when it is ready.'" size="lg" @close="emit('close')">
    <form id="policy-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <div class="grid gap-4 sm:grid-cols-[1fr_220px]">
        <AppInput v-model="form.title" label="Title" required :maxlength="200" :error="fieldErrors.title" />
        <AppSelect v-model="form.category" label="Category" :options="categoryOptions" :clearable="false" />
      </div>
      <AppTextarea v-model="form.summary" label="Summary" :rows="2" :maxlength="1000" help="One or two lines shown in the policy list." />
      <AppSelect v-if="auth.can('user.view', 'ORGANIZATION')" v-model="form.ownerUserId" label="Owner" placeholder="No owner" :options="ownerOptions" searchable :error="fieldErrors.ownerUserId" />
      <fieldset class="space-y-4 rounded-xl p-4 ring-1 ring-line">
        <legend class="px-1 text-sm font-medium text-fg">Who it applies to</legend>
        <div class="grid gap-4 sm:grid-cols-2">
          <ChipPicker v-model="form.departmentIds" label="Departments" placeholder="All departments" :options="toOptions(departments.data.value)" />
          <ChipPicker v-model="form.locationIds" label="Locations" placeholder="All locations" :options="toOptions(locations.data.value)" />
        </div>
        <div>
          <p class="label">Employment types</p>
          <div class="flex flex-wrap gap-x-5 gap-y-2">
            <AppCheckbox v-for="t in EMPLOYMENT_TYPES" :key="t" :model-value="form.employmentTypes.includes(t)" :label="EMPLOYMENT_TYPE_LABELS[t]" @update:model-value="(on: boolean) => toggleType(t, on)" />
          </div>
          <p class="mt-1 text-xs text-fg-muted">Nothing chosen = everyone.</p>
        </div>
      </fieldset>
      <div class="grid gap-4 sm:grid-cols-3">
        <AppCheckbox v-model="form.requiresAck" class="sm:col-span-3" label="Employees must acknowledge it" description="Each person confirms they have read it; HR tracks who hasn't." />
        <AppInput v-model="form.ackDueDays" label="Days to acknowledge" type="number" :min="1" :max="365" :disabled="!form.requiresAck" help="From publishing, or from joining for new joiners." :error="fieldErrors.ackDueDays" />
        <AppInput v-model="form.reviewMonths" label="Review every (months)" type="number" :min="1" :max="60" placeholder="No review cycle" :error="fieldErrors.reviewMonths" />
      </div>
      <AppTextarea v-if="!policy" v-model="form.content" label="Policy text" :rows="10" :maxlength="200000" help="You can also attach a PDF after saving." />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="policy-form" :loading="saving" :disabled="!canSave">Save</AppButton>
    </template>
  </AppModal>
</template>
