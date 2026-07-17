<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  limits: Record<string, number>
  usage?: Record<string, number | string | undefined>
}>()

const rows = computed(() => [
  { key: 'maxToolCalls', label: '工具调用', unit: '次' },
  { key: 'maxModelTokens', label: '模型 Token', unit: '' },
  { key: 'maxCostMicros', label: '估算费用', unit: ' μ' },
  { key: 'maxWallTimeMillis', label: '执行时长', unit: ' ms' }
].filter((item) => Number(props.limits[item.key] || 0) > 0).map((item) => {
  const limit = Number(props.limits[item.key] || 0)
  const used = Number(props.usage?.[item.key.replace('max', '').replace(/^./, (value) => value.toLowerCase())] || 0)
  return { ...item, limit, used, ratio: limit ? Math.min(1, used / limit) : 0 }
}))
</script>

<template>
  <div class="budget-list">
    <div v-for="item in rows" :key="item.key" class="budget-row">
      <div><span>{{ item.label }}</span><strong>{{ item.used.toLocaleString() }} / {{ item.limit.toLocaleString() }}{{ item.unit }}</strong></div>
      <div class="track"><span :style="{ width: `${item.ratio * 100}%` }" /></div>
    </div>
  </div>
</template>

<style scoped>
.budget-list { display: grid; gap: var(--space-3); }
.budget-row > div:first-child { display: flex; justify-content: space-between; gap: var(--space-3); font-size: 12px; }
.budget-row span { color: var(--muted-foreground); }
.track { height: 7px; margin-top: 7px; overflow: hidden; border-radius: 999px; background: var(--surface-muted); }
.track span { display: block; height: 100%; border-radius: inherit; background: var(--primary); }
</style>
