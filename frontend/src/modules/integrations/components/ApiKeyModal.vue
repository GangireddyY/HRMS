<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { integrationsApi } from '@/modules/integrations/integrations.api';
import type { ApiKeyRow, GrantablePermission } from '@/modules/integrations/types';
import { AppAlert, AppButton, AppCheckbox, AppDatePicker, AppInput, AppModal } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { addDaysIso, localToday } from '@/shared/utils/dates';

/** Create a read-only API key with chosen view permissions and an optional expiry. */
const props = defineProps<{ open: boolean; grantable: GrantablePermission[] }>();
const emit = defineEmits<{ close: []; created: [k: ApiKeyRow & { key: string }] }>();
const { fieldErrors, formError, handle, reset } = useFormErrors();
const form = reactive({ name: '', permissions: [] as string[], expires: true, expiresOn: undefined as string | undefined });
const saving = ref(false);
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    Object.assign(form, { name: '', permissions: [], expires: true, expiresOn: addDaysIso(localToday(), 365) });
  },
  { immediate: true },
);
/** Grouped by module ("employee.view" → Employee). */
const groups = computed(() => {
  const by = new Map<string, GrantablePermission[]>();
  for (const p of props.grantable) {
    const mod = p.key.split('.')[0]!;
    by.set(mod, [...(by.get(mod) ?? []), p]);
  }
  return [...by.entries()].map(([mod, items]) => ({ mod: mod.charAt(0).toUpperCase() + mod.slice(1), items }));
});
function toggle(key: string, on: boolean) {
  form.permissions = on ? [...form.permissions, key] : form.permissions.filter((p) => p !== key);
}
const canSave = computed(() => form.name.trim().length >= 2 && form.permissions.length > 0 && (!form.expires || !!form.expiresOn));
async function save() {
  reset();
  saving.value = true;
  try {
    emit('created', await integrationsApi.createApiKey({ name: form.name, permissions: form.permissions, expiresAt: form.expires && form.expiresOn ? new Date(`${form.expiresOn}T23:59:59`).toISOString() : null }));
  } catch (e) {
    handle(e, 'Could not create the key');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="New API key" description="Keys are read-only: they can call GET endpoints within the permissions you choose, acting as you." size="lg" @close="emit('close')">
    <form id="api-key-form" class="space-y-5" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppInput v-model="form.name" label="Name" required :maxlength="100" placeholder="e.g. Power BI headcount dashboard" :error="fieldErrors.name" />
      <fieldset>
        <legend class="label">What it can read</legend>
        <p v-if="fieldErrors.permissions" class="error-text" role="alert">{{ fieldErrors.permissions }}</p>
        <div class="grid gap-3 sm:grid-cols-2">
          <div v-for="g in groups" :key="g.mod" class="rounded-lg p-3 ring-1 ring-line ring-inset">
            <p class="mb-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase">{{ g.mod }}</p>
            <AppCheckbox v-for="p in g.items" :key="p.key" :model-value="form.permissions.includes(p.key)" :label="p.description" @update:model-value="(v: boolean) => toggle(p.key, v)" />
          </div>
        </div>
      </fieldset>
      <div class="flex flex-wrap items-end gap-4">
        <AppCheckbox v-model="form.expires" label="Expires" />
        <AppDatePicker v-if="form.expires" v-model="form.expiresOn" label="On" :min="addDaysIso(localToday(), 1)" class="w-56" />
      </div>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="api-key-form" :loading="saving" :disabled="!canSave">Create key</AppButton>
    </template>
  </AppModal>
</template>
