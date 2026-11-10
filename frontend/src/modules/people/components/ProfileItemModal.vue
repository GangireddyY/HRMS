<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { profileApi } from '@/modules/people/api/people.api';
import type { Education, Experience, FamilyMember, ProfileSection } from '@/modules/people/types';
import { educationLevelOptions, genderOptions, relationshipOptions } from '@/modules/people/utils/labels';
import { AppAlert, AppButton, AppCheckbox, AppDatePicker, AppInput, AppModal, AppSelect, AppTextarea } from '@/shared/components';
import { useFormErrors } from '@/shared/composables/use-form-errors';
import { localToday } from '@/shared/utils/dates';

type Item = FamilyMember | Education | Experience;

const props = defineProps<{ open: boolean; employeeId: string; section: ProfileSection; item: Item | null; joiningDate?: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const TITLES: Record<ProfileSection, string> = { family: 'family member', education: 'education', experience: 'previous employment' };
const { fieldErrors, formError, handle, reset } = useFormErrors();
const saving = ref(false);
const today = localToday();
const form = reactive({
  name: '',
  relationship: null as string | null,
  dateOfBirth: undefined as string | undefined,
  gender: null as string | null,
  phone: '',
  isDependent: false,
  level: null as string | null,
  qualification: '',
  specialization: '',
  institution: '',
  startYear: '' as string | number,
  endYear: '' as string | number,
  score: '',
  company: '',
  designation: '',
  startDate: undefined as string | undefined,
  endDate: undefined as string | undefined,
  location: '',
  description: '',
});

watch(
  () => [props.open, props.item] as const,
  ([open, item]) => {
    if (!open) return;
    reset();
    const i = (item ?? {}) as Partial<FamilyMember & Education & Experience>;
    Object.assign(form, {
      name: i.name ?? '',
      relationship: i.relationship ?? null,
      dateOfBirth: i.dateOfBirth ?? undefined,
      gender: i.gender ?? null,
      phone: i.phone ?? '',
      isDependent: i.isDependent ?? false,
      level: i.level ?? null,
      qualification: i.qualification ?? '',
      specialization: i.specialization ?? '',
      institution: i.institution ?? '',
      startYear: i.startYear ?? '',
      endYear: i.endYear ?? '',
      score: i.score ?? '',
      company: i.company ?? '',
      designation: i.designation ?? '',
      startDate: i.startDate ?? undefined,
      endDate: i.endDate ?? undefined,
      location: i.location ?? '',
      description: i.description ?? '',
    });
  },
  { immediate: true },
);

const year = (v: string | number) => (v === '' ? null : Number(v));
function body(): Record<string, unknown> {
  if (props.section === 'family') {
    return { name: form.name, relationship: form.relationship, dateOfBirth: form.dateOfBirth ?? null, gender: form.gender, phone: form.phone, isDependent: form.isDependent };
  }
  if (props.section === 'education') {
    return {
      level: form.level,
      qualification: form.qualification,
      specialization: form.specialization,
      institution: form.institution,
      startYear: year(form.startYear),
      endYear: year(form.endYear),
      score: form.score,
    };
  }
  return { company: form.company, designation: form.designation, startDate: form.startDate, endDate: form.endDate, location: form.location, description: form.description };
}

const canSave = computed(() => {
  if (props.section === 'family') return !!form.name.trim() && !!form.relationship;
  if (props.section === 'education') return !!form.level && !!form.qualification.trim() && form.institution.trim().length >= 2;
  return !!form.company.trim() && !!form.designation.trim() && !!form.startDate && !!form.endDate;
});

async function save() {
  reset();
  saving.value = true;
  try {
    if (props.item) await profileApi.update(props.employeeId, props.section, props.item.id, body());
    else await profileApi.create(props.employeeId, props.section, body());
    emit('saved');
  } catch (e) {
    handle(e, `Could not save ${TITLES[props.section]}`);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppModal :open="open" :title="`${item ? 'Edit' : 'Add'} ${TITLES[section]}`" @close="emit('close')">
    <form id="profile-item-form" class="space-y-4" novalidate @submit.prevent="save">
      <AppAlert v-if="formError">{{ formError }}</AppAlert>

      <template v-if="section === 'family'">
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.name" label="Full name" required autofocus :error="fieldErrors.name" />
          <AppSelect v-model="form.relationship" label="Relationship" required :options="relationshipOptions" :error="fieldErrors.relationship" />
          <AppDatePicker v-model="form.dateOfBirth" label="Date of birth" :max="today" :error="fieldErrors.dateOfBirth" />
          <AppSelect v-model="form.gender" label="Gender" placeholder="Not specified" :options="genderOptions" :error="fieldErrors.gender" />
          <AppInput v-model="form.phone" label="Phone" type="tel" :error="fieldErrors.phone" />
        </div>
        <AppCheckbox v-model="form.isDependent" label="Dependent" description="Covered by dependent benefits such as health insurance." />
      </template>

      <template v-else-if="section === 'education'">
        <div class="grid gap-4 sm:grid-cols-2">
          <AppSelect v-model="form.level" label="Level" required :options="educationLevelOptions" :error="fieldErrors.level" />
          <AppInput v-model="form.qualification" label="Qualification" placeholder="e.g. B.Tech" required :error="fieldErrors.qualification" />
          <AppInput v-model="form.specialization" label="Specialization" placeholder="e.g. Computer Science" :error="fieldErrors.specialization" />
          <AppInput v-model="form.institution" label="Institution" required :error="fieldErrors.institution" />
          <AppInput v-model="form.startYear" label="Start year" type="number" :min="1950" :max="2100" :error="fieldErrors.startYear" />
          <AppInput v-model="form.endYear" label="Year of completion" type="number" :min="1950" :max="2100" :error="fieldErrors.endYear" />
          <AppInput v-model="form.score" label="Grade / score" placeholder="e.g. 8.4 CGPA or 78%" :error="fieldErrors.score" />
        </div>
      </template>

      <template v-else>
        <div class="grid gap-4 sm:grid-cols-2">
          <AppInput v-model="form.company" label="Company" required autofocus :error="fieldErrors.company" />
          <AppInput v-model="form.designation" label="Designation" required :error="fieldErrors.designation" />
          <AppDatePicker v-model="form.startDate" label="From" required :max="joiningDate ?? today" :error="fieldErrors.startDate" />
          <AppDatePicker v-model="form.endDate" label="To" required :min="form.startDate" :max="today" :error="fieldErrors.endDate" />
          <AppInput v-model="form.location" class="sm:col-span-2" label="Location" :error="fieldErrors.location" />
        </div>
        <AppTextarea v-model="form.description" label="Responsibilities" :rows="2" :maxlength="500" :error="fieldErrors.description" />
      </template>
    </form>
    <template #footer>
      <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="profile-item-form" :loading="saving" :disabled="!canSave">{{ item ? 'Save changes' : 'Add' }}</AppButton>
    </template>
  </AppModal>
</template>
