import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { consumeSseBuffer, type TurnStatusEvent } from '@/api/app'
import ChatThinkingProcess from '@/components/chat/ChatThinkingProcess.vue'
import { mergeAgentProgress, type AgentStepEvent } from '@/domain/chat-progress'
import { appendReasoning, mergeReasoning, processTimestamp, type ChatReasoning } from '@/domain/chat-reasoning'
import { historyMessage } from '@/domain/chat-history'
import jacksonFixture from '../fixtures/chat-process-jackson.json'

const progress = [
  { turnId: 'replay-turn', sequence: '1', step: 'supervisor_agent', status: 'completed' },
  { turnId: 'replay-turn', sequence: '3', step: 'writer_agent', status: 'completed' }
]
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

describe('persisted chat process over the Java SSE replay contract', () => {
  // Captured from the backend's localhost HTTP integration test with its real JacksonConfig,
  // including ToStringSerializer<Long>, durable metadata and the history/replay read paths.
  for (const [name, fixture] of Object.entries(jacksonFixture)) {
    for (const mode of ['liveFrames', 'replayFrames'] as const) {
      it(`renders the actual Java ${name} ${mode} after completion`, async () => {
        let items: AgentStepEvent[] = []
        let reasoning: ChatReasoning | undefined
        let phase: TurnStatusEvent['phase'] = 'THINKING'
        let startedAt: number | undefined
        let completedAt: number | undefined
        let answer = ''
        const handlers = {
          onDelta: (text: string) => { answer += text },
          onAgentStep: (event: AgentStepEvent) => { items = mergeAgentProgress(items, event, fixture.turnId) },
          onReasoningDelta: (event: unknown) => { reasoning = appendReasoning(reasoning, event, fixture.turnId) },
          onMeta: (meta: Record<string, unknown>) => {
            reasoning = mergeReasoning(reasoning, meta.reasoning)
            startedAt = processTimestamp(meta.processStartedAt) ?? startedAt
            completedAt = processTimestamp(meta.processCompletedAt) ?? completedAt
          },
          onTurnStatus: (event: TurnStatusEvent) => {
            phase = event.phase
            startedAt = processTimestamp(event.processStartedAt) ?? startedAt
            completedAt = processTimestamp(event.processCompletedAt) ?? completedAt
          }
        }
        let buffer = ''
        const wire = fixture[mode].join('')
        for (let offset = 0; offset < wire.length; offset += 19) {
          buffer = consumeSseBuffer(buffer + wire.slice(offset, offset + 19), handlers)
        }
        expect(buffer).toBe('')
        expect(answer).toBe('今天晴天。')
        expect(items).toMatchObject([{ step: 'tool_agent', sequence: 2, status: 'completed', durationMs: 100 }])
        expect(reasoning?.text).toBe(name === 'withReasoning' ? '先核对天气数据🙂。' : undefined)
        expect(startedAt).toBe(Number(fixture.historyMetadata.processStartedAt))
        expect(completedAt).toBe(Number(fixture.historyMetadata.processCompletedAt))
        const html = await renderToString(createSSRApp(ChatThinkingProcess, { items, reasoning, phase, startedAt, completedAt }))
        expect(html).toContain('aria-expanded="false"')
        expect(html).toContain('天气查询完成')
        expect(html).toContain('用时 0 秒')
      })
    }

    it(`restores the actual Java ${name} history metadata into a completed disclosure`, async () => {
      const message = historyMessage({ id: 'm', conversationId: 'c', turnId: fixture.turnId,
        role: 'assistant', content: '今天晴天。', createdAt: '', metadata: fixture.historyMetadata })
      expect(message.agentProgress).toHaveLength(1)
      expect(message.reasoning?.text).toBe(name === 'withReasoning' ? '先核对天气数据🙂。' : undefined)
      const html = await renderToString(createSSRApp(ChatThinkingProcess, {
        items: message.agentProgress || [], reasoning: message.reasoning, phase: message.phase,
        startedAt: message.processStartedAt, completedAt: message.processCompletedAt
      }))
      expect(html).toContain('aria-expanded="false"')
      expect(html).toContain('天气查询完成')
      expect(html).toContain('用时 0 秒')
    })
  }

  it('retains string-Long live frames through completion with reasoning and elapsed time', async () => {
    let items: AgentStepEvent[] = []
    let reasoning: ChatReasoning | undefined
    let phase: TurnStatusEvent['phase'] = 'THINKING'
    let startedAt: number | undefined
    let completedAt: number | undefined
    const wire = frame('turn.status', { turnId: 'replay-turn', phase: 'THINKING',
      message: '正在理解你的需求…', processStartedAt: '1789662595003' })
      + frame('agent.step', progress[0])
      + frame('reasoning.delta', { turnId: 'replay-turn', sequence: '1', step: 'writer_agent', kind: 'summary', delta: '已核对资料。' })
      + frame('delta', { text: '天气回答' })
      + frame('agent.step', progress[1])
      + frame('turn.status', { turnId: 'replay-turn', phase: 'COMPLETED', message: '回复完成',
        processStartedAt: '1789662595003', processCompletedAt: '1789662599003' })
      + frame('done', { turnId: 'replay-turn' })
    consumeSseBuffer(wire, {
      onDelta: () => undefined,
      onAgentStep: event => { items = mergeAgentProgress(items, event, 'replay-turn') },
      onReasoningDelta: event => { reasoning = appendReasoning(reasoning, event, 'replay-turn') },
      onTurnStatus: event => {
        phase = event.phase
        startedAt = processTimestamp(event.processStartedAt) ?? startedAt
        completedAt = processTimestamp(event.processCompletedAt) ?? completedAt
      }
    })
    expect(items).toHaveLength(2)
    expect(reasoning).toEqual({ text: '已核对资料。', kind: 'summary', sequence: 1 })
    const html = await renderToString(createSSRApp(ChatThinkingProcess, { items, reasoning, phase, startedAt, completedAt }))
    expect(html).toContain('data-testid="chat-thinking-process"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('已核对资料。')
    expect(html).toContain('用时 4 秒')
    expect(html).not.toContain('thinking-process__spinner')
  })

  it('retains the completed disclosure when replay sends steps only in meta and no reasoning', async () => {
    let items: AgentStepEvent[] = []
    let phase: TurnStatusEvent['phase'] = 'THINKING'
    // ChatServiceImpl.stream(existing turn) sends delta, replayMetadata, status and done.
    // Unlike a new request, replay does not send individual agent.step events.
    const wire = frame('delta', { text: '天气回答' })
      + frame('meta', { agentProgress: progress, processStartedAt: 1000, processCompletedAt: 5000 })
      + frame('turn.status', { turnId: 'replay-turn', phase: 'COMPLETED', message: '回复完成' })
      + frame('done', { turnId: 'replay-turn' })
    const handlers = {
      onDelta: () => undefined,
      onAgentStep: (event: AgentStepEvent) => { items = mergeAgentProgress(items, event, 'replay-turn') },
      onTurnStatus: (event: TurnStatusEvent) => { phase = event.phase }
    }
    const remainder = consumeSseBuffer(wire.slice(0, 73), handlers)
    expect(consumeSseBuffer(remainder + wire.slice(73), handlers)).toBe('')
    expect(items).toHaveLength(2)
    const html = await renderToString(createSSRApp(ChatThinkingProcess, { items, phase }))
    expect(html).toContain('data-testid="chat-thinking-process"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-agent="writer_agent" data-status="completed"')
    expect(html).not.toContain('模型思考')
  })

  it('keeps newer live events and rejects malformed or unrelated replay steps', () => {
    let items = mergeAgentProgress([], { ...progress[1], sequence: 7 }, 'replay-turn')
    const handlers = {
      onDelta: () => undefined,
      onAgentStep: (event: AgentStepEvent) => { items = mergeAgentProgress(items, event, 'replay-turn') }
    }
    consumeSseBuffer(frame('meta', { agentProgress: [
      ...progress,
      { ...progress[1], sequence: 99, turnId: 'different-turn' },
      { ...progress[1], sequence: 99, step: 'injected-step' },
      { ...progress[1], sequence: '99oops' }
    ] }), handlers)
    expect(items).toHaveLength(2)
    expect(items.find(item => item.step === 'writer_agent')?.sequence).toBe(7)
    consumeSseBuffer(frame('meta', {}), handlers)
    expect(items).toHaveLength(2)
  })
})
