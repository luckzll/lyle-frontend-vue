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

  await page.route('**/api/experience/templates', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }))
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

  await page.goto('/automations')
  const section = page.getByRole('heading', { name: '我的自动化' }).locator('..').locator('..')
  const card = page.getByRole('article').filter({ hasText: '逾期与停滞提醒' })
  await expect(section).toBeVisible()
  await expect(card.getByText('运行中')).toBeVisible()
  await expect(card.getByText(/daily:10:00/)).toBeVisible()

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
