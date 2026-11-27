<script setup lang="ts">
import AppShell from '@/layouts/shell/AppShell.vue';
</script>

<template>
  <AppShell workspace="me">
    <RouterView v-slot="{ Component }">
      <KeepAlive :include="['VectorWorkspacePage']">
        <component :is="Component" />
      </KeepAlive>
    </RouterView>
  </AppShell>
</template>
