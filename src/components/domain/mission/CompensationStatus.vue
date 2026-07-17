<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw } from '@lucide/vue'
import type { Compensation } from '@/api/missions'
import { formatBeijingTime } from '@/domain/date-time'

const props = defineProps<{ compensation: Compensation }>()
const available = computed(() => props.compensation.status === 'AVAILABLE')
</script>

<template>
  <aside class="compensation" :class="{ available }">
    <RotateCcw :size="18" />
    <div><strong>{{ available ? '可撤销' : compensation.status }}</strong><p>{{ compensation.toolRef }} · 撤销期限 {{ formatBeijingTime(compensation.expiresAt) }}</p></div>
  </aside>
</template>

<style scoped>
.compensation { display: flex; align-items: flex-start; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-muted); padding: var(--space-3); color: var(--muted-foreground); }
.compensation.available { border-color: var(--success-border); background: var(--success-soft); color: var(--success-strong); }
p { margin: 3px 0 0; color: var(--muted-foreground); font-size: 12px; }
</style>
