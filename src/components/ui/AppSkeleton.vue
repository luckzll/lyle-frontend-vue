<script setup lang="ts">
withDefaults(defineProps<{ lines?: number }>(), { lines: 3 })
</script>

<template>
  <div class="skeleton" aria-hidden="true">
    <span v-for="line in lines" :key="line" :style="{ width: line === lines ? '68%' : '100%' }" />
  </div>
</template>

<style scoped>
.skeleton { display: grid; gap: var(--space-3); width: 100%; }
.skeleton span { height: 14px; border-radius: var(--radius-sm); background: linear-gradient(90deg, var(--surface-muted) 20%, var(--surface-raised) 48%, var(--surface-muted) 76%); background-size: 220% 100%; animation: shimmer 1.35s ease-in-out infinite; }
@keyframes shimmer { to { background-position-x: -220%; } }
@media (prefers-reduced-motion: reduce) { .skeleton span { animation: none; } }
</style>
