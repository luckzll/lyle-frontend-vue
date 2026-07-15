import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getTodayBriefing: vi.fn(),
  listConfirmations: vi.fn(),
  listExecutionResults: vi.fn(),
  listRecommendedConnections: vi.fn()
}))

vi.mock('@/api/app', () => api)

import { getDashboardViewModel } from '@/api/adapters/dashboard'
import type {
  ConfirmationInboxItem,
  ConnectionDiagnostic,
  DailyBriefing,
  ExecutionResultSummary
} from '@/api/types'

describe('dashboard adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aggregates successful sources, puts urgent work first, and keeps only the five newest results', async () => {
    const briefing = createBriefing({
      todayFocus: ['推进今日到期任务：今日任务', '整理发布范围'],
      overdueTasks: [createTask(1, '逾期任务', '2026-07-10T08:00:00.000Z')],
      dueTasks: [createTask(2, '今日任务', '2026-07-11T10:00:00.000Z')],
      projects: [createProject(9, 'V4.2 工作台')],
      projectId: 9
    })
    const confirmations = [createConfirmation(41)]
    const results = Array.from({ length: 7 }, (_, index) =>
      createResult(index + 1, index === 0 ? 'failed' : 'completed', `2026-07-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`)
    )
    const connections = [createConnection('github', 'reauthorize_required')]

    api.getTodayBriefing.mockResolvedValue({ data: briefing })
    api.listConfirmations.mockResolvedValue({ data: { items: confirmations } })
    api.listExecutionResults.mockResolvedValue({ data: { items: results } })
    api.listRecommendedConnections.mockResolvedValue({ data: { items: connections } })

    const viewModel = await getDashboardViewModel()

    expect(api.getTodayBriefing).toHaveBeenCalledTimes(1)
    expect(api.listConfirmations).toHaveBeenCalledTimes(1)
    expect(api.listExecutionResults).toHaveBeenCalledWith({ limit: 8 })
    expect(api.listRecommendedConnections).toHaveBeenCalledTimes(1)
    expect(viewModel.todayFocus.map((item) => [item.title, item.tone])).toEqual([
      ['逾期任务', 'danger'],
      ['今日任务', 'warning'],
      ['整理发布范围', 'info']
    ])
    expect(viewModel.actionItems.map((item) => item.kind)).toEqual([
      'confirmation',
      'connection',
      'execution'
    ])
    expect(viewModel.recentResults.map((item) => item.id)).toEqual([7, 6, 5, 4, 3])
    expect(viewModel.partialFailure).toBe(false)
    expect(viewModel.allFailed).toBe(false)
    expect(viewModel.confirmedEmpty).toBe(false)
  })

  it('keeps successful sections when some sources fail and never reports that state as empty', async () => {
    api.getTodayBriefing.mockResolvedValue({ data: createBriefing() })
    api.listConfirmations.mockRejectedValue(new Error('confirmation service unavailable'))
    api.listExecutionResults.mockResolvedValue({
      data: { items: [createResult(8, 'failed', '2026-07-11T08:00:00.000Z')] }
    })
    api.listRecommendedConnections.mockRejectedValue(new Error('connection service unavailable'))

    const viewModel = await getDashboardViewModel()

    expect(viewModel.sources.briefing.status).toBe('ready')
    expect(viewModel.sources.confirmations.status).toBe('error')
    expect(viewModel.sources.results.status).toBe('ready')
    expect(viewModel.sources.connections.status).toBe('error')
    expect(viewModel.partialFailure).toBe(true)
    expect(viewModel.allFailed).toBe(false)
    expect(viewModel.confirmedEmpty).toBe(false)
    expect(viewModel.recentResults).toHaveLength(1)
    expect(viewModel.actionItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'execution-8', kind: 'execution', tone: 'danger' })
    ]))
  })

  it('marks the dashboard unavailable when all four sources fail', async () => {
    api.getTodayBriefing.mockRejectedValue(new Error('briefing unavailable'))
    api.listConfirmations.mockRejectedValue(new Error('confirmations unavailable'))
    api.listExecutionResults.mockRejectedValue(new Error('results unavailable'))
    api.listRecommendedConnections.mockRejectedValue(new Error('connections unavailable'))

    const viewModel = await getDashboardViewModel()

    expect(viewModel.allFailed).toBe(true)
    expect(viewModel.partialFailure).toBe(false)
    expect(viewModel.confirmedEmpty).toBe(false)
    expect(viewModel.todayFocus).toEqual([])
    expect(viewModel.actionItems).toEqual([])
    expect(viewModel.recentResults).toEqual([])
    expect(viewModel.activeProjects).toEqual([])
    expect(Object.values(viewModel.sources).every((source) => source.status === 'error')).toBe(true)
  })

  it('reports a confirmed empty workspace only after every source succeeds with no data', async () => {
    api.getTodayBriefing.mockResolvedValue({ data: createBriefing() })
    api.listConfirmations.mockResolvedValue({ data: { items: [] } })
    api.listExecutionResults.mockResolvedValue({ data: { items: [] } })
    api.listRecommendedConnections.mockResolvedValue({ data: { items: [] } })

    const viewModel = await getDashboardViewModel()

    expect(viewModel.confirmedEmpty).toBe(true)
    expect(viewModel.partialFailure).toBe(false)
    expect(viewModel.allFailed).toBe(false)
    expect(Object.values(viewModel.sources).every((source) => source.status === 'ready')).toBe(true)
  })
})

function createBriefing(overrides: Partial<DailyBriefing> = {}): DailyBriefing {
  return {
    projectId: null,
    briefingType: 'daily',
    title: '今日项目简报',
    content: '',
    todayFocus: [],
    projects: [],
    goals: [],
    dueTasks: [],
    overdueTasks: [],
    pendingOperations: [],
    createdAt: '2026-07-11T08:00:00.000Z',
    ...overrides
  }
}

function createTask(id: number, title: string, dueAt: string) {
  return {
    id,
    title,
    status: 'open',
    dueAt,
    conversationId: '',
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-11T08:00:00.000Z'
  }
}

function createProject(id: number, name: string) {
  return {
    id,
    name,
    status: 'active',
    currentStage: '体验收口',
    priority: 3,
    lastActivityAt: '2026-07-11T07:00:00.000Z',
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-11T07:00:00.000Z'
  }
}

function createConfirmation(id: number): ConfirmationInboxItem {
  return {
    pendingOperationId: id,
    actionTitle: '发布更新说明',
    riskLevel: 'medium',
    reason: '需要写入仓库',
    impactResources: ['README.md'],
    reversible: true,
    requiresSecondConfirmation: false,
    source: 'release automation',
    createdAt: '2026-07-11T08:00:00.000Z'
  }
}

function createResult(
  id: number,
  status: ExecutionResultSummary['status'],
  createdAt: string
): ExecutionResultSummary {
  return {
    id,
    sourceType: 'automation',
    sourceId: String(id),
    projectId: null,
    status,
    title: `执行结果 ${id}`,
    conclusion: status === 'failed' ? '执行失败，需要处理。' : '执行完成。',
    completedItems: [],
    risks: status === 'failed' ? ['连接授权失效'] : [],
    recommendedActions: [],
    dataScope: [],
    createdAt
  }
}

function createConnection(id: string, status: ConnectionDiagnostic['status']): ConnectionDiagnostic {
  return {
    id,
    type: 'github',
    name: 'GitHub',
    status,
    displayReason: '授权已过期',
    nextAction: '重新授权',
    capabilities: ['读取仓库'],
    lastCheckedAt: '2026-07-11T08:00:00.000Z'
  }
}
