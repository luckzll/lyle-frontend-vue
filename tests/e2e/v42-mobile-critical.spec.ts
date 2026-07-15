import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await seedAuth(page)
  await page.route('**/api/agent-tools/reminders**', (route) => json(route, { items: [] }))
  await page.route('**/api/experience/events', (route) => json(route, { accepted: true }))
  await page.route('**/api/experience/confirmations', (route) => json(route, { items: [] }))
  await page.route('**/api/experience/execution/needs-attention', (route) => json(route, { items: [] }))
})

test('360px user can confirm a pending operation', async ({ page }) => {
  const now = '2026-07-11T08:00:00.000Z'
  let confirmCalls = 0
  let items = [{
    pendingOperationId: 51,
    actionTitle: '更新项目周报',
    toolName: 'project',
    operationType: 'project.update',
    riskLevel: 'write',
    status: 'pending',
    reason: '此操作会更新项目周报。',
    impactResources: ['项目 7'],
    reversible: true,
    requiresSecondConfirmation: false,
    source: '周报自动化',
    createdAt: now
  }]

  await page.route('**/api/experience/confirmations', (route) => json(route, { items }))
  await page.route('**/api/experience/confirmations/51/confirm', (route) => {
    confirmCalls += 1
    items = []
    return json(route, { accepted: true })
  })
  await page.route('**/api/experience/execution/results**', (route) => json(route, { items: [] }))
  await page.route('**/api/experience/execution/needs-attention', (route) => json(route, { items: [] }))

  await page.goto('/execution-center?view=confirmations')
  await expect(page.getByRole('combobox', { name: '执行中心分区' })).toBeVisible()
  await expect(page.getByRole('button', { name: '筛选结果' })).toBeVisible()
  await expect(page.getByRole('region', { name: '筛选条件' })).toBeHidden()
  const card = page.getByRole('article').filter({ hasText: '更新项目周报' })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: '确认执行' }).click()

  await expect.poll(() => confirmCalls).toBe(1)
  await expect(page.getByText('操作已确认执行。')).toBeVisible()
  await expect(page.getByText('没有等待确认的操作')).toBeVisible()
  expect(await hasHorizontalOverflow(page)).toBe(false)
})

test('360px user can pause and resume an automation', async ({ page }) => {
  let pauseCalls = 0
  let enableCalls = 0
  let status = 'enabled'
  const automation = () => ({
    id: 17,
    workflowId: 8,
    projectId: 7,
    projectName: 'V4.2',
    name: '发布巡检',
    triggerType: 'schedule',
    scheduleExpr: 'daily:09:00',
    timezone: 'Asia/Shanghai',
    status,
    nextRunAt: status === 'enabled' ? '2026-07-12T01:00:00.000Z' : null,
    lastRunAt: '2026-07-11T01:00:00.000Z',
    lastRunStatus: 'completed',
    lastResultId: 301,
    lastResultTitle: '发布巡检已完成',
    consecutiveFailures: 0,
    needsAttention: false,
    input: {},
    maxRetries: 2,
    retryDelaySeconds: 60,
    notifyOnFailure: true
  })

  await page.route('**/api/experience/templates', (route) => json(route, { items: [] }))
  await page.route('**/api/experience/onboarding', (route) => json(route, {
    completedAt: '2026-07-11T00:00:00.000Z',
    candidates: { projects: [], workspaces: [] }
  }))
  await page.route('**/api/workbench/automations**', (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET' && url.pathname.endsWith('/workbench/automations')) {
      return json(route, { items: [automation()] })
    }
    if (url.pathname.endsWith('/17/pause')) {
      pauseCalls += 1
      status = 'paused'
      return json(route, { accepted: true })
    }
    if (url.pathname.endsWith('/17/enable')) {
      enableCalls += 1
      status = 'enabled'
      return json(route, { accepted: true })
    }
    return json(route, { message: `Unexpected request ${url.pathname}` }, 404)
  })

  await page.goto('/automations')
  const card = page.getByRole('article').filter({ hasText: '发布巡检' })
  await card.getByRole('button', { name: '暂停' }).click()
  await expect.poll(() => pauseCalls).toBe(1)
  await expect(card.getByRole('button', { name: '恢复' })).toBeVisible()

  await card.getByRole('button', { name: '恢复' }).click()
  await expect.poll(() => enableCalls).toBe(1)
  await expect(card.getByRole('button', { name: '暂停' })).toBeVisible()
  expect(await hasHorizontalOverflow(page)).toBe(false)
})

async function seedAuth(page: Page) {
  const payload = Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString('base64url')
  await page.addInitScript(({ token }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify({ id: 1, username: '移动验收用户', role: 'USER' }))
  }, { token: `header.${payload}.signature` })
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body ?? {}) })
}

async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(() => (
    document.documentElement.scrollWidth > window.innerWidth
    || document.body.scrollWidth > window.innerWidth
  ))
}
