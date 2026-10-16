<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Info } from '@lucide/vue'
import type { UsageTrendPoint } from '@/api/usage'
import { formatTokens, hourlyUsageTrend } from '@/domain/usage'

const props = defineProps<{ points: UsageTrendPoint[]; period: 'today' | 'month'; loading?: boolean }>()
const selectedBucket = ref<string | null>(null)
const displayPoints = computed(() => props.period === 'today' ? hourlyUsageTrend(props.points) : props.points)
const selectedPoint = computed(() => displayPoints.value.find((point) => point.bucket === selectedBucket.value))
watch(() => [props.period, props.points], () => { selectedBucket.value = null })

const chart = computed(() => {
  const values = displayPoints.value.map((point) => Math.max(0, point.totalTokens))
  const max = Math.max(...values, 1)
  const width = 640
  const height = 150
  const xStep = values.length <= 1 ? width : (width - 16) / (values.length - 1)
  const coordinates = values.map((value, index) => ({
    ...displayPoints.value[index],
    x: values.length === 1 ? width / 2 : 8 + index * xStep,
    y: height - (value / max) * height
  }))
  return {
    width,
    height,
    max,
    coordinates,
    xStep,
    labels: coordinates.filter((_, index) => index === 0 || index === values.length - 1 || index % Math.ceil(values.length / 4) === 0),
    line: coordinates.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
    area: coordinates.length
      ? `M ${coordinates[0].x} ${height} ${coordinates.map((point) => `L ${point.x} ${point.y}`).join(' ')} L ${coordinates[coordinates.length - 1].x} ${height} Z`
      : ''
  }
})
</script>

<template>
  <article class="trend-card">
    <header><h3>{{ period === 'today' ? '今日' : '本月' }}用量趋势 <span>（Token）</span></h3><Info :size="15" :aria-label="period === 'today' ? '按北京时间逐小时汇总，未发生调用的小时为 0' : '按调用发生日期汇总'" /></header>
    <div v-if="loading" class="trend-loading">正在读取趋势…</div>
    <div v-else-if="!displayPoints.length" class="trend-empty">当前周期还没有 AI 用量</div>
    <template v-else>
    <p class="trend-detail" aria-live="polite">
      <template v-if="selectedPoint">{{ selectedPoint.bucket }}{{ period === 'today' ? '–' + String(Number(selectedPoint.bucket.slice(0, 2)) + 1).padStart(2, '0') + ':00' : '' }} · {{ formatTokens(selectedPoint.totalTokens) }} Token · {{ selectedPoint.callCount }} 次调用</template>
      <template v-else>{{ period === 'today' ? '北京时间 · 每小时用量' : '每日用量' }} · {{ points.length ? '悬停或点选查看详情' : '今日暂无 AI 用量' }}</template>
    </p>
    <div class="trend-chart">
      <div class="trend-scale">
        <span>{{ formatTokens(chart.max) }}</span>
        <span>{{ formatTokens(chart.max / 2) }}</span>
        <span>0</span>
      </div>
      <div class="trend-canvas">
        <svg :viewBox="`0 0 ${chart.width} ${chart.height}`" preserveAspectRatio="none" role="group" :aria-label="`${period === 'today' ? '今日' : '本月'} Token 用量折线图`" @pointerleave="selectedBucket = null">
          <line v-for="y in [0, chart.height / 2, chart.height]" :key="y" class="trend-grid" x1="0" :x2="chart.width" :y1="y" :y2="y" />
          <path class="trend-area" :d="chart.area" />
          <path class="trend-line" :d="chart.line" />
          <g v-for="point in chart.coordinates" :key="point.bucket" class="trend-point" tabindex="0" role="button"
            :aria-label="`${point.bucket}，${formatTokens(point.totalTokens)} Token，${point.callCount} 次调用`"
            @pointerenter="selectedBucket = point.bucket" @focus="selectedBucket = point.bucket" @blur="selectedBucket = null"
            @click="selectedBucket = point.bucket" @keydown.enter.prevent="selectedBucket = point.bucket" @keydown.space.prevent="selectedBucket = point.bucket">
            <line v-if="selectedBucket === point.bucket" class="trend-guide" :x1="point.x" :x2="point.x" y1="0" :y2="chart.height" />
            <circle v-if="point.totalTokens > 0 || selectedBucket === point.bucket" class="trend-dot" :cx="point.x" :cy="point.y" r="3.5" />
            <rect :x="Math.max(0, point.x - chart.xStep / 2)" y="-5" :width="Math.min(chart.width, point.x + chart.xStep / 2) - Math.max(0, point.x - chart.xStep / 2)" :height="chart.height + 10" fill="transparent" />
          </g>
        </svg>
        <div class="trend-labels">
          <span v-for="point in chart.labels" :key="point.bucket" :style="{ left: `${point.x / chart.width * 100}%` }">{{ point.bucket }}</span>
        </div>
      </div>
    </div>
    </template>
  </article>
</template>

<style scoped>
.trend-card { min-width: 0; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 16px 18px; }
.trend-card header { display: flex; align-items: center; gap: 7px; }
.trend-card h3 { margin: 0; font-size: 14px; }
.trend-card h3 span { color: var(--muted-foreground); font-weight: 500; }
.trend-card header svg { color: var(--muted-foreground); }
.trend-detail { min-height: 18px; margin: 10px 0 18px; color: var(--muted-foreground); font-size: 11px; }
.trend-chart { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 8px; }
.trend-scale { display: flex; height: 150px; flex-direction: column; justify-content: space-between; color: var(--muted-foreground); font-size: 10px; text-align: right; }
.trend-canvas { min-width: 0; }
.trend-canvas svg { display: block; width: 100%; height: 150px; overflow: visible; border-bottom: 1px solid var(--border); }
.trend-line { fill: none; stroke: var(--primary); stroke-linecap: round; stroke-linejoin: round; stroke-width: 2.5; vector-effect: non-scaling-stroke; }
.trend-area { fill: color-mix(in srgb, var(--primary) 10%, transparent); stroke: none; }
.trend-grid { stroke: var(--border); stroke-dasharray: 3 4; vector-effect: non-scaling-stroke; }
.trend-guide { stroke: var(--primary); stroke-dasharray: 3 4; vector-effect: non-scaling-stroke; }
.trend-dot { fill: var(--primary); stroke: var(--surface); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.trend-point { cursor: pointer; }
.trend-point:focus-visible { outline: 2px solid var(--primary); }
.trend-labels { position: relative; height: 15px; margin-top: 7px; color: var(--muted-foreground); font-size: 10px; }
.trend-labels span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.trend-labels span:first-child { transform: none; }
.trend-labels span:last-child { transform: translateX(-100%); }
.trend-loading, .trend-empty { display: grid; height: 174px; place-items: center; color: var(--muted-foreground); font-size: 13px; }
</style>
