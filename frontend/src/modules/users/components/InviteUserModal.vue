<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { usersApi } from '@/modules/users/api/users.api';
import type { Member } from '@/modules/users/types';
import type { RoleSummary } from '@/modules/roles/types';
import { AppAlert, AppButton, AppInput, AppModal } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import RolePicker from '@/modules/users/components/RolePicker.vue';

const props = defineProps<{ open: boolean; roles: RoleSummary[] }>();
const emit = defineEmits<{ close: []; invited: [member: Member] }>();

const form = reactive({ email: '', firstName: '', lastName: '', roleIds: [] as string[] });
const saving = ref(false);
const { fieldErrors, formError, handle, reset } = useFormErrors();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    const employee = props.roles.find((r) => r.key === 'employee');
    Object.assign(form, { email: '', firstName: '', lastName: '', roleIds: employee ? [employee.id] : [] });
  },
);

async function submit() {
  reset();
  saving.value = true;
  try {
    const member = await usersApi.invite({ ...form, email: form.email.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim() });
    emit('invited', member);
  } catch (e) {
    handle(e, 'Could not send invitation');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" title="Invite user" description="They'll receive an email to set their password and join." size="lg" @close="emit('close')">
    <form id="invite-form" class="space-y-4" novalidate @submit.prevent="submit">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>
      <AppInput v-model="form.email" label="Work email" type="email" required autofocus :error="fieldErrors.email" />
      <div class="grid gap-4 sm:grid-cols-2">
        <AppInput v-model="form.firstName" label="First name" required :error="fieldErrors.firstName" />
        <AppInput v-model="form.lastName" label="Last name" required :error="fieldErrors.lastName" />
      </div>
      <RolePicker v-model="form.roleIds" :roles="roles" :error="fieldErrors.roleIds" />
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="invite-form" :loading="saving" :disabled="!form.email || !form.firstName || !form.lastName || !form.roleIds.length">Send invitation</AppButton>
    </template>
  </AppModal>
</template>
