import { chatWireInteger } from './chat-wire'

export const MAX_TOOL_CALLS = 128
export const TOOL_CALL_STATUSES = ['running', 'completed', 'failed', 'awaiting_confirmation', 'needs_clarification', 'interrupted'] as const
export type ToolCallStatus = typeof TOOL_CALL_STATUSES[number]
export interface ChatToolCall {
  turnId: string
  sequence: number
  callId: string
  tool: string
  title: string
  status: ToolCallStatus
  summary?: string
  durationMs?: number
}

export function sanitizeToolCall(value: unknown, turnId?: string): ChatToolCall | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  const sequence = chatWireInteger(item.sequence)
  if (typeof item.turnId !== 'string' || !item.turnId || (turnId && item.turnId !== turnId)
    || sequence === undefined || sequence < 1
    || typeof item.callId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item.callId)
    || typeof item.tool !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(item.tool)
    || typeof item.title !== 'string' || !item.title.trim()
    || !TOOL_CALL_STATUSES.includes(item.status as ToolCallStatus)) return undefined
  const duration = typeof item.durationMs === 'number' ? item.durationMs : chatWireInteger(item.durationMs)
  return {
    turnId: item.turnId, sequence, callId: item.callId, tool: item.tool,
    title: item.title.trim().slice(0, 80), status: item.status as ToolCallStatus,
    ...(typeof item.summary === 'string' && item.summary.trim() ? { summary: item.summary.trim().slice(0, 240) } : {}),
    ...(duration !== undefined && Number.isFinite(duration) && duration >= 0 && duration <= 86_400_000 ? { durationMs: duration } : {})
  }
}

/** Update each invocation in place; repeated calls to the same tool remain separate rows. */
export function mergeToolCalls(current: ChatToolCall[] | undefined, incoming: unknown, turnId?: string): ChatToolCall[] {
  const calls = new Map<string, ChatToolCall>()
  for (const raw of [...(current || []), ...(Array.isArray(incoming) ? incoming : [incoming])]) {
    const call = sanitizeToolCall(raw, turnId)
    if (!call) continue
    const previous = calls.get(call.callId)
    if (!previous || (call.sequence > previous.sequence && call.tool === previous.tool
      && (previous.status === 'running' || call.status === previous.status))) calls.set(call.callId, call)
  }
  return [...calls.values()].slice(-MAX_TOOL_CALLS)
}

export function toolCallDisplayStatus(call: ChatToolCall, active: boolean): ToolCallStatus {
  return call.status === 'running' && !active ? 'interrupted' : call.status
}

export const TOOL_CALL_STATUS_LABELS: Record<ToolCallStatus, string> = {
  running: '进行中', completed: '已完成', failed: '失败', awaiting_confirmation: '待确认',
  needs_clarification: '待补充信息', interrupted: '已中断'
}
