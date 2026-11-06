<script setup lang="ts">
import { platformApi } from '@/modules/platform/api/platform.api';
import AuditLogView from '@/modules/audit/components/AuditLogView.vue';
import { AppPageHeader } from '@/shared/components';
</script>

<template>
  <div>
    <AppPageHeader title="Platform audit log" description="Audit events across all organizations and platform administration." />
    <AuditLogView :fetcher="platformApi.auditLogs" show-organization />
  </div>
</template>
