<script setup lang="ts">
import { computed } from 'vue'
import { BarChart3, Braces, CircleGauge, Tag } from '@lucide/vue'
import type { UsagePolicy, UsageSummary } from '@/api/usage'
import { formatEstimatedCost, formatTokens } from '@/domain/usage'

const props = defineProps<{
  summary: UsageSummary | null
  policy: UsagePolicy | null
  period: 'today' | 'month'
  loading?: boolean
}>()

const remainingPercent = computed(() => {
  if (!props.policy) return 0
  return Math.max(0, Math.round(100 - props.policy.usedPercent))
})
</script>

<template>
  <section class="usage-summary" aria-label="AI 用量汇总">
    <article :class="{ skeleton: loading }">
      <BarChart3 aria-hidden="true" />
      <div><strong>{{ formatTokens(summary?.totalTokens || 0) }}</strong><span>Token</span><small>{{ period === 'today' ? '今日消耗' : '本月消耗' }}</small></div>
    </article>
    <article :class="{ skeleton: loading }">
      <Braces aria-hidden="true" />
      <div><strong>{{ formatTokens(summary?.callCount || 0) }}</strong><span>次 AI 调用</span><small>{{ period === 'today' ? '今日调用次数' : '本月调用次数' }}</small></div>
    </article>
    <article :class="{ skeleton: loading }">
      <Tag aria-hidden="true" />
      <div><strong>{{ formatEstimatedCost(summary?.estimatedCostMicros || 0) }}</strong><small>估算费用</small></div>
    </article>
    <article :class="{ skeleton: loading }">
      <CircleGauge aria-hidden="true" />
      <div><strong>{{ remainingPercent }}%</strong><small>今日额度剩余</small></div>
    </article>
  </section>
</template>

<style scoped>
.usage-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.usage-summary article { display: flex; min-height: 88px; align-items: center; justify-content: center; gap: 14px; padding: 16px; }
.usage-summary article + article { border-left: 1px solid var(--border); }
.usage-summary svg { width: 24px; color: var(--primary); stroke-width: 1.8; }
.usage-summary article > div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.usage-summary strong { color: var(--foreground); font-size: clamp(20px, 2vw, 25px); font-weight: 700; letter-spacing: -.03em; }
.usage-summary span { color: var(--muted-foreground); font-size: 12px; }
.usage-summary small { width: 100%; color: var(--muted-foreground); font-size: 11px; }
.skeleton > * { opacity: .25; }
@media (max-width: 980px) {
  .usage-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .usage-summary article:nth-child(3) { border-top: 1px solid var(--border); border-left: 0; }
  .usage-summary article:nth-child(4) { border-top: 1px solid var(--border); }
}
@media (max-width: 560px) {
  .usage-summary { grid-template-columns: 1fr; }
  .usage-summary article + article { border-top: 1px solid var(--border); border-left: 0; }
}
</style>
