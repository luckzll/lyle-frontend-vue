<script setup lang="ts">
import { computed } from 'vue'
import { Check, Circle, CircleEllipsis, CircleX, Clock3 } from '@lucide/vue'

export type ExecutionStep = {
  id: string
  title: string
  detail?: string
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed'
}

const props = defineProps<{ steps: ExecutionStep[] }>()
const iconFor = computed(() => ({
  pending: Circle,
  running: CircleEllipsis,
  waiting: Clock3,
  completed: Check,
  failed: CircleX
}))
</script>

<template>
  <ol class="timeline" aria-label="执行进度">
    <li v-for="step in steps" :key="step.id" :class="`status-${step.status}`">
      <span class="marker"><component :is="iconFor[step.status]" :size="14" aria-hidden="true" /></span>
      <div><strong>{{ step.title }}</strong><small v-if="step.detail">{{ step.detail }}</small></div>
    </li>
  </ol>
</template>

<style scoped>
.timeline { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.timeline li { position: relative; display: grid; grid-template-columns: 28px 1fr; gap: var(--space-2); min-height: 48px; color: var(--muted-foreground); }
.timeline li:not(:last-child)::after { content: ''; position: absolute; top: 24px; bottom: 0; left: 13px; width: 1px; background: var(--border); }
.marker { z-index: 1; display: grid; width: 28px; height: 28px; place-items: center; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); }
.timeline div { display: grid; align-content: start; gap: 3px; padding-top: 4px; }.timeline strong { color: var(--foreground); font-size: 13px; }.timeline small { line-height: 1.4; }
.status-completed .marker { border-color: var(--success-border); background: var(--success-soft); color: var(--success-strong); }
.status-running .marker { border-color: var(--info-border); background: var(--info-soft); color: var(--info-strong); }
.status-waiting .marker { border-color: var(--warning-border); background: var(--warning-soft); color: var(--warning-strong); }
.status-failed .marker { border-color: var(--danger-border); background: var(--danger-soft); color: var(--danger-strong); }
</style>
