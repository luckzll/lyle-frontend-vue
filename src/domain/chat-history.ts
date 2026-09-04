import type { ImageBatchItem, TurnStatusEvent } from '@/api/app'
import type {
  AgentTraceItem,
  ChatMessage,
  ChatRetrievalScope,
  ChatSource,
  ChatUsage,
  MemoryExclusions,
  ProjectChatContext,
  ToolResult,
  UsedMemory
} from '@/api/types'
import type { ChatAttachment } from '@/domain/chat-attachment'
import {
  sanitizeAgentTrace,
  sanitizeChatSources,
  sanitizeDebugVersion,
  sanitizeKnowledgeBaseIds,
  sanitizeMemoryExclusions,
  sanitizeProjectContext,
  sanitizeRetrievalScope,
  sanitizeReview,
  sanitizeToolResults,
  sanitizeUsedMemories
} from '@/domain/chat-safety'

export const CHAT_DEBUG_VERSION = 'chat-debug-v1'

export type ChatDebugDataState = 'pending' | 'available' | 'unsupported' | 'legacy' | 'unavailable'

export type RecoveredImageBatch = {
  batchId: string
  count: number
  mode: 'generate' | 'edit'
  status: 'RUNNING' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' | 'CANCELLED'
  completedCount: number
  failedCount: number
  items: ImageBatchItem[]
}

export type RecoveredChatMessage = {
  id?: string
  role: 'user' | 'assistant'
  content: string
  turnId?: string
  phase?: TurnStatusEvent['phase']
  statusText?: string
  imageBatch?: RecoveredImageBatch
  attachments?: ChatAttachment[]
  usage?: ChatUsage
  sources?: ChatSource[]
  agentTrace?: AgentTraceItem[]
  toolResults?: ToolResult[]
  projectContext?: ProjectChatContext
  review?: Record<string, unknown>
  usedMemories?: UsedMemory[]
  memoryExclusions?: MemoryExclusions
  memoryExplanationVersion?: string
  debugVersion?: string
  knowledgeBaseIds?: string[]
  retrievalScope?: ChatRetrievalScope
  debugTruncated?: boolean
  debugDataState?: ChatDebugDataState
}

export function historyMessage(item: ChatMessage): RecoveredChatMessage {
  const metadata = isRecord(item.metadata) ? item.metadata : {}
  const phase = historyTurnPhase(metadata.phase)
  const debugVersion = sanitizeDebugVersion(metadata.debugVersion)
  const resolvedDebugDataState = resolveChatDebugDataState(metadata.debugVersion)
  const debugDataState = item.role === 'assistant'
    ? phase === 'FAILED' && resolvedDebugDataState === 'legacy'
      ? 'unavailable'
      : resolvedDebugDataState
    : undefined
  return {
    id: item.id,
    role: item.role,
    content: item.content,
    turnId: item.turnId || (typeof metadata.turnId === 'string' ? metadata.turnId : undefined),
    phase,
    statusText: typeof metadata.statusText === 'string' ? metadata.statusText : undefined,
    imageBatch: historyImageBatch(metadata.imageBatch),
    attachments: Array.isArray(item.attachments) ? item.attachments : undefined,
    usage: historyUsage(metadata.usage),
    sources: sanitizeChatSources(metadata.sources),
    agentTrace: sanitizeAgentTrace(metadata.agentTrace),
    toolResults: sanitizeToolResults(metadata.toolResults),
    projectContext: sanitizeProjectContext(metadata.projectContext),
    review: sanitizeReview(metadata.review),
    usedMemories: sanitizeUsedMemories(metadata.usedMemories),
    memoryExclusions: sanitizeMemoryExclusions(metadata.memoryExclusions),
    memoryExplanationVersion: typeof metadata.memoryExplanationVersion === 'string'
      ? metadata.memoryExplanationVersion
      : undefined,
    debugVersion,
    knowledgeBaseIds: sanitizeKnowledgeBaseIds(metadata.knowledgeBaseIds),
    retrievalScope: sanitizeRetrievalScope(metadata.retrievalScope),
    debugTruncated: metadata.debugTruncated === true,
    debugDataState
  }
}
export function resolveChatDebugDataState(value: unknown): Extract<ChatDebugDataState, 'available' | 'unsupported' | 'legacy'> {
  if (sanitizeDebugVersion(value) === CHAT_DEBUG_VERSION) return 'available'
  return typeof value === 'string' && Boolean(value.trim()) ? 'unsupported' : 'legacy'
}

export function resolveLiveChatDebugDataState(value: unknown): Extract<ChatDebugDataState, 'available' | 'unsupported' | 'unavailable'> {
  const state = resolveChatDebugDataState(value)
  return state === 'legacy' ? 'unavailable' : state
}

export function resolveTerminalChatDebugDataState(state: ChatDebugDataState | undefined): ChatDebugDataState | undefined {
  return state === 'pending' ? 'unavailable' : state
}

export function isActiveTurnPhase(phase: TurnStatusEvent['phase'] | undefined) {
  return ['THINKING', 'ANALYZING', 'GENERATING', 'RESPONDING'].includes(String(phase || ''))
}

function historyTurnPhase(value: unknown): TurnStatusEvent['phase'] | undefined {
  const phase = String(value || '')
  return ['THINKING', 'ANALYZING', 'GENERATING', 'RESPONDING', 'COMPLETED', 'FAILED'].includes(phase)
    ? phase as TurnStatusEvent['phase']
    : undefined
}

function historyImageBatch(value: unknown): RecoveredImageBatch | undefined {
  if (!isRecord(value) || typeof value.batchId !== 'string') return undefined
  const status = String(value.status || '')
  if (!['RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) return undefined
  const items = Array.isArray(value.items)
    ? value.items.flatMap((raw): ImageBatchItem[] => {
        if (!isRecord(raw)) return []
        const itemStatus = String(raw.status || '')
        if (!['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(itemStatus)) return []
        return [{
          index: Number(raw.index || 0),
          status: itemStatus as ImageBatchItem['status'],
          imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : undefined,
          error: typeof raw.error === 'string' ? raw.error : undefined
        }]
      })
    : []
  return {
    batchId: value.batchId,
    count: Number(value.count || items.length || 1),
    mode: value.mode === 'edit' ? 'edit' : 'generate',
    status: status as RecoveredImageBatch['status'],
    completedCount: Number(value.completedCount || 0),
    failedCount: Number(value.failedCount || 0),
    items
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function historyUsage(value: unknown): ChatUsage | undefined {
  if (!isRecord(value)) return undefined
  return {
    promptTokens: Number(value.promptTokens || 0),
    completionTokens: Number(value.completionTokens || 0),
    callCount: Number(value.callCount || 0),
    estimatedCostMicros: Number(value.estimatedCostMicros || 0),
    measurementSource: ['PROVIDER_REPORTED', 'ESTIMATED', 'PARTIAL_ESTIMATE'].includes(String(value.measurementSource))
      ? value.measurementSource as ChatUsage['measurementSource']
      : 'PENDING'
  }
}
