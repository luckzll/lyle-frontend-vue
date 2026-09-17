/** Only provider-supplied display text belongs here; it never becomes answer content. */
export const MAX_REASONING_CHARS = 16_000

export interface ChatReasoning {
  text: string
  kind: 'reasoning' | 'summary'
  sequence: number
}

export interface ReasoningDelta {
  turnId: string
  sequence: number
  step: 'writer_agent'
  delta: string
  kind: ChatReasoning['kind']
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function sanitizeReasoning(value: unknown): ChatReasoning | undefined {
  if (!record(value) || !validSequence(value.sequence) || typeof value.text !== 'string'
    || !value.text.trim() || !['reasoning', 'summary'].includes(String(value.kind))) return undefined
  return { text: value.text.slice(0, MAX_REASONING_CHARS), kind: value.kind as ChatReasoning['kind'], sequence: value.sequence }
}

export function sanitizeReasoningDelta(value: unknown, turnId?: string): ReasoningDelta | undefined {
  if (!record(value) || typeof value.turnId !== 'string' || !value.turnId
    || (turnId && value.turnId !== turnId) || !validSequence(value.sequence)
    || value.step !== 'writer_agent' || typeof value.delta !== 'string' || !value.delta
    || !['reasoning', 'summary'].includes(String(value.kind))) return undefined
  return { turnId: value.turnId, sequence: value.sequence, step: 'writer_agent',
    delta: value.delta.slice(0, MAX_REASONING_CHARS), kind: value.kind as ChatReasoning['kind'] }
}

export function appendReasoning(current: ChatReasoning | undefined, value: unknown, turnId: string): ChatReasoning | undefined {
  const event = sanitizeReasoningDelta(value, turnId)
  if (!event || (current && (event.sequence <= current.sequence || event.kind !== current.kind))) return current
  return { text: ((current?.text || '') + event.delta).slice(0, MAX_REASONING_CHARS), kind: event.kind, sequence: event.sequence }
}

/** Replayed/persisted snapshots replace, rather than append to, already visible text. */
export function mergeReasoning(current: ChatReasoning | undefined, snapshot: unknown): ChatReasoning | undefined {
  const next = sanitizeReasoning(snapshot)
  if (!next || (current && next.sequence <= current.sequence)) return current
  return next
}

export function processTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}
