<script setup lang="ts">
import { auditApi } from '@/modules/audit/api/audit.api';
import AuditLogView from '@/modules/audit/components/AuditLogView.vue';
import { AppPageHeader } from '@/shared/components';
</script>

<template>
  <div>
    <AppPageHeader title="Audit log" description="Append-only record of administrative and security events in this organization." />
    <AuditLogView :fetcher="auditApi.list" />
  </div>
</template>
