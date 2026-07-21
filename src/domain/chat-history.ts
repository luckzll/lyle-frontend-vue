import type { ImageBatchItem, TurnStatusEvent } from '@/api/app'
import type { ChatMessage } from '@/api/types'

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
  role: 'user' | 'assistant'
  content: string
  turnId?: string
  phase?: TurnStatusEvent['phase']
  statusText?: string
  imageBatch?: RecoveredImageBatch
}

export function historyMessage(item: ChatMessage): RecoveredChatMessage {
  const metadata = isRecord(item.metadata) ? item.metadata : {}
  return {
    role: item.role,
    content: item.content,
    turnId: item.turnId || (typeof metadata.turnId === 'string' ? metadata.turnId : undefined),
    phase: historyTurnPhase(metadata.phase),
    statusText: typeof metadata.statusText === 'string' ? metadata.statusText : undefined,
    imageBatch: historyImageBatch(metadata.imageBatch)
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
