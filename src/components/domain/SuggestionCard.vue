<script setup lang="ts">
import { ArrowRight, Sparkles } from '@lucide/vue'

withDefaults(defineProps<{
  title: string
  description?: string
  actionLabel?: string
  compact?: boolean
}>(), {
  description: '',
  actionLabel: '开始',
  compact: false
})

defineEmits<{ select: [] }>()
</script>

<template>
  <button class="suggestion-card" :class="{ compact }" type="button" @click="$emit('select')">
    <span class="icon"><Sparkles :size="16" aria-hidden="true" /></span>
    <span class="copy"><strong>{{ title }}</strong><small v-if="description">{{ description }}</small></span>
    <span class="action">{{ actionLabel }} <ArrowRight :size="14" aria-hidden="true" /></span>
  </button>
</template>

<style scoped>
.suggestion-card { display: grid; width: 100%; grid-template-columns: auto 1fr auto; align-items: center; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); color: var(--foreground); padding: var(--space-4); text-align: left; transition: border-color var(--motion-fast), background var(--motion-fast), transform var(--motion-fast); }
.suggestion-card:hover { border-color: var(--primary-border); background: var(--primary-soft); transform: translateY(-1px); }
.icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: var(--radius-md); background: var(--primary-soft); color: var(--primary); }
.copy { display: grid; gap: 3px; }.copy small { color: var(--muted-foreground); font-weight: 450; }
.action { display: inline-flex; align-items: center; gap: 4px; color: var(--primary); font-size: 12px; font-weight: 750; }
.compact { padding: var(--space-3); }
@media (max-width: 480px) { .suggestion-card { grid-template-columns: auto 1fr; }.action { grid-column: 2; } }
@media (prefers-reduced-motion: reduce) { .suggestion-card:hover { transform: none; } }
</style>
