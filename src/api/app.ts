import { http } from './http'
import { getAuthToken } from '@/auth'
import type {
  AdminOverview,
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
  Conversation,
  EvaluationBatchResponse,
  EvaluationCase,
  EvaluationRunDetail,
  EvaluationRunItem,
  EvaluationRunReport,
  EvaluationSetDetail,
  EvaluationSetItem,
  EvaluationTrendResponse,
  ImageUploadResponse,
  KnowledgeFileUploadResponse,
  KnowledgeBase,
  KnowledgeFile,
  MemoryItem,
  MemorySnapshot,
  PageResponse,
  PendingOperationItem,
  PromptTemplate,
  PromptTemplateResponse,
  RagChunkResponse,
  RagDebugResponse,
  StructuredMemoryHistoryItem,
  StructuredMemoryMergeSuggestion,
  User
} from './types'

export type StreamMeta = {
  sources?: ChatSource[]
  agentTrace?: ChatResponse['agentTrace']
  toolResults?: ChatResponse['toolResults']
  candidateMemories?: MemoryItem[]
  candidateTasks?: ChatResponse['candidateTasks']
  review?: ChatResponse['review']
}

export type SseHandlers = {
  onDelta: (chunk: string) => void
  onMeta?: (meta: StreamMeta) => void
  onError?: (message: string) => void
  onDone?: () => void
}

export function register(username: string, password: string) {
  return http.post<AuthResponse>('/auth/register', { username, password })
}

export function login(username: string, password: string) {
  return http.post<AuthResponse>('/auth/login', { username, password })
}

export function uploadChatImage(file: File) {
  const form = new FormData()
  form.append('file', file)
  return http.post<ImageUploadResponse>('/uploads/images', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

export function createConversation(title: string) {
  return http.post<Conversation>('/conversations', { title })
}

export function listConversations() {
  return http.get<Conversation[]>('/conversations')
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

export function rebuildKnowledgeFile(knowledgeBaseId: string, fileId: string) {
  return http.post<KnowledgeFileUploadResponse>(`/knowledge-bases/${knowledgeBaseId}/files/${fileId}/rebuild`)
}

export function rebuildKnowledgeBaseFiles(knowledgeBaseId: string) {
  return http.post<KnowledgeFileUploadResponse[]>(`/knowledge-bases/${knowledgeBaseId}/files/rebuild`)
}

export function sendMessage(payload: {
  conversationId?: string
  message: string
  knowledgeBaseIds: string[]
}) {
  return http.post<ChatResponse>('/chat/send', payload)
}

export function listChatMessages(conversationId: string) {
  return http.get<ChatMessage[]>(`/chat/messages/${conversationId}`)
}

export function getCurrentMemory(conversationId?: string) {
  return http.get<MemorySnapshot>('/memory/current', {
    params: conversationId ? { conversationId } : {}
  })
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
  return http.post<{ operation: PendingOperationItem; result: Record<string, unknown> }>(`/agent-tools/operations/${operationId}/confirm`)
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
    message: string
    knowledgeBaseIds: string[]
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
    throw new Error(`Chat stream failed: ${response.status}`)
  }

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
  let eventEnd = buffer.indexOf('\n\n')
  while (eventEnd >= 0) {
    const block = buffer.slice(0, eventEnd)
    buffer = buffer.slice(eventEnd + 2)
    handleSseBlock(block, handlers)
    eventEnd = buffer.indexOf('\n\n')
  }
  return buffer
}

export function handleSseBlock(block: string, handlers: SseHandlers) {
  const lines = block.split('\n')
  const event = lines.find((line) => line.startsWith('event: '))?.slice(7).trim()
  const dataText = lines
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .join('\n')
  const data = dataText ? JSON.parse(dataText) : {}

  if (event === 'delta') {
    handlers.onDelta(String(data.text ?? ''))
  } else if (event === 'meta') {
    handlers.onMeta?.(data)
  } else if (event === 'error') {
    handlers.onError?.(String(data.message ?? '流式请求失败'))
  } else if (event === 'done') {
    handlers.onDone?.()
  }
}
