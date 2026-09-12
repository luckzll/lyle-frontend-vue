import { describe, expect, it } from 'vitest'
import { agentProgressState, mergeAgentProgress, sanitizeAgentStep, sanitizeStageTimings, stageTimingLabel } from '@/domain/chat-progress'
import { historyMessage } from '@/domain/chat-history'
import { sanitizeAgentTrace } from '@/domain/chat-safety'

const event = { turnId: 'turn-1', sequence: 1, step: 'rag_agent', status: 'running' }

describe('real agent step progress', () => {
  it('does not mark unstarted steps as running or invent result evidence', () => {
    const progress = mergeAgentProgress([], event, 'turn-1')
    expect(agentProgressState(progress, 'rag_agent')).toBe('running')
    expect(agentProgressState(progress, 'writer_agent')).toBe('pending')
    expect(agentProgressState([], 'supervisor_agent')).toBe('pending')
    expect(progress[0]).not.toHaveProperty('contextCount')
  })

  it('ignores duplicate, stale, and cross-turn events while allowing independent steps', () => {
    let progress = mergeAgentProgress([], [event, { ...event, sequence: 4, status: 'completed' }], 'turn-1')
    progress = mergeAgentProgress(progress, [event, { ...event, sequence: 4, status: 'failed' },
      { ...event, sequence: 9, turnId: 'other' }, { ...event, sequence: 2, step: 'memory_agent' }], 'turn-1')
    expect(progress).toHaveLength(2)
    expect(agentProgressState(progress, 'rag_agent')).toBe('completed')
    expect(agentProgressState(progress, 'memory_agent')).toBe('running')
  })

  it('validates protocol fields and accepts only numeric allowlisted timings', () => {
    for (const patch of [{ status: 'anything' }, { step: '__proto__' }, { sequence: NaN }, { sequence: -1 }, { sequence: 0.5 }, { turnId: '' }]) {
      expect(sanitizeAgentStep({ ...event, ...patch })).toBeUndefined()
    }
    const clean = sanitizeAgentStep({ ...event, durationMs: -2, summary: 'x'.repeat(600), authorization: 'secret', timings: {
      embedding_ms: 30, query_1_vector_search_ms: 90, api_key: 123, total_ms: Infinity, rerank_ms: -1, writer_ms: '10'
    } })
    expect(clean?.summary).toHaveLength(500)
    expect(clean?.timings).toEqual({ embedding_ms: 30, query_1_vector_search_ms: 90 })
    expect(clean).not.toHaveProperty('authorization')
    expect(clean).not.toHaveProperty('durationMs')
    expect(stageTimingLabel('query_1_vector_search_ms')).toBe('查询 1 · 向量搜索')
    expect(stageTimingLabel('query_5_ms')).toBeUndefined()
    expect(stageTimingLabel('diagnostics_ms')).toBe('诊断信息汇总')
    expect(stageTimingLabel('query_2_merge_ms')).toBe('查询 2 · 结果合并')
    expect(sanitizeStageTimings({ diagnostics_ms: 20, query_2_merge_ms: 3 })).toEqual({ diagnostics_ms: 20, query_2_merge_ms: 3 })
    expect(sanitizeStageTimings(['fake'])).toBeUndefined()
  })

  it('shows recorded running steps as interrupted after turn failure without inventing unstarted steps', () => {
    const progress = mergeAgentProgress([], event, 'turn-1')
    expect(agentProgressState(progress, 'rag_agent', 'FAILED')).toBe('interrupted')
    expect(agentProgressState(progress, 'writer_agent', 'FAILED')).toBe('pending')
    expect(progress[0].status).toBe('running')
    const finalProgress = mergeAgentProgress(progress, { ...event, sequence: 2, status: 'failed', summary: '已停止生成' }, 'turn-1')
    expect(agentProgressState(finalProgress, 'rag_agent', 'FAILED')).toBe('failed')
    expect(finalProgress[0].sequence).toBe(2)
  })

  it('restores progress after refresh without presenting a final ledger prematurely', () => {
    const message = historyMessage({ id: 'm', role: 'assistant', turnId: 'turn-1', conversationId: 'c', content: '', createdAt: '',
      metadata: { phase: 'ANALYZING', agentProgress: [event, { ...event, sequence: 8, turnId: 'other' }] } })
    expect(message.agentProgress).toEqual([event])
    expect(message.debugDataState).toBe('pending')
    expect(message.agentTrace).toEqual([])
    expect(message.sources).toEqual([])
  })

  it('retains final trace timings without retaining arbitrary diagnostic fields', () => {
    const [trace] = sanitizeAgentTrace([{ agent: 'rag_agent', durationMs: 1500,
      timings: { query_rewrite_ms: 800, query_2_ms: 500, embedding_ms: -1, accessToken: 10 }, secret: 'hidden' }])
    expect(trace.timings).toEqual({ query_rewrite_ms: 800, query_2_ms: 500 })
    expect(trace.durationMs).toBe(1500)
    expect(trace).not.toHaveProperty('secret')
  })
})
