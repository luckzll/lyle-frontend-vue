import type { ChatAttachment } from '@/domain/chat-attachment'

export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface KnowledgeBase {
  id: string
  name: string
  createdAt: string
}

export interface KnowledgeFile {
  id: string
  knowledgeBaseId: string
  fileName: string
  storagePath: string
  storageProvider?: string
  bucket?: string
  objectKey?: string
  originalName?: string
  contentType?: string
  fileSize?: number
  visibility?: string
  parseStatus: string
  createdAt: string
}

export interface KnowledgeFileUploadResponse {
  fileId: string
  knowledgeBaseId: string
  fileName: string
  storagePath: string
  storageProvider?: string
  bucket?: string
  objectKey?: string
  originalName?: string
  contentType?: string
  fileSize?: number
  visibility?: string
  parseStatus: string
  ingestTaskId?: string | null
  candidateMemories?: MemoryItem[]
}

export interface Project {
  id: number
  name: string
  slug?: string | null
  description?: string | null
  status: string
  currentStage?: string | null
  priority: number
  lastActivityAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectLink {
  id: number
  projectId: number
  targetType: string
  targetId: string
  relation: string
  confidence: number
  createdAt: string
}

export interface ProjectDecision {
  id: number
  title: string
  content: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface ProjectOpenQuestion {
  id: number
  question: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface ProjectOverview {
  project: Project
  linkCounts: Record<string, number>
  links: ProjectLink[]
  decisions: ProjectDecision[]
  openQuestions: ProjectOpenQuestion[]
  nextStepSuggestions: string[]
}

export interface Milestone {
  id: number
  goalId: number
  title: string
  description?: string | null
  status: string
  sortOrder: number
  dueAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface Goal {
  id: number
  projectId?: number | null
  title: string
  description?: string | null
  horizon: string
  status: string
  progress: number
  dueAt?: string | null
  createdAt: string
  updatedAt: string
  milestones?: Milestone[]
}

export interface ProjectChatContext {
  resolver?: {
    projectId?: number | null
    projectName?: string
    confidence?: number
    requiresClarification?: boolean
    reason?: string
    candidates?: Array<Record<string, unknown>>
    linkedConversation?: boolean
  }
  context?: {
    project?: Project
    goals?: Goal[]
    linkCounts?: Record<string, number>
    decisions?: ProjectDecision[]
    openQuestions?: ProjectOpenQuestion[]
    nextStepSuggestions?: string[]
    summary?: string
    error?: string
  }
}

export interface AgentPlanStep {
  id: number
  planId: number
  sortOrder: number
  title: string
  description?: string | null
  status: string
  toolName?: string | null
  outputRef?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentPlan {
  id: number
  projectId?: number | null
  conversationId?: string | null
  title: string
  objective: string
  status: string
  requiresConfirmation: boolean
  steps?: AgentPlanStep[]
  createdAt: string
  updatedAt: string
  completedAt?: string | null
}

export interface DailyBriefing {
  id?: number | null
  projectId?: number | null
  briefingType: string
  title: string
  content: string
  todayFocus: string[]
  projects: Project[]
  goals: Goal[]
  dueTasks: AgentTodoItem[]
  overdueTasks: AgentTodoItem[]
  pendingOperations: PendingOperationItem[]
  createdAt: string
}

export interface ConnectorInfo {
  name: string
  label: string
  status: string
  capabilities: string[]
  message: string
}

export interface ConnectorItem {
  id: string
  title: string
  resourceType?: string
  path?: string
  url?: string
  state?: string
  number?: number
  updatedAt?: string | number | null
  author?: string | null
  snippet?: string
  content?: string
  score?: number
  [key: string]: unknown
}

export interface ConnectorResult {
  connector: string
  ok: boolean
  content: string
  items: ConnectorItem[]
  sources: Array<Record<string, unknown>>
  requiresConfirmation?: boolean
  operation?: PendingOperationItem
  error?: {
    code: string
    message: string
    retryable: boolean
  }
}

export interface ChatSource {
  docId: string
  title: string
  chunk: string
  score?: string
  backend?: string
  hitModes?: string
  chunkIndex?: string
  parentTitle?: string
  startChar?: string
  endChar?: string
}

export interface ChatResponse {
  conversationId: string
  answer: string
  sources: ChatSource[]
  agentTrace: AgentTraceItem[]
  toolResults: ToolResult[]
  candidateMemories?: MemoryItem[]
  candidateTasks?: CandidateTaskItem[]
  candidateGoals?: CandidateGoalItem[]
  candidateDecisions?: CandidateDecisionItem[]
  candidateOpenQuestions?: CandidateOpenQuestionItem[]
  candidatePlans?: CandidatePlanItem[]
  executionSuggestions?: ExecutionSuggestionItem[]
  projectContext?: ProjectChatContext
  review: Record<string, unknown>
  usage?: ChatUsage
  usedMemories?: UsedMemory[]
  memoryExclusions?: MemoryExclusions
  memoryExplanationVersion?: string
  debugVersion?: string
  knowledgeBaseIds?: string[]
  retrievalScope?: ChatRetrievalScope
  debugTruncated?: boolean
}

export interface ChatRetrievalScope {
  requested?: boolean
  executed?: boolean
  skipped?: boolean
  knowledgeBaseCount?: number
  queryCount?: number
  contextCount?: number
  reason?: string
}

export interface UsedMemory {
  memoryId: string
  title: string
  valueSummary: string
  reasonCode: 'QUESTION_RELEVANT' | 'USER_REQUESTED_RECALL' | 'PROJECT_CONTEXT' | string
  reliability: MemoryReliability
  sourceCount: number
}

export interface MemoryExclusions {
  conflicted: number
  sensitive: number
  governed: number
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  callCount: number
  estimatedCostMicros: number
  measurementSource: 'PROVIDER_REPORTED' | 'ESTIMATED' | 'PARTIAL_ESTIMATE' | 'PENDING'
}

export interface AgentTraceDecision {
  depth?: string
  reason?: string
  router?: string
  confidence?: number
  needs_clarification?: boolean
  should_recall?: boolean
  should_retrieve?: boolean
  should_call_tools?: boolean
  selected_tools?: string[]
}

export interface AgentMemoryShortTermPreview {
  role: string
  content: string
}

export interface AgentMemorySummary {
  summaryChars?: number
  summaryPreview?: string
  shortTermCount?: number
  shortTermPreview?: AgentMemoryShortTermPreview[]
  structuredCount?: number
  structuredPreview?: string[]
  semanticCount?: number
  vectorCount?: number
  retrievedCount?: number
  retrievedPreview?: string[]
}

export interface AgentWriterInput {
  memoryContextChars?: number
  excludedMemoryContextChars?: number
  memoryExclusionReason?: string
  toolContextChars?: number
  ragContextCount?: number
  combinedContextChars?: number
}

export interface ExecutionSuggestionItem {
  id: string
  type: 'mcp' | 'cli' | 'workflow'
  title: string
  description: string
  riskLevel: string
  status: 'pending' | 'active' | 'disabled'
  action: 'open_workbench' | 'create_workflow'
  payload: Record<string, any>
  createdWorkflowId?: number
  error?: string
}

export interface AutomationTemplate {
  id: string
  version: number
  category: string
  name: string
  problem: string
  sources: string[]
  writes: boolean
  estimatedDuration: string
  defaultSchedule: string
  output: string
  availability?: 'coming_soon'
}

export interface AutomationDraft {
  id: number
  templateId: string
  title: string
  userGoal?: string
  projectId?: number | null
  workspaceId?: number | null
  schedule: string
  timezone: string
  allowedSources: string[]
  riskSummary: { level: string; writes: boolean; message: string }
  status: string
  automationId?: number | null
  expiresAt: string
}

export interface AutomationSummary {
  id: number
  workflowId?: number
  projectId?: number | null
  name: string
  status: 'enabled' | 'paused' | 'failed' | string
  triggerType?: string
  scheduleExpr?: string | null
  timezone?: string | null
  nextRunAt?: string | null
  lastRunAt?: string | null
  consecutiveFailures?: number
  input?: Record<string, unknown>
  maxRetries?: number
  retryDelaySeconds?: number
  notifyOnFailure?: boolean
  projectName?: string | null
  lastRunStatus?: string | null
  lastResultTitle?: string | null
  lastResultId?: number | null
  needsAttention?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface AutomationUpdatePayload {
  workflowId?: number
  name: string
  triggerType: string
  scheduleExpr?: string | null
  timezone: string
  status: string
  input: Record<string, unknown>
  maxRetries: number
  retryDelaySeconds: number
  notifyOnFailure: boolean
}

export interface ExecutionResultSummary {
  id: number
  sourceType: string
  sourceId: string
  projectId?: number | null
  automationId?: number | null
  automationName?: string | null
  templateId?: string | null
  status: 'completed' | 'partial' | 'failed' | 'awaiting_confirmation'
  title: string
  conclusion: string
  completedItems: string[]
  risks: string[]
  recommendedActions: Array<{ type: string; label: string }>
  dataScope: string[]
  durationMs?: number | null
  traceRef?: string | null
  dismissedAt?: string | null
  createdAt: string
}

export interface ExecutionResultListParams {
  status?: string
  projectId?: number
  automationId?: number
  attentionOnly?: boolean
  cursor?: string
  limit?: number
}

export interface ExecutionResultPage {
  items: ExecutionResultSummary[]
  nextCursor: string | null
  hasMore: boolean
}

type EffectiveProgressCommon = {
  status?:
    | 'accepted'
    | 'awaiting_confirmation'
    | 'completed'
    | 'confirmed'
    | 'enabled'
    | 'failed'
    | 'partial'
    | 'pending'
    | 'succeeded'
  durationMs?: number
}

export type EffectiveProgressEventPayload = EffectiveProgressCommon & (
  | { page: 'tasks'; actionType: 'task_complete' | 'task_reschedule'; projectId?: number }
  | { page: 'execution-center'; actionType: 'confirmation' | 'result_action'; projectId?: number }
  | { page: 'automations'; actionType: 'automation_enable' | 'automation_run'; projectId?: number }
  | { page: 'chat'; actionType: 'project_chat'; projectId: number }
)

export interface ConfirmationInboxItem {
  pendingOperationId: number
  actionTitle: string
  toolName?: string
  operationType?: string
  riskLevel: string
  status?: string
  reason: string
  impactResources: string[]
  reversible: boolean
  requiresSecondConfirmation: boolean
  beforeAfter?: unknown
  source: string
  createdAt: string
  updatedAt?: string
}

export interface ConnectionDiagnostic {
  id: string
  type: string
  name: string
  status: 'healthy' | 'reauthorize_required' | 'restricted' | 'unavailable'
  displayReason: string
  nextAction: string
  actionTarget?: string
  diagnosable?: boolean
  capabilities: string[]
  lastCheckedAt?: string | null
}

export interface AgentTraceItem {
  agent: string
  approved?: boolean
  skipped?: boolean
  streaming?: boolean
  ruleBlocked?: boolean
  sufficient?: boolean
  deterministicMemoryOverview?: boolean
  answerChars?: number
  rewriteAttempt?: number
  toolCount?: number
  contextCount?: number
  queryCount?: number
  elapsedMs?: number
  memoryContextChars?: number
  score?: number
  action?: 'read' | 'write'
  intent?: string
  nextAgents?: string[]
  receivedAgents?: string[]
  selectedTools?: string[]
  queries?: string[]
  decision?: AgentTraceDecision
  memorySummary?: AgentMemorySummary
  writerInput?: AgentWriterInput
  [key: string]: unknown
}

export interface ToolResult {
  tool: string
  ok: boolean
  content: string
  summary?: string
  operationType?: string
  riskLevel?: string
  retryable?: boolean
  elapsedMs?: number
  requiresConfirmation?: boolean
  operation?: PendingOperationItem
  [key: string]: unknown
}

export interface ChatMessage {
  id: string
  conversationId: string
  turnId?: string
  role: 'user' | 'assistant'
  content: string
  metadata?: Record<string, unknown>
  attachments?: ChatAttachment[]
  createdAt: string
}

export interface User {
  id: string
  username: string
  role: string
  status?: 'ACTIVE' | 'DISABLED' | string
  lastLoginAt?: string | null
}

export interface AuthResponse {
  user: User
  accessToken: string
  expiresInSeconds: number
  /** Temporary response compatibility for staged V6.3 backends. */
  token?: string
}

export interface ImageUploadResponse {
  fileName: string
  url: string
  objectKey: string
  contentType: string
  size: number
}

export interface PageResponse<T> {
  records: T[]
  total: number
  page: number
  size: number
}

export interface AdminOverview {
  users: number
  conversations: number
  knowledgeBases: number
  knowledgeFiles: number
  auditLogs: number
}

export interface AuditLog {
  id: string
  userId: string
  action: string
  target: string
  targetId: string
  createdAt: string
}

export interface AiConfigItem {
  key: string
  value: string
  description: string
  updatedAt: string
}

export interface AiToolItem {
  name: string
  description: string
  enabled: boolean
  riskLevel?: string
  requiresConfirmation?: boolean
  riskDescription?: string
}

export interface AiToolsResponse {
  tools: AiToolItem[]
}

export interface AiToolAuditItem {
  id: number
  toolName: string
  userId: string
  conversationId: string
  ok: boolean
  elapsedMs: number
  payload: Record<string, unknown>
  createdAt: string
}

export interface AiToolAuditResponse {
  items: AiToolAuditItem[]
}

export interface AiMetricsResponse {
  uptime_seconds: number
  features: Record<string, unknown>
  models: Record<string, { provider: string; model: string }>
  tools: Record<string, unknown>
  limits: Record<string, unknown>
  requests?: Record<string, unknown>
}

export interface ExperienceAnalytics {
  periodDays: number
  funnel: {
    onboardingStarted: number
    firstRunStarted: number
    firstRunCompleted: number
    draftCreated: number
    draftEnabled: number
  }
  templates: Array<{ templateId: string; enabled: number }>
  executionByStatus: Array<{ status: string; count: number }>
  confirmations: { viewed: number; confirmed: number; rejected: number }
  failureCategories: Array<{ category: string; count: number }>
  northStar: {
    windowDays: 7
    twoPlusEffectiveProgressUsers: number
    eventActiveUsers: number
    shareOfEventActiveUsers: number
    effectiveProgressActions: number
  }
}

export interface AgentTodoItem {
  id: number
  title: string
  status: string
  dueAt?: string | null
  conversationId: string
  sourceRef?: string
  goalLinks?: Array<{
    schemaPath: string
    label: string
    value: string
    confidence?: number
    reason?: string
  }>
  createdAt: string
  updatedAt: string
}

export interface PendingOperationItem {
  id: number
  toolName: string
  operationType: string
  riskLevel: string
  summary: string
  payload: Record<string, unknown>
  status: string
  sourceText?: string
  result?: Record<string, unknown> | null
  conversationId?: string
  createdAt: string
  updatedAt: string
  confirmedAt?: string | null
  rejectedAt?: string | null
  idempotencyKey?: string
  error?: string
}

export interface OperationConfirmResponse {
  operation: PendingOperationItem
  result: Record<string, unknown>
  idempotentReplay?: boolean
}

export interface CandidateTaskItem {
  type: 'todo'
  title: string
  dueAt?: string | null
  source?: string
  confidence?: number
  status?: string
  error?: string
}

export interface CandidateGoalItem {
  type: 'goal'
  projectId: number
  title: string
  description?: string
  horizon?: string
  confidence?: number
  status?: string
  source?: string
  error?: string
}

export interface CandidateDecisionItem {
  type: 'decision'
  projectId: number
  title: string
  content: string
  rationale?: string
  confidence?: number
  status?: string
  source?: string
  error?: string
}

export interface CandidateOpenQuestionItem {
  type: 'open_question'
  projectId: number
  question: string
  confidence?: number
  status?: string
  source?: string
  error?: string
}

export interface CandidatePlanItem {
  type: 'agent_plan'
  projectId?: number | null
  title: string
  objective: string
  requiresConfirmation?: boolean
  confidence?: number
  status?: string
  source?: string
  steps: Array<{
    title: string
    description?: string
    status?: string
    toolName?: string
  }>
  createdPlan?: AgentPlan
  error?: string
}

export interface AgentCalendarItem {
  id: number
  title: string
  startsAt?: string | null
  status: string
  conversationId: string
  sourceRef?: string
  createdAt: string
  updatedAt: string
}

export interface EvaluationCase {
  id?: string
  question: string
  answer: string
  contexts: Array<Record<string, string>>
  expectedAnswer?: string
  mustInclude?: string[]
  mustNotInclude?: string[]
  type?: string
  rubric?: string
}

export interface AgentReminderItem {
  id: number
  sourceType: string
  sourceId: number
  title: string
  message: string
  status: string
  createdAt: string
  readAt?: string | null
}

export interface EvaluationBatchResultItem {
  id: string
  question: string
  answer?: string
  score: number
  checks: Record<string, unknown>
  dimensions?: Record<string, number>
  reason?: string
  scoringMode?: string
  heuristicScore?: number
  judgeScore?: number | null
  promptVersion: string
  badcase?: boolean
}

export interface EvaluationBatchResponse {
  runId?: number
  count: number
  averageScore: number
  badcaseCount?: number
  evaluationSetId?: number
  items: EvaluationBatchResultItem[]
}

export interface EvaluationRunItem {
  id: number
  name: string
  count: number
  averageScore: number
  promptVersion: string
  modelProvider: string
  modelName: string
  evaluationSetId?: number | null
  badcaseCount?: number
  createdAt: string
}

export interface EvaluationRunDetail extends EvaluationRunItem {
  items: EvaluationBatchResultItem[]
}

export interface EvaluationRunReport {
  runId: number
  fileName: string
  contentType: string
  markdown: string
}

export interface EvaluationSetItem {
  id: number
  name: string
  description: string
  caseCount: number
  createdAt: string
  updatedAt: string
}

export interface EvaluationSetDetail extends EvaluationSetItem {
  cases: EvaluationCase[]
}

export interface EvaluationTrendPoint {
  id: number
  name: string
  averageScore: number
  promptVersion: string
  modelProvider: string
  modelName: string
  badcaseCount: number
  createdAt: string
}

export interface EvaluationCompareItem {
  name: string
  count: number
  averageScore: number
  badcaseCount: number
}

export interface EvaluationTrendResponse {
  points: EvaluationTrendPoint[]
  promptCompare: EvaluationCompareItem[]
  modelCompare: EvaluationCompareItem[]
}

export interface PromptTemplate {
  id: number
  name: string
  version: string
  systemPrompt: string
  status: string
  trafficPercent: number
  createdAt: string
  updatedAt: string
  persisted?: boolean
}

export interface PromptTemplateResponse {
  items: PromptTemplate[]
  active?: PromptTemplate | null
}

export interface RagDebugResponse {
  knowledgeBaseIds: string[]
  queries: string[]
  contexts: Array<{
    doc_id?: string
    docId?: string
    title: string
    chunk: string
    score?: string
    backend?: string
    hitModes?: string
    chunkIndex?: string
    parentTitle?: string
    startChar?: string
    endChar?: string
    query?: string
  }>
  sufficiency: Record<string, unknown>
  attribution?: {
    status: string
    reasons: string[]
    suggestions: string[]
    queryCount: number
    contextCount: number
    topScore: number
    sufficiencyScore: number
  }
  citationQuality?: {
    level: string
    score: number
    reason: string
  }
}

export interface RagChunkResponse {
  items: Array<{
    doc_id: string
    knowledge_base_id: string
    title: string
    chunk: string
    chunkIndex?: string
    parentTitle?: string
    startChar?: string
    endChar?: string
    backend: string
  }>
}

export interface MemoryItem {
  role?: string
  content?: string
  key?: string
  targetKey?: string
  schemaPath?: string
  label?: string
  group?: string
  value?: string
  summary?: string
  text?: string
  score?: number
  backend?: string
  source?: string
  status?: string
  confidence?: number
  updated_at?: number
  updatedAt?: number
  createdAt?: number
  expires_at?: number | null
  evidenceCount?: number
  id?: number
  sourceType?: string
  sourceId?: string
  sourceRef?: string
  sourceText?: string
  normalizedText?: string
  category?: string
  fragment?: MemoryItem
  relation?: string
}

export type MemoryReliability = 'RELIABLE' | 'BASIC' | 'REVIEW_REQUIRED'
export type MemoryRecordStatus =
  | 'ACTIVE'
  | 'PENDING'
  | 'CONFLICTED'
  | 'DISABLED'
  | 'FORGOTTEN'
  | 'PURGING'
  | 'PURGE_FAILED'
  | 'REVIEW_REQUIRED'

export interface MemorySource {
  sourceId: string
  type: 'CONVERSATION' | 'KNOWLEDGE' | 'MANUAL' | 'SYSTEM' | string
  label: string
  relation: 'SUPPORT' | 'SUPPLEMENT' | 'CORRECTION' | 'CONTRADICT' | 'DUPLICATE' | 'MANUAL' | string
  excerpt: string
  occurredAt?: string | null
  availability: 'AVAILABLE' | 'UNAVAILABLE'
  unavailableReason?: string | null
  conversationId?: string | null
  messageId?: string | null
  chunkId?: string | null
  link?: string | null
}

export interface MemoryRecord {
  memoryId: string
  profileId: number
  schemaPath: string
  title: string
  value: string
  rawValue: string
  status: MemoryRecordStatus
  reliability: MemoryReliability
  confirmedByUser: boolean
  sourceCount: number
  latestSource?: MemorySource | null
  usageDescription: string
  lastUsedAt?: string | null
  updatedAt?: string | null
  allowedActions: Array<'CORRECT' | 'DISABLE' | 'RESTORE' | 'FORGET' | 'PURGE' | 'RESOLVE'>
  sources?: MemorySource[]
  history?: MemoryGovernanceEvent[]
}

export interface MemoryConflict {
  id: number
  schemaPath: string
  title: string
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED'
  version: number
  currentMemory?: MemoryRecord | null
  candidate?: {
    fragmentId: number
    value: string
    source: Omit<MemorySource, 'sourceId' | 'relation' | 'availability'>
  } | null
  createdAt: string
  updatedAt: string
}

export interface MemoryInboxItem {
  inboxId: string
  type: 'CONFLICT' | 'LOW_RELIABILITY' | 'CANDIDATE' | 'PURGE_FAILED'
  title: string
  description: string
  status: string
  createdAt?: string | null
  conflict?: MemoryConflict
  memory?: MemoryRecord
  candidate?: Record<string, unknown>
  purgeJob?: MemoryPurgeJob
}

export interface MemoryGovernanceEvent {
  eventId: number
  subjectType: string
  subjectId: string
  action: string
  beforeSnapshot: Record<string, unknown>
  afterSnapshot: Record<string, unknown>
  reasonCode: string
  createdAt: string
}

export interface MemoryPurgeJob {
  jobId: number
  memoryId: string
  status: 'PENDING' | 'RUNNING' | 'RETRY' | 'SUCCEEDED' | 'FAILED'
  attemptCount: number
  steps: Record<string, string>
  createdAt: string
  updatedAt: string
  completedAt?: string | null
}

export interface MemorySnapshot {
  summary: string
  summary_meta?: {
    requestedConversationId?: string
    sourceConversationId?: string | null
    fallback?: boolean
  }
  short_term: MemoryItem[]
  structured: MemoryItem[]
  structured_all?: MemoryItem[]
  profiles?: MemoryItem[]
  fragments?: MemoryItem[]
  profile_schema?: Array<Record<string, unknown>>
  recall_plan?: Record<string, unknown>
  semantic: MemoryItem[]
  vector: MemoryItem[]
  retrieved: MemoryItem[]
}

export interface StructuredMemoryHistoryItem {
  id: number
  key: string
  oldValue?: string | null
  newValue?: string | null
  action: string
  source: string
  confidence: number
  status: string
  createdAt: string
}

export interface StructuredMemoryMergeSuggestion {
  group: string
  reason: string
  items: MemoryItem[]
}
