import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import ChatThinkingProcess from '@/components/chat/ChatThinkingProcess.vue'
import type { AgentStepEvent } from '@/domain/chat-progress'

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

  it('uses provider text as escaped plain text in an independently labelled region', async () => {
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
})
