import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'

type CorePage = {
  path: string
  heading: string
  readyText?: string
  readyTestId?: string
}

const corePages: CorePage[] = [
  { path: '/dashboard', heading: '工作台', readyText: '这里还很安静' },
  { path: '/', heading: 'AI 聊天', readyTestId: 'chat-input' },
  { path: '/tasks', heading: '任务', readyText: '暂无提醒。' },
  { path: '/projects', heading: '项目', readyText: '暂无项目' },
  { path: '/automations', heading: '自动化', readyText: '还没有启用的自动化' },
  { path: '/execution-center', heading: '执行中心', readyText: '没有等待确认的操作' },
  { path: '/connections', heading: '连接', readyText: '暂无推荐连接' },
  { path: '/knowledge-bases', heading: '知识库', readyText: '暂无知识库' },
  { path: '/memory', heading: '记忆', readyText: 'Lyle 还没有保存长期记忆' },
  { path: '/settings', heading: '设置', readyText: '保存偏好' }
]

const emptyBriefing = {
  id: null,
  projectId: null,
  briefingType: 'daily',
  title: '今日简报',
  content: '',
  todayFocus: [],
  projects: [],
  goals: [],
  dueTasks: [],
  overdueTasks: [],
  pendingOperations: [],
  createdAt: '2026-07-11T00:00:00.000Z'
}

const emptyMemory = {
  summary: '',
  short_term: [],
  structured: [],
  structured_all: [],
  profiles: [],
  fragments: [],
  semantic: [],
  vector: [],
  retrieved: []
}

test.beforeEach(async ({ page }) => {
  await installAuthenticatedSession(page)
  await mockCoreApis(page)
})

for (const corePage of corePages) {
  test(`${corePage.path} has no critical or serious WCAG A/AA violations`, async ({ page }) => {
    await page.goto(corePage.path)
    await expect(page.getByRole('heading', { level: 1, name: corePage.heading })).toBeVisible()

    if (corePage.readyTestId) {
      await expect(page.getByTestId(corePage.readyTestId)).toBeVisible()
    } else if (corePage.readyText) {
      await expect(page.getByText(corePage.readyText, { exact: false }).first()).toBeVisible()
    }

    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const severeViolations = result.violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious'
    )

    expect(severeViolations, formatViolations(corePage.path, severeViolations)).toEqual([])
  })
}

async function installAuthenticatedSession(page: Page) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString('base64url')
  const token = `header.${payload}.signature`

  await page.addInitScript(({ authToken }) => {
    localStorage.setItem('lyle-token', authToken)
    localStorage.setItem('lyle-user', JSON.stringify({
      id: 'v42-accessibility-user',
      username: 'V4.2 无障碍验收用户',
      role: 'USER'
    }))
  }, { authToken: token })
}

async function mockCoreApis(page: Page) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const pathname = new URL(route.request().url()).pathname

    if (pathname === '/api/briefings/today') return fulfillJson(route, emptyBriefing)
    if (pathname === '/api/knowledge-bases' || pathname === '/api/conversations') {
      return fulfillJson(route, [])
    }
    if (pathname === '/api/memory/current') return fulfillJson(route, emptyMemory)
    if (pathname === '/api/memory/records') return fulfillJson(route, { items: [], nextCursor: null })
    if (pathname === '/api/memory/inbox') return fulfillJson(route, { items: [], count: 0 })
    if (pathname === '/api/memory/governance-events') return fulfillJson(route, { items: [], nextCursor: null })
    if (pathname === '/api/users/me') return fulfillJson(route, { id: 'v42-accessibility-user', username: 'V4.2 无障碍验收用户', role: 'USER' })
    if (pathname === '/api/projects') return fulfillJson(route, { items: [] })
    if (pathname === '/api/experience/templates') return fulfillJson(route, { items: [] })
    if (pathname === '/api/experience/onboarding') {
      return fulfillJson(route, {
        completedAt: '2026-07-11T00:00:00.000Z',
        candidates: { projects: [], workspaces: [] }
      })
    }
    if (pathname === '/api/experience/events') return fulfillJson(route, { accepted: true })

    const emptyListEndpoints = new Set([
      '/api/agent-tools/todos',
      '/api/agent-tools/calendar',
      '/api/agent-tools/reminders',
      '/api/agent-tools/operations',
      '/api/workbench/automations',
      '/api/experience/confirmations',
      '/api/experience/execution/results',
      '/api/experience/execution/needs-attention',
      '/api/experience/connections/recommended'
    ])
    if (emptyListEndpoints.has(pathname)) return fulfillJson(route, { items: [] })

    return fulfillJson(route, { message: `No accessibility fixture for ${pathname}` }, 404)
  })
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  })
}

function formatViolations(path: string, violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  if (!violations.length) return ''
  return [
    `Accessibility violations on ${path}:`,
    ...violations.map((violation) => [
      `${violation.id} [${violation.impact}]: ${violation.help}`,
      ...violation.nodes.map((node) => `  ${node.target.join(' > ')} — ${compactHtml(node.html)}`)
    ].join('\n'))
  ].join('\n')
}

function compactHtml(html: string) {
  return html.replace(/\s+/g, ' ').trim().slice(0, 240)
}
