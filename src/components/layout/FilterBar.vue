<script setup lang="ts">
import { SlidersHorizontal } from '@lucide/vue'
</script>

<template>
  <section class="filter-bar" aria-label="筛选条件">
    <span class="label"><SlidersHorizontal :size="15" aria-hidden="true" />筛选</span>
    <slot />
    <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
  </section>
</template>

<style scoped>
.filter-bar { display: flex; align-items: center; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: var(--space-3); }
.label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground); font-size: 13px; font-weight: 700; }
.filter-bar :deep(select), .filter-bar :deep(input) { width: auto; min-width: 140px; }
.actions { margin-left: auto; }
@media (max-width: 720px) { .filter-bar { align-items: stretch; flex-direction: column; }.filter-bar :deep(select), .filter-bar :deep(input) { width: 100%; }.actions { margin-left: 0; } }
</style>
