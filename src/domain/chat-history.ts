import type { ImageBatchItem, TurnStatusEvent } from '@/api/app'
import type { ChatMessage, ChatUsage, MemoryExclusions, UsedMemory } from '@/api/types'
import type { ChatAttachment } from '@/domain/chat-attachment'

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
  usedMemories?: UsedMemory[]
  memoryExclusions?: MemoryExclusions
  memoryExplanationVersion?: string
}

export function historyMessage(item: ChatMessage): RecoveredChatMessage {
  const metadata = isRecord(item.metadata) ? item.metadata : {}
  return {
    id: item.id,
    role: item.role,
    content: item.content,
    turnId: item.turnId || (typeof metadata.turnId === 'string' ? metadata.turnId : undefined),
    phase: historyTurnPhase(metadata.phase),
    statusText: typeof metadata.statusText === 'string' ? metadata.statusText : undefined,
    imageBatch: historyImageBatch(metadata.imageBatch),
    attachments: Array.isArray(item.attachments) ? item.attachments : undefined,
    usage: historyUsage(metadata.usage),
    usedMemories: historyUsedMemories(metadata.usedMemories),
    memoryExclusions: historyMemoryExclusions(metadata.memoryExclusions),
    memoryExplanationVersion: typeof metadata.memoryExplanationVersion === 'string'
      ? metadata.memoryExplanationVersion
      : undefined
  }
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

function historyUsedMemories(value: unknown): UsedMemory[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.flatMap((raw): UsedMemory[] => {
    if (!isRecord(raw)) return []
    const memoryId = typeof raw.memoryId === 'string' ? raw.memoryId : ''
    const title = typeof raw.title === 'string' ? raw.title : ''
    const valueSummary = typeof raw.valueSummary === 'string' ? raw.valueSummary : ''
    if (!memoryId || !title || !valueSummary) return []
    const reliability = String(raw.reliability || '')
    return [{
      memoryId,
      title,
      valueSummary,
      reasonCode: typeof raw.reasonCode === 'string' ? raw.reasonCode : 'QUESTION_RELEVANT',
      reliability: ['RELIABLE', 'BASIC', 'REVIEW_REQUIRED'].includes(reliability)
        ? reliability as UsedMemory['reliability']
        : 'REVIEW_REQUIRED',
      sourceCount: Math.max(0, Number(raw.sourceCount || 0))
    }]
  })
  return items.length ? items : undefined
}

function historyMemoryExclusions(value: unknown): MemoryExclusions | undefined {
  if (!isRecord(value)) return undefined
  return {
    conflicted: Math.max(0, Number(value.conflicted || 0)),
    sensitive: Math.max(0, Number(value.sensitive || 0)),
    governed: Math.max(0, Number(value.governed || 0))
  }
}
