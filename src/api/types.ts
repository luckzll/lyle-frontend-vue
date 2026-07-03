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

export interface ChatSource {
  docId: string
  title: string
  chunk: string
  score?: string
  backend?: string
  hitModes?: string
}

export interface ChatResponse {
  conversationId: string
  answer: string
  sources: ChatSource[]
  agentTrace: AgentTraceItem[]
  toolResults: ToolResult[]
  candidateMemories?: MemoryItem[]
  candidateTasks?: CandidateTaskItem[]
  review: Record<string, unknown>
}

export interface AgentTraceItem {
  agent: string
  [key: string]: unknown
}

export interface ToolResult {
  tool: string
  ok: boolean
  content: string
  requiresConfirmation?: boolean
  operation?: PendingOperationItem
  [key: string]: unknown
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface User {
  id: string
  username: string
  role: string
}

export interface AuthResponse {
  user: User
  token: string
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

export interface AgentTodoItem {
  id: number
  title: string
  status: string
  dueAt?: string | null
  conversationId: string
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
  error?: string
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

export interface AgentCalendarItem {
  id: number
  title: string
  startsAt?: string | null
  status: string
  conversationId: string
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
