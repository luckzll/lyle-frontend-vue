<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, Clock3, Eye, PauseCircle, ShieldX, TimerOff } from '@lucide/vue'
import type { MissionStatus } from '@/api/missions'

const props = defineProps<{ status: MissionStatus }>()
const presentation = computed(() => ({
  DRAFT: { label: '草稿', tone: 'neutral', icon: Clock3 },
  SHADOW: { label: '预演中', tone: 'info', icon: Eye },
  AWAITING_APPROVAL: { label: '等待批准', tone: 'warning', icon: Clock3 },
  ACTIVE: { label: '运行中', tone: 'success', icon: CircleCheck },
  PAUSED: { label: '已暂停', tone: 'warning', icon: PauseCircle },
  EXPIRED: { label: '已到期', tone: 'neutral', icon: TimerOff },
  REVOKED: { label: '已撤销', tone: 'danger', icon: ShieldX },
  ARCHIVED: { label: '已归档', tone: 'neutral', icon: TimerOff }
}[props.status]))
</script>

<template>
  <span class="badge" :class="`tone-${presentation.tone}`">
    <component :is="presentation.icon" :size="13" aria-hidden="true" />
    {{ presentation.label }}
  </span>
</template>

<style scoped>
.badge { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 999px; padding: 4px 8px; font-size: 12px; font-weight: 750; }
.tone-neutral { background: var(--surface-muted); color: var(--muted-foreground); }
.tone-info { border-color: var(--info-border); background: var(--info-soft); color: var(--info-strong); }
.tone-warning { border-color: var(--warning-border); background: var(--warning-soft); color: var(--warning-strong); }
.tone-success { border-color: var(--success-border); background: var(--success-soft); color: var(--success-strong); }
.tone-danger { border-color: var(--danger-border); background: var(--danger-soft); color: var(--danger-strong); }
</style>
