import { expect, test } from '@playwright/test'

test('email code login handles cooldown, invalid code, and existing-account redirect', async ({ page }) => {
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { items: [] }
    let status = 200
    if (path === '/api/auth/email/options') body = { enabled: true }
    if (path === '/api/auth/email/login') {
      if (route.request().postDataJSON().code === '000000') {
        status = 400
        body = { detail: '验证码无效或已过期。' }
      } else {
        const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
        body = { user: { id: 42, username: 'zhoulele', role: 'USER' }, accessToken: `head.${payload}.signature`, expiresInSeconds: 3600 }
      }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto('/login?redirect=%2Fsettings')
  await expect(page.getByTestId('username-input')).toBeVisible()
  await page.getByRole('button', { name: '邮箱验证码', exact: true }).click()
  await page.getByLabel('邮箱', { exact: true }).fill('user@example.com')
  await page.getByRole('button', { name: '发送验证码' }).click()
  await expect(page.getByRole('button', { name: /秒后重发/ })).toBeDisabled()
  await page.getByLabel('验证码', { exact: true }).fill('000000')
  await page.getByRole('button', { name: '验证并登录' }).click()
  await expect(page.getByRole('alert')).toHaveText('验证码无效或已过期。')
  await expect(page.getByLabel('验证码', { exact: true })).toHaveValue('')
  await page.getByLabel('验证码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '验证并登录' }).click()
  await expect(page).toHaveURL('/settings')
})
