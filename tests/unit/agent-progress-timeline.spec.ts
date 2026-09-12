import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import AgentProgressTimeline from '@/components/chat/AgentProgressTimeline.vue'
import { mergeAgentProgress } from '@/domain/chat-progress'

describe('agent progress timeline rendering', () => {
  it('stops presenting historical running steps as active once the turn has been cancelled or failed', async () => {
    const items = mergeAgentProgress([], [
      { turnId: 't', sequence: 2, step: 'supervisor_agent', status: 'completed' },
      { turnId: 't', sequence: 3, step: 'writer_agent', status: 'running', summary: '正在生成' }
    ], 't')
    const html = await renderToString(createSSRApp(AgentProgressTimeline, { items, phase: 'FAILED' }))
    expect(html).toContain('data-agent="writer_agent" data-status="interrupted"')
    expect(html).toContain('已中断')
    expect(html).toContain('此步骤未完成')
    expect(html).not.toContain('进行中')
    expect(html).not.toContain('正在生成')
    expect(html).not.toContain('data-agent="reviewer_agent"')
    expect(items[1].status).toBe('running')
  })

  it('renders only reported steps, including completed routing while retrieval is running', async () => {
    const items = mergeAgentProgress([], [
      { turnId: 't', sequence: 2, step: 'supervisor_agent', status: 'completed', durationMs: 1200 },
      { turnId: 't', sequence: 3, step: 'rag_agent', status: 'running' }
    ], 't')
    const html = await renderToString(createSSRApp(AgentProgressTimeline, { items, active: true }))
    expect(html).toContain('data-agent="supervisor_agent" data-status="completed"')
    expect(html).toContain('data-agent="rag_agent" data-status="running"')
    expect(html).toContain('1.2 秒')
    expect(html).not.toContain('data-agent="writer_agent"')
    expect(html).not.toContain('命中 0')
    expect(html).toContain('步骤状态实时更新')
  })

  it('renders safe text and translated per-query timings in step details', async () => {
    const items = mergeAgentProgress([], { turnId: 't', sequence: 4, step: 'rag_agent', status: 'completed',
      summary: '<script>unsafe()</script>', timings: { query_1_embedding_ms: 230, query_rewrite_ms: 700, token: 123 } }, 't')
    const html = await renderToString(createSSRApp(AgentProgressTimeline, { items }))
    expect(html).toContain('查询 1 · 查询向量化')
    expect(html).toContain('查询改写')
    expect(html).toContain('230 毫秒')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('query_1_embedding_ms')
    expect(html).not.toContain('token')
  })
})
