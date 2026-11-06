<script setup lang="ts">
import { AppConfirmDialog, AppToaster } from '@/shared/components';
</script>

<template>
  <RouterView />
  <AppToaster />
  <AppConfirmDialog />
</template>
