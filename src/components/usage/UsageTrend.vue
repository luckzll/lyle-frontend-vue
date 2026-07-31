<script setup lang="ts">
import { computed } from 'vue'
import { Info } from '@lucide/vue'
import type { UsageTrendPoint } from '@/api/usage'
import { formatTokens } from '@/domain/usage'

const props = defineProps<{ points: UsageTrendPoint[]; period: 'today' | 'month'; loading?: boolean }>()

const chart = computed(() => {
  const values = props.points.map((point) => Math.max(0, point.totalTokens))
  const max = Math.max(...values, 1)
  const width = 640
  const height = 178
  const xStep = values.length <= 1 ? width : width / (values.length - 1)
  const coordinates = values.map((value, index) => ({
    x: Math.round(index * xStep * 10) / 10,
    y: Math.round((height - (value / max) * (height - 18)) * 10) / 10
  }))
  return {
    width,
    height,
    max,
    line: coordinates.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
    area: coordinates.length
      ? `M 0 ${height} ${coordinates.map((point) => `L ${point.x} ${point.y}`).join(' ')} L ${width} ${height} Z`
      : ''
  }
})
</script>

<template>
  <article class="trend-card">
    <header><h3>{{ period === 'today' ? '今日' : '本月' }}用量趋势 <span>（Token）</span></h3><Info :size="15" aria-label="按调用发生时间汇总" /></header>
    <div v-if="loading" class="trend-loading">正在读取趋势…</div>
    <div v-else-if="!points.length" class="trend-empty">当前周期还没有 AI 用量</div>
    <div v-else class="trend-chart">
      <div class="trend-scale">
        <span>{{ formatTokens(chart.max) }}</span>
        <span>{{ formatTokens(chart.max / 2) }}</span>
        <span>0</span>
      </div>
      <div class="trend-canvas">
        <svg :viewBox="`0 0 ${chart.width} ${chart.height}`" role="img" :aria-label="`${period === 'today' ? '今日' : '本月'} Token 用量折线图`">
          <path class="trend-area" :d="chart.area" />
          <path class="trend-line" :d="chart.line" />
        </svg>
        <div class="trend-labels">
          <span v-for="point in points" :key="point.bucket">{{ point.bucket }}</span>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.trend-card { min-width: 0; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 16px 18px; }
.trend-card header { display: flex; align-items: center; gap: 7px; }
.trend-card h3 { margin: 0; font-size: 14px; }
.trend-card h3 span { color: var(--muted-foreground); font-weight: 500; }
.trend-card header svg { color: var(--muted-foreground); }
.trend-chart { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 8px; margin-top: 16px; }
.trend-scale { display: flex; height: 150px; flex-direction: column; justify-content: space-between; color: var(--muted-foreground); font-size: 10px; text-align: right; }
.trend-canvas { min-width: 0; overflow: hidden; }
.trend-canvas svg { display: block; width: 100%; height: 150px; overflow: visible; border-bottom: 1px solid var(--border); }
.trend-line { fill: none; stroke: var(--primary); stroke-linecap: round; stroke-linejoin: round; stroke-width: 2.5; vector-effect: non-scaling-stroke; }
.trend-area { fill: color-mix(in srgb, var(--primary) 10%, transparent); stroke: none; }
.trend-labels { display: flex; justify-content: space-between; gap: 12px; margin-top: 7px; color: var(--muted-foreground); font-size: 10px; }
.trend-labels span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trend-loading, .trend-empty { display: grid; height: 174px; place-items: center; color: var(--muted-foreground); font-size: 13px; }
</style>
