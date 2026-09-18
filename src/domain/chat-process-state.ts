import { mergeAgentProgress, sanitizeAgentStep, type AgentStepEvent } from './chat-progress'
import { appendReasoning, mergeReasoning, processTimestamp, sanitizeReasoningDelta, type ChatReasoning } from './chat-reasoning'
import { mergeToolCalls, sanitizeToolCall, type ChatToolCall } from './chat-tool-calls'
import { appendProcessReasoning, appendProcessReference, mergeProcessTimeline, type ProcessTimelineEntry } from './chat-process-timeline'

export interface ChatProcessState {
  agentProgress?: AgentStepEvent[]
  toolCalls?: ChatToolCall[]
  processTimeline?: ProcessTimelineEntry[]
  reasoning?: ChatReasoning
  processStartedAt?: number
  processCompletedAt?: number
}

export function applyProcessAgent(state: ChatProcessState, raw: unknown, turnId: string) {
  const event = sanitizeAgentStep(raw, turnId)
  if (!event) return
  const first = !state.agentProgress?.some(item => item.step === event.step)
  state.agentProgress = mergeAgentProgress(state.agentProgress, event, turnId)
  if (first) state.processTimeline = appendProcessReference(state.processTimeline, 'agent', event.step)
}

export function applyProcessTool(state: ChatProcessState, raw: unknown, turnId: string) {
  const event = sanitizeToolCall(raw, turnId)
  if (!event) return
  const first = !state.toolCalls?.some(item => item.callId === event.callId)
  state.toolCalls = mergeToolCalls(state.toolCalls, event, turnId)
  state.processTimeline = mergeProcessTimeline(
    first ? appendProcessReference(state.processTimeline, 'tool', event.callId) : state.processTimeline,
    undefined, state.agentProgress || [], state.toolCalls
  )
}

export function applyProcessReasoning(state: ChatProcessState, raw: unknown, turnId: string) {
  const event = sanitizeReasoningDelta(raw, turnId)
  if (!event) return
  const previous = state.reasoning
  state.reasoning = appendReasoning(previous, event, turnId)
  if (state.reasoning === previous) return
  state.processTimeline = appendProcessReasoning(state.processTimeline, event)
}

export function applyProcessSnapshot(state: ChatProcessState, raw: unknown, turnId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const snapshot = raw as Record<string, unknown>
  state.agentProgress = mergeAgentProgress(state.agentProgress, snapshot.agentProgress, turnId)
  state.toolCalls = mergeToolCalls(state.toolCalls, snapshot.toolCalls, turnId)
  state.processTimeline = mergeProcessTimeline(state.processTimeline, snapshot.processTimeline, state.agentProgress, state.toolCalls)
  if (!Array.isArray(snapshot.processTimeline) && !state.processTimeline?.length
    && (state.agentProgress.length || state.toolCalls.length || snapshot.reasoning)) state.processTimeline = undefined
  state.reasoning = mergeReasoning(state.reasoning, snapshot.reasoning)
  state.processStartedAt = processTimestamp(snapshot.processStartedAt) ?? state.processStartedAt
  state.processCompletedAt = processTimestamp(snapshot.processCompletedAt) ?? state.processCompletedAt
}
