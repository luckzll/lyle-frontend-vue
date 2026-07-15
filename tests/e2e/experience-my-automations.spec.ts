import { expect, test } from '@playwright/test'

test('default automation page manages enabled automations without advanced mode', async ({ page }) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const token = `header.${payload}.signature`
  let status = 'enabled'
  let deleted = false
  let runCalls = 0

  await page.addInitScript(({ token }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify({ id: 1, username: 'experience_automation_test', role: 'USER' }))
  }, { token })

  await page.route('**/api/agent-tools/reminders**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))
  await page.route('**/api/experience/confirmations**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))
  await page.route('**/api/experience/execution/needs-attention**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))
  await page.route('**/api/experience/events', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' }))

  await page.route('**/api/experience/templates', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: [
        { id: 'daily', category: 'project', name: '项目每日简报', problem: '每天快速看清重点、风险与下一步。', sources: ['项目', '目标', '任务'], output: '今日重点、风险、建议', defaultSchedule: 'daily:09:00', estimatedDuration: '约 1 分钟' },
        { id: 'weekly', category: 'project', name: '项目每周复盘', problem: '汇总本周进展、阻塞和下周建议。', sources: ['项目', '任务', '已授权工作区'], output: '进展、阻塞、下周建议', defaultSchedule: 'weekly:fri:17:00', estimatedDuration: '约 2 分钟' },
        { id: 'health', category: 'code', name: '代码健康检查', problem: '发现未提交改动、TODO 与测试风险。', sources: ['已授权工作区 Git 状态', 'TODO', '测试摘要'], output: '代码状态和需处理项', defaultSchedule: 'weekly:fri:16:00', estimatedDuration: '约 2 分钟' }
      ]
    })
  }))
  await page.route('**/api/experience/onboarding', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ completedAt: '2026-07-11T00:00:00Z', candidates: { projects: [], workspaces: [] } }) }))
  await page.route('**/api/workbench/automations', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: deleted ? [] : [{ id: 17, name: '逾期与停滞提醒', status, triggerType: 'schedule', scheduleExpr: 'daily:10:00', timezone: 'Asia/Shanghai', nextRunAt: '2026-07-12T02:00:00Z', lastRunAt: null }] }) })
      return
    }
    await route.fallback()
  })
  await page.route('**/api/workbench/automations/17/runs', async (route) => { runCalls += 1; await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) })
  await page.route('**/api/workbench/automations/17/pause', async (route) => { status = 'paused'; await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) })
  await page.route('**/api/workbench/automations/17/enable', async (route) => { status = 'enabled'; await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) })
  await page.route('**/api/workbench/automations/17', async (route) => { deleted = true; await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) })

  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/automations')
  const section = page.getByRole('heading', { name: '我的自动化' }).locator('..').locator('..')
  const card = page.getByRole('article').filter({ hasText: '逾期与停滞提醒' })
  await expect(section).toBeVisible()
  await expect(card.getByText('运行中')).toBeVisible()
  await expect(card.getByText('每天 10:00（北京时间）')).toBeVisible()
  await expect(page.locator('.template-meta').filter({ hasText: '项目' })).toHaveCount(2)
  await expect(page.locator('.template-meta').filter({ hasText: '代码' })).toHaveCount(1)
  await expect(page.getByText('project', { exact: true })).toHaveCount(0)
  await expect(page.getByText('code', { exact: true })).toHaveCount(0)

  const templateLayout = await page.locator('.template-grid').evaluate((grid) => ({
    columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    definitionColumns: getComputedStyle(grid.querySelector('dl') as HTMLElement).gridTemplateColumns.split(' ').length,
    verticalDefinitions: Array.from(grid.querySelectorAll('dd')).some((item) => getComputedStyle(item).writingMode !== 'horizontal-tb'),
    overflow: document.documentElement.scrollWidth > window.innerWidth
  }))
  expect(templateLayout).toEqual({ columns: 2, definitionColumns: 1, verticalDefinitions: false, overflow: false })

  await card.getByRole('button', { name: '运行一次' }).click()
  await expect(page.getByText('结果将在执行中心展示')).toBeVisible()
  expect(runCalls).toBe(1)

  await card.getByRole('button', { name: '暂停' }).click()
  await expect(card.getByText('已暂停')).toBeVisible()
  await card.getByRole('button', { name: '恢复' }).click()
  await expect(card.getByText('运行中')).toBeVisible()

  await card.getByRole('button', { name: '删除' }).click()
  await expect(card.getByRole('button', { name: '确认删除' })).toBeVisible()
  await card.getByRole('button', { name: '确认删除' }).click()
  await expect(page.getByText('还没有启用的自动化')).toBeVisible()
})
