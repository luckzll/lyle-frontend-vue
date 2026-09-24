import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/refresh', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'anonymous' })
  }))
  await page.route('**/api/runtime-config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      authLoginV63Enabled: true,
      chatWorkspaceDropEnabled: true,
      chatFolderAttachmentsEnabled: true
    })
  }))
})

test('anonymous visitors can preview chat and are prompted only when they use a protected action', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL('/')
  await expect(page.getByTestId('guest-chat-preview')).toBeVisible()
  await expect(page.getByRole('heading', { name: '今天想推进什么？' })).toBeVisible()
  await expect(page.getByRole('link', { name: '登录或注册，解锁完整工作台' }).first()).toBeVisible()

  await page.locator('.workspace-heading').filter({ has: page.getByRole('button', { name: '添加本地项目', exact: true }) }).hover()
  await page.getByRole('button', { name: '添加本地项目', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '把刚才的操作继续完成' })).toBeVisible()
  await expect(page.getByText('登录后即可打开本地项目，并自动回到你刚才选择的位置。')).toBeVisible()
  await page.getByRole('button', { name: '先随便看看' }).click()
  await expect(page).toHaveURL('/')

  await page.getByTestId('guest-chat-composer').click()
  await expect(page.getByText('登录后即可开始 AI 对话，并自动回到你刚才选择的位置。')).toBeVisible()
  await page.getByTestId('auth-gate-confirm').click()
  await expect(page).toHaveURL('/login?redirect=/')
})
