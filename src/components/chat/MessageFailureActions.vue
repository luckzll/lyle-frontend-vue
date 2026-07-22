<script setup lang="ts">
import { RefreshCcw } from '@lucide/vue'
defineEmits<{ retry: [] }>()
</script>

<template>
  <button class="failure-retry" type="button" @click="$emit('retry')"><RefreshCcw :size="15" aria-hidden="true" /> 重试</button>
</template>

<style scoped>
.failure-retry { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 7px 10px; color: var(--danger); }
</style>
