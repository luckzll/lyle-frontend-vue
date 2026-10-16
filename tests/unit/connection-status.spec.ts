import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ConnectionHealthCard from '@/components/domain/ConnectionHealthCard.vue'
import type { ConnectionDiagnostic } from '@/api/types'
import { connectionNeedsAttention, normalizeConnectionStatus } from '@/domain/connection-status'

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

  it.each([
    ['not_configured', '未配置'],
    ['disabled', '未启用'],
    ['unchecked', '待检查'],
    ['healthy', '可用'],
    ['unavailable', '不可用'],
    ['reauthorize_required', '需要重新授权'],
    ['restricted', '受限']
  ] as const)('renders the explicit %s state clearly', async (status, label) => {
    const html = await render({ status, displayReason: '机器状态有明确含义。' })
    expect(html).toContain(`状态：${label}`)
    if (['not_configured', 'disabled', 'unchecked'].includes(status)) {
      expect(html).toContain('tone-neutral')
    }
  })

  it('keeps nondiagnosable workspaces as navigation actions', async () => {
    const html = await render({
      id: 'workspace-7', type: 'local_project', status: 'unchecked',
      diagnosable: false, actionTarget: '/advanced-settings?tab=cli', nextAction: '查看工作区设置',
      displayReason: '工作区已授权；本地环境尚未检查。'
    })
    expect(html).toContain('href="/advanced-settings?tab=cli"')
    expect(html).toContain('查看工作区设置')
    expect(html).not.toContain('运行连接诊断')
  })

  it('does not offer a diagnosis for a legacy disabled workspace', async () => {
    const html = await render({ type: 'local_project', status: 'restricted', displayReason: '工作区已停用。' })
    expect(html).toContain('状态：未启用')
    expect(html).toContain('href="/advanced-settings?tab=cli"')
    expect(html).not.toContain('运行连接诊断')
  })
})

describe('connection attention uses machine state with bounded legacy compatibility', () => {
  it.each([
    ['not_configured', false],
    ['disabled', false],
    ['unchecked', false],
    ['healthy', false],
    ['unavailable', true],
    ['reauthorize_required', true],
    ['restricted', true]
  ] as const)('classifies %s attention as %s', (status, attention) => {
    expect(connectionNeedsAttention({ ...connection, status, displayReason: '明确的连接状态。' })).toBe(attention)
  })

  it('accepts explicit attention suppression while setup states remain nonblocking', () => {
    expect(connectionNeedsAttention({ ...connection, status: 'unavailable', displayReason: '连接失败。', needsAttention: false })).toBe(false)
    expect(connectionNeedsAttention({ ...connection, status: 'unchecked', needsAttention: true })).toBe(false)
  })

  it('normalizes only known legacy setup and disabled-workspace messages', () => {
    expect(normalizeConnectionStatus({ ...connection, type: 'local_project', displayReason: '尚未授权本地工作区。' })).toBe('not_configured')
    expect(normalizeConnectionStatus({ ...connection, type: 'github', displayReason: '当前没有可用的 GitHub 连接。' })).toBe('not_configured')
    expect(normalizeConnectionStatus(connection)).toBe('unchecked')
    expect(normalizeConnectionStatus({ ...connection, type: 'local_project', status: 'restricted', displayReason: '工作区已停用。' })).toBe('disabled')
    expect(connectionNeedsAttention({ ...connection, displayReason: '连接超时。' })).toBe(true)
    expect(connectionNeedsAttention({ ...connection, lastCheckedAt: '2026-10-16T08:00:00Z' })).toBe(true)
  })
})
