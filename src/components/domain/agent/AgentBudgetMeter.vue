<script setup lang="ts">
import { computed } from 'vue'
import type { AgentBudget, AgentBudgetUsage } from '@/api/agentTasks'

const props = defineProps<{ limit: AgentBudget; used: AgentBudgetUsage }>()

const ratio = computed(() => Math.min(1, Math.max(
  props.used.completedSteps / props.limit.maxSteps,
  props.used.toolCalls / props.limit.maxToolCalls,
  props.used.modelTokens / props.limit.maxModelTokens,
  props.used.costMicros / props.limit.maxCostMicros,
  props.used.elapsedMillis / props.limit.maxWallTimeMillis
)))
const percent = computed(() => Math.round(ratio.value * 100))
</script>

<template>
  <section class="budget" :class="{ near: ratio >= 0.8 }" aria-label="执行预算">
    <header><strong>预算</strong><span>{{ percent }}% 已用</span></header>
    <div class="track" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
      <span :style="{ width: `${percent}%` }" />
    </div>
    <dl>
      <div><dt>步骤</dt><dd>{{ used.completedSteps }} / {{ limit.maxSteps }}</dd></div>
      <div><dt>工具</dt><dd>{{ used.toolCalls }} / {{ limit.maxToolCalls }}</dd></div>
      <div><dt>Token</dt><dd>{{ used.modelTokens.toLocaleString() }} / {{ limit.maxModelTokens.toLocaleString() }}</dd></div>
      <div><dt>费用</dt><dd>¥{{ (used.costMicros / 1_000_000).toFixed(2) }} / ¥{{ (limit.maxCostMicros / 1_000_000).toFixed(2) }}</dd></div>
    </dl>
  </section>
</template>

<style scoped>
.budget { display: grid; gap: var(--space-3); }
header { display: flex; justify-content: space-between; gap: var(--space-3); font-size: 13px; }
header span { color: var(--muted-foreground); }
.track { height: 7px; overflow: hidden; border-radius: 999px; background: var(--surface-muted); }
.track span { display: block; height: 100%; border-radius: inherit; background: var(--primary); transition: width var(--motion-normal); }
.near .track span { background: var(--warning); }
dl { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin: 0; }
dl div { display: flex; justify-content: space-between; gap: var(--space-2); font-size: 12px; }
dt { color: var(--muted-foreground); }
dd { margin: 0; font-weight: 650; }
</style>
