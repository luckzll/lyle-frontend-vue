import {
  getTodayBriefing,
  listConfirmations,
  listExecutionResults,
  listRecommendedConnections
} from '@/api/app'
import type {
  ConfirmationInboxItem,
  ConnectionDiagnostic,
  DailyBriefing,
  ExecutionResultSummary
} from '@/api/types'
import { humanizeIsoDateTimes } from '@/domain/date-time'

export type DashboardSource = 'briefing' | 'confirmations' | 'results' | 'connections'
export type DashboardTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success'

export interface DashboardSourceState {
  status: 'ready' | 'error'
  message?: string
}

export interface DashboardFocusItem {
  id: string
  title: string
  meta: string
  tone: DashboardTone
  target: string
}

export interface DashboardActionItem {
  id: string
  title: string
  description: string
  kind: 'confirmation' | 'connection' | 'execution'
  tone: 'warning' | 'danger'
  target: string
}

export interface DashboardResultItem {
  id: number
  title: string
  conclusion: string
  status: ExecutionResultSummary['status']
  statusLabel: string
  createdAt: string
  projectId?: number | null
  target: string
}

export interface DashboardProjectItem {
  id: number
  name: string
  stage: string
  nextStep: string
  updatedAt: string
  target: string
}

export interface DashboardViewModel {
  generatedAt: string
  counts: {
    dueToday: number
    overdue: number
    pending: number
    needsAttention: number
  }
  todayFocus: DashboardFocusItem[]
  actionItems: DashboardActionItem[]
  recentResults: DashboardResultItem[]
  activeProjects: DashboardProjectItem[]
  sources: Record<DashboardSource, DashboardSourceState>
  partialFailure: boolean
  allFailed: boolean
  confirmedEmpty: boolean
}

type DashboardResponses = {
  briefing: DailyBriefing | null
  confirmations: ConfirmationInboxItem[]
  results: ExecutionResultSummary[]
  connections: ConnectionDiagnostic[]
}

const SOURCE_LABELS: Record<DashboardSource, string> = {
  briefing: '今日重点与项目',
  confirmations: '待确认操作',
  results: '最近结果',
  connections: '连接状态'
}

/**
 * Assemble the dashboard with exactly four independent reads. A failed source
 * never discards successful sections, and callers can distinguish an empty
 * section from one whose API did not load.
 */
export async function getDashboardViewModel(): Promise<DashboardViewModel> {
  const settled = await Promise.allSettled([
    getTodayBriefing(),
    listConfirmations(),
    listExecutionResults({ limit: 8 }),
    listRecommendedConnections()
  ] as const)

  const sourceOrder: DashboardSource[] = ['briefing', 'confirmations', 'results', 'connections']
  const sources = {} as Record<DashboardSource, DashboardSourceState>

  sourceOrder.forEach((source, index) => {
    const result = settled[index]
    sources[source] = result.status === 'fulfilled'
      ? { status: 'ready' }
      : { status: 'error', message: `${SOURCE_LABELS[source]}暂时无法加载` }
  })

  const responses: DashboardResponses = {
    briefing: settled[0].status === 'fulfilled' ? settled[0].value.data : null,
    confirmations: settled[1].status === 'fulfilled' && Array.isArray(settled[1].value.data.items)
      ? settled[1].value.data.items
      : [],
    results: settled[2].status === 'fulfilled' && Array.isArray(settled[2].value.data.items)
      ? settled[2].value.data.items
      : [],
    connections: settled[3].status === 'fulfilled' && Array.isArray(settled[3].value.data.items)
      ? settled[3].value.data.items
      : []
  }

  const todayFocus = buildTodayFocus(responses.briefing)
  const actionItems = buildActionItems(responses)
  const recentResults = buildRecentResults(responses.results)
  const activeProjects = buildActiveProjects(responses.briefing)
  const failedCount = Object.values(sources).filter((source) => source.status === 'error').length
  const hasData = todayFocus.length > 0
    || actionItems.length > 0
    || recentResults.length > 0
    || activeProjects.length > 0

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      dueToday: responses.briefing?.dueTasks.length ?? 0,
      overdue: responses.briefing?.overdueTasks.length ?? 0,
      pending: responses.confirmations.length || responses.briefing?.pendingOperations.length || 0,
      needsAttention: actionItems.filter((item) => item.kind !== 'confirmation').length
    },
    todayFocus,
    actionItems,
    recentResults,
    activeProjects,
    sources,
    partialFailure: failedCount > 0 && failedCount < sourceOrder.length,
    allFailed: failedCount === sourceOrder.length,
    confirmedEmpty: failedCount === 0 && !hasData
  }
}

function buildTodayFocus(briefing: DailyBriefing | null): DashboardFocusItem[] {
  if (!briefing) return []

  const overdue = briefing.overdueTasks.map((task) => ({
    id: `overdue-${task.id}`,
    title: task.title,
    meta: task.dueAt ? `已逾期 · ${formatDateTime(task.dueAt)}` : '已逾期',
    tone: 'danger' as const,
    target: '/tasks'
  }))
  const dueToday = briefing.dueTasks.map((task) => ({
    id: `due-${task.id}`,
    title: task.title,
    meta: task.dueAt ? `今日到期 · ${formatTime(task.dueAt)}` : '今日到期',
    tone: 'warning' as const,
    target: '/tasks'
  }))
  const taskTitles = [...briefing.overdueTasks, ...briefing.dueTasks]
    .map((task) => task.title.trim().toLocaleLowerCase())
    .filter(Boolean)
  const suggestions = briefing.todayFocus
    .filter((title) => !taskTitles.some((taskTitle) => title.toLocaleLowerCase().includes(taskTitle)))
    .map((title, index) => ({
    id: `focus-${index}-${title}`,
    title,
    meta: 'Lyle 建议的下一步',
    tone: 'info' as const,
    target: briefing.projectId ? `/projects/${briefing.projectId}` : '/projects'
    }))

  return dedupeByTitle([...overdue, ...dueToday, ...suggestions]).slice(0, 6)
}

function buildActionItems(responses: DashboardResponses): DashboardActionItem[] {
  const confirmations = responses.confirmations.map((item) => ({
    id: `confirmation-${item.pendingOperationId}`,
    title: humanizeIsoDateTimes(item.actionTitle),
    description: humanizeIsoDateTimes(item.reason) || '此操作需要你确认后才能继续。',
    kind: 'confirmation' as const,
    tone: item.riskLevel === 'high' ? 'danger' as const : 'warning' as const,
    target: '/execution-center?view=confirmations'
  }))

  // The briefing still exposes legacy pending operations. Keep them only as a
  // fallback when the dedicated confirmation endpoint returned no items.
  const legacyConfirmations = confirmations.length === 0
    ? (responses.briefing?.pendingOperations ?? []).map((item) => ({
      id: `pending-${item.id}`,
      title: humanizeIsoDateTimes(item.summary),
      description: humanizeIsoDateTimes(item.sourceText) || '此操作需要你确认后才能继续。',
      kind: 'confirmation' as const,
      tone: item.riskLevel === 'high' ? 'danger' as const : 'warning' as const,
      target: '/execution-center?view=confirmations'
    }))
    : []

  const connectionIssues = responses.connections
    .filter((item) => item.status !== 'healthy')
    .map((item) => ({
      id: `connection-${item.id}`,
      title: `${item.name}需要处理`,
      description: item.displayReason || item.nextAction,
      kind: 'connection' as const,
      tone: item.status === 'unavailable' ? 'danger' as const : 'warning' as const,
      target: '/connections'
    }))

  const executionIssues = responses.results
    .filter((item) => item.status === 'failed' || item.status === 'partial')
    .map((item) => ({
      id: `execution-${item.id}`,
      title: humanizeIsoDateTimes(item.title),
      description: humanizeIsoDateTimes(item.risks[0] || item.conclusion) || '执行结果需要你检查。',
      kind: 'execution' as const,
      tone: item.status === 'failed' ? 'danger' as const : 'warning' as const,
      target: '/execution-center?view=attention'
    }))

  return [...confirmations, ...legacyConfirmations, ...connectionIssues, ...executionIssues].slice(0, 6)
}

function buildRecentResults(results: ExecutionResultSummary[]): DashboardResultItem[] {
  return [...results]
    .sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt))
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      title: item.title,
      conclusion: item.conclusion || resultFallback(item.status),
      status: item.status,
      statusLabel: resultStatusLabel(item.status),
      createdAt: item.createdAt,
      projectId: item.projectId,
      target: `/execution-center?view=results&resultId=${item.id}`
    }))
}

function buildActiveProjects(briefing: DailyBriefing | null): DashboardProjectItem[] {
  if (!briefing) return []
  return [...briefing.projects]
    .sort((left, right) => {
      const activityDifference = dateValue(right.lastActivityAt || right.updatedAt) - dateValue(left.lastActivityAt || left.updatedAt)
      return activityDifference || right.priority - left.priority
    })
    .slice(0, 5)
    .map((project) => ({
      id: project.id,
      name: project.name,
      stage: project.currentStage || '尚未设置阶段',
      nextStep: project.id === briefing.projectId && briefing.todayFocus[0]
        ? briefing.todayFocus[0]
        : project.currentStage
          ? `继续推进：${project.currentStage}`
          : '打开项目，补充目标和下一步',
      updatedAt: project.lastActivityAt || project.updatedAt,
      target: `/projects/${project.id}`
    }))
}

function dedupeByTitle(items: DashboardFocusItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.title.trim().toLocaleLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function resultStatusLabel(status: ExecutionResultSummary['status']) {
  return {
    completed: '已完成',
    partial: '部分完成',
    failed: '需要处理',
    awaiting_confirmation: '等待确认'
  }[status]
}

function resultFallback(status: ExecutionResultSummary['status']) {
  if (status === 'failed') return '本次执行未完成，请查看原因并决定下一步。'
  if (status === 'partial') return '本次执行已完成一部分，仍有事项需要处理。'
  if (status === 'awaiting_confirmation') return '执行正在等待你的确认。'
  return '本次执行已完成。'
}

function dateValue(value?: string | null) {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间待确认'
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间待确认'
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
