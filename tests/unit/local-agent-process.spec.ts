import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import LocalAgentProcess from '@/components/chat/LocalAgentProcess.vue'

describe('local agent execution process', () => {
  it('renders returned commentary safely and keeps file paths inert', async () => {
    const html = await renderToString(createSSRApp(LocalAgentProcess, { open: true, active: true, activities: [
      { label: '分析下一步', status: 'done', detail: '**先查看结构**，再读取 `pom.xml`。\n<img src=x onerror=alert(1)>' },
      { label: '读取文件', path: 'src/<script>.ts', status: 'running' }
    ] }))
    expect(html).toContain('<strong>先查看结构</strong>')
    expect(html).toContain('<code>pom.xml</code>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('src/&lt;script&gt;.ts')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script>')
    expect(html).toContain('data-status="running"')
    expect(html).toContain('正在读取文件内容')
    expect(html).toContain('aria-expanded="true"')
  })

  it('respects the persisted open state and renders only recorded activities', async () => {
    const html = await renderToString(createSSRApp(LocalAgentProcess, { open: false, completed: true, activities: [
      { label: '查看目录', path: '/', status: 'done', detail: '本次返回 2 个目录项。' }
    ] }))
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/class="local-agent-process__body" hidden/)
    expect(html).toContain('1 个步骤')
    expect(html).toContain('本次返回 2 个目录项。')
    expect(html).not.toContain('读取文件')
    expect(html).not.toContain('正在')
  })

  it('keeps pending confirmation distinct from a completed file modification', async () => {
    const html = await renderToString(createSSRApp(LocalAgentProcess, { open: true, active: true, waiting: true, activities: [
      { label: '修改文件', path: 'pom.xml', status: 'waiting' }
    ] }))
    expect(html).toContain('data-status="waiting"')
    expect(html).toContain('待确认')
    expect(html).toContain('文件尚未写入')
    expect(html).not.toContain('local-agent-process__icon-badge is-done')
    expect(html).not.toContain('已写入')
    expect(html).not.toContain('local-agent-process__spinner')
  })

  it('presents saved rejected edits as unexecuted even when the protocol status is done', async () => {
    const html = await renderToString(createSSRApp(LocalAgentProcess, { open: true, completed: true, activities: [
      { label: '修改文件', path: 'pom.xml', status: 'done', detail: '已拒绝，文件未修改' }
    ] }))
    expect(html).toContain('data-status="rejected"')
    expect(html).toContain('未执行')
    expect(html).toContain('已结束')
    expect(html).toContain('已拒绝，文件未修改')
    expect(html).not.toContain('local-agent-process__icon-badge is-done')
    expect(html).not.toContain('is-completed')
    expect(html).not.toContain('已确认写入')
  })

  it('stops running indicators and confirmation prompts when the turn is inactive', async () => {
    const html = await renderToString(createSSRApp(LocalAgentProcess, { open: true, active: false, activities: [
      { label: '分析下一步', status: 'running', detail: '正在检查 `src` 中的入口文件。' },
      { label: '修改文件', path: 'pom.xml', status: 'waiting' }
    ] }))
    expect(html).toContain('已停止')
    expect(html.match(/data-status="interrupted"/g)).toHaveLength(2)
    expect(html).not.toContain('local-agent-process__spinner')
    expect(html).not.toContain('待确认')
    expect(html).toContain('此步骤未完成')
  })

  it('does not represent a finished turn with an operation error as all successful', async () => {
    const html = await renderToString(createSSRApp(LocalAgentProcess, { open: true, completed: true, activities: [
      { label: '读取文件', path: 'missing.ts', status: 'error', detail: '文件不存在' }
    ] }))
    expect(html).toContain('data-status="error"')
    expect(html).toContain('未完成')
    expect(html).toContain('文件不存在')
    expect(html).toContain('已结束')
    expect(html).not.toContain('is-completed')
    expect(html).not.toContain('local-agent-process__icon-badge is-done')
  })

  it('summarizes the current operation before opening the execution record', async () => {
    const html = await renderToString(createSSRApp(LocalAgentProcess, { open: false, active: true, activities: [
      { label: '查看目录', status: 'done' },
      { label: '读取文件', path: 'src/main.ts', status: 'running' }
    ] }))
    const summary = html.slice(0, html.indexOf('local-agent-process__body'))
    expect(summary).toContain('进行中')
    expect(summary).toContain('· 读取文件')
    expect(summary).toContain('2 个步骤')
    expect(summary).not.toContain('src/main.ts')
    expect(html).not.toContain('本次目录查看已结束。')
    expect(html).toContain('lucide-folder-search')
    expect(html).toContain('lucide-file-search')
  })

  it('keeps write confirmation visible while disclosing long output on demand', async () => {
    const detail = '修改建议：\n' + '这是需要确认后才能执行的文件变更说明。'.repeat(24)
    const html = await renderToString(createSSRApp(LocalAgentProcess, { open: true, active: true, waiting: true, activities: [
      { label: '修改文件', path: 'src/main.ts', status: 'waiting', detail }
    ] }))
    const disclosureStart = html.indexOf('<details')
    expect(disclosureStart).toBeGreaterThan(-1)
    expect(html.slice(0, disclosureStart)).toContain('等待你确认这项修改，文件尚未写入。')
    expect(html).toMatch(/<details class="local-agent-process__output"[^>]*>/)
    expect(html.match(/<details\b[^>]*>/)?.[0]).not.toContain(' open')
    expect(html).toContain('查看输出详情')
    expect(html).toContain('修改建议：')
    expect(html).not.toContain('已写入')
  })

  it('keeps failure and interruption notices outside a collapsed long output', async () => {
    for (const status of ['error', 'waiting'] as const) {
      const html = await renderToString(createSSRApp(LocalAgentProcess, { open: true, active: false, completed: status === 'error', activities: [
        { label: '修改文件', path: 'src/main.ts', status, detail: '诊断输出\n'.repeat(12) }
      ] }))
      const visibleRecord = html.slice(0, html.indexOf('<details'))
      expect(visibleRecord).toContain(status === 'error' ? '此步骤未能完成。' : '本轮已停止，此步骤未完成。')
      expect(html).toMatch(/<details class="local-agent-process__output"[^>]*>/)
      expect(html).not.toContain('已写入')
    }
  })
})
