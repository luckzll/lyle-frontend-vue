<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, CircleDot, CircleX, Clock3, LoaderCircle, PauseCircle, TriangleAlert } from '@lucide/vue'
import { statusPresentation } from '@/domain/status'

const props = defineProps<{ status?: string | null; label?: string }>()
const presentation = computed(() => statusPresentation(props.status))
const text = computed(() => props.label || presentation.value.label)
const icon = computed(() => ({
  success: CircleCheck,
  warning: props.status === 'awaiting_confirmation' || props.status === 'pending' ? Clock3 : TriangleAlert,
  danger: CircleX,
  info: props.status === 'running' || props.status === 'diagnosing' ? LoaderCircle : CircleDot,
  neutral: PauseCircle
}[presentation.value.tone]))
</script>

<template>
  <span class="status-badge" :class="`tone-${presentation.tone}`" :aria-label="`状态：${text}`">
    <component :is="icon" :size="13" aria-hidden="true" />
    {{ text }}
  </span>
</template>

<style scoped>
.status-badge { display: inline-flex; width: fit-content; align-items: center; gap: 5px; border: 1px solid transparent; border-radius: 999px; padding: 4px 8px; font-size: 12px; font-weight: 700; line-height: 1.2; white-space: nowrap; }
.tone-success { border-color: var(--success-border); background: var(--success-soft); color: var(--success-strong); }
.tone-warning { border-color: var(--warning-border); background: var(--warning-soft); color: var(--warning-strong); }
.tone-danger { border-color: var(--danger-border); background: var(--danger-soft); color: var(--danger-strong); }
.tone-info { border-color: var(--info-border); background: var(--info-soft); color: var(--info-strong); }
.tone-neutral { border-color: var(--border); background: var(--surface-muted); color: var(--muted-foreground); }
.tone-info :deep(svg) { animation: status-spin 1.1s linear infinite; }
@keyframes status-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .tone-info :deep(svg) { animation: none; } }
</style>
