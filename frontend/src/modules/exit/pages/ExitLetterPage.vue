<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Printer } from '@lucide/vue';
import { exitApi } from '@/modules/exit/api/exit.api';
import LetterDocument from '@/modules/exit/components/LetterDocument.vue';
import { LETTER_LABELS } from '@/modules/exit/utils/exit-format';
import { AppAlert, AppButton, AppErrorState, AppPageHeader, AppSkeleton } from '@/shared/components';
import { useAsync } from '@/shared/composables/use-async';
import { formatDate } from '@/shared/utils/format';

/** One exit letter, printable (browser "Save as PDF"). Used from the exit page (HR) and My Workspace. */
const route = useRoute();
const ids = computed(() => ({ id: String(route.params.id), letterId: String(route.params.letterId) }));
const letter = useAsync(() => exitApi.letter(ids.value.id, ids.value.letterId));
watch(ids, () => void letter.run());
const hr = computed(() => route.path.startsWith('/hr'));
const print = () => window.print();
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <AppPageHeader
      class="print:hidden"
      :title="letter.data.value ? `${LETTER_LABELS[letter.data.value.type]} · ${letter.data.value.reference}` : 'Letter'"
      :description="letter.data.value?.employee.name"
      :back="hr ? `/hr/exits/${ids.id}` : '/me/exit'"
      :back-label="hr ? 'Exit' : 'Resignation & exit'"
    >
      <template #actions><AppButton variant="secondary" :icon="Printer" :disabled="!letter.data.value" @click="print">Print / save as PDF</AppButton></template>
    </AppPageHeader>
    <AppSkeleton v-if="letter.loading.value && !letter.data.value" :lines="12" />
    <AppErrorState v-else-if="letter.error.value" :error="letter.error.value" title="This letter isn't available" @retry="letter.run" />
    <template v-else-if="letter.data.value">
      <AppAlert v-if="letter.data.value.revokedAt" tone="warning" class="mb-4 print:hidden">
        Revoked by {{ letter.data.value.revokedBy }} on {{ formatDate(letter.data.value.revokedAt) }}: {{ letter.data.value.revokedReason }}
      </AppAlert>
      <LetterDocument :letter="letter.data.value" />
    </template>
  </div>
</template>
