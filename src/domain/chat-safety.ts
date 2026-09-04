import type {
  AgentTraceDecision,
  AgentTraceItem,
  AgentWriterInput,
  ChatRetrievalScope,
  ChatSource,
  ExecutionSuggestionItem,
  Goal,
  MemoryExclusions,
  PendingOperationItem,
  ProjectChatContext,
  ToolResult,
  UsedMemory
} from '@/api/types'

const MAX_TRACE_TEXT = 500
const SENSITIVE_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'password',
  'passwd',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'clientsecret',
  'secret',
  'cookie',
  'setcookie',
  'credential',
  'credentials',
  'privatekey',
  'awssecretaccesskey',
  'awsaccesskeyid',
  'awssessiontoken',
  'headers',
  'env',
  'config'
])

const SENSITIVE_KEY_MARKERS = [
  'authorization',
  'auth',
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'credential',
  'cookie',
  'privatekey',
  'accesskey',
  'sessionkey',
  'signingkey',
  'clientkey'
]

/**
 * Chat metadata is an extensible backend envelope. Convert it to the smallest
 * UI contract as soon as it enters page state so arbitrary trace/tool fields
 * (including credentials or full tool parameters) are never retained.
 */
export function sanitizeAgentTrace(items: unknown): AgentTraceItem[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, 40).flatMap((raw): AgentTraceItem[] => {
    const item = record(raw)
    if (!item) return []
    const safe: AgentTraceItem = {
      agent: safeText(item.agent, 80) || 'unknown'
    }
    copyBooleanFields(item, safe, [
      'approved',
      'skipped',
      'streaming',
      'ruleBlocked',
      'sufficient',
      'deterministicMemoryOverview'
    ])
    copyNumberFields(item, safe, [
      'answerChars',
      'rewriteAttempt',
      'toolCount',
      'contextCount',
      'queryCount',
      'elapsedMs',
      'memoryContextChars',
      'score'
    ])
    copyEnumField(item, safe, 'action', ['read', 'write'])

    const intent = safeText(item.intent, 80)
    if (intent) safe.intent = intent
    const nextAgents = safeStringArray(item.nextAgents, 20, 80)
    if (nextAgents.length) safe.nextAgents = nextAgents
    const receivedAgents = safeStringArray(item.receivedAgents, 20, 80)
    if (receivedAgents.length) safe.receivedAgents = receivedAgents
    const selectedTools = safeStringArray(item.selectedTools, 20, 80)
    if (selectedTools.length) safe.selectedTools = selectedTools
    const queries = safeStringArray(item.queries, 8, MAX_TRACE_TEXT)
    if (queries.length) safe.queries = queries

    const writerInput = record(item.writerInput)
    if (writerInput) {
      const safeWriterInput: AgentWriterInput = numericRecord(writerInput, [
        'memoryContextChars',
        'excludedMemoryContextChars',
        'toolContextChars',
        'ragContextCount',
        'combinedContextChars'
      ])
      const memoryExclusionReason = safeText(writerInput.memoryExclusionReason, 160)
      if (memoryExclusionReason) safeWriterInput.memoryExclusionReason = memoryExclusionReason
      safe.writerInput = safeWriterInput
    }

    const memorySummary = record(item.memorySummary)
    if (memorySummary) {
      safe.memorySummary = {
        ...numericRecord(memorySummary, [
          'summaryChars',
          'shortTermCount',
          'structuredCount',
          'semanticCount',
          'vectorCount',
          'retrievedCount'
        ]),
        structuredPreview: safeStringArray(memorySummary.structuredPreview, 12, MAX_TRACE_TEXT),
        retrievedPreview: safeStringArray(memorySummary.retrievedPreview, 8, MAX_TRACE_TEXT),
        shortTermPreview: safeMemoryTurnPreview(memorySummary.shortTermPreview),
        summaryPreview: safeText(memorySummary.summaryPreview, 1000)
      }
    }

    const decision = record(item.decision)
    if (decision) {
      const safeDecision: AgentTraceDecision = {
        depth: safeText(decision.depth, 40),
        selected_tools: safeStringArray(decision.selected_tools, 20, 80),
        reason: safeText(decision.reason, MAX_TRACE_TEXT)
      }
      const router = safeText(decision.router, 80)
      if (router) safeDecision.router = router
      copyBooleanFields(decision, safeDecision, [
        'needs_clarification',
        'should_recall',
        'should_retrieve',
        'should_call_tools'
      ])
      copyNumberFields(decision, safeDecision, ['confidence'])
      safe.decision = safeDecision
    }
    return [safe]
  })
}

export function sanitizeToolResults(items: unknown): ToolResult[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, 40).flatMap((raw): ToolResult[] => {
    const item = record(raw)
    if (!item) return []
    const operation = record(item.operation)
    const operationSummary = safeText(operation?.summary, 500)
    const explicitSummary = safeText(item.summary, 500)
    const requiresConfirmation = item.requiresConfirmation === true
    const ok = item.ok === true
    const safe: ToolResult = {
      tool: safeText(item.tool, 100) || 'unknown',
      ok,
      // Raw tool output may contain credentials or large third-party payloads.
      // Only an explicit summary or a whitelisted operation preview is retained.
      content: operationSummary
        || explicitSummary
        || (requiresConfirmation
          ? '工具已准备，等待用户确认。'
          : ok
            ? '工具执行已完成。'
            : '工具执行未完成。')
    }
    if (explicitSummary) safe.summary = explicitSummary
    if (requiresConfirmation) safe.requiresConfirmation = true
    if (typeof item.retryable === 'boolean') safe.retryable = item.retryable
    const operationType = safeText(item.operationType, 100)
    const riskLevel = safeText(item.riskLevel, 40)
    const elapsedMs = finiteNumber(item.elapsedMs)
    if (operationType) safe.operationType = operationType
    if (riskLevel) safe.riskLevel = riskLevel
    if (elapsedMs !== undefined) safe.elapsedMs = elapsedMs
    if (operation) safe.operation = sanitizePendingOperation(operation as unknown as PendingOperationItem)
    if (safe.tool === 'image_generate') {
      const model = safeText(item.model, 100)
      const storageRequested = safeText(item.storageRequested, 80)
      const storageUsed = safeText(item.storageUsed, 80)
      const storageError = safeText(item.storageError, MAX_TRACE_TEXT)
      if (model) safe.model = model
      if (storageRequested) safe.storageRequested = storageRequested
      if (storageUsed) safe.storageUsed = storageUsed
      if (storageError) safe.storageError = storageError
    }
    return [safe]
  })
}

export function sanitizeExecutionSuggestions(
  items: ExecutionSuggestionItem[] | undefined
): ExecutionSuggestionItem[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, 20).map((item) => {
    const payload: Record<string, unknown> = {}
    if (item.type === 'workflow') {
      const workflow = record(item.payload?.workflow)
      payload.workflow = { description: safeText(workflow?.description, 2000) }
    } else if (item.type === 'cli') {
      const workspaceId = positiveInteger(item.payload?.workspaceId)
      if (workspaceId) payload.workspaceId = workspaceId
    } else {
      const toolId = positiveInteger(item.payload?.toolId)
      if (toolId) payload.toolId = toolId
    }
    return {
      id: safeText(item.id, 128),
      type: item.type,
      title: safeText(item.title, 240),
      description: safeText(item.description, 1000),
      riskLevel: safeText(item.riskLevel, 40),
      status: item.status,
      action: item.action,
      payload,
      ...(positiveInteger(item.createdWorkflowId)
        ? { createdWorkflowId: positiveInteger(item.createdWorkflowId) as number }
        : {}),
      ...(item.error ? { error: safeText(item.error, MAX_TRACE_TEXT) } : {})
    }
  })
}

export function sanitizeProjectContext(value: unknown): ProjectChatContext | undefined {
  const source = record(value)
  if (!source) return undefined
  const rawResolver = record(source.resolver)
  const rawContext = record(source.context)
  const resolver = rawResolver
    ? {
        projectId: positiveInteger(rawResolver.projectId),
        projectName: safeText(rawResolver.projectName, 240),
        confidence: finiteNumber(rawResolver.confidence),
        requiresClarification: rawResolver.requiresClarification === true,
        reason: safeText(rawResolver.reason, MAX_TRACE_TEXT),
        linkedConversation: rawResolver.linkedConversation === true
      }
    : undefined
  const goals = Array.isArray(rawContext?.goals)
    ? rawContext.goals.slice(0, 6).flatMap((raw): Goal[] => {
        const goal = record(raw)
        return goal ? [sanitizeGoal(goal as unknown as Goal)] : []
      })
    : []
  const nextStepSuggestions = safeStringArray(rawContext?.nextStepSuggestions, 8, 500)
  return {
    ...(resolver ? { resolver } : {}),
    ...(goals.length || nextStepSuggestions.length
      ? { context: { goals, nextStepSuggestions } }
      : {})
  }
}

export function sanitizeReview(value: unknown): Record<string, unknown> {
  const source = record(value)
  if (!source) return {}
  const safe: Record<string, unknown> = {}
  copyBooleanFields(source, safe, ['approved', 'skipped', 'ruleBlocked'])
  copyNumberFields(source, safe, ['score'])
  const rule = safeText(source.v3Rule, 80)
  const reason = safeText(source.reason, MAX_TRACE_TEXT)
  const rewriteInstruction = safeText(source.rewrite_instruction, MAX_TRACE_TEXT)
  if (rule) safe.v3Rule = rule
  if (reason) safe.reason = reason
  if (rewriteInstruction) safe.rewrite_instruction = rewriteInstruction
  return safe
}

export function sanitizeChatSources(items: unknown): ChatSource[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, 50).flatMap((raw): ChatSource[] => {
    const item = record(raw)
    if (!item) return []
    const source: ChatSource = {
      docId: safeText(item.docId, 160),
      title: safeText(item.title, 300),
      chunk: safeText(item.chunk, 4000)
    }
    copyOptionalText(item, source, 'score', 40)
    copyOptionalText(item, source, 'backend', 80)
    copyOptionalText(item, source, 'hitModes', 120)
    copyOptionalText(item, source, 'chunkIndex', 40)
    copyOptionalText(item, source, 'parentTitle', 300)
    copyOptionalText(item, source, 'startChar', 40)
    copyOptionalText(item, source, 'endChar', 40)
    return source.docId || source.title || source.chunk ? [source] : []
  })
}

export function sanitizeUsedMemories(items: unknown): UsedMemory[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, 40).flatMap((raw): UsedMemory[] => {
    const item = record(raw)
    if (!item) return []
    const memoryId = safeText(item.memoryId, 160)
    const title = safeText(item.title, 240)
    const valueSummary = safeText(item.valueSummary, 1000)
    if (!memoryId || !title || !valueSummary) return []
    const reliability = safeText(item.reliability, 40)
    return [{
      memoryId,
      title,
      valueSummary,
      reasonCode: safeText(item.reasonCode, 80) || 'QUESTION_RELEVANT',
      reliability: ['RELIABLE', 'BASIC', 'REVIEW_REQUIRED'].includes(reliability)
        ? reliability as UsedMemory['reliability']
        : 'REVIEW_REQUIRED',
      sourceCount: Math.max(0, Math.trunc(finiteNumber(item.sourceCount) || 0))
    }]
  })
}

export function sanitizeMemoryExclusions(value: unknown): MemoryExclusions | undefined {
  const source = record(value)
  if (!source) return undefined
  return {
    conflicted: nonNegativeInteger(source.conflicted),
    sensitive: nonNegativeInteger(source.sensitive),
    governed: nonNegativeInteger(source.governed)
  }
}

export function sanitizeKnowledgeBaseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .slice(0, 20)
    .flatMap((item): string[] => (
      typeof item === 'string' || typeof item === 'number'
        ? [safeText(item, 160)]
        : []
    ))
    .filter(Boolean)))
}

export function sanitizeDebugVersion(value: unknown): string | undefined {
  const version = safeText(value, 80)
  // This marker means the complete v1 snapshot is present, not merely that
  // some future/unknown debug string happened to be stored.
  return version === 'chat-debug-v1' ? version : undefined
}

export function sanitizeRetrievalScope(value: unknown): ChatRetrievalScope | undefined {
  const source = record(value)
  if (!source) return undefined
  const scope: ChatRetrievalScope = {}
  copyBooleanFields(source, scope as Record<string, unknown>, ['requested', 'executed', 'skipped'])
  for (const key of ['knowledgeBaseCount', 'queryCount', 'contextCount'] as const) {
    if (finiteNumber(source[key]) !== undefined) scope[key] = nonNegativeInteger(source[key])
  }
  const reason = safeText(source.reason, MAX_TRACE_TEXT)
  if (reason) scope.reason = reason
  return scope
}

export function maskSensitiveText(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  const structured = sanitizeStructuredText(text)
  return maskPlainText(structured)
}

function maskPlainText(value: string): string {
  const deescaped = deescapeForSensitiveKeyScan(value)
  if (
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i.test(deescaped)
    || /(?:^|[^a-z0-9])(?:authorization|proxy[-_]?authorization|password|passwd|token|access[-_]?token|refresh[-_]?token|api[-_]?key|client[-_]?secret|secret|cookie|set[-_]?cookie|credential|credentials|private[-_]?key|aws[-_]?secret[-_]?access[-_]?key|aws[-_]?access[-_]?key[-_]?id|aws[-_]?session[-_]?token|headers|env|config)(?:\s*\[[^\]\r\n]{0,200}\]\s*|["']?\s*)[:=]/i.test(deescaped)
  ) {
    // Extensible trace strings are not required for core UI. If they look
    // like a credential-bearing structure, hiding the whole value is safer
    // than trying to preserve adjacent debug prose.
    return '[已隐藏]'
  }
  return value
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi,
      '[PRIVATE KEY 已隐藏]'
    )
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@/\s]+)@/gi, '$1***:***@')
    .replace(
      /(["']?\b(?:authorization|proxy-authorization)\b["']?\s*[:=]\s*)(["']?)(?:[a-z][a-z0-9._-]*\s+)?[^"'\s,;}\]]+/gi,
      '$1$2***$2'
    )
    .replace(
      /(["']?\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|cookie|set-cookie|credential|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key|aws[_-]?access[_-]?key[_-]?id|aws[_-]?session[_-]?token)\b["']?\s*[:=]\s*)(["']?)[^"'\s,;}\]]+/gi,
      '$1$2***$2'
    )
    .replace(/\b(?:basic|bearer)\s+["']?[a-z0-9._~+/=-]{8,}["']?/gi, (match) => `${match.split(/\s/, 1)[0]} ***`)
    .replace(/\b(?:sk-[a-z0-9_-]{12,}|ghp_[a-z0-9_]{20,}|AKIA[A-Z0-9]{16}|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{8,})\b/gi, '***')
}

function deescapeForSensitiveKeyScan(value: string): string {
  let result = value
  for (let index = 0; index < 4; index += 1) {
    const next = result.replace(/\\(["'\\])/g, '$1')
    if (next === result) break
    result = next
  }
  return result
}

function sanitizeStructuredText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return text
  try {
    return JSON.stringify(sanitizeJsonValue(JSON.parse(trimmed), 0))
  } catch {
    return text
  }
}

function sanitizeJsonValue(value: unknown, depth: number): unknown {
  if (depth > 8) return '[内容已截断]'
  if (Array.isArray(value)) {
    if (value.length === 2 && typeof value[0] === 'string' && isSensitiveKey(value[0])) {
      return [value[0], '[已隐藏]']
    }
    return value.slice(0, 100).map((item) => sanitizeJsonValue(item, depth + 1))
  }
  const source = record(value)
  if (source) {
    return Object.fromEntries(Object.entries(source).slice(0, 100).map(([key, item]) => {
      return [key, isSensitiveKey(key)
        ? '[已隐藏]'
        : sanitizeJsonValue(item, depth + 1)]
    }))
  }
  if (typeof value === 'string') return maskPlainText(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  return String(value ?? '')
}

function isSensitiveKey(value: string): boolean {
  const normalized = value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
  return SENSITIVE_KEYS.has(normalized)
    || SENSITIVE_KEY_MARKERS.some((marker) => normalized.includes(marker))
}

function sanitizePendingOperation(item: PendingOperationItem): PendingOperationItem {
  const payload: Record<string, unknown> = {}
  if (item.operationType === 'todo.create') {
    payload.title = safeText(item.payload?.title, 500)
    payload.dueAt = safeText(item.payload?.dueAt, 80)
  } else if (item.operationType === 'calendar.create') {
    payload.title = safeText(item.payload?.title, 500)
    payload.startsAt = safeText(item.payload?.startsAt, 80)
  }
  return {
    id: positiveInteger(item.id) || 0,
    toolName: safeText(item.toolName, 100),
    operationType: safeText(item.operationType, 100),
    riskLevel: safeText(item.riskLevel, 40),
    summary: safeText(item.summary, 500),
    payload,
    status: safeText(item.status, 40),
    createdAt: safeText(item.createdAt, 80),
    updatedAt: safeText(item.updatedAt, 80),
    ...(item.confirmedAt ? { confirmedAt: safeText(item.confirmedAt, 80) } : {}),
    ...(item.rejectedAt ? { rejectedAt: safeText(item.rejectedAt, 80) } : {}),
    ...(item.error ? { error: safeText(item.error, MAX_TRACE_TEXT) } : {})
  }
}

function sanitizeGoal(goal: Goal): Goal {
  return {
    id: positiveInteger(goal.id) || 0,
    projectId: positiveInteger(goal.projectId),
    title: safeText(goal.title, 500),
    description: null,
    horizon: safeText(goal.horizon, 80),
    status: safeText(goal.status, 80),
    progress: finiteNumber(goal.progress) || 0,
    dueAt: null,
    createdAt: '',
    updatedAt: ''
  }
}

function safeText(value: unknown, limit: number): string {
  return maskSensitiveText(value).slice(0, limit)
}

function safeStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map((item) => safeText(item, maxLength))
    .filter(Boolean)
}

function safeMemoryTurnPreview(value: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(value)) return []
  return value.slice(0, 8).flatMap((raw): Array<{ role: string; content: string }> => {
    const item = record(raw)
    if (!item) return []
    const role = safeText(item.role, 40)
    const content = safeText(item.content, MAX_TRACE_TEXT)
    return role || content ? [{ role, content }] : []
  })
}

function copyOptionalText(
  source: Record<string, unknown>,
  target: object,
  key: string,
  maxLength: number
) {
  if (source[key] === null || source[key] === undefined || source[key] === '') return
  const value = safeText(source[key], maxLength)
  if (value) (target as Record<string, unknown>)[key] = value
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function nonNegativeInteger(value: unknown): number {
  const parsed = finiteNumber(value)
  return parsed === undefined ? 0 : Math.max(0, Math.trunc(parsed))
}

function numericRecord(source: Record<string, unknown>, keys: string[]): Record<string, number> {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = finiteNumber(source[key])
    return value === undefined ? [] : [[key, value]]
  }))
}

function copyBooleanFields(
  source: Record<string, unknown>,
  target: object,
  keys: string[]
) {
  const targetRecord = target as Record<string, unknown>
  for (const key of keys) {
    if (typeof source[key] === 'boolean') targetRecord[key] = source[key]
  }
}

function copyNumberFields(
  source: Record<string, unknown>,
  target: object,
  keys: string[]
) {
  const targetRecord = target as Record<string, unknown>
  for (const key of keys) {
    const value = finiteNumber(source[key])
    if (value !== undefined) targetRecord[key] = value
  }
}

function copyEnumField(
  source: Record<string, unknown>,
  target: object,
  key: string,
  allowed: string[]
) {
  if (typeof source[key] === 'string' && allowed.includes(source[key])) {
    (target as Record<string, unknown>)[key] = source[key]
  }
}
