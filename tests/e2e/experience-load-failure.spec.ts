import { expect, test } from '@playwright/test'

test('Product experience pages distinguish API failures from real empty states', async ({ page }) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString('base64url')
  const token = `header.${payload}.signature`

  await page.addInitScript(({ token }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify({ id: 1, username: 'experience_failure_test', role: 'USER' }))
  }, { token })

  await page.route('**/api/agent-tools/reminders**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })

  await page.route('**/api/experience/**', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'AI 服务暂时不可用' })
    })
  })

  await page.goto('/automations')
  await expect(page.getByRole('heading', { name: '自动化加载失败' })).toBeVisible()
  await expect(page.getByText('AI 服务暂时不可用')).toBeVisible()
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  await expect(page.getByText('结果模板')).toHaveCount(0)

  await page.goto('/execution-center')
  await expect(page.getByRole('heading', { name: '执行中心加载失败' })).toBeVisible()
  await expect(page.getByText('AI 服务暂时不可用')).toBeVisible()
  await expect(page.getByText('没有等待确认的操作')).toHaveCount(0)
  await expect(page.getByText('还没有执行结果')).toHaveCount(0)

  await page.goto('/connections')
  await expect(page.getByRole('heading', { name: '连接加载失败' })).toBeVisible()
  await expect(page.getByText('AI 服务暂时不可用')).toBeVisible()
  await expect(page.getByText('暂无推荐连接')).toHaveCount(0)
})
