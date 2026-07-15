<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '@/app/AppShell.vue'
import AppToast from '@/components/feedback/AppToast.vue'

const route = useRoute()
const usesAuthLayout = computed(() => route.meta.layout === 'auth' || route.name === 'login')
</script>

<template>
  <RouterView v-if="usesAuthLayout" />
  <AppShell v-else />
  <AppToast />
</template>
