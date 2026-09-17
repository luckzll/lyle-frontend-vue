import { describe, expect, it, vi } from 'vitest'
import { consumeSseBuffer } from '@/api/app'
import { appendReasoning, mergeReasoning, sanitizeReasoning, processTimestamp, MAX_REASONING_CHARS } from '@/domain/chat-reasoning'
import { historyMessage } from '@/domain/chat-history'
import { reconcileChatTurn } from '@/domain/chat-recovery'
import type { ChatMessage } from '@/api/types'

const delta = { turnId: 't', sequence: 1, step: 'writer_agent', kind: 'summary', delta: '先核对资料。' }
const snapshot = { text: '先核对资料。', kind: 'summary' as const, sequence: 1 }
const stored = (reasoning: unknown, phase = 'COMPLETED'): ChatMessage => ({
  id: 'm', conversationId: 'c', turnId: 't', role: 'assistant', content: '最终答案', createdAt: '',
  metadata: { reasoning, phase, processStartedAt: 1000, processCompletedAt: phase === 'COMPLETED' ? 5000 : undefined }
})

describe('provider reasoning display stream', () => {
  it('accepts production Jackson Long string sequences and timestamps from SSE and history', () => {
    expect(appendReasoning(undefined, { ...delta, sequence: '1' }, 't')).toEqual(snapshot)
    expect(sanitizeReasoning({ ...snapshot, sequence: '1' })).toEqual(snapshot)
    expect(mergeReasoning(snapshot, { ...snapshot, text: '后续摘要', sequence: '10' }))
      .toEqual({ ...snapshot, text: '后续摘要', sequence: 10 })
    expect(processTimestamp('1789662595003')).toBe(1789662595003)
    const history = stored({ ...snapshot, sequence: '1' })
    history.metadata!.processStartedAt = '1789662595003'
    history.metadata!.processCompletedAt = '1789662599003'
    expect(historyMessage(history)).toMatchObject({ reasoning: snapshot,
      processStartedAt: 1789662595003, processCompletedAt: 1789662599003 })
  })

  it('rejects unsafe, zero and noncanonical reasoning sequence and timestamp strings', () => {
    for (const sequence of ['0', '', ' ', '01', '-1', '1.5', '1e2', '0x10', '1oops',
      '9007199254740992', Number.MAX_SAFE_INTEGER + 1, null, true, []]) {
      expect(sanitizeReasoning({ ...snapshot, sequence })).toBeUndefined()
      expect(appendReasoning(undefined, { ...delta, sequence }, 't')).toBeUndefined()
      expect(processTimestamp(sequence)).toBeUndefined()
    }
  })

  it('keeps partial SSE chunks separate from answer and tool events', () => {
    const handlers = { onDelta: vi.fn(), onReasoningDelta: vi.fn(), onAgentStep: vi.fn() }
    const frame = `event: reasoning.delta\r\ndata: ${JSON.stringify(delta)}\r\n\r\n`
    const rest = consumeSseBuffer(frame.slice(0, 52), handlers)
    expect(handlers.onReasoningDelta).not.toHaveBeenCalled()
    expect(consumeSseBuffer(rest + frame.slice(52), handlers)).toBe('')
    expect(handlers.onReasoningDelta).toHaveBeenCalledExactlyOnceWith(delta)
    expect(handlers.onDelta).not.toHaveBeenCalled()
    expect(handlers.onAgentStep).not.toHaveBeenCalled()
  })

  it('ignores duplicate, stale, cross-turn and malformed deltas', () => {
    const first = appendReasoning(undefined, delta, 't')
    expect(first).toEqual(snapshot)
    for (const event of [delta, { ...delta, sequence: 0 }, { ...delta, sequence: 2, turnId: 'other' },
      { ...delta, sequence: 2, kind: 'raw_prompt' }, { ...delta, sequence: 2, step: 'fake' }, { ...delta, sequence: 2, delta: {} }]) {
      expect(appendReasoning(first, event, 't')).toBe(first)
    }
    expect(appendReasoning(first, { ...delta, sequence: 2, delta: '再比较结果。' }, 't')?.text).toBe('先核对资料。再比较结果。')
  })

  it('bounds growing output and does not fabricate absent reasoning', () => {
    expect(sanitizeReasoning(undefined)).toBeUndefined()
    expect(sanitizeReasoning({ text: '  ', kind: 'summary', sequence: 1 })).toBeUndefined()
    const text = '字'.repeat(MAX_REASONING_CHARS + 100)
    const full = appendReasoning(undefined, { ...delta, delta: text }, 't')
    const capped = appendReasoning(full, { ...delta, sequence: 2 }, 't')
    expect(capped?.text.length).toBe(MAX_REASONING_CHARS)
    expect(capped?.sequence).toBe(2)
  })

  it('replaces a replay snapshot without duplicating text', () => {
    expect(mergeReasoning(snapshot, { ...snapshot, sequence: 2, text: '完整摘要' })?.text).toBe('完整摘要')
    expect(mergeReasoning(snapshot, snapshot)).toBe(snapshot)
    expect(mergeReasoning(snapshot, undefined)).toBe(snapshot)
  })

  it('restores history and keeps streamed text while persistence trails during recovery', () => {
    expect(historyMessage(stored(snapshot))).toMatchObject({ reasoning: snapshot, processStartedAt: 1000, processCompletedAt: 5000 })
    const local = { role: 'assistant' as const, content: '', turnId: 't', phase: 'THINKING' as const,
      reasoning: { ...snapshot, sequence: 2, text: '已经显示的完整摘要' } }
    expect(reconcileChatTurn(local, [stored(snapshot, 'THINKING')]).reasoning).toEqual(local.reasoning)
    expect(reconcileChatTurn(local, [stored(undefined, 'FAILED')]).reasoning).toEqual(local.reasoning)
    expect(historyMessage({ ...stored(snapshot), role: 'user' }).reasoning).toBeUndefined()
  })
})
