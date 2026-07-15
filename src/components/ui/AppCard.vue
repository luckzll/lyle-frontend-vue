<script setup lang="ts">
withDefaults(defineProps<{
  as?: 'article' | 'section' | 'div'
  interactive?: boolean
}>(), {
  as: 'article',
  interactive: false
})
</script>

<template>
  <component :is="as" class="app-card" :class="{ interactive }"><slot /></component>
</template>

<style scoped>
.app-card {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  padding: var(--space-5);
}
.interactive { transition: border-color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast); }
.interactive:hover { border-color: var(--border-strong); box-shadow: var(--shadow-card); transform: translateY(-1px); }
@media (prefers-reduced-motion: reduce) { .interactive:hover { transform: none; } }
</style>
