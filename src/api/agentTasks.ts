import { http } from '@/api/http'

export type AgentTaskStatus =
  | 'DRAFT' | 'PLANNING' | 'AWAITING_PLAN_APPROVAL' | 'READY' | 'RUNNING'
  | 'AWAITING_CONFIRMATION' | 'AWAITING_INPUT' | 'PAUSING' | 'PAUSED'
  | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' | 'CANCELLED'

export type AgentStepStatus =
  | 'PENDING' | 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  | 'WAITING_CONFIRMATION' | 'WAITING_INPUT' | 'CANCELLED'

export interface AgentBudget {
  maxSteps: number
  maxToolCalls: number
  maxModelTokens: number
  maxCostMicros: number
  maxWallTimeMillis: number
  maxRetriesPerStep: number
  maxConsecutiveNoProgress: number
}

export interface AgentBudgetUsage {
  completedSteps: number
  toolCalls: number
  modelTokens: number
  costMicros: number
  elapsedMillis: number
  retries: number
}

export interface AgentPlanStep {
  id?: string
  stepKey: string
  position: number
  stepType: string
  title: string
  purpose: string
  toolRef: string
  inputTemplate: Record<string, unknown>
  dependencies: string[]
  riskLevel: 'READ' | 'EXTERNAL_READ' | 'WRITE_LOW'
  expectedArtifact: Record<string, unknown>
  writeIntent: boolean
}

export interface AgentPlan {
  id: string
  version: number
  source: string
  goal: string
  completionCriteria: Array<string | Record<string, unknown>>
  constraints: Record<string, unknown>
  accessScope: Record<string, unknown>
  budget: AgentBudget
  changeSummary: Record<string, unknown>
  approvalStatus: string
  approvedBy?: number | null
  approvedAt?: string | null
  steps: AgentPlanStep[]
}

export interface AgentStepRun {
  id: string
  planStepId: string
  stepKey: string
  position: number
  title: string
  purpose: string
  toolRef: string
  riskLevel: string
  writeIntent: boolean
  attempt: number
  status: AgentStepStatus
  output: Record<string, unknown>
  toolResultRef?: string | null
  errorCode?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

export interface AgentTaskRun {
  id: string
  planVersion: number
  status: AgentTaskStatus
  budgetLimit: AgentBudget
  budgetUsed: AgentBudgetUsage
  noProgressCount: number
  startedAt?: string | null
  pausedAt?: string | null
  finishedAt?: string | null
  updatedAt: string
}

export interface AgentArtifact {
  id: string
  taskRunId: string
  stepRunId?: string | null
  type: string
  title: string
  summary: string
  contentRef?: string | null
  evidenceRefs: unknown[]
  metadata: Record<string, unknown>
  createdAt: string
}

export interface ChangePreview {
  id: string
  stepRunId: string
  pendingOperationId: number
  resourceRef: string
  actionType: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  impact: string
  riskLevel: string
  undoSupported: boolean
  status: string
  createdAt: string
}

export interface AgentTask {
  id: string
  title: string
  goal: string
  completionCriteria: Array<string | Record<string, unknown>>
  constraints: Record<string, unknown>
  projectId?: string | null
  conversationId?: string | null
  templateId?: string | null
  status: AgentTaskStatus
  riskLevel: string
  autonomyLevel: number
  activePlanVersion?: number | null
  currentRunId?: string | null
  version: number
  createdAt: string
  updatedAt: string
  plan?: AgentPlan
  run?: AgentTaskRun
  stepRuns?: AgentStepRun[]
  pendingChangePreview?: ChangePreview
  artifacts?: AgentArtifact[]
  availableActions?: string[]
}

export interface AgentTaskCreateInput {
  title?: string
  goal: string
  completionCriteria: string[]
  constraints?: Record<string, unknown>
  templateId?: string
  autonomyLevel: 0 | 1 | 2
  projectId?: number
  conversationId?: number
}

export interface AgentTaskEvent {
  sequence: number
  eventType: string
  payload: Record<string, unknown>
  occurredAt: string
}

function idempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function mutationConfig() {
  return { headers: { 'Idempotency-Key': idempotencyKey() } }
}

function numberValue(value: unknown) {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function normalizeBudget(value: any): AgentBudget {
  return {
    maxSteps: numberValue(value?.maxSteps),
    maxToolCalls: numberValue(value?.maxToolCalls),
    maxModelTokens: numberValue(value?.maxModelTokens),
    maxCostMicros: numberValue(value?.maxCostMicros),
    maxWallTimeMillis: numberValue(value?.maxWallTimeMillis),
    maxRetriesPerStep: numberValue(value?.maxRetriesPerStep),
    maxConsecutiveNoProgress: numberValue(value?.maxConsecutiveNoProgress)
  }
}

function normalizeUsage(value: any): AgentBudgetUsage {
  return {
    completedSteps: numberValue(value?.completedSteps),
    toolCalls: numberValue(value?.toolCalls),
    modelTokens: numberValue(value?.modelTokens),
    costMicros: numberValue(value?.costMicros),
    elapsedMillis: numberValue(value?.elapsedMillis),
    retries: numberValue(value?.retries)
  }
}

function normalizeTask(raw: any): AgentTask {
  const plan = raw.plan ? {
    ...raw.plan,
    id: String(raw.plan.id),
    version: numberValue(raw.plan.version),
    budget: normalizeBudget(raw.plan.budget),
    steps: (raw.plan.steps || []).map((step: any) => ({
      ...step,
      ...(step.id == null ? {} : { id: String(step.id) }),
      position: numberValue(step.position)
    }))
  } : undefined
  const run = raw.run ? {
    ...raw.run,
    id: String(raw.run.id),
    planVersion: numberValue(raw.run.planVersion),
    budgetLimit: normalizeBudget(raw.run.budgetLimit),
    budgetUsed: normalizeUsage(raw.run.budgetUsed),
    noProgressCount: numberValue(raw.run.noProgressCount)
  } : undefined
  return {
    ...raw,
    id: String(raw.id),
    version: numberValue(raw.version),
    projectId: raw.projectId == null ? null : String(raw.projectId),
    conversationId: raw.conversationId == null ? null : String(raw.conversationId),
    currentRunId: raw.currentRunId == null ? null : String(raw.currentRunId),
    activePlanVersion: raw.activePlanVersion == null ? null : numberValue(raw.activePlanVersion),
    plan,
    run,
    stepRuns: raw.stepRuns?.map((step: any) => ({ ...step, id: String(step.id), planStepId: String(step.planStepId), position: numberValue(step.position), attempt: numberValue(step.attempt) })),
    pendingChangePreview: raw.pendingChangePreview ? {
      ...raw.pendingChangePreview,
      id: String(raw.pendingChangePreview.id),
      stepRunId: String(raw.pendingChangePreview.stepRunId),
      pendingOperationId: numberValue(raw.pendingChangePreview.pendingOperationId)
    } : undefined,
    artifacts: raw.artifacts?.map((artifact: any) => ({
      ...artifact,
      id: String(artifact.id),
      taskRunId: String(artifact.taskRunId),
      stepRunId: artifact.stepRunId == null ? null : String(artifact.stepRunId)
    }))
  }
}

export function createAgentTask(input: AgentTaskCreateInput) {
  return http.post<AgentTask>('/agent-tasks', input, mutationConfig()).then((response) => ({ ...response, data: normalizeTask(response.data) }))
}

export function listAgentTasks(params: { status?: AgentTaskStatus; limit?: number } = {}) {
  return http.get<{ items: AgentTask[] }>('/agent-tasks', { params }).then((response) => ({
    ...response,
    data: { items: response.data.items.map(normalizeTask) }
  }))
}

export function getAgentTask(id: string | number) {
  return http.get<AgentTask>(`/agent-tasks/${id}`).then((response) => ({ ...response, data: normalizeTask(response.data) }))
}

export function generateAgentPlan(id: string | number, expectedVersion: number, signal?: AbortSignal) {
  const config = mutationConfig()
  return http.post<AgentTask>(`/agent-tasks/${id}/plan:generate`, { expectedVersion }, { ...config, signal }).then((response) => ({ ...response, data: normalizeTask(response.data) }))
}

export function updateAgentPlan(id: string | number, version: number, expectedVersion: number, input: Partial<AgentPlan>) {
  return http.put<AgentTask>(`/agent-tasks/${id}/plans/${version}`, { ...input, expectedVersion }, mutationConfig()).then((response) => ({ ...response, data: normalizeTask(response.data) }))
}

export function approveAgentPlan(id: string | number, version: number, expectedVersion: number) {
  return http.post<AgentTask>(`/agent-tasks/${id}/plans/${version}:approve`, { expectedVersion }, mutationConfig()).then((response) => ({ ...response, data: normalizeTask(response.data) }))
}

export function startAgentTask(id: string | number, expectedVersion: number) {
  return http.post<AgentTask>(`/agent-tasks/${id}:start`, { expectedVersion }, mutationConfig()).then((response) => ({ ...response, data: normalizeTask(response.data) }))
}

export function pauseAgentTask(id: string | number, expectedVersion: number) {
  return http.post<AgentTask>(`/agent-tasks/${id}:pause`, { expectedVersion }, mutationConfig()).then((response) => ({ ...response, data: normalizeTask(response.data) }))
}

export function resumeAgentTask(id: string | number, expectedVersion: number) {
  return http.post<AgentTask>(`/agent-tasks/${id}:resume`, { expectedVersion }, mutationConfig()).then((response) => ({ ...response, data: normalizeTask(response.data) }))
}

export function cancelAgentTask(id: string | number, expectedVersion: number) {
  return http.post<AgentTask>(`/agent-tasks/${id}:cancel`, { expectedVersion }, mutationConfig()).then((response) => ({ ...response, data: normalizeTask(response.data) }))
}

export type AgentInputAction = 'RETRY' | 'SKIP' | 'REVISE_PLAN' | 'TERMINATE'

export function provideAgentTaskInput(id: string | number, expectedVersion: number, input: string, action: AgentInputAction = 'RETRY') {
  return http.post<AgentTask>(`/agent-tasks/${id}:provide-input`, { expectedVersion, input, action }, mutationConfig()).then((response) => ({ ...response, data: normalizeTask(response.data) }))
}
