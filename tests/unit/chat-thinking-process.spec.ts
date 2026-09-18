import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import ChatThinkingProcess from '@/components/chat/ChatThinkingProcess.vue'
import type { AgentStepEvent } from '@/domain/chat-progress'
import { historyMessage } from '@/domain/chat-history'
import type { ChatToolCall } from '@/domain/chat-tool-calls'
import fixture from '../fixtures/tool-process-jackson.json'

const items: AgentStepEvent[] = [
  { turnId: 'turn-1', sequence: 1, step: 'supervisor_agent', status: 'completed', durationMs: 1100 },
  { turnId: 'turn-1', sequence: 2, step: 'rag_agent', status: 'running', summary: '正在检索知识库' }
]

describe('chat thinking and execution disclosure', () => {
  it('does not show empty thinking for a historical answer without process data', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, { items: [], phase: 'COMPLETED' }))
    expect(html).not.toContain('data-testid="chat-thinking-process"')
  })

  it('opens live execution and renders only actual reported steps without inventing reasoning', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, { items, active: true }))
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('data-agent="supervisor_agent" data-status="completed"')
    expect(html).toContain('data-agent="rag_agent" data-status="running"')
    expect(html).toContain('知识库检索')
    expect(html).not.toContain('data-agent="writer_agent"')
    expect(html).not.toContain('模型思考')
    expect(html).not.toContain('思考摘要')
  })

  it('escapes provider HTML and labels its timeline text accessibly', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, {
      items: [], active: true,
      reasoning: { text: '<script>alert(1)</script>\n先核对数据。', kind: 'summary', sequence: 4 }
    }))
    expect(html).toContain('思考摘要内容')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('模型思考')
    expect(html).not.toContain('aria-label="执行步骤"')
  })

  it('labels raw provider reasoning separately from a summary', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, {
      items: [], active: true,
      reasoning: { text: '模型返回的可展示内容', kind: 'reasoning', sequence: 4 }
    }))
    expect(html).toContain('模型思考内容')
    expect(html).not.toContain('思考摘要')
  })

  it('ignores whitespace-only reasoning', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, {
      items: [], reasoning: { text: ' \n ', kind: 'reasoning', sequence: 4 }
    }))
    expect(html).not.toContain('data-testid="chat-thinking-process"')
  })

  it('collapses completed history and calculates wall time rather than summing parallel steps', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, {
      items: items.map(item => ({ ...item, status: 'completed', durationMs: 140000 })),
      phase: 'COMPLETED', startedAt: 10000, completedAt: 156000
    }))
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain(' hidden')
    expect(html).toContain('用时 2 分 26 秒')
    expect(html).not.toContain('用时 4 分 40 秒')
    expect(html).not.toContain('thinking-process__spinner')
  })

  it('does not imply a historical unfinished step is still running after interruption', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, { items, phase: 'FAILED', active: true }))
    expect(html).toContain('data-agent="rag_agent" data-status="interrupted"')
    expect(html).toContain('此步骤未完成')
    expect(html).not.toContain('正在检索知识库')
    expect(html).not.toContain('thinking-process__spinner')
    expect(items[1].status).toBe('running')
  })

  it('does not invent successful completion for steps missing their final event', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, { items, phase: 'COMPLETED' }))
    expect(html).toContain('data-agent="rag_agent" data-status="ended"')
    expect(html).toContain('未收到此步骤的完成状态')
    expect(html).not.toContain('thinking-process__spinner')
  })

  it('omits elapsed time when a historical closing timestamp is unavailable', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, { items, phase: 'COMPLETED', startedAt: 10000 }))
    expect(html).not.toContain('用时')
  })

  it('keeps recovery status visible and connects the keyboard disclosure to its panel', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, {
      items, active: true, statusText: '后台仍在执行，正在同步进度…'
    }))
    expect(html).toContain('后台仍在执行，正在同步进度…')
    expect(html).toContain('type="button"')
    const panelId = /aria-controls="([^"]+)"/.exec(html)?.[1]
    expect(panelId).toBeTruthy()
    expect(html).toContain(`id="${panelId}"`)
  })

  it('renders production thinking and repeated tool calls interleaved in one list after completion', async () => {
    const message = historyMessage({ id: 'm', role: 'assistant', conversationId: 'c', turnId: fixture.turnId,
      content: '答案', createdAt: '', metadata: fixture.historyMetadata })
    const html = await renderToString(createSSRApp(ChatThinkingProcess, {
      items: message.agentProgress!, toolCalls: message.toolCalls, processTimeline: message.processTimeline, phase: message.phase
    }))
    const ids = [...html.matchAll(/data-process-id="([^"]+)"/g)].map(match => match[1])
    // The generic tool_agent aggregate is omitted when actual invocations are present.
    expect(ids).toEqual(['r-1', 'first', 'r-2', 'second', 'r-3'])
    expect(html.match(/<ol /g)).toHaveLength(1)
    expect(html).toContain('data-call-id="first" data-status="completed"')
    expect(html).toContain('data-call-id="second" data-status="awaiting_confirmation"')
    expect(html).toContain('等待确认')
    expect(html).toContain('工具：<code')
    expect(html).toContain('weather</code>')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('历史记录未保存发生顺序')
    expect(html).not.toContain('thinking-process__spinner')
  })

  it('formats basic emphasis without executing provider HTML or rendering a separate thought panel', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, {
      items: [], active: true, processTimeline: [{ type: 'reasoning', id: 'r-1', kind: 'reasoning', sequence: 1,
        text: '**核对来源**后调用`weather`。<img src=x onerror=alert(1)>' }]
    }))
    expect(html).toMatch(/<strong[^>]*>核对来源<\/strong>/)
    expect(html).toMatch(/<code[^>]*>weather<\/code>/)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('**核对来源**')
    expect(html).not.toContain('thinking-process__reasoning-scroll')
  })

  it('marks an unfinished historical tool interrupted without pretending a preview executed', async () => {
    const toolCalls: ChatToolCall[] = [
      { turnId: 't', sequence: 1, callId: 'unfinished', tool: 'weather', title: '查询天气', status: 'running', summary: '正在查询' },
      { turnId: 't', sequence: 2, callId: 'preview', tool: 'calendar.create', title: '创建日程', status: 'awaiting_confirmation', summary: '请确认后创建' }
    ]
    const html = await renderToString(createSSRApp(ChatThinkingProcess, { items: [], toolCalls, phase: 'COMPLETED' }))
    expect(html).toContain('data-call-id="unfinished" data-status="interrupted"')
    expect(html).toContain('未收到此操作的完成结果')
    expect(html).toContain('data-call-id="preview" data-status="awaiting_confirmation"')
    expect(html).not.toContain('data-status="completed"')
    expect(html).not.toContain('正在查询')
    expect(html).not.toContain('thinking-process__spinner')
  })

  it('omits skipped template rows and duplicate summary prose while retaining metadata', async () => {
    const steps: AgentStepEvent[] = [
      { turnId: 't', sequence: 1, step: 'rag_agent', status: 'skipped', summary: '本轮无需执行此步骤' },
      { turnId: 't', sequence: 2, step: 'writer_agent', status: 'completed', summary: '步骤已完成' }
    ]
    const html = await renderToString(createSSRApp(ChatThinkingProcess, { items: steps, phase: 'COMPLETED' }))
    expect(html).not.toContain('data-agent="rag_agent"')
    expect(html).not.toContain('步骤已完成')
    expect(html).toContain('data-agent="writer_agent" data-status="completed"')
    expect(steps).toHaveLength(2)
    const skippedOnly = await renderToString(createSSRApp(ChatThinkingProcess, { items: steps.slice(0, 1), phase: 'COMPLETED' }))
    expect(skippedOnly).toContain('data-testid="chat-thinking-process"')
    expect(skippedOnly).toContain('aria-expanded="false"')
  })

  it('discloses the unavailable chronology of older aggregate records', async () => {
    const html = await renderToString(createSSRApp(ChatThinkingProcess, { items, phase: 'COMPLETED',
      reasoning: { text: '旧记录摘要', kind: 'summary', sequence: 1 } }))
    expect(html).toContain('历史记录未保存发生顺序，以下为已记录的内容。')
  })
})
