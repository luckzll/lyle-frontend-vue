import { expect, test } from '@playwright/test'

for (const status of [429, 503]) {
  test(`email send ${status} starts the server cooldown and permits retry after expiry`, async ({ page }) => {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    let sends = 0
    await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/email/code') {
        sends++
        return route.fulfill({ status, headers: { 'Retry-After': '37' }, json: { detail: '请稍后重试。' } })
      }
      const body = path === '/api/auth/email/options' ? { enabled: true, captcha: { configured: true, provider: 'tianai' } }
        : path === '/api/auth/captcha/challenge' ? { id: 'SLIDER_' + 'a'.repeat(32), backgroundImage: pixel, templateImage: pixel, backgroundImageWidth: 600, backgroundImageHeight: 360, templateImageWidth: 100, templateImageHeight: 360 }
        : path === '/api/auth/captcha/verify' ? { captchaToken: 'a'.repeat(43) } : { items: [] }
      await route.fulfill({ status: path === '/api/auth/refresh' ? 401 : 200, json: body })
    })
    await page.goto('/login')
    await page.getByLabel('邮箱地址', { exact: true }).fill('user@example.com')
    await page.getByRole('button', { name: '点击完成验证', exact: true }).click()
    await page.getByRole('slider', { name: '移动拼图位置' }).press('ArrowRight')
    await page.getByRole('slider').press('Enter')
    await expect(page.getByText('安全验证已通过', { exact: true })).toBeVisible()
    await page.clock.install()
    await page.getByRole('button', { name: '获取验证码' }).click()
    await expect(page.getByRole('button', { name: '37 秒后重发' })).toBeDisabled()
    await expect(page.getByRole('timer')).toContainText('37 秒后可重新发送')
    await page.clock.fastForward(5000)
    await expect(page.getByRole('button', { name: '32 秒后重发' })).toBeDisabled()
    expect(sends).toBe(1)
    await page.clock.fastForward(32000)
    await expect(page.getByRole('button', { name: '重新发送', exact: true })).toBeEnabled()
  })
}

test('email code login handles cooldown, invalid code, and existing-account redirect', async ({ page }) => {
  // These API stubs are test-only. Backend tests exercise the real Tianai image engine.
  const token = 'a'.repeat(43)
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { items: [] }
    let status = 200
    if (path === '/api/auth/refresh') status = 401
    if (path === '/api/auth/email/options') body = { enabled: true, captcha: { configured: true, provider: 'tianai' } }
    if (path === '/api/auth/captcha/challenge') body = { id: 'SLIDER_' + 'a'.repeat(32), backgroundImage: pixel, templateImage: pixel, backgroundImageWidth: 600, backgroundImageHeight: 360, templateImageWidth: 100, templateImageHeight: 360 }
    if (path === '/api/auth/captcha/verify') {
      expect(route.request().postDataJSON().track.trackList.length).toBeGreaterThanOrEqual(2)
      body = { captchaToken: token }
    }
    if (path === '/api/auth/email/code') {
      expect(route.request().postDataJSON()).toEqual({ email: 'user@example.com', captchaToken: token })
      body = { retryAfterSeconds: 60 }
    }
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
  await expect(page.getByTestId('username-input')).toHaveCount(0)
  await expect(page.getByText('微信登录', { exact: true })).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)
  await page.getByLabel('邮箱地址', { exact: true }).fill('user@example.com')
  await page.getByRole('button', { name: '点击完成验证', exact: true }).click()
  await page.getByRole('slider', { name: '移动拼图位置' }).press('ArrowRight')
  await page.getByRole('slider').press('Enter')
  await expect(page.getByText('安全验证已通过', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '获取验证码' }).click()
  await expect(page.getByRole('button', { name: /秒后重发/ })).toBeDisabled()
  await page.getByLabel('邮箱验证码', { exact: true }).fill('000000')
  await page.getByRole('button', { name: '登录 / 注册' }).click()
  await expect(page.getByRole('alert')).toHaveText('验证码无效或已过期。')
  await expect(page.getByLabel('邮箱验证码', { exact: true })).toHaveValue('')
  await page.getByLabel('邮箱验证码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '登录 / 注册' }).click()
  await expect(page).toHaveURL('/settings')
})
