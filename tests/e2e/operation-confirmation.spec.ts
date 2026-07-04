import { expect, type Page, test } from '@playwright/test'

test('confirms operation idempotently and prevents rejected operation confirmation', async ({ page }) => {
  test.setTimeout(120000)
  const suffix = Date.now()
  const username = `operation_e2e_${suffix}`

  await page.goto('/login')
  await page.getByTestId('register-tab').click()
  await page.getByTestId('username-input').fill(username)
  await page.getByTestId('password-input').fill('123456')
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL('/')

  await page.getByTestId('chat-input').fill(`帮我创建待办：明天下午三点提交操作验收 ${suffix}`)
  await page.getByTestId('chat-submit').click()
  const confirmButton = page.getByTestId('chat-operation-confirm').first()
  await expect(confirmButton).toBeVisible()
  await confirmButton.click()

  await page.getByRole('link', { name: '操作', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '已执行' }).click()
  const confirmed = page.locator('.operation-row').filter({ hasText: `提交操作验收 ${suffix}` })
  await expect(confirmed).toContainText('已执行')
  const replay = await replayConfirmedOperation(page, `提交操作验收 ${suffix}`)
  expect(replay.idempotentReplay).toBe(true)

  await page.getByRole('link', { name: '聊天', exact: true }).click()
  await page.getByTestId('chat-input').fill(`帮我创建待办：明天上午九点拒绝操作验收 ${suffix}`)
  await page.getByTestId('chat-submit').click()
  await page.getByTestId('chat-operation-reject').first().click()

  await page.getByRole('link', { name: '操作', exact: true }).click()
  await page.getByRole('button', { name: '已拒绝' }).click()
  const rejected = page.locator('.operation-row').filter({ hasText: `拒绝操作验收 ${suffix}` })
  await expect(rejected).toContainText('已拒绝')
  await expect(rejected.getByTestId('operation-confirm-button')).toHaveCount(0)
})

async function replayConfirmedOperation(page: Page, summaryText: string) {
  return page.evaluate(async (summary) => {
    const token = window.localStorage.getItem('lyle-token')
    const listResponse = await fetch('/api/agent-tools/operations?limit=100', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const list = await listResponse.json()
    const operation = list.items.find((item) => item.summary.includes(summary))
    const response = await fetch(`/api/agent-tools/operations/${operation.id}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
    return response.json()
  }, summaryText)
}
