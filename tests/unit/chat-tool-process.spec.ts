import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeSseBuffer, streamMessage, type SseHandlers } from '@/api/app'
import type { ChatMessage } from '@/api/types'
import { historyMessage } from '@/domain/chat-history'
import { reconcileChatTurn, type RecoverableMessage } from '@/domain/chat-recovery'
import { mergeToolCalls, sanitizeToolCall, toolCallDisplayStatus, MAX_TOOL_CALLS, type ChatToolCall } from '@/domain/chat-tool-calls'
import { mergeProcessTimeline, sanitizeProcessTimeline, MAX_PROCESS_TIMELINE, type ProcessTimelineEntry } from '@/domain/chat-process-timeline'
import { applyProcessAgent, applyProcessReasoning, applyProcessSnapshot, applyProcessTool, type ChatProcessState } from '@/domain/chat-process-state'
import { processTimestamp } from '@/domain/chat-reasoning'
import fixture from '../fixtures/tool-process-jackson.json'

const call: ChatToolCall = { turnId: 't', callId: 'c1', tool: 'weather', title: '查询天气', sequence: 1, status: 'running' }
const reason = (sequence: number, delta: string) => ({ turnId: 't', sequence, step: 'writer_agent', kind: 'reasoning', delta })
const saved = (metadata: Record<string, unknown>): ChatMessage => ({
  id: 'm', role: 'assistant', turnId: 't', conversationId: 'c', content: '回答正文', createdAt: '', metadata
})

afterEach(() => vi.unstubAllGlobals())

describe('safe real tool calls', () => {
  it('accepts stringified Java Long values and retains only bounded presentation fields', () => {
    expect(sanitizeToolCall({ ...call, sequence: '1', durationMs: '204', summary: '查询北京天气',
      arguments: { token: 'secret' }, output: { raw: 'hidden' } }, 't')).toEqual({ ...call, durationMs: 204, summary: '查询北京天气' })
    expect(sanitizeToolCall({ ...call, title: '字'.repeat(90), summary: '字'.repeat(300), durationMs: 12.5 }))
      .toMatchObject({ title: '字'.repeat(80), summary: '字'.repeat(240), durationMs: 12.5 })
    for (const sequence of ['0', '', '01', '-1', '1.0', '1e2', '1oops', '9007199254740992', true, null]) {
      expect(sanitizeToolCall({ ...call, sequence })).toBeUndefined()
    }
    for (const invalid of [{ callId: '../file' }, { tool: '<script>' }, { title: ' ' }, { status: 'success' }, { turnId: 'other' }]) {
      expect(sanitizeToolCall({ ...call, ...invalid }, 't')).toBeUndefined()
    }
    for (const durationMs of [-1, Infinity, 86_400_001, '2e3']) {
      expect(sanitizeToolCall({ ...call, durationMs })?.durationMs).toBeUndefined()
    }
  })

  it('updates an invocation in place, retains repeated tools, and never resurrects a terminal call', () => {
    const running = mergeToolCalls([], [call, { ...call, callId: 'c2', sequence: 2 }], 't')
    const completed = mergeToolCalls(running, { ...call, sequence: 3, status: 'completed' }, 't')
    expect(completed.map(item => [item.callId, item.status])).toEqual([['c1', 'completed'], ['c2', 'running']])
    for (const event of [call, { ...call, sequence: 4 }, { ...call, sequence: 4, status: 'failed' },
      { ...call, sequence: 4, status: 'completed', tool: 'shell' }, { ...call, sequence: 4, turnId: 'other' }]) {
      expect(mergeToolCalls(completed, event, 't')).toEqual(completed)
    }
    expect(mergeToolCalls(completed, { ...call, sequence: 4, status: 'completed', summary: '完成查询' }, 't')[0])
      .toMatchObject({ summary: '完成查询', sequence: 4 })
    expect(toolCallDisplayStatus(call, false)).toBe('interrupted')
    expect(toolCallDisplayStatus({ ...call, status: 'awaiting_confirmation' }, false)).toBe('awaiting_confirmation')
  })

  it('prunes dropped invocation references when retaining the latest 128 calls', () => {
    const state: ChatProcessState = { toolCalls: [], processTimeline: [] }
    for (let index = 1; index <= MAX_TOOL_CALLS + 2; index++) applyProcessTool(state, { ...call, callId: `c${index}`, sequence: index }, 't')
    expect(state.toolCalls).toHaveLength(MAX_TOOL_CALLS)
    expect(state.processTimeline).toHaveLength(MAX_TOOL_CALLS)
    expect(state.toolCalls?.[0].callId).toBe('c3')
    expect(state.processTimeline?.[0]).toEqual({ type: 'tool', id: 'c3' })
  })
})

describe('one chronological process timeline', () => {
  it('interleaves accepted streams by arrival, coalesces adjacent reasoning, and updates statuses in place', () => {
    const state: ChatProcessState = { processTimeline: [] }
    applyProcessReasoning(state, reason(1, '先检查。'), 't')
    applyProcessTool(state, call, 't')
    applyProcessReasoning(state, reason(2, '再核对'), 't')
    applyProcessTool(state, { ...call, sequence: 2, status: 'completed' }, 't')
    applyProcessReasoning(state, reason(3, '结果。'), 't')
    applyProcessAgent(state, { turnId: 't', sequence: 100, step: 'writer_agent', status: 'running' }, 't')
    applyProcessReasoning(state, reason(4, '生成答案。'), 't')
    const accepted = structuredClone(state)
    applyProcessReasoning(state, reason(3, '重复'), 't')
    applyProcessTool(state, { ...call, sequence: 99, status: 'running' }, 't')
    applyProcessReasoning(state, { ...reason(5, '跨轮次'), turnId: 'other' }, 't')
    expect(state).toEqual(accepted)
    expect(state.processTimeline).toEqual([
      { type: 'reasoning', id: 'r-1', text: '先检查。', kind: 'reasoning', sequence: 1 },
      { type: 'tool', id: 'c1' },
      { type: 'reasoning', id: 'r-2', text: '再核对结果。', kind: 'reasoning', sequence: 3 },
      { type: 'agent', id: 'writer_agent' },
      { type: 'reasoning', id: 'r-4', text: '生成答案。', kind: 'reasoning', sequence: 4 }
    ])
    expect(state.reasoning?.text).toBe('先检查。再核对结果。生成答案。')
  })

  it('uses snapshot chronology when local subscription starts late, preserving newer local text and tool status', () => {
    const agent = { turnId: 't', sequence: 100, step: 'writer_agent' as const, status: 'completed' as const }
    const complete: ProcessTimelineEntry[] = [
      { type: 'agent', id: 'writer_agent' },
      { type: 'reasoning', id: 'r-1', text: '先检查。', kind: 'reasoning', sequence: 1 },
      { type: 'tool', id: 'c1' },
      { type: 'reasoning', id: 'r-2', text: '继续', kind: 'reasoning', sequence: 2 },
      { type: 'tool', id: 'c2' }
    ]
    const newerText = { type: 'reasoning' as const, id: 'r-2', text: '继续检查全部资料。', kind: 'reasoning' as const, sequence: 3 }
    const local: RecoverableMessage = { role: 'assistant', turnId: 't', content: '', phase: 'THINKING',
      toolCalls: [{ ...call, callId: 'c2', sequence: 4, status: 'completed' }], processTimeline: [newerText, { type: 'tool', id: 'c2' }] }
    const result = reconcileChatTurn(local, [saved({ phase: 'THINKING', agentProgress: [agent],
      toolCalls: [call, { ...call, callId: 'c2', sequence: '3' }], processTimeline: complete })])
    expect(result.processTimeline?.map(entry => entry.id)).toEqual(complete.map(entry => entry.id))
    expect(result.processTimeline?.[3]).toEqual(newerText)
    expect(result.toolCalls?.find(item => item.callId === 'c2')?.status).toBe('completed')
    const calls = [call, { ...call, callId: 'c2', sequence: 3 }]
    // Polling can return an older prefix; a capped snapshot can also omit its old prefix.
    expect(mergeProcessTimeline(complete, complete.slice(0, 3), [agent], calls)).toEqual(complete)
    expect(mergeProcessTimeline(complete, complete.slice(2), [agent], calls)).toEqual(complete)
  })

  it('retains latest bounded references and at most 16k reasoning characters', () => {
    const many = Array.from({ length: MAX_PROCESS_TIMELINE + 10 }, (_, index) => ({
      type: 'reasoning', id: `r-${index + 1}`, sequence: String(index + 1), kind: 'reasoning', text: '字'.repeat(40)
    }))
    const result = sanitizeProcessTimeline([{ type: 'tool', id: 'missing' }, ...many])!
    expect(result[0].id).toBe('r-11')
    expect(result.length).toBeLessThanOrEqual(MAX_PROCESS_TIMELINE)
    expect(result.reduce((sum, entry) => sum + (entry.type === 'reasoning' ? entry.text.length : 0), 0)).toBe(16_000)
    expect(sanitizeProcessTimeline([{ ...many[0], sequence: '1oops' }, { ...many[0], id: 'r-2' }])).toEqual([])
  })

  it('preserves local data through cancellation and isolates an empty retry from its old attempt', () => {
    const local: RecoverableMessage = { role: 'assistant', turnId: 't', content: '部分回答', phase: 'THINKING', processTimeline: [] }
    applyProcessTool(local, call, 't')
    applyProcessReasoning(local, reason(1, '检查资料。'), 't')
    const cancelled = reconcileChatTurn(local, [saved({ phase: 'FAILED', statusText: '已停止生成' })])
    expect(cancelled.phase).toBe('FAILED')
    expect(cancelled.toolCalls).toEqual([call])
    expect(cancelled.processTimeline).toEqual(local.processTimeline)
    const retry: ChatProcessState = { agentProgress: [], toolCalls: [], processTimeline: [] }
    applyProcessTool(retry, { ...call, callId: 'retry-call' }, 't')
    expect(retry.toolCalls?.map(item => item.callId)).toEqual(['retry-call'])
    expect(retry.processTimeline).toEqual([{ type: 'tool', id: 'retry-call' }])
    expect(retry.reasoning).toBeUndefined()
    expect(historyMessage({ ...saved({ toolCalls: [call] }), role: 'user' }).toolCalls).toEqual([])
  })

  it('does not claim legacy chronology when metadata only contains aggregate snapshots', () => {
    const state: ChatProcessState = { processTimeline: [] }
    applyProcessSnapshot(state, { toolCalls: [call], reasoning: { text: '历史摘要', kind: 'summary', sequence: '1' } }, 't')
    expect(state.processTimeline).toBeUndefined()
    expect(historyMessage(saved({ toolCalls: [call] })).processTimeline).toBeUndefined()
  })
})

// Actual localhost HTTP frames and history serialization from ChatServiceImpl + production JacksonConfig.
describe('real Java tool timeline contract', () => {
  for (const mode of ['liveFrames', 'replayFrames'] as const) {
    it(`decodes ${mode} across UTF-8 byte boundaries without mixing tool/reasoning into the answer`, async () => {
      const state: RecoverableMessage = { role: 'assistant', content: '', turnId: fixture.turnId, phase: 'THINKING', processTimeline: [] }
      const handlers: SseHandlers = {
        onDelta: chunk => { state.content += chunk },
        onAgentStep: event => applyProcessAgent(state, event, fixture.turnId),
        onToolCall: event => applyProcessTool(state, event, fixture.turnId),
        onReasoningDelta: event => applyProcessReasoning(state, event, fixture.turnId),
        onMeta: meta => applyProcessSnapshot(state, meta, fixture.turnId),
        onTurnStatus: event => { state.phase = event.phase;
          state.processStartedAt = processTimestamp(event.processStartedAt) ?? state.processStartedAt
          state.processCompletedAt = processTimestamp(event.processCompletedAt) ?? state.processCompletedAt }
      }
      const bytes = new TextEncoder().encode(fixture[mode].join(''))
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        // One-byte chunks guarantee a split inside every Chinese character, not just between frames.
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      } })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
      await streamMessage({ turnId: fixture.turnId, message: '天气', knowledgeBaseIds: [] }, handlers)
      const history = historyMessage({ ...saved(fixture.historyMetadata), turnId: fixture.turnId })
      expect(state.content).toBe('已查询，请确认后续操作。')
      expect(state.toolCalls).toEqual(history.toolCalls)
      expect(state.processTimeline).toEqual(history.processTimeline)
      expect(state.processTimeline?.map(entry => entry.id)).toEqual(['tool_agent', 'r-1', 'first', 'r-2', 'second', 'r-3'])
      expect(state.reasoning?.text).toBe('先检查需求🙂。确认查询结果。准备等待确认。将保留操作。')
      expect(state.toolCalls?.map(item => item.status)).toEqual(['completed', 'awaiting_confirmation'])
      expect(state.processStartedAt).toBe(Number(fixture.historyMetadata.processStartedAt))
      expect(state.processCompletedAt).toBe(Number(fixture.historyMetadata.processCompletedAt))
      expect(state.phase).toBe('COMPLETED')
      const beforeReplay = structuredClone(state)
      consumeSseBuffer(fixture.replayFrames.find(frame => frame.startsWith('event: meta'))!, handlers)
      expect(state).toEqual(beforeReplay)
    })
  }
})
