<script setup lang="ts">
import { HeartPulse } from '@lucide/vue';
import EnrollmentsTable from '@/modules/benefits/components/EnrollmentsTable.vue';
import { AppButton, AppPageHeader } from '@/shared/components';

/** HR's enrolment inbox: requests waiting for approval first; the status strip switches to everyone's cover. */
</script>

<template>
  <div>
    <AppPageHeader title="Benefit enrolments" description="Approve enrolment requests and manage who is covered. Pick a status above the list to see everyone's cover." back="/hr/benefits/plans" back-label="Benefit plans">
      <template #actions>
        <AppButton variant="secondary" :icon="HeartPulse" to="/hr/benefits/plans">Plans</AppButton>
      </template>
    </AppPageHeader>
    <EnrollmentsTable status="PENDING" show-plan summary />
  </div>
</template>
