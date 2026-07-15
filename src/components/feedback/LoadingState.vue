<script setup lang="ts">
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
withDefaults(defineProps<{ label?: string; cards?: number }>(), { label: '正在加载', cards: 3 })
</script>

<template>
  <section class="loading" role="status" aria-live="polite">
    <span class="sr-only">{{ label }}</span>
    <article v-for="card in cards" :key="card"><AppSkeleton :lines="4" /></article>
  </section>
</template>

<style scoped>
.loading { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: var(--space-4); }
.loading article { border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); padding: var(--space-5); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
</style>
