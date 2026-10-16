import { expect, test, type Page, type Route } from '@playwright/test'

const FIXED_NOW = '2026-07-11T08:30:00.000Z'
const viewports = [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1024', width: 1024, height: 768 },
  { name: 'desktop-1440', width: 1440, height: 900 }
]

for (const viewport of viewports) {
  test(`dashboard visual baseline at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.clock.setFixedTime(new Date(FIXED_NOW))
    await seedAuth(page)
    await mockDashboard(page)
    await page.goto('/dashboard')

    await expect(page.getByRole('heading', { level: 1, name: /视觉验收用户/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: '今日重点' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '待我处理' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '最近结果' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '项目计划' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow).toBe(false)
    await expect(page).toHaveScreenshot(`dashboard-${viewport.name}.png`, {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.01
    })
  })
}

for (const state of ['empty', 'partial-failure', 'all-failed'] as const) {
  test(`dashboard ${state} visual state`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.clock.setFixedTime(new Date(FIXED_NOW))
    await seedAuth(page)
    await mockDashboard(page)

    if (state === 'empty') {
      await page.route('**/api/briefings/today**', (route) => json(route, emptyBriefing()))
      await page.route('**/api/experience/confirmations**', (route) => json(route, { items: [] }))
      await page.route('**/api/experience/execution/results**', (route) => json(route, { items: [] }))
      await page.route('**/api/experience/connections/recommended**', (route) => json(route, { items: [] }))
    } else if (state === 'partial-failure') {
      await page.route('**/api/experience/confirmations**', (route) => serverError(route))
    } else {
      await page.route('**/api/briefings/today**', (route) => serverError(route))
      await page.route('**/api/experience/confirmations**', (route) => serverError(route))
      await page.route('**/api/experience/execution/results**', (route) => serverError(route))
      await page.route('**/api/experience/connections/recommended**', (route) => serverError(route))
    }

    await page.goto('/dashboard')
    if (state === 'empty') await expect(page.getByText('这里还很安静')).toBeVisible()
    if (state === 'partial-failure') await expect(page.getByText('部分信息未能更新')).toBeVisible()
    if (state === 'all-failed') await expect(page.getByText('工作台数据暂时不可用')).toBeVisible()
    await expect(page).toHaveScreenshot(`dashboard-${state}.png`, {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.01
    })
  })
}

test('dashboard loading visual state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.setFixedTime(new Date(FIXED_NOW))
  await seedAuth(page)
  await mockDashboard(page)
  let releaseBriefing!: () => void
  const briefingGate = new Promise<void>((resolve) => { releaseBriefing = resolve })
  await page.route('**/api/briefings/today**', async (route) => {
    await briefingGate
    await json(route, emptyBriefing())
  })

  await page.goto('/dashboard')
  await expect(page.locator('.loading-grid')).toBeVisible()
  await expect(page).toHaveScreenshot('dashboard-loading.png', {
    fullPage: true,
    animations: 'disabled',
    maxDiffPixelRatio: 0.01
  })
  releaseBriefing()
})

async function seedAuth(page: Page) {
  const payload = Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString('base64url')
  await page.addInitScript(({ token }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify({
      id: 'visual-user',
      username: '视觉验收用户',
      role: 'USER'
    }))
  }, { token: `header.${payload}.signature` })
}

async function mockDashboard(page: Page) {
  await page.route('**/api/agent-tools/reminders**', (route) => json(route, { items: [] }))
  await page.route('**/api/briefings/today**', (route) => json(route, {
    id: 1,
    projectId: 42,
    briefingType: 'daily',
    title: 'V4.2 今日简报',
    content: '完成发布验收。',
    todayFocus: ['确认上线范围'],
    projects: [{
      id: 42,
      name: 'Lyle V4.2 升级',
      slug: 'lyle-v42',
      description: '个人 AI 工作台体验升级',
      status: 'active',
      currentStage: '发布验收',
      priority: 10,
      lastActivityAt: FIXED_NOW,
      createdAt: '2026-07-01T08:00:00.000Z',
      updatedAt: FIXED_NOW
    }],
    goals: [],
    dueTasks: [{
      id: 11,
      title: '完成移动端验收',
      status: 'open',
      dueAt: '2026-07-11T10:00:00.000Z',
      conversationId: '',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW
    }],
    overdueTasks: [{
      id: 12,
      title: '修复导航回归',
      status: 'open',
      dueAt: '2026-07-10T10:00:00.000Z',
      conversationId: '',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW
    }],
    pendingOperations: [],
    counts: { dueToday: 1, overdue: 1, pending: 1 },
    createdAt: FIXED_NOW
  }))
  await page.route('**/api/experience/confirmations**', (route) => json(route, {
    total: 1,
    items: [{
      pendingOperationId: 91,
      actionTitle: '发布 V4.2 到生产环境',
      riskLevel: 'high',
      reason: '生产发布需要人工确认。',
      impactResources: ['frontend'],
      reversible: true,
      requiresSecondConfirmation: true,
      source: 'release',
      createdAt: FIXED_NOW
    }]
  }))
  await page.route('**/api/experience/execution/results**', (route) => json(route, {
    hasMore: false,
    statusCounts: { completed: 1, failed: 0, partial: 0, awaiting_confirmation: 0 },
    items: [{
      id: 301,
      sourceType: 'automation',
      sourceId: '17',
      projectId: 42,
      automationId: 17,
      automationName: '发布巡检',
      status: 'completed',
      title: 'V4.2 设计系统巡检',
      conclusion: '设计 Token 与关键页面检查已完成。',
      completedItems: ['设计 Token', '应用壳层'],
      risks: [],
      recommendedActions: [],
      dataScope: ['frontend'],
      durationMs: 1250,
      createdAt: FIXED_NOW
    }]
  }))
  await page.route('**/api/experience/connections/recommended**', (route) => json(route, {
    items: [{
      id: 'github',
      type: 'github',
      name: 'GitHub',
      status: 'reauthorize_required',
      displayReason: '授权即将到期',
      nextAction: '重新授权',
      diagnosable: true,
      capabilities: ['repository'],
      lastCheckedAt: FIXED_NOW
    }]
  }))
  await page.route('**/api/experience/events', (route) => json(route, { accepted: true }))
  await page.route('**/api/experience/execution/needs-attention', (route) => json(route, { items: [] }))
  await page.route('**/api/missions/digest**', (route) => json(route, { items: [], completedRuns: 0, attentionCount: 0 }))
  await page.route('**/api/exceptions**', (route) => json(route, { items: [] }))
}

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

async function serverError(route: Route) {
  await route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: '服务暂时不可用' })
  })
}

function emptyBriefing() {
  return {
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
    counts: { dueToday: 0, overdue: 0, pending: 0 },
    createdAt: FIXED_NOW
  }
}
