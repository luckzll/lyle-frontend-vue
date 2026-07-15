import { expect, test } from '@playwright/test'

test('recommended connection actions do not diagnose placeholders and card failures stay local', async ({ page }) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const token = `header.${payload}.signature`
  let diagnosticCalls = 0

  await page.addInitScript(({ token }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify({ id: 1, username: 'experience_connection_test', role: 'USER' }))
  }, { token })

  await page.route('**/api/agent-tools/reminders**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))
  await page.route('**/api/experience/confirmations**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))
  await page.route('**/api/experience/execution/needs-attention**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }))

  await page.route('**/api/experience/connections/recommended', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [
      { id: 'local-project', type: 'local_project', name: '本地项目', status: 'unavailable', displayReason: '尚未授权本地工作区。', nextAction: '前往添加工作区', actionTarget: '/advanced-settings?tab=cli', diagnosable: false, capabilities: ['读取 Git 状态'] },
      { id: 'mcp-7', type: 'github', name: 'GitHub 已连接', status: 'unavailable', displayReason: '需要诊断。', nextAction: '运行连接诊断', diagnosable: true, capabilities: ['读取 PR'] }
    ] }) })
  })
  await page.route('**/api/experience/connections/mcp-7/diagnose', async (route) => {
    diagnosticCalls += 1
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: '连接不存在' }) })
  })

  await page.goto('/connections')
  const localCard = page.getByRole('article').filter({ hasText: '本地项目' })
  await expect(localCard.getByRole('link', { name: '前往添加工作区' })).toHaveAttribute('href', '/advanced-settings?tab=cli')
  await expect(localCard.getByRole('button', { name: '运行连接诊断' })).toHaveCount(0)

  const githubCard = page.getByRole('article').filter({ hasText: 'GitHub 已连接' })
  await githubCard.getByRole('button', { name: '运行连接诊断' }).click()
  await expect(githubCard.getByRole('alert')).toHaveText('连接不存在')
  await expect(localCard).toBeVisible()
  expect(diagnosticCalls).toBe(1)
})
