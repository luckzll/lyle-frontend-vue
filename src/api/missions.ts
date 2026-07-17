import { http } from '@/api/http'

export type MissionStatus =
  | 'DRAFT' | 'SHADOW' | 'AWAITING_APPROVAL' | 'ACTIVE' | 'PAUSED'
  | 'EXPIRED' | 'REVOKED' | 'ARCHIVED'

export interface MissionEvent {
  sequence: number
  eventType:
    | 'mission.updated'
    | 'mission.triggered'
    | 'mission.run.created'
    | 'mission.run.completed'
    | 'grant.updated'
    | 'grant.revoked'
    | 'authorization.decided'
    | 'exception.opened'
    | 'exception.resolved'
    | 'compensation.updated'
  missionId: string
  status: string
  count: number
  summary: string
  payload: Record<string, unknown>
  occurredAt: string
}

export interface GrantRule {
  id: string
  effect: 'allow' | 'deny'
  toolRefs: string[]
  operations: string[]
  resourceScope: {
    projectIds?: number[]
    workspaceIds?: number[]
  }
  allowedFields: string[]
  maxRisk: 'R0' | 'R1'
  requiresReversible: boolean
  maxCallsPerRun: number
}

export interface DelegationGrant {
  id: string
  missionId: string
  version: number
  status: string
  summary: string
  rules: GrantRule[]
  budgetPolicy: Record<string, number>
  validFrom: string
  expiresAt: string
  approvedBy?: number | null
  approvedAt?: string | null
  contentHash: string
  createdAt: string
}

export interface MissionTrigger {
  id: string
  missionId: string
  type: 'FIXED_TIME' | 'CRON_SUBSET' | 'PROJECT_STATE'
  config: Record<string, unknown>
  timezone: string
  misfirePolicy: 'SKIP' | 'RUN_ONCE'
  enabled: boolean
  nextFireAt?: string | null
  version: number
}

export interface MissionOccurrence {
  id: string
  missionId: string
  triggerId: string
  scheduledFor: string
  payload: Record<string, unknown>
  status: string
  agentTaskId?: string | null
  createdAt: string
  completedAt?: string | null
}

export interface MissionRun {
  agentTaskId: string
  status: string
  title: string
  createdAt: string
  updatedAt: string
  occurrenceId?: string | null
  scheduledFor?: string | null
  occurrenceStatus?: string | null
}

export interface AuthorizationDecision {
  id: string
  agentTaskId: string
  stepRunId?: string | null
  grantVersion: number
  toolRef: string
  operation: string
  resourceRefHash: string
  riskLevel: string
  reversibility: string
  decision: 'ALLOW' | 'REQUIRE_CONFIRMATION' | 'DENY'
  reasonCode: string
  matchedRuleId?: string | null
  createdAt: string
}

export interface Mission {
  id: string
  projectId?: string | null
  title: string
  goal: string
  completionCriteria: string[]
  constraints: Record<string, unknown>
  templateId: 'project-health' | 'research-weekly' | 'release-readiness'
  status: MissionStatus
  activeGrantVersion?: number | null
  notificationPolicy: Record<string, unknown>
  quietHours: Record<string, unknown>
  singleRunBudget: Record<string, number>
  periodBudget: Record<string, number>
  periodUsage?: {
    completedSteps: number
    toolCalls: number
    modelTokens: number
    costMicros: number
    wallTimeMillis: number
    periodStart?: string
    periodEnd?: string
  }
  periodType: string
  validFrom: string
  expiresAt: string
  nextRunAt?: string | null
  version: number
  createdAt: string
  updatedAt: string
  grants?: DelegationGrant[]
  triggers?: MissionTrigger[]
  occurrences?: MissionOccurrence[]
  recentRuns?: MissionRun[]
  recentDecisions?: AuthorizationDecision[]
  latestRun?: MissionRun | null
  availableActions?: string[]
  shadowOnly?: boolean
  grantChange?: {
    version: number
    requiresApproval: boolean
    effectiveImmediately: boolean
  }
}

export interface MissionCreateInput {
  title?: string
  goal: string
  templateId: Mission['templateId']
  projectId?: number
  workspaceId?: number
  completionCriteria?: string[]
  forbidden?: string[]
  autoMaintainTasks?: boolean
  allowFilePatch?: boolean
  writeTarget?: Record<string, unknown>
  validityDays?: number
  timezone?: string
  schedule?: Record<string, unknown>
  quietHours?: Record<string, unknown>
}

export interface ShadowDecision {
  title: string
  toolRef: string
  operation: string
  riskLevel: string
  writeIntent: boolean
  input: Record<string, unknown>
  decision: 'ALLOW' | 'REQUIRE_CONFIRMATION' | 'DENY'
  reasonCode: string
  matchedRuleId?: string | null
  reversibility: string
}

export interface ShadowResult {
  mission: Mission
  summary: { allow: number; requireConfirmation: number; deny: number }
  decisions: ShadowDecision[]
  notice: string
}

export interface MissionException {
  id: string
  missionId: string
  agentTaskId?: string | null
  type: string
  severity: string
  title: string
  summary: string
  evidenceRefs: string[]
  availableActions: string[]
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED'
  createdAt: string
  resolvedAt?: string | null
}

export interface Compensation {
  id: string
  missionId: string
  agentTaskId: string
  stepRunId: string
  toolRef: string
  operation: string
  status: string
  expiresAt: string
  requestedAt?: string | null
  completedAt?: string | null
  result?: Record<string, unknown>
}

function idempotencyKey(prefix = 'mission') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function mutationConfig(prefix?: string) {
  return { headers: { 'Idempotency-Key': idempotencyKey(prefix) } }
}

function normalizeMission(raw: any): Mission {
  return {
    ...raw,
    id: String(raw.id),
    projectId: raw.projectId == null ? null : String(raw.projectId),
    version: Number(raw.version || 0),
    activeGrantVersion: raw.activeGrantVersion == null ? null : Number(raw.activeGrantVersion),
    grants: raw.grants?.map((grant: any) => ({
      ...grant,
      id: String(grant.id),
      missionId: String(grant.missionId),
      version: Number(grant.version || 0)
    })),
    triggers: raw.triggers?.map((trigger: any) => ({
      ...trigger,
      id: String(trigger.id),
      missionId: String(trigger.missionId),
      version: Number(trigger.version || 0)
    })),
    occurrences: raw.occurrences?.map(normalizeOccurrence),
    recentRuns: raw.recentRuns?.map(normalizeRun),
    latestRun: raw.latestRun ? normalizeRun(raw.latestRun) : raw.latestRun,
    recentDecisions: raw.recentDecisions?.map(normalizeDecision)
  }
}

function normalizeOccurrence(raw: any): MissionOccurrence {
  return {
    ...raw,
    id: String(raw.id),
    missionId: String(raw.missionId),
    triggerId: String(raw.triggerId),
    agentTaskId: raw.agentTaskId == null ? null : String(raw.agentTaskId)
  }
}

function normalizeRun(raw: any): MissionRun {
  return {
    ...raw,
    agentTaskId: String(raw.agentTaskId),
    occurrenceId: raw.occurrenceId == null ? null : String(raw.occurrenceId)
  }
}

function normalizeDecision(raw: any): AuthorizationDecision {
  return {
    ...raw,
    id: String(raw.id),
    agentTaskId: String(raw.agentTaskId),
    stepRunId: raw.stepRunId == null ? null : String(raw.stepRunId),
    grantVersion: Number(raw.grantVersion || 0)
  }
}

function normalizeException(raw: any): MissionException {
  return {
    ...raw,
    id: String(raw.id),
    missionId: String(raw.missionId),
    agentTaskId: raw.agentTaskId == null ? null : String(raw.agentTaskId)
  }
}

function normalizeCompensation(raw: any): Compensation {
  return {
    ...raw,
    id: String(raw.id),
    missionId: String(raw.missionId),
    agentTaskId: String(raw.agentTaskId),
    stepRunId: String(raw.stepRunId)
  }
}

export function createMission(input: MissionCreateInput) {
  return http.post<Mission>('/missions', input, mutationConfig('mission-create')).then((response) => ({
    ...response,
    data: normalizeMission(response.data)
  }))
}

export function listMissions(params: { status?: MissionStatus; limit?: number } = {}) {
  return http.get<{ items: Mission[] }>('/missions', { params }).then((response) => ({
    ...response,
    data: { items: response.data.items.map(normalizeMission) }
  }))
}

export function getMission(id: string | number) {
  return http.get<Mission>(`/missions/${id}`).then((response) => ({
    ...response,
    data: normalizeMission(response.data)
  }))
}

export function shadowMission(id: string | number, expectedVersion: number, grantVersion?: number) {
  return http.post<ShadowResult>(`/missions/${id}:shadow`, {
    expectedVersion,
    ...(grantVersion ? { grantVersion } : {})
  }, mutationConfig('mission-shadow')).then((response) => ({
    ...response,
    data: { ...response.data, mission: normalizeMission(response.data.mission) }
  }))
}

export function submitMissionApproval(id: string | number, expectedVersion: number, grantVersion: number) {
  return http.post<Mission>(`/missions/${id}:activate`, {
    expectedVersion,
    grantVersion
  }, mutationConfig('mission-submit')).then((response) => ({
    ...response,
    data: normalizeMission(response.data)
  }))
}

export function approveMissionGrant(id: string | number, version: number, expectedVersion: number) {
  return http.post<Mission>(`/missions/${id}/grants/${version}:approve`, {
    expectedVersion
  }, mutationConfig('grant-approve')).then((response) => ({
    ...response,
    data: normalizeMission(response.data)
  }))
}

export function pauseMission(id: string | number, expectedVersion: number) {
  return missionStateMutation(id, 'pause', expectedVersion)
}

export function resumeMission(id: string | number, expectedVersion: number) {
  return missionStateMutation(id, 'resume', expectedVersion)
}

export function revokeMission(id: string | number, expectedVersion: number) {
  return missionStateMutation(id, 'revoke', expectedVersion)
}

function missionStateMutation(id: string | number, action: string, expectedVersion: number) {
  return http.post<Mission>(`/missions/${id}:${action}`, {
    expectedVersion
  }, mutationConfig(`mission-${action}`)).then((response) => ({
    ...response,
    data: normalizeMission(response.data)
  }))
}

export function runMissionNow(id: string | number) {
  return http.post<Record<string, unknown>>(`/missions/${id}:run-now`, {}, mutationConfig('mission-run'))
}

export function createMissionGrant(id: string | number, expectedVersion: number, input: {
  summary: string
  rules: GrantRule[]
  budgetPolicy: Record<string, number>
  expiresAt?: string
}) {
  return http.post<Mission>(`/missions/${id}/grants`, {
    ...input,
    expectedVersion
  }, mutationConfig('grant-create')).then((response) => ({
    ...response,
    data: normalizeMission(response.data)
  }))
}

export function updateMission(id: string | number, expectedVersion: number, input: {
  title?: string
  goal?: string
  completionCriteria?: string[]
  constraints?: Record<string, unknown>
  notificationPolicy?: Record<string, unknown>
  quietHours?: Record<string, unknown>
}) {
  return http.put<Mission>(`/missions/${id}`, {
    ...input,
    expectedVersion
  }, mutationConfig('mission-update')).then((response) => ({
    ...response,
    data: normalizeMission(response.data)
  }))
}

export function updateMissionTrigger(
  missionId: string | number,
  triggerId: string | number,
  expectedVersion: number,
  input: {
    triggerVersion: number
    type?: MissionTrigger['type']
    config?: Record<string, unknown>
    timezone?: string
    misfirePolicy?: MissionTrigger['misfirePolicy']
    enabled?: boolean
  }
) {
  return http.put<MissionTrigger>(`/missions/${missionId}/triggers/${triggerId}`, {
    ...input,
    expectedVersion
  }, mutationConfig('trigger-update'))
}

export function disableMissionTrigger(
  missionId: string | number,
  triggerId: string | number,
  expectedVersion: number,
  triggerVersion: number
) {
  return http.delete<MissionTrigger>(`/missions/${missionId}/triggers/${triggerId}`, {
    params: { expectedVersion, triggerVersion },
    ...mutationConfig('trigger-disable')
  })
}

export function getMissionDigest(limit = 20) {
  return http.get<{
    items: Array<{
      missionId: string
      title: string
      status: MissionStatus
      summary: string
      completedRuns: number
      attentionCount: number
      evidenceRefs: string[]
      periodUsage: Record<string, number>
      nearBudget: boolean
      nextRunAt?: string | null
      expiresAt: string
    }>
    completedRuns: number
    attentionCount: number
  }>('/missions/digest', { params: { limit } })
}

export function listMissionExceptions(params: { status?: string; limit?: number } = {}) {
  return http.get<{ items: MissionException[] }>('/exceptions', { params }).then((response) => ({
    ...response,
    data: { items: response.data.items.map(normalizeException) }
  }))
}

export function getMissionException(id: string | number) {
  return http.get<MissionException>(`/exceptions/${id}`).then((response) => ({
    ...response,
    data: normalizeException(response.data)
  }))
}

export function acknowledgeMissionException(id: string | number) {
  return http.post<MissionException>(`/exceptions/${id}:acknowledge`, {}, mutationConfig('exception-ack')).then((response) => ({
    ...response,
    data: normalizeException(response.data)
  }))
}

export function resolveMissionException(id: string | number, action: string) {
  return http.post<MissionException>(`/exceptions/${id}:resolve`, { action }, mutationConfig('exception-resolve')).then((response) => ({
    ...response,
    data: normalizeException(response.data)
  }))
}

export function dismissMissionException(id: string | number) {
  return http.post<MissionException>(`/exceptions/${id}:dismiss`, {}, mutationConfig('exception-dismiss')).then((response) => ({
    ...response,
    data: normalizeException(response.data)
  }))
}

export function getCompensation(stepRunId: string | number) {
  return http.get<Compensation>(`/agent-actions/${stepRunId}/compensation`).then((response) => ({
    ...response,
    data: normalizeCompensation(response.data)
  }))
}

export function compensateAgentAction(stepRunId: string | number) {
  return http.post<Compensation>(`/agent-actions/${stepRunId}:compensate`, {}, mutationConfig('compensate')).then((response) => ({
    ...response,
    data: normalizeCompensation(response.data)
  }))
}
