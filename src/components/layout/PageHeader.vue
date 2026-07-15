<script setup lang="ts">
defineProps<{ eyebrow?: string; title: string; description?: string }>()
</script>

<template>
  <header class="page-header-v42">
    <div>
      <p v-if="eyebrow" class="eyebrow-v42">{{ eyebrow }}</p>
      <h1>{{ title }}</h1>
      <p v-if="description" class="description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.page-header-v42 { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-5); }
.eyebrow-v42 { margin: 0 0 6px; color: var(--primary); font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 0; color: var(--foreground); font-size: clamp(26px, 3vw, 34px); line-height: 1.14; letter-spacing: -.025em; }
.description { max-width: 720px; margin: 8px 0 0; color: var(--muted-foreground); line-height: 1.55; }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
@media (max-width: 680px) { .page-header-v42 { flex-direction: column; }.actions { width: 100%; justify-content: stretch; }.actions :deep(a), .actions :deep(button) { flex: 1; } }
</style>
