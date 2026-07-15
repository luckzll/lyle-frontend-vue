import type {
  AgentTraceItem,
  ChatSource,
  ExecutionSuggestionItem,
  Goal,
  PendingOperationItem,
  ProjectChatContext,
  ToolResult
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
export function sanitizeAgentTrace(items: AgentTraceItem[] | undefined): AgentTraceItem[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, 40).map((item) => {
    const safe: AgentTraceItem = {
      agent: safeText(item.agent, 80) || 'unknown'
    }
    copyBooleanFields(item, safe, ['approved', 'skipped', 'streaming', 'ruleBlocked'])
    copyNumberFields(item, safe, ['answerChars', 'rewriteAttempt', 'toolCount', 'contextCount', 'queryCount'])
    copyEnumField(item, safe, 'action', ['read', 'write'])

    const selectedTools = safeStringArray(item.selectedTools, 20, 80)
    if (selectedTools.length) safe.selectedTools = selectedTools

    const writerInput = record(item.writerInput)
    if (writerInput) {
      safe.writerInput = numericRecord(writerInput, [
        'memoryContextChars',
        'toolContextChars',
        'ragContextCount',
        'combinedContextChars'
      ])
    }

    const memorySummary = record(item.memorySummary)
    if (memorySummary) {
      safe.memorySummary = {
        ...numericRecord(memorySummary, [
          'summaryChars',
          'shortTermCount',
          'structuredCount',
          'semanticCount',
          'retrievedCount'
        ]),
        structuredPreview: safeStringArray(memorySummary.structuredPreview, 8, MAX_TRACE_TEXT),
        retrievedPreview: safeStringArray(memorySummary.retrievedPreview, 3, MAX_TRACE_TEXT),
        summaryPreview: safeText(memorySummary.summaryPreview, 1000)
      }
    }

    const decision = record(item.decision)
    if (decision) {
      safe.decision = {
        depth: safeText(decision.depth, 40),
        selected_tools: safeStringArray(decision.selected_tools, 20, 80),
        reason: safeText(decision.reason, MAX_TRACE_TEXT)
      }
    }
    return safe
  })
}

export function sanitizeToolResults(items: ToolResult[] | undefined): ToolResult[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, 40).map((item) => {
    const safe: ToolResult = {
      tool: safeText(item.tool, 100) || 'unknown',
      ok: item.ok === true,
      // Never retain an extensible raw tool payload. The assistant answer and
      // the whitelisted operation preview carry the user-facing information.
      content: item.operation?.summary
        ? safeText(item.operation.summary, 500)
        : item.requiresConfirmation
          ? '工具已准备，等待用户确认。'
          : item.ok === true
            ? '工具执行已完成。'
            : '工具执行未完成。'
    }
    if (item.requiresConfirmation === true) safe.requiresConfirmation = true
    if (item.operation) safe.operation = sanitizePendingOperation(item.operation)
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
    return safe
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

export function sanitizeProjectContext(value: ProjectChatContext | undefined): ProjectChatContext | undefined {
  if (!value) return undefined
  const resolver = value.resolver
    ? {
        projectId: positiveInteger(value.resolver.projectId),
        projectName: safeText(value.resolver.projectName, 240),
        confidence: finiteNumber(value.resolver.confidence),
        requiresClarification: value.resolver.requiresClarification === true,
        reason: safeText(value.resolver.reason, MAX_TRACE_TEXT),
        linkedConversation: value.resolver.linkedConversation === true
      }
    : undefined
  const goals = Array.isArray(value.context?.goals)
    ? value.context.goals.slice(0, 6).map(sanitizeGoal)
    : []
  const nextStepSuggestions = safeStringArray(value.context?.nextStepSuggestions, 8, 500)
  return {
    ...(resolver ? { resolver } : {}),
    ...(goals.length || nextStepSuggestions.length
      ? { context: { goals, nextStepSuggestions } }
      : {})
  }
}

export function sanitizeReview(value: Record<string, unknown> | undefined): Record<string, unknown> {
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

export function sanitizeChatSources(items: ChatSource[] | undefined): ChatSource[] {
  if (!Array.isArray(items)) return []
  return items.slice(0, 50).map((item) => ({
    docId: safeText(item.docId, 160),
    title: safeText(item.title, 300),
    chunk: safeText(item.chunk, 4000),
    ...(item.score ? { score: safeText(item.score, 40) } : {}),
    ...(item.backend ? { backend: safeText(item.backend, 80) } : {}),
    ...(item.hitModes ? { hitModes: safeText(item.hitModes, 120) } : {}),
    ...(item.chunkIndex ? { chunkIndex: safeText(item.chunkIndex, 40) } : {}),
    ...(item.parentTitle ? { parentTitle: safeText(item.parentTitle, 300) } : {}),
    ...(item.startChar ? { startChar: safeText(item.startChar, 40) } : {}),
    ...(item.endChar ? { endChar: safeText(item.endChar, 40) } : {})
  }))
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

function numericRecord(source: Record<string, unknown>, keys: string[]): Record<string, number> {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = finiteNumber(source[key])
    return value === undefined ? [] : [[key, value]]
  }))
}

function copyBooleanFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  keys: string[]
) {
  for (const key of keys) {
    if (typeof source[key] === 'boolean') target[key] = source[key]
  }
}

function copyNumberFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  keys: string[]
) {
  for (const key of keys) {
    const value = finiteNumber(source[key])
    if (value !== undefined) target[key] = value
  }
}

function copyEnumField(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  key: string,
  allowed: string[]
) {
  if (typeof source[key] === 'string' && allowed.includes(source[key])) target[key] = source[key]
}
