<script setup lang="ts">
import EnrollmentsTable from '@/modules/benefits/components/EnrollmentsTable.vue';
import { AppPageHeader } from '@/shared/components';
</script>

<template>
  <div>
    <AppPageHeader title="Benefit enrolments" description="Requests waiting for approval. Change the status filter to see everyone's cover." back="/hr/benefits/plans" back-label="Benefit plans" />
    <EnrollmentsTable status="PENDING" show-plan />
  </div>
</template>
