import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ConnectionHealthCard from '@/components/domain/ConnectionHealthCard.vue'
import type { ConnectionDiagnostic } from '@/api/types'

const connection: ConnectionDiagnostic = {
  id: 'mcp', type: 'mcp', name: '本地 MCP', status: 'unavailable',
  displayReason: '需要运行连接诊断。', nextAction: '运行连接诊断',
  diagnosable: true, capabilities: [], lastCheckedAt: null
}

async function render(overrides: Partial<ConnectionDiagnostic> = {}, loading = false) {
  const app = createSSRApp(ConnectionHealthCard, { item: { ...connection, ...overrides }, loading })
  app.component('RouterLink', { props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) })
  return renderToString(app)
}

describe('connection status communicates setup separately from failures', () => {
  it('uses a neutral badge only for the explicit unchecked placeholder', async () => {
    expect(await render()).toContain('状态：待检查')
  })

  it('does not hide a known failure when the service omits its check timestamp', async () => {
    const html = await render({ displayReason: '连接超时，请检查服务地址。' })
    expect(html).toContain('状态：不可用')
    expect(html).not.toContain('状态：待检查')
  })

  it('retains the unavailable badge for a checked connection', async () => {
    expect(await render({ lastCheckedAt: '2026-09-12T00:00:00Z' })).toContain('状态：不可用')
  })

  it('shows a pending state and disables the action while checking', async () => {
    const html = await render({}, true)
    expect(html).toContain('状态：检查中')
    expect(html).toContain('disabled')
    expect(html).toContain('aria-busy="true"')
  })
})
