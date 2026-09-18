import type { AgentStepEvent } from './chat-progress'
import { MAX_REASONING_CHARS, type ReasoningDelta } from './chat-reasoning'
import type { ChatToolCall } from './chat-tool-calls'
import { chatWireInteger } from './chat-wire'

export const MAX_PROCESS_TIMELINE = 512
export type ProcessTimelineEntry = { type: 'agent' | 'tool'; id: string }
  | { type: 'reasoning'; id: string; text: string; kind: 'reasoning' | 'summary'; sequence: number }

export function sanitizeProcessTimeline(value: unknown, agents: AgentStepEvent[] = [], calls: ChatToolCall[] = []): ProcessTimelineEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const agentIds = new Set(agents.map(item => item.step))
  const callIds = new Set(calls.map(item => item.callId))
  const entries = new Map<string, ProcessTimelineEntry>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string') continue
    if (item.type === 'agent' && agentIds.has(item.id as AgentStepEvent['step'])) {
      entries.set(`agent:${item.id}`, { type: 'agent', id: item.id })
    } else if (item.type === 'tool' && callIds.has(item.id)) {
      entries.set(`tool:${item.id}`, { type: 'tool', id: item.id })
    } else if (item.type === 'reasoning' && /^r-[1-9]\d{0,15}$/.test(item.id)
      && typeof item.text === 'string' && (item.kind === 'reasoning' || item.kind === 'summary')) {
      const sequence = chatWireInteger(item.sequence)
      const firstSequence = chatWireInteger(item.id.slice(2))
      if (!sequence || !firstSequence || firstSequence > sequence) continue
      const previous = entries.get(`reasoning:${item.id}`)
      if (!previous || (previous.type === 'reasoning' && item.kind === previous.kind && sequence > previous.sequence)) {
        entries.set(`reasoning:${item.id}`, { type: 'reasoning', id: item.id, text: item.text.slice(0, MAX_REASONING_CHARS), kind: item.kind, sequence })
      }
    }
  }
  let remaining = MAX_REASONING_CHARS
  return [...entries.values()].slice(-MAX_PROCESS_TIMELINE).flatMap<ProcessTimelineEntry>(entry => {
    if (entry.type !== 'reasoning') return [entry]
    const text = entry.text.slice(0, remaining)
    remaining -= text.length
    return text ? [{ ...entry, text }] : []
  })
}

export function appendProcessReference(current: ProcessTimelineEntry[] | undefined, type: 'agent' | 'tool', id: string): ProcessTimelineEntry[] {
  const entries = current || []
  return entries.some(entry => entry.type === type && entry.id === id)
    ? entries : [...entries, { type, id }].slice(-MAX_PROCESS_TIMELINE)
}

/** Only call after accepting the reasoning sequence; adjacent chunks form one visible paragraph. */
export function appendProcessReasoning(current: ProcessTimelineEntry[] | undefined, event: ReasoningDelta): ProcessTimelineEntry[] {
  const entries = [...(current || [])]
  const used = entries.reduce((count, entry) => count + (entry.type === 'reasoning' ? entry.text.length : 0), 0)
  const delta = event.delta.slice(0, Math.max(0, MAX_REASONING_CHARS - used))
  if (!delta) return entries
  const last = entries[entries.length - 1]
  if (last?.type === 'reasoning' && last.kind === event.kind) {
    if (event.sequence <= last.sequence) return entries
    entries[entries.length - 1] = { ...last, text: last.text + delta, sequence: event.sequence }
  } else {
    entries.push({ type: 'reasoning', id: `r-${event.sequence}`, text: delta, kind: event.kind, sequence: event.sequence })
  }
  return entries.slice(-MAX_PROCESS_TIMELINE)
}

/** Restore missing chronology while keeping newer local segments and display text. */
export function mergeProcessTimeline(current: ProcessTimelineEntry[] | undefined, snapshot: unknown, agents: AgentStepEvent[], calls: ChatToolCall[]): ProcessTimelineEntry[] | undefined {
  const next = sanitizeProcessTimeline(snapshot, agents, calls)
  if (!next) return sanitizeProcessTimeline(current, agents, calls)
  const local = sanitizeProcessTimeline(current, agents, calls) || []
  const key = (entry: ProcessTimelineEntry) => `${entry.type}:${entry.id}`
  const ordered = [...next]
  const present = new Set(ordered.map(key))
  // Shared entries anchor local gaps. This also handles capped snapshots that retain a suffix.
  for (let index = 0; index < local.length; index++) {
    const entry = local[index]
    if (present.has(key(entry))) continue
    const anchor = local.slice(index + 1).find(item => present.has(key(item)))
    const position = anchor ? ordered.findIndex(item => key(item) === key(anchor)) : ordered.length
    ordered.splice(position, 0, entry)
    present.add(key(entry))
  }
  return sanitizeProcessTimeline([...ordered, ...local], agents, calls)
}

/** A deliberately small Markdown subset: Vue escapes every token, so provider text never becomes HTML. */
export function processTextParts(text: string): Array<{ type: 'text' | 'strong' | 'code'; text: string }> {
  const result: Array<{ type: 'text' | 'strong' | 'code'; text: string }> = []
  const pattern = /\*\*([^*]+)\*\*|`([^`\n]+)`/g
  let offset = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index! > offset) result.push({ type: 'text', text: text.slice(offset, match.index) })
    result.push({ type: match[1] ? 'strong' : 'code', text: match[1] || match[2] })
    offset = match.index! + match[0].length
  }
  if (offset < text.length) result.push({ type: 'text', text: text.slice(offset) })
  return result
}
