import { http, publicHttp } from './http'
import type { MemorySchemaStatus } from './types'
import type { MemoryFact } from './types'
import { getAuthToken } from '@/auth'
import { sanitizeAgentStep, type AgentStepEvent } from '@/domain/chat-progress'
import { sanitizeReasoningDelta, type ChatReasoning, type ReasoningDelta } from '@/domain/chat-reasoning'
import { sanitizeToolCall, type ChatToolCall } from '@/domain/chat-tool-calls'
import type { ProcessTimelineEntry } from '@/domain/chat-process-timeline'
import type { AttachmentFolderMetadata, ChatAttachment, ChatAttachmentKind } from '@/domain/chat-attachment'
import type {
  AdminOverview,
  AgentPlan,
  AgentCalendarItem,
  AgentReminderItem,
  AgentTodoItem,
  AiConfigItem,
  AiMetricsResponse,
  AiToolAuditResponse,
  AiToolsResponse,
  AuditLog,
  AuthResponse,
  ChatMessage,
  ChatResponse,
  ChatSource,
  ConnectorInfo,
  ConnectorResult,
  Conversation,
  DailyBriefing,
  EvaluationBatchResponse,
  EvaluationCase,
  EvaluationRunDetail,
  EvaluationRunItem,
  EvaluationRunReport,
  EvaluationSetDetail,
  EvaluationSetItem,
  EvaluationTrendResponse,
  ExperienceAnalytics,
  Goal,
  ImageUploadResponse,
  KnowledgeFileUploadResponse,
  KnowledgeBase,
  KnowledgeFile,
  MemoryItem,
  MemoryRecord,
  MemorySource,
  MemoryInboxItem,
  MemoryConflict,
  MemoryGovernanceEvent,
  MemoryPurgeJob,
  UsedMemory,
  MemoryExclusions,
  MemorySnapshot,
  OperationConfirmResponse,
  PageResponse,
  PendingOperationItem,
  PromptTemplate,
  PromptTemplateResponse,
  Project,
  ProjectDecision,
  ProjectLink,
  ProjectOpenQuestion,
  ProjectOverview,
  RagChunkResponse,
  RagDebugResponse,
  StructuredMemoryHistoryItem,
  StructuredMemoryMergeSuggestion,
  User
} from './types'
import type {
  AutomationDraft,
  AutomationSummary,
  AutomationTemplate,
  AutomationUpdatePayload,
  ConfirmationInboxItem,
  ConnectionDiagnostic,
  EffectiveProgressEventPayload,
  ExecutionResultListParams,
  ExecutionResultPage,
  ExecutionResultSummary
} from './types'

export type StreamMeta = {
  toolCalls?: ChatToolCall[]
  processTimeline?: ProcessTimelineEntry[]
  agentProgress?: AgentStepEvent[]
  reasoning?: ChatReasoning
  processStartedAt?: number
  processCompletedAt?: number
  sources?: ChatSource[]
  agentTrace?: ChatResponse['agentTrace']
  toolResults?: ChatResponse['toolResults']
  candidateMemories?: MemoryItem[]
  candidateTasks?: ChatResponse['candidateTasks']
  candidateGoals?: ChatResponse['candidateGoals']
  candidateDecisions?: ChatResponse['candidateDecisions']
  candidateOpenQuestions?: ChatResponse['candidateOpenQuestions']
  candidatePlans?: ChatResponse['candidatePlans']
  executionSuggestions?: ChatResponse['executionSuggestions']
  projectContext?: ChatResponse['projectContext']
  review?: ChatResponse['review']
  usage?: ChatResponse['usage']
  usedMemories?: UsedMemory[]
  memoryExclusions?: MemoryExclusions
  memoryExplanationVersion?: string
  debugVersion?: ChatResponse['debugVersion']
  knowledgeBaseIds?: ChatResponse['knowledgeBaseIds']
  retrievalScope?: ChatResponse['retrievalScope']
  debugTruncated?: ChatResponse['debugTruncated']
}

export type SseHandlers = {
  onOpen?: () => void
  onDelta: (chunk: string) => void
  onMeta?: (meta: StreamMeta) => void
  onTurnStatus?: (event: TurnStatusEvent) => void
  onAgentStep?: (event: AgentStepEvent) => void
  onToolCall?: (event: ChatToolCall) => void
  onReasoningDelta?: (event: ReasoningDelta) => void
  onImageBatchStarted?: (event: ImageBatchStartedEvent) => void
  onImageItem?: (event: ImageItemEvent) => void
  onImageBatchCompleted?: (event: ImageBatchCompletedEvent) => void
  onError?: (message: string) => void
  onDone?: () => void
}

export class HttpStreamError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'HttpStreamError'
  }
}

export type TurnStatusEvent = {
  turnId: string
  phase: 'THINKING' | 'ANALYZING' | 'GENERATING' | 'RESPONDING' | 'COMPLETED' | 'FAILED'
  message: string
  processStartedAt?: number
  processCompletedAt?: number
}

export type ImageBatchItem = {
  index: number
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  imageUrl?: string
  error?: string
}

export type ImageBatchStartedEvent = {
  turnId: string
  batchId: string
  count: number
  mode: 'generate' | 'edit'
  concurrency: number
  referenceCount: number
  items: ImageBatchItem[]
}

export type ImageItemEvent = ImageBatchItem & {
  turnId: string
  batchId: string
  count: number
  completedCount: number
}

export type ImageBatchCompletedEvent = {
  turnId: string
  batchId: string
  status: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED'
  count: number
  completedCount: number
  failedCount: number
}

export function register(username: string, password: string) {
  return http.post<AuthResponse>('/auth/register', { username, password })
}

export function login(username: string, password: string) {
  return http.post<AuthResponse>('/auth/login', { username, password })
}

export type RuntimeFeatures = {
  authLoginV63Enabled: boolean
  chatWorkspaceDropEnabled: boolean
  chatFolderAttachmentsEnabled: boolean
}

export function getRuntimeFeatures() {
  return publicHttp.get<RuntimeFeatures>('/runtime-config')
}

export function uploadChatImage(file: File) {
  const form = new FormData()
  form.append('file', file)
  return http.post<ImageUploadResponse>('/uploads/images', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

export function uploadChatAttachment(file: File, kind: ChatAttachmentKind, metadata?: AttachmentFolderMetadata) {
  const form = new FormData()
  form.append('file', file)
  form.append('kind', kind)
  if (metadata?.sourceType) form.append('sourceType', metadata.sourceType)
  if (metadata?.folderGroupId) form.append('folderGroupId', metadata.folderGroupId)
  if (metadata?.folderRoot) form.append('folderRoot', metadata.folderRoot)
  if (metadata?.relativePath) form.append('relativePath', metadata.relativePath)
  return http.post<ChatAttachment>('/chat/attachments', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

export function deleteChatAttachment(attachmentId: string) {
  return http.delete(`/chat/attachments/${encodeURIComponent(attachmentId)}`)
}

export function createConversation(title: string) {
  return http.post<Conversation>('/conversations', { title })
}

export function listConversations() {
  return http.get<Conversation[]>('/conversations')
}

export function updateConversationTitle(conversationId: string, title: string) {
  return http.patch<Conversation>(`/conversations/${conversationId}`, { title })
}

export function deleteConversation(conversationId: string) {
  return http.delete(`/conversations/${conversationId}`)
}

export function createKnowledgeBase(name: string) {
  return http.post<KnowledgeBase>('/knowledge-bases', { name })
}

export function listKnowledgeBases() {
  return http.get<KnowledgeBase[]>('/knowledge-bases')
}

export function updateKnowledgeBase(knowledgeBaseId: string, name: string) {
  return http.patch<KnowledgeBase>(`/knowledge-bases/${knowledgeBaseId}`, { name })
}

export function deleteKnowledgeBase(knowledgeBaseId: string) {
  return http.delete(`/knowledge-bases/${knowledgeBaseId}`)
}

export function uploadKnowledgeFile(knowledgeBaseId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return http.post<KnowledgeFileUploadResponse>(`/knowledge-bases/${knowledgeBaseId}/files`, form)
}

export function listKnowledgeFiles(knowledgeBaseId: string) {
  return http.get<KnowledgeFile[]>(`/knowledge-bases/${knowledgeBaseId}/files`)
}

export function deleteKnowledgeFile(knowledgeBaseId: string, fileId: string) {
  return http.delete(`/knowledge-bases/${knowledgeBaseId}/files/${fileId}`)
}

export function listProjects(status = 'active', limit = 100) {
  return http.get<{ items: Project[] }>('/projects', {
    params: { status, limit }
  })
}

export function createProject(payload: {
  name: string
  description?: string
  currentStage?: string
  priority?: number
}) {
  return http.post<Project>('/projects', payload)
}

export function getProject(projectId: number) {
  return http.get<Project>(`/projects/${projectId}`)
}

export function updateProject(projectId: number, payload: Partial<Project>) {
  return http.patch<Project>(`/projects/${projectId}`, payload)
}

export function getProjectOverview(projectId: number) {
  return http.get<ProjectOverview>(`/projects/${projectId}/overview`)
}

export function listProjectLinks(projectId: number, targetType?: string, limit = 100) {
  return http.get<{ items: ProjectLink[] }>(`/projects/${projectId}/links`, {
    params: { ...(targetType ? { targetType } : {}), limit }
  })
}

export function createProjectLink(projectId: number, payload: {
  targetType: string
  targetId: string
  relation?: string
  confidence?: number
}) {
  return http.post<ProjectLink>(`/projects/${projectId}/links`, payload)
}

export function deleteProjectLink(projectId: number, linkId: number) {
  return http.delete(`/projects/${projectId}/links/${linkId}`)
}

export function createProjectDecision(projectId: number, payload: {
  title: string
  content: string
  rationale?: string
  sourceType?: string
  sourceId?: string
}) {
  return http.post<ProjectDecision>(`/projects/${projectId}/decisions`, payload)
}

export function createProjectOpenQuestion(projectId: number, payload: {
  question: string
  sourceType?: string
  sourceId?: string
}) {
  return http.post<ProjectOpenQuestion>(`/projects/${projectId}/open-questions`, payload)
}

export function updateProjectOpenQuestion(questionId: number, status: string) {
  return http.patch<ProjectOpenQuestion>(`/projects/open-questions/${questionId}`, { status })
}

export function listGoals(projectId?: number, status = 'active', limit = 100) {
  return http.get<{ items: Goal[] }>('/goals', {
    params: { ...(projectId ? { projectId } : {}), status, limit }
  })
}

export function createGoal(payload: {
  projectId?: number
  title: string
  description?: string
  horizon?: string
  dueAt?: string | null
}) {
  return http.post<Goal>('/goals', payload)
}

export function updateGoal(goalId: number, payload: Partial<Goal>) {
  return http.patch<Goal>(`/goals/${goalId}`, payload)
}

export function createMilestone(goalId: number, payload: {
  title: string
  description?: string
  status?: string
  sortOrder?: number
  dueAt?: string | null
}) {
  return http.post(`/goals/${goalId}/milestones`, payload)
}

export function linkTaskToGoal(goalId: number, taskId: string, milestoneId?: number | null) {
  return http.post(`/goals/${goalId}/tasks/${encodeURIComponent(taskId)}/link`, { milestoneId })
}

export function listAgentPlans(projectId?: number, status?: string, limit = 100) {
  return http.get<{ items: AgentPlan[] }>('/agent/plans', {
    params: { ...(projectId ? { projectId } : {}), ...(status ? { status } : {}), limit }
  })
}

export function createAgentPlan(payload: {
  projectId?: number
  conversationId?: string
  title: string
  objective: string
  steps?: Array<{ title: string; description?: string; toolName?: string }>
}) {
  return http.post<AgentPlan>('/agent/plans', payload)
}

export function confirmAgentPlan(planId: number) {
  return http.post<AgentPlan>(`/agent/plans/${planId}/confirm`)
}

export function pauseAgentPlan(planId: number) {
  return http.post<AgentPlan>(`/agent/plans/${planId}/pause`)
}

export function resumeAgentPlan(planId: number) {
  return http.post<AgentPlan>(`/agent/plans/${planId}/resume`)
}

export function cancelAgentPlan(planId: number) {
  return http.post<AgentPlan>(`/agent/plans/${planId}/cancel`)
}

export function getTodayBriefing(projectId?: number) {
  return http.get<DailyBriefing>('/briefings/today', {
    params: { ...(projectId ? { projectId } : {}) }
  })
}

export function generateDailyBriefing(projectId?: number) {
  return http.post<DailyBriefing>('/briefings/daily/generate', undefined, {
    params: { ...(projectId ? { projectId } : {}) }
  })
}

export function generateEveningBriefing(projectId?: number) {
  return http.post<DailyBriefing>('/briefings/evening/generate', undefined, {
    params: { ...(projectId ? { projectId } : {}) }
  })
}

export function generateWeeklyBriefing(projectId?: number) {
  return http.post<DailyBriefing>('/briefings/weekly/generate', undefined, {
    params: { ...(projectId ? { projectId } : {}) }
  })
}

export function listConnectors() {
  return http.get<{ items: ConnectorInfo[] }>('/connectors')
}

export function listConnectorResources(connectorName: string, params: {
  repo?: string
  state?: string
  limit?: number
} = {}) {
  return http.get<ConnectorResult>(`/connectors/${connectorName}/list`, { params })
}

export function searchConnector(connectorName: string, params: {
  q: string
  repo?: string
  limit?: number
}) {
  return http.get<ConnectorResult>(`/connectors/${connectorName}/search`, { params })
}

export function previewConnectorCreate(connectorName: string, payload: Record<string, unknown>) {
  return http.post<ConnectorResult>(`/connectors/${connectorName}/preview-create`, payload)
}

export function rebuildKnowledgeFile(knowledgeBaseId: string, fileId: string) {
  return http.post<KnowledgeFileUploadResponse>(`/knowledge-bases/${knowledgeBaseId}/files/${fileId}/rebuild`)
}

export function rebuildKnowledgeBaseFiles(knowledgeBaseId: string) {
  return http.post<KnowledgeFileUploadResponse[]>(`/knowledge-bases/${knowledgeBaseId}/files/rebuild`)
}

export function sendMessage(payload: {
  conversationId?: string
  projectId?: number
  message: string
  knowledgeBaseIds: string[]
  modelId?: string
}) {
  return http.post<ChatResponse>('/chat/send', payload)
}

export function listChatMessages(conversationId: string) {
  return http.get<ChatMessage[]>(`/chat/messages/${conversationId}`)
}

export function cancelChatTurn(conversationId: string, turnId: string) {
  return http.post<ChatMessage>(
    `/chat/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/cancel`
  )
}

export function getCurrentMemory(conversationId?: string) {
  return http.get<MemorySnapshot>('/memory/current', {
    params: conversationId ? { conversationId } : {}
  })
}

export function getMemoryRecords(params: { status?: string; query?: string; limit?: number } = {}) {
  return http.get<{ items: MemoryRecord[]; nextCursor?: string | null }>('/memory/records', {
    params: { ...params, limit: params.limit ?? 100 }
  })
}

export function getMemorySchemaStatus() {
  return http.get<MemorySchemaStatus>('/memory/schema')
}

export function getMemoryFacts() {
  return http.get<{ items: MemoryFact[]; migration: { conflicts: string[]; unmappedKeys?: string[] } }>('/memory/facts')
}

export function reviseMemoryFact(fact: MemoryFact, status: 'active' | 'disabled') {
  return http.put<MemoryFact>(`/memory/facts/${encodeURIComponent(fact.factId)}`, {
    expectedRevision: fact.revision, status
  })
}

export function rebuildMemorySchema() {
  return http.post<MemorySchemaStatus>('/memory/schema/rebuild', {})
}

export function getMemoryRecord(memoryId: string) {
  return http.get<MemoryRecord>(`/memory/records/${encodeURIComponent(memoryId)}`)
}

export function getMemoryRecordSources(memoryId: string) {
  return http.get<{ items: MemorySource[] }>(`/memory/records/${encodeURIComponent(memoryId)}/sources`)
}

export function getMemoryInbox() {
  return http.get<{ items: MemoryInboxItem[]; count: number }>('/memory/inbox')
}

export function getMemoryGovernanceEvents() {
  return http.get<{ items: MemoryGovernanceEvent[]; nextCursor?: string | null }>('/memory/governance-events')
}

export function correctMemoryRecord(memoryId: string, value: string, reason?: string) {
  return http.post<{ memory: MemoryRecord; governanceEventId: number }>(
    `/memory/records/${encodeURIComponent(memoryId)}:correct`,
    { value, reason, clientRequestId: crypto.randomUUID() }
  )
}

export function governMemoryRecord(
  memoryId: string,
  action: 'disable' | 'restore' | 'forget',
  reason?: string
) {
  return http.post<{ memory: MemoryRecord; governanceEventId: number }>(
    `/memory/records/${encodeURIComponent(memoryId)}:${action}`,
    { reason, clientRequestId: crypto.randomUUID() }
  )
}

export function purgeMemoryRecord(memoryId: string) {
  return http.post<MemoryPurgeJob>(
    `/memory/records/${encodeURIComponent(memoryId)}:purge`,
    { clientRequestId: crypto.randomUUID() }
  )
}

export function getMemoryPurgeJob(jobId: number) {
  return http.get<MemoryPurgeJob>(`/memory/purge-jobs/${jobId}`)
}

export function retryMemoryPurgeJob(jobId: number) {
  return http.post<MemoryPurgeJob>(`/memory/purge-jobs/${jobId}:retry`)
}

export function resolveMemoryConflict(
  conflict: MemoryConflict,
  resolution: 'KEEP_CURRENT' | 'USE_CANDIDATE' | 'MERGE' | 'USE_NEITHER' | 'FORGET',
  mergedValue?: string
) {
  return http.post<{ conflict: MemoryConflict; memory?: MemoryRecord; governanceEventId: number }>(
    `/memory/conflicts/${conflict.id}:resolve`,
    {
      resolution,
      mergedValue: mergedValue || null,
      expectedVersion: conflict.version,
      clientRequestId: crypto.randomUUID()
    }
  )
}

export function saveStructuredMemory(key: string, value: string, confidence = 1, source = 'manual') {
  return http.put<MemoryItem>('/memory/structured', { key, value, confidence, source })
}

export function deleteStructuredMemory(key: string) {
  return http.delete(`/memory/structured/${encodeURIComponent(key)}`)
}

export function purgeStructuredMemory(key: string) {
  return http.delete(`/memory/structured/${encodeURIComponent(key)}/purge`)
}

export function changeStructuredMemoryStatus(key: string, status: string) {
  return http.put<MemoryItem>(`/memory/structured/${encodeURIComponent(key)}/status`, { status })
}

export function getStructuredMemoryHistory(key: string, limit = 30) {
  return http.get<{ items: StructuredMemoryHistoryItem[] }>(`/memory/structured/${encodeURIComponent(key)}/history`, {
    params: { limit }
  })
}

export function getStructuredMemoryMergeSuggestions() {
  return http.get<{ items: StructuredMemoryMergeSuggestion[] }>('/memory/structured/merge-suggestions')
}

export function getMemoryProfiles(status?: string, limit = 200) {
  return http.get<{ items: MemoryItem[] }>('/memory/profiles', {
    params: { ...(status ? { status } : {}), limit }
  })
}

export function getMemoryFragments(status?: string, category?: string, limit = 200) {
  return http.get<{ items: MemoryItem[] }>('/memory/fragments', {
    params: { ...(status ? { status } : {}), ...(category ? { category } : {}), limit }
  })
}

export function getProfileEvidence(profileId: number, limit = 100) {
  return http.get<{ items: MemoryItem[] }>(`/memory/profiles/${profileId}/evidence`, {
    params: { limit }
  })
}

export function changeProfileStatus(schemaPath: string, status: string) {
  return http.put<MemoryItem>(`/memory/profiles/schema-path/${encodeURIComponent(schemaPath)}/status`, { status })
}

export function changeFragmentStatus(fragmentId: number, status: string) {
  return http.put<MemoryItem>(`/memory/fragments/${fragmentId}/status`, { status })
}

export function getMe() {
  return http.get<User>('/users/me')
}

export interface AuthSessionInfo {
  createdAt: string
  lastUsedAt: string
  expiresAt: string
  current: boolean
}

export function getAuthSession() {
  return http.get<AuthSessionInfo>('/auth/session')
}

export function changePassword(currentPassword: string, newPassword: string) {
  return http.post<AuthResponse>('/auth/change-password', { currentPassword, newPassword })
}

export function getAdminOverview() {
  return http.get<AdminOverview>('/admin/overview')
}

export function listAuditLogs(page = 1, size = 20) {
  return http.get<PageResponse<AuditLog>>('/admin/audit-logs', {
    params: { page, size }
  })
}

export function listAiConfigs() {
  return http.get<AiConfigItem[]>('/admin/ai/config')
}

export function updateAiConfig(key: string, value: string) {
  return http.put<AiConfigItem>('/admin/ai/config', { key, value })
}

export function getAiMetrics() {
  return http.get<AiMetricsResponse>('/admin/ai/metrics')
}

export function getExperienceAnalytics(days = 7) {
  return http.get<ExperienceAnalytics>('/admin/experience/analytics', { params: { days } })
}

export function getAiTools() {
  return http.get<AiToolsResponse>('/admin/ai/tools')
}

export function getAiToolAudit(limit = 50) {
  return http.get<AiToolAuditResponse>('/admin/ai/tools/audit', {
    params: { limit }
  })
}

export function listPendingOperations(limit = 50) {
  return http.get<{ items: PendingOperationItem[] }>('/agent-tools/operations', {
    params: { limit }
  })
}

export function confirmPendingOperation(operationId: number) {
  return http.post<OperationConfirmResponse>(`/agent-tools/operations/${operationId}/confirm`)
}

export function rejectPendingOperation(operationId: number) {
  return http.post<{ operation: PendingOperationItem }>(`/agent-tools/operations/${operationId}/reject`)
}

export function listAgentTodos(limit = 50) {
  return http.get<{ items: AgentTodoItem[] }>('/agent-tools/todos', {
    params: { limit }
  })
}

export function createAgentTodo(title: string, dueAt?: string | null, conversationId?: string) {
  return http.post<AgentTodoItem>('/agent-tools/todos', { title, dueAt, conversationId })
}

export function updateAgentTodoStatus(todoId: number, status: string) {
  return http.patch<AgentTodoItem>(`/agent-tools/todos/${todoId}/status`, { status })
}

export function updateAgentTodoDueAt(todoId: number, dueAt?: string | null) {
  return http.patch<AgentTodoItem>(`/agent-tools/todos/${todoId}/due-at`, { dueAt })
}

export function deleteAgentTodo(todoId: number) {
  return http.delete(`/agent-tools/todos/${todoId}`)
}

export function listAgentCalendar(limit = 50) {
  return http.get<{ items: AgentCalendarItem[] }>('/agent-tools/calendar', {
    params: { limit }
  })
}

export function updateAgentCalendarStatus(eventId: number, status: string) {
  return http.patch<AgentCalendarItem>(`/agent-tools/calendar/${eventId}/status`, { status })
}

export function deleteAgentCalendar(eventId: number) {
  return http.delete(`/agent-tools/calendar/${eventId}`)
}

export function listAgentReminders(limit = 50) {
  return http.get<{ items: AgentReminderItem[] }>('/agent-tools/reminders', {
    params: { limit }
  })
}

export function markAgentReminderRead(notificationId: number) {
  return http.patch<AgentReminderItem>(`/agent-tools/reminders/${notificationId}/read`)
}

export function evaluateBatch(cases: EvaluationCase[], name?: string) {
  return http.post<EvaluationBatchResponse>('/evaluation/batch', { cases, name })
}

export function listEvaluationRuns(limit = 20) {
  return http.get<{ items: EvaluationRunItem[] }>('/evaluation/runs', {
    params: { limit }
  })
}

export function getEvaluationRun(runId: number) {
  return http.get<EvaluationRunDetail>(`/evaluation/runs/${runId}`)
}

export function getEvaluationRunReport(runId: number) {
  return http.get<EvaluationRunReport>(`/evaluation/runs/${runId}/report`)
}

export function getEvaluationTrends(limit = 50) {
  return http.get<EvaluationTrendResponse>('/evaluation/trends', {
    params: { limit }
  })
}

export function listEvaluationSets(limit = 20) {
  return http.get<{ items: EvaluationSetItem[] }>('/evaluation/sets', {
    params: { limit }
  })
}

export function saveEvaluationSet(name: string, description: string, cases: EvaluationCase[]) {
  return http.post<EvaluationSetItem>('/evaluation/sets', { name, description, cases })
}

export function updateEvaluationSet(setId: number, name: string, description: string, cases: EvaluationCase[]) {
  return http.put<EvaluationSetItem>(`/evaluation/sets/${setId}`, { name, description, cases })
}

export function deleteEvaluationSet(setId: number) {
  return http.delete(`/evaluation/sets/${setId}`)
}

export function getEvaluationSet(setId: number) {
  return http.get<EvaluationSetDetail>(`/evaluation/sets/${setId}`)
}

export function runEvaluationSet(setId: number, badcasesOnly = false) {
  return http.post<EvaluationBatchResponse>(`/evaluation/sets/${setId}/run`, undefined, {
    params: { badcasesOnly }
  })
}

export function listPrompts(limit = 50) {
  return http.get<PromptTemplateResponse>('/prompts', {
    params: { limit }
  })
}

export function savePrompt(payload: {
  name: string
  version: string
  systemPrompt: string
  status: string
  trafficPercent: number
}) {
  return http.post<PromptTemplate>('/prompts', payload)
}

export function activatePrompt(promptId: number) {
  return http.post<PromptTemplate>(`/prompts/${promptId}/activate`)
}

export function debugRag(question: string, knowledgeBaseIds: string[]) {
  return http.post<RagDebugResponse>('/rag/debug', { question, knowledgeBaseIds })
}

export function listRagChunks(knowledgeBaseId?: string, limit = 50) {
  return http.get<RagChunkResponse>('/rag/chunks', {
    params: { knowledgeBaseId, limit }
  })
}

export async function streamMessage(
  payload: {
    conversationId?: string
    turnId?: string
    projectId?: number
    message: string
    knowledgeBaseIds: string[]
    attachmentIds?: string[]
    retry?: boolean
    modelId?: string
  },
  handlers: SseHandlers,
  options: { signal?: AbortSignal } = {}
) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAuthToken()}`
    },
    body: JSON.stringify(payload),
    signal: options.signal
  })

  if (!response.ok || !response.body) {
    let message = `Chat stream failed: ${response.status}`
    try {
      const payload = await response.json()
      message = String(payload?.message || payload?.detail || message)
    } catch {
      // Preserve the stable fallback when the server did not return JSON.
    }
    throw new HttpStreamError(message, response.status)
  }

  handlers.onOpen?.()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    buffer = consumeSseBuffer(buffer, handlers)
  }

  const tail = decoder.decode()
  if (tail) {
    buffer += tail
    consumeSseBuffer(buffer, handlers)
  }
}

export function consumeSseBuffer(buffer: string, handlers: SseHandlers) {
  let boundary = /\r?\n\r?\n/.exec(buffer)
  while (boundary) {
    const block = buffer.slice(0, boundary.index)
    buffer = buffer.slice(boundary.index + boundary[0].length)
    handleSseBlock(block, handlers)
    boundary = /\r?\n\r?\n/.exec(buffer)
  }
  return buffer
}

export function handleSseBlock(block: string, handlers: SseHandlers) {
  const lines = block.split(/\r?\n/)
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
  if (!event || event === 'heartbeat' || event === 'ping') return
  const dataText = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n')
  const data = dataText ? JSON.parse(dataText) : {}

  if (event === 'delta') {
    handlers.onDelta(String(data.text ?? ''))
  } else if (event === 'meta') {
    handlers.onMeta?.(data)
    // Replayed turns carry their accepted steps in metadata instead of separate live frames.
    for (const item of Array.isArray(data.agentProgress) ? data.agentProgress : []) {
      const step = sanitizeAgentStep(item)
      if (step) handlers.onAgentStep?.(step)
    }
    for (const item of Array.isArray(data.toolCalls) ? data.toolCalls : []) {
      const call = sanitizeToolCall(item)
      if (call) handlers.onToolCall?.(call)
    }
  } else if (event === 'turn.status') {
    handlers.onTurnStatus?.(data as TurnStatusEvent)
  } else if (event === 'agent.step') {
    const step = sanitizeAgentStep(data)
    if (step) handlers.onAgentStep?.(step)
  } else if (event === 'tool.call') {
    const call = sanitizeToolCall(data)
    if (call) handlers.onToolCall?.(call)
  } else if (event === 'reasoning.delta') {
    const reasoning = sanitizeReasoningDelta(data)
    if (reasoning) handlers.onReasoningDelta?.(reasoning)
  } else if (event === 'image.batch.started') {
    handlers.onImageBatchStarted?.(data as ImageBatchStartedEvent)
  } else if (event === 'image.item.completed' || event === 'image.item.failed') {
    handlers.onImageItem?.(data as ImageItemEvent)
  } else if (event === 'image.batch.completed') {
    handlers.onImageBatchCompleted?.(data as ImageBatchCompletedEvent)
  } else if (event === 'error') {
    handlers.onError?.(String(data.message ?? '流式请求失败'))
  } else if (event === 'done') {
    handlers.onDone?.()
  }
}

export type ApiList<T = Record<string, unknown>> = { items: T[] }

export function listMcpServers() {
  return http.get<ApiList>('/workbench/mcp/servers')
}

export function createMcpServer(payload: Record<string, unknown>) {
  return http.post<Record<string, unknown>>('/workbench/mcp/servers', payload)
}

export function updateMcpServerStatus(serverId: number, status: 'enabled' | 'disabled') {
  return http.patch<Record<string, unknown>>(`/workbench/mcp/servers/${serverId}/status`, { status })
}

export function checkMcpServer(serverId: number) {
  return http.post<Record<string, unknown>>(`/workbench/mcp/servers/${serverId}/health-check`, {})
}

export function syncMcpTools(serverId: number, tools: Array<Record<string, unknown>> = []) {
  return http.post<ApiList>(`/workbench/mcp/servers/${serverId}/tools/sync`, { tools })
}

export function listMcpTools() {
  return http.get<ApiList>('/workbench/mcp/tools')
}

export function invokeMcpTool(toolId: number, payload: Record<string, unknown>) {
  return http.post<Record<string, unknown>>(`/workbench/mcp/tools/${toolId}/invoke`, payload)
}

export function updateMcpToolPolicy(toolId: number, payload: Record<string, unknown>) {
  return http.patch<Record<string, unknown>>(`/workbench/mcp/tools/${toolId}/policy`, payload)
}

export function listWorkspaces() {
  return http.get<ApiList>('/workbench/workspaces')
}

export function createWorkspace(payload: Record<string, unknown>) {
  return http.post<Record<string, unknown>>('/workbench/workspaces', payload)
}

export function listWorkspacePolicies(workspaceId: number) {
  return http.get<ApiList>(`/workbench/workspaces/${workspaceId}/policies`)
}

export function createWorkspacePolicy(workspaceId: number, payload: Record<string, unknown>) {
  return http.post<Record<string, unknown>>(`/workbench/workspaces/${workspaceId}/policies`, payload)
}

export function deleteWorkspacePolicy(workspaceId: number, policyId: number) {
  return http.delete<Record<string, unknown>>(`/workbench/workspaces/${workspaceId}/policies/${policyId}`)
}

export function previewCommand(workspaceId: number, command: string) {
  return http.post<Record<string, unknown>>(`/workbench/workspaces/${workspaceId}/commands/preview`, { command })
}

export function runCommand(workspaceId: number, command: string, confirmed = false, secondConfirmed = false) {
  return http.post<Record<string, unknown>>(`/workbench/workspaces/${workspaceId}/commands/run`, {
    command,
    confirmed,
    secondConfirmed
  })
}

export function listCommandRuns(workspaceId: number, limit = 50) {
  return http.get<ApiList>(`/workbench/workspaces/${workspaceId}/commands`, { params: { limit } })
}

export function listWorkflows() {
  return http.get<ApiList>('/workbench/workflows')
}

export function createWorkflow(payload: Record<string, unknown>) {
  return http.post<Record<string, unknown>>('/workbench/workflows', payload)
}

export function createWorkflowFromPlan(planId: number) {
  return http.post<Record<string, unknown>>(`/workbench/workflows/from-plan/${planId}`, {})
}

export function getWorkflow(workflowId: number) {
  return http.get<Record<string, unknown>>(`/workbench/workflows/${workflowId}`)
}

export function updateWorkflow(workflowId: number, payload: Record<string, unknown>) {
  return http.patch<Record<string, unknown>>(`/workbench/workflows/${workflowId}`, payload)
}

export function runWorkflow(workflowId: number, payload: Record<string, unknown>) {
  return http.post<Record<string, unknown>>(`/workbench/workflows/${workflowId}/runs`, payload)
}

export function listWorkflowRuns(limit = 50) {
  return http.get<ApiList>('/workbench/workflow-runs', { params: { limit } })
}

export function getWorkflowRun(runId: number) {
  return http.get<Record<string, unknown>>(`/workbench/workflow-runs/${runId}`)
}

export function resumeWorkflowRun(runId: number, secondConfirmed = false) {
  return http.post<Record<string, unknown>>(`/workbench/workflow-runs/${runId}/resume`, {
    confirmed: true,
    secondConfirmed
  })
}

export function retryWorkflowRun(runId: number) {
  return http.post<Record<string, unknown>>(`/workbench/workflow-runs/${runId}/retry`, {})
}

export function cancelWorkflowRun(runId: number) {
  return http.post<Record<string, unknown>>(`/workbench/workflow-runs/${runId}/cancel`, {})
}

export function listWorkflowRunsByWorkflow(workflowId: number, limit = 50) {
  return http.get<ApiList>(`/workbench/workflows/${workflowId}/runs`, { params: { limit } })
}

export function listAutomations() {
  return http.get<ApiList<AutomationSummary>>('/workbench/automations')
}

export function createAutomation(payload: Record<string, unknown>) {
  return http.post<Record<string, unknown>>('/workbench/automations', payload)
}

export function updateAutomation(automationId: number, payload: AutomationUpdatePayload) {
  return http.patch<AutomationSummary>(`/workbench/automations/${automationId}`, payload)
}

export function deleteAutomation(automationId: number) {
  return http.delete<Record<string, unknown>>(`/workbench/automations/${automationId}`)
}

export function runAutomation(automationId: number, input?: Record<string, unknown>) {
  return http.post<Record<string, unknown>>(`/workbench/automations/${automationId}/runs`, { input: input ?? {} })
}

export function checkAutomationTrigger(automationId: number) {
  return http.post<Record<string, unknown>>(`/workbench/automations/${automationId}/check-trigger`, {})
}

export function listAutomationRuns(automationId: number, limit = 50) {
  return http.get<ApiList>(`/workbench/automations/${automationId}/runs`, { params: { limit } })
}

export function enableAutomation(automationId: number) {
  return http.post<Record<string, unknown>>(`/workbench/automations/${automationId}/enable`)
}

export function pauseAutomation(automationId: number) {
  return http.post<Record<string, unknown>>(`/workbench/automations/${automationId}/pause`)
}

export function listAudit(limit = 100) {
  return http.get<ApiList>('/workbench/audit', { params: { limit } })
}

export function listExperienceTemplates() {
  return http.get<{ items: AutomationTemplate[] }>('/experience/templates')
}

export type ProductEventPayload = {
  eventType: string
  page: string
  actionType?: string
  projectId?: number
  templateId?: string
  status?: string
  durationMs?: number
  errorCategory?: string
  itemCount?: number
}

export function trackProductEvent(payload: ProductEventPayload) {
  return http.post<{ accepted: boolean }>('/experience/events', payload)
}

export function trackPublicProductEvent(payload: ProductEventPayload) {
  return publicHttp.post<{ accepted: boolean }>('/experience/public-events', payload)
}

export function trackEffectiveProgressAction(payload: EffectiveProgressEventPayload) {
  return trackProductEvent({ eventType: 'effective_progress_action', ...payload })
}

export function getOnboarding() {
  return http.get<Record<string, any>>('/experience/onboarding')
}

export function updateOnboarding(payload: Record<string, unknown>) {
  return http.patch<Record<string, any>>('/experience/onboarding', payload)
}

export function runFirstInspection(payload: Record<string, unknown>) {
  return http.post<Record<string, any>>('/experience/onboarding/first-run', payload)
}

export function createDraftFromTemplate(payload: Record<string, unknown>) {
  return http.post<AutomationDraft>('/experience/drafts/from-template', payload)
}

export function createDraftFromIntent(payload: Record<string, unknown>) {
  return http.post<{ kind: string; draft?: AutomationDraft; unsupportedReason?: string; recommendedTemplateIds?: string[] }>('/experience/drafts/from-intent', payload)
}

export function enableDraft(draftId: number) {
  return http.post<{ draft: AutomationDraft }>(`/experience/drafts/${draftId}/enable`, { idempotencyKey: `draft-${draftId}-enable` })
}

export function discardDraft(draftId: number) {
  return http.post<AutomationDraft>(`/experience/drafts/${draftId}/discard`)
}

export function listExecutionResults(params: ExecutionResultListParams = {}) {
  return http.get<ExecutionResultPage>('/experience/execution/results', { params })
}

export function getExecutionResult(id: number) {
  return http.get<ExecutionResultSummary>(`/experience/execution/results/${id}`)
}

export function dismissExecutionResult(id: number) {
  return http.post<ExecutionResultSummary>(`/experience/execution/results/${id}/dismiss`)
}

export function restoreExecutionResult(id: number) {
  return http.post<ExecutionResultSummary>(`/experience/execution/results/${id}/restore`)
}

export function listNeedsAttention() {
  return http.get<{ items: ExecutionResultSummary[] }>('/experience/execution/needs-attention')
}

export function listConfirmations() {
  return http.get<{ items: ConfirmationInboxItem[] }>('/experience/confirmations')
}

export function getConfirmation(id: number) {
  return http.get<ConfirmationInboxItem>(`/experience/confirmations/${id}`)
}

export function confirmOperation(id: number) {
  return http.post(`/experience/confirmations/${id}/confirm`)
}

export function rejectOperation(id: number) {
  return http.post(`/experience/confirmations/${id}/reject`)
}

export function listRecommendedConnections() {
  return http.get<{ items: ConnectionDiagnostic[] }>('/experience/connections/recommended')
}

export function diagnoseConnection(id: string) {
  return http.post<ConnectionDiagnostic>(`/experience/connections/${encodeURIComponent(id)}/diagnose`)
}
