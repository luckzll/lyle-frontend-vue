<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Info } from '@lucide/vue'
import {
  getUsageByTask,
  getUsagePolicy,
  getUsageSummary,
  getUsageTrend,
  getUsageTurns,
  updateUsagePolicy,
  type UsagePeriod,
  type UsagePolicy,
  type UsageSummary,
  type UsageTaskItem,
  type UsageTrendPoint,
  type UsageTurn
} from '@/api/usage'
import SettingsFrame from '@/components/settings/SettingsFrame.vue'
import TurnUsageList from '@/components/usage/TurnUsageList.vue'
import UsageBreakdown from '@/components/usage/UsageBreakdown.vue'
import UsagePolicyForm from '@/components/usage/UsagePolicyForm.vue'
import UsageSummaryCards from '@/components/usage/UsageSummaryCards.vue'
import UsageTrend from '@/components/usage/UsageTrend.vue'
import { useToast } from '@/composables/useToast'

const period = ref<UsagePeriod>('today')
const summary = ref<UsageSummary | null>(null)
const tasks = ref<UsageTaskItem[]>([])
const trend = ref<UsageTrendPoint[]>([])
const turns = ref<UsageTurn[]>([])
const policy = ref<UsagePolicy | null>(null)
const loading = ref(true)
const moduleErrors = ref<string[]>([])
const savingPolicy = ref(false)
const { show } = useToast()
const periodTabs: UsagePeriod[] = ['today', 'month']

const measurementNote = computed(() => {
  if (!summary.value || summary.value.measurementStatus === 'EMPTY') return '当前周期还没有 AI 用量'
  if (summary.value.measurementStatus === 'REPORTED') return '计量可信度：全部为供应商实报'
  if (summary.value.measurementStatus === 'ESTIMATED') return '计量可信度：当前数据均为系统估算'
  return `计量可信度：供应商实报 ${summary.value.reportedRatio}% · 系统估算 ${summary.value.estimatedRatio}%`
})

watch(period, () => {
  void loadUsage()
}, { immediate: true })

async function loadUsage() {
  loading.value = true
  moduleErrors.value = []
  const [summaryResult, taskResult, trendResult, turnsResult, policyResult] = await Promise.allSettled([
    getUsageSummary(period.value),
    getUsageByTask(period.value),
    getUsageTrend(period.value),
    getUsageTurns(period.value, 20),
    getUsagePolicy()
  ])
  if (summaryResult.status === 'fulfilled') summary.value = summaryResult.value.data
  else moduleErrors.value.push('汇总')
  if (taskResult.status === 'fulfilled') tasks.value = taskResult.value.data
  else moduleErrors.value.push('任务统计')
  if (trendResult.status === 'fulfilled') trend.value = trendResult.value.data
  else moduleErrors.value.push('趋势')
  if (turnsResult.status === 'fulfilled') turns.value = turnsResult.value.data
  else moduleErrors.value.push('最近消耗')
  if (policyResult.status === 'fulfilled') policy.value = policyResult.value.data
  else moduleErrors.value.push('额度')
  loading.value = false
}

function selectPeriod(nextPeriod: UsagePeriod, target?: EventTarget | null) {
  period.value = nextPeriod
  if (target instanceof HTMLElement) target.focus()
}

function handlePeriodKey(event: KeyboardEvent) {
  const currentIndex = periodTabs.indexOf(period.value)
  let nextIndex = currentIndex
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % periodTabs.length
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + periodTabs.length) % periodTabs.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = periodTabs.length - 1
  else return
  event.preventDefault()
  const tab = (event.currentTarget as HTMLElement).parentElement
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]
  selectPeriod(periodTabs[nextIndex], tab)
}

async function savePolicy(payload: {
  dailySoftTokenLimit: number
  dailyHardTokenLimit: number
  dailySoftCostMicros: number
  dailyHardCostMicros: number
}) {
  savingPolicy.value = true
  try {
    policy.value = (await updateUsagePolicy(payload)).data
    show('额度已更新', { message: '新额度将用于后续 AI 调用。' })
  } catch (error: any) {
    show('额度保存失败', {
      message: error?.response?.data?.detail || '请检查提醒阈值与硬上限。',
      tone: 'danger'
    })
  } finally {
    savingPolicy.value = false
  }
}
</script>

<template>
  <SettingsFrame>
    <section class="usage-page" aria-labelledby="usage-title">
      <header class="usage-heading">
        <div>
          <h2 id="usage-title">AI 用量</h2>
          <p>了解 AI 消耗，控制每日预算。</p>
        </div>
      </header>

      <div class="period-switch" role="tablist" aria-label="用量周期">
        <button
          id="usage-today-tab"
          type="button"
          role="tab"
          aria-controls="usage-period-panel"
          :aria-selected="period === 'today'"
          :tabindex="period === 'today' ? 0 : -1"
          @click="selectPeriod('today', $event.currentTarget)"
          @keydown="handlePeriodKey"
        >今日</button>
        <button
          id="usage-month-tab"
          type="button"
          role="tab"
          aria-controls="usage-period-panel"
          :aria-selected="period === 'month'"
          :tabindex="period === 'month' ? 0 : -1"
          @click="selectPeriod('month', $event.currentTarget)"
          @keydown="handlePeriodKey"
        >本月</button>
      </div>

      <section
        id="usage-period-panel"
        class="usage-period-panel"
        role="tabpanel"
        :aria-labelledby="`usage-${period}-tab`"
      >
        <p v-if="moduleErrors.length" class="usage-error" role="status">
          {{ moduleErrors.join('、') }}暂时未能更新，已保留其余可用数据。
          <button type="button" @click="loadUsage">重试</button>
        </p>

        <UsageSummaryCards :summary="summary" :policy="policy" :period="period" :loading="loading" />

        <div class="usage-overview">
          <UsageTrend :points="trend" :period="period" :loading="loading" />
          <UsagePolicyForm :policy="policy" :saving="savingPolicy" @save="savePolicy" />
        </div>

        <UsageBreakdown :items="tasks" :loading="loading" />
        <p class="measurement-note"><Info :size="14" aria-hidden="true" />{{ measurementNote }}</p>
        <TurnUsageList :items="turns" :loading="loading" />

        <p class="usage-disclaimer">
          <Info :size="14" aria-hidden="true" />
          费用为估算，仅用于成本管理，不代表账单。
        </p>
      </section>
    </section>
  </SettingsFrame>
</template>

<style scoped>
.usage-page { display: grid; gap: 11px; max-width: 1100px; margin: 0 auto; }
.usage-heading h2 { margin: 0; color: var(--foreground); font-size: 24px; letter-spacing: -.025em; }
.usage-heading p { margin: 6px 0 0; color: var(--muted-foreground); font-size: 13px; }
.period-switch { display: inline-grid; width: fit-content; grid-template-columns: repeat(2, 78px); overflow: hidden; border: 1px solid var(--border); border-radius: 7px; }
.period-switch button { min-height: 34px; border: 0; border-radius: 0; background: var(--surface); color: var(--muted-foreground); padding: 0 16px; font-size: 12px; font-weight: 650; }
.period-switch button + button { border-left: 1px solid var(--border); }
.period-switch button[aria-selected='true'] { background: var(--primary-soft); color: var(--primary); }
.usage-period-panel { display: grid; gap: 11px; }
.usage-overview { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(280px, 1fr); gap: 14px; }
.usage-error { display: flex; align-items: center; gap: 8px; margin: 0; border: 1px solid var(--warning-border); border-radius: 8px; background: var(--warning-soft); color: var(--warning-strong); padding: 9px 12px; font-size: 12px; }
.usage-error button { margin-left: auto; border: 0; background: transparent; color: inherit; padding: 0; font-size: 12px; font-weight: 700; }
.measurement-note, .usage-disclaimer { display: flex; align-items: center; gap: 7px; margin: -6px 0 0; color: var(--muted-foreground); font-size: 11px; }
.usage-disclaimer { margin: 0; }
@media (max-width: 980px) {
  .usage-overview { grid-template-columns: 1fr; }
}
</style>
