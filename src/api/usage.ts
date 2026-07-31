import { http } from './http'

export type UsagePeriod = 'today' | 'month'
export type MeasurementStatus = 'EMPTY' | 'REPORTED' | 'ESTIMATED' | 'PARTIAL_ESTIMATE'

export interface UsageSummary {
  period: UsagePeriod
  periodStart: string
  periodEnd: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  callCount: number
  estimatedCostMicros: number
  reportedRatio: number
  estimatedRatio: number
  measurementStatus: MeasurementStatus
}

export interface UsageTaskItem {
  taskType: string
  label: string
  description: string
  totalTokens: number
  estimatedCostMicros: number
  callCount: number
}

export interface UsageTrendPoint {
  bucket: string
  totalTokens: number
  callCount: number
}

export interface UsageTurn {
  turnId: string
  conversationId?: string | null
  workTitle: string
  taskType: string
  taskLabel: string
  totalTokens: number
  estimatedCostMicros: number
  callCount: number
  measurementSource: 'PROVIDER_REPORTED' | 'ESTIMATED' | 'PARTIAL_ESTIMATE'
  occurredAt: string
}

export interface UsagePolicy {
  dailySoftTokenLimit: number
  dailyHardTokenLimit: number
  dailySoftCostMicros: number
  dailyHardCostMicros: number
  turnMaxCalls: number
  turnMaxInputTokens: number
  turnMaxOutputTokens: number
  turnMaxCostMicros: number
  usedTokens: number
  usedCostMicros: number
  usedPercent: number
  remainingTokens: number
  status: 'HEALTHY' | 'NEAR_LIMIT' | 'EXHAUSTED'
  resetsAt: string
}

export function getUsageSummary(period: UsagePeriod) {
  return http.get<UsageSummary>('/usage/summary', { params: { period } })
}

export function getUsageByTask(period: UsagePeriod) {
  return http.get<UsageTaskItem[]>('/usage/by-task', { params: { period } })
}

export function getUsageTrend(period: UsagePeriod) {
  return http.get<UsageTrendPoint[]>('/usage/trend', { params: { period } })
}

export function getUsageTurns(period: UsagePeriod, limit = 20) {
  return http.get<UsageTurn[]>('/usage/turns', { params: { period, limit } })
}

export function getUsagePolicy() {
  return http.get<UsagePolicy>('/usage/policy')
}

export function updateUsagePolicy(payload: Pick<
  UsagePolicy,
  'dailySoftTokenLimit' | 'dailyHardTokenLimit' | 'dailySoftCostMicros' | 'dailyHardCostMicros'
>) {
  return http.put<UsagePolicy>('/usage/policy', payload)
}
