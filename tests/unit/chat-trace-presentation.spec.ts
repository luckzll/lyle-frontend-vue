import { describe, expect, it } from 'vitest'
import { formatTraceDuration, presentAgentTrace } from '@/domain/chat-trace-presentation'
import { sanitizeAgentTrace } from '@/domain/chat-safety'

describe('chat trace presentation', () => {
  it('explains project resolution without exposing its implementation name or inventing a match', () => {
    expect(presentAgentTrace({ agent: 'project_resolver' })).toMatchObject({
      name: '识别项目', statusLabel: '结果未记录', tone: 'neutral',
      purpose: '判断当前问题属于哪个项目',
      summary: '已进入项目识别步骤，未保存具体匹配结果', duration: null
    })
    expect(presentAgentTrace({ agent: 'project_resolver' }, {
      projectContext: { resolver: { projectId: null, reason: '未命中项目关键词' } }
    })).toMatchObject({ statusLabel: '未匹配', tone: 'neutral', summary: '未命中项目关键词' })
  })

  it('distinguishes matching, linking and ambiguous project results', () => {
    const trace = { agent: 'project_resolver' }
    expect(presentAgentTrace(trace, {
      projectContext: { resolver: { projectId: 42, projectName: 'Lyle' } }
    })).toMatchObject({ statusLabel: '已匹配', summary: '匹配项目「Lyle」' })
    expect(presentAgentTrace(trace, {
      projectContext: { resolver: { projectId: 42, projectName: 'Lyle', linkedConversation: true } }
    }).statusLabel).toBe('已关联')
    expect(presentAgentTrace(trace, {
      projectContext: { resolver: { projectId: 42, projectName: 'Lyle', requiresClarification: true } }
    })).toMatchObject({ statusLabel: '需要确认', tone: 'warning' })
    expect(presentAgentTrace(trace, {
      projectContext: { resolver: { projectId: null, reason: 'project_store_unavailable:TimeoutError' } }
    })).toMatchObject({ statusLabel: '暂不可用', summary: '项目数据暂时不可用' })
  })

  it('does not turn an absent count into zero or conflate recalled memory with new candidates', () => {
    const recalled = presentAgentTrace({
      agent: 'memory_agent', memorySummary: { structuredCount: 5, semanticCount: 15, retrievedCount: 0 }
    })
    expect(recalled.name).toBe('记忆召回')
    expect(recalled.summary).toBe('合并召回 0 条 · 结构化记忆 5 条 · 语义记忆 15 条')
    expect(recalled.summary).not.toContain('长期摘要')
    const candidates = presentAgentTrace({
      agent: 'memory_agent', action: 'candidate_ready', candidateCount: 2
    })
    expect(candidates).toMatchObject({
      name: '记忆整理', statusLabel: '候选已就绪', tone: 'neutral',
      summary: '整理出 2 条候选记忆；后续写入结果未记录'
    })
    expect(presentAgentTrace({ agent: 'memory_agent', action: 'write' })).toMatchObject({
      name: '记忆写入', statusLabel: '已发起', summary: '已发起记忆写入，完成结果未记录'
    })
  })

  it('labels a disabled model reviewer as skipped instead of claiming a model or rule pass', () => {
    const trace = { agent: 'reviewer_agent', skipped: true, approved: true, score: 1 }
    const skipped = presentAgentTrace(trace)
    expect(skipped).toMatchObject({ statusLabel: '已跳过', tone: 'neutral' })
    expect(skipped.summary).not.toContain('通过')
    expect(presentAgentTrace(trace, { review: { reason: 'Reviewer disabled', approved: true } }))
      .toMatchObject({ statusLabel: '已跳过', summary: '模型复核未开启，本轮未执行模型复核' })
    expect(presentAgentTrace(trace, { review: { reason: 'RAG 规则通过' } }).summary)
      .toBe('RAG 规则通过；未执行模型复核')
  })

  it('gives failure and skipped flags precedence over generic completion, and preserves a failed review', () => {
    expect(presentAgentTrace({ agent: 'tool_agent', toolCount: 0, skipped: true, status: 'completed' }))
      .toMatchObject({ statusLabel: '已跳过', summary: '本轮未执行此步骤' })
    expect(presentAgentTrace({ agent: 'reviewer_agent', approved: false, skipped: true }, {
      review: { reason: '回答引用了已停用的记忆' }
    })).toMatchObject({ statusLabel: '未通过', tone: 'danger', summary: '回答引用了已停用的记忆' })
    expect(presentAgentTrace({ agent: 'tool_agent', skipped: true, status: 'failed' }))
      .toMatchObject({ statusLabel: '执行失败', tone: 'danger' })
  })

  it('reports actual routing and gathering choices with readable node names', () => {
    expect(presentAgentTrace({ agent: 'supervisor_agent', nextAgents: ['memory_agent', 'rag_agent'] }))
      .toMatchObject({ name: '理解与分流', statusLabel: '已完成', summary: '本轮安排：记忆召回、知识库检索' })
    expect(presentAgentTrace({ agent: 'gather_agent', receivedAgents: ['memory_agent', 'tool_agent'] }))
      .toMatchObject({ name: '整理上下文', summary: '已汇集：记忆召回、工具调用' })
  })

  it('does not treat streaming mode or elapsed time as evidence that a step is currently running', () => {
    expect(presentAgentTrace({ agent: 'writer_agent', streaming: true, answerChars: 297 })).toMatchObject({
      statusLabel: '已完成', summary: '回答 297 字'
    })
    expect(presentAgentTrace({ agent: 'writer_agent', elapsedMs: 3105 })).toMatchObject({
      statusLabel: '结果未记录', duration: '3.1 秒'
    })
    expect(presentAgentTrace({ agent: 'writer_agent', status: 'running', answerChars: 15 }).statusLabel)
      .toBe('进行中')
  })

  it('keeps unknown steps honest and hides raw identifiers from the readable timeline', () => {
    const [safe] = sanitizeAgentTrace([{ agent: 'future_internal_worker', status: 'unknown', reason: 'internal_state_missing' }])
    const result = presentAgentTrace(safe)
    expect(result).toMatchObject({ name: '其他处理', statusLabel: '结果未记录', tone: 'neutral' })
    expect(JSON.stringify(result)).not.toMatch(/future_internal_worker|internal_state_missing|已记录执行状态/)
  })

  it('preserves real image-analysis evidence through sanitization without claiming successful tool execution', () => {
    const [safe] = sanitizeAgentTrace([{
      agent: 'tool_agent', tool: 'image_analyze', imageCount: 1, streaming: true, elapsedMs: 1320,
      rawInput: 'private prompt', headers: { authorization: 'private-token' }
    }])
    expect(safe).toMatchObject({ tool: 'image_analyze', imageCount: 1, elapsedMs: 1320 })
    expect(safe).not.toHaveProperty('rawInput')
    expect(safe).not.toHaveProperty('headers')
    expect(presentAgentTrace(safe)).toMatchObject({
      name: '图片分析', purpose: '分析用户提供的图片内容', statusLabel: '已返回', tone: 'neutral',
      summary: '输入图片 1 张 · 处理已返回，具体结果请查看工具详情', duration: '1.32 秒'
    })
  })

  it('keeps safe failure state through sanitization and gives it precedence over counts or skipping', () => {
    const [failed, invalid] = sanitizeAgentTrace([
      { agent: 'tool_agent', tool: 'image_analyze', status: 'FAILED', imageCount: 1, skipped: true },
      { agent: 'custom_worker', status: 'token=private-state' }
    ])
    expect(failed.status).toBe('failed')
    expect(presentAgentTrace(failed)).toMatchObject({ name: '图片分析', statusLabel: '执行失败', tone: 'danger' })
    expect(invalid).not.toHaveProperty('status')
  })

  it.each([['image_generate', '图片生成'], ['image_edit', '图片编辑']])('names %s without inventing missing image counts', (tool, name) => {
    const [safe] = sanitizeAgentTrace([{ agent: 'tool_agent', tool }])
    expect(presentAgentTrace(safe)).toMatchObject({
      name, statusLabel: '已返回', tone: 'neutral', summary: '处理已返回，具体结果请查看工具详情', duration: null
    })
  })

  it('formats real durations and leaves missing or invalid durations absent', () => {
    expect(formatTraceDuration(0)).toBe('0 毫秒')
    expect(formatTraceDuration(999)).toBe('999 毫秒')
    expect(formatTraceDuration(1320)).toBe('1.32 秒')
    for (const value of [undefined, null, -1, NaN, Infinity, '3105']) {
      expect(formatTraceDuration(value)).toBeNull()
    }
  })
})
