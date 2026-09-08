import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/runtime-config', route => route.fulfill({ body: '{}' }))
  await page.route('**/api/auth/email/options', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ enabled: true, captcha: { configured: false, provider: '', siteKey: '' } })
  }))
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, body: '{}' }))
})
test('email-only entry rejects malformed addresses and requires human verification', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await expect(page.getByTestId('username-input')).toHaveCount(0)
  await page.getByLabel('邮箱地址', { exact: true }).fill("user@qq.co'm")
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('邮箱格式不正确')
  for (const email of ['user@qq.com', 'user@163.com', 'user@gmail.com', 'user@company.example']) {
    await page.getByLabel('邮箱地址', { exact: true }).fill(email)
    await page.getByRole('button', { name: '获取验证码', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('请先完成人机验证。')
  }
})
test('email entry accessibility', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('邮箱地址', { exact: true })).toBeVisible()
  const result = await new AxeBuilder({ page }).include('main').analyze()
  expect(result.violations.filter(item => ['critical', 'serious'].includes(item.impact || ''))).toEqual([])
})
test('mobile login fits the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  await expect(page.getByRole('button', { name: '登录 / 注册', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
