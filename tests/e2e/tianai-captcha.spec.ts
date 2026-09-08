import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/refresh', r => r.fulfill({ status: 401, body: '{}' }))
  await page.route('**/api/runtime-config', r => r.fulfill({ body: '{}' }))
  await page.route('**/api/auth/email/options', r => r.fulfill({ json: { enabled: true, captcha: { provider: 'tianai', configured: true } } }))
})

test('failed puzzle can be retried and changing email discards an open challenge', async ({ page }) => {
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  let generated = 0
  await page.route('**/api/auth/captcha/challenge', r => {
    generated++
    return r.fulfill({ json: { id: 'SLIDER_' + 'a'.repeat(32), backgroundImage: pixel, templateImage: pixel, backgroundImageWidth: 600, backgroundImageHeight: 360, templateImageWidth: 100, templateImageHeight: 360 } })
  })
  await page.route('**/api/auth/captcha/verify', r => r.fulfill({ status: 400, json: { detail: '安全验证未通过，请重新验证。' } }))
  await page.goto('/login')
  await page.getByRole('button', { name: '点击完成验证' }).click()
  await page.getByRole('slider').press('ArrowRight')
  await page.getByRole('slider').press('Enter')
  await expect(page.getByRole('alert')).toContainText('安全验证未通过')
  await page.getByRole('button', { name: '重新验证', exact: true }).click()
  await expect(page.getByRole('slider')).toBeVisible()
  expect(generated).toBe(2)
  await page.getByLabel('邮箱地址', { exact: true }).fill('other@qq.com')
  await expect(page.getByRole('slider')).toHaveCount(0)
  await page.getByRole('button', { name: '获取验证码' }).click()
  await expect(page.getByRole('alert')).toHaveText('请先完成人机验证。')
})

test('challenge outage presents retry instead of granting a proof', async ({ page }) => {
  await page.route('**/api/auth/captcha/challenge', r => r.fulfill({ status: 503, json: { detail: '安全验证服务暂不可用，请稍后重试。' } }))
  await page.goto('/login')
  await page.getByRole('button', { name: '点击完成验证' }).click()
  await expect(page.getByRole('alert')).toContainText('安全验证服务暂不可用')
  await expect(page.getByText('已完成人机验证', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新验证', exact: true })).toBeEnabled()
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`expanded captcha replaces trigger and fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    await page.route('**/api/auth/captcha/challenge', r => r.fulfill({ json: { id: 'SLIDER_' + 'a'.repeat(32), backgroundImage: pixel, templateImage: pixel, backgroundImageWidth: 600, backgroundImageHeight: 360, templateImageWidth: 110, templateImageHeight: 360 } }))
    await page.goto('/login')
    await page.getByRole('button', { name: '点击完成验证', exact: true }).click()
    await expect(page.getByRole('slider')).toBeVisible()
    await expect(page.getByRole('button', { name: '点击完成验证', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '确认位置', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true)
    await page.getByRole('button', { name: '关闭滑块验证' }).click()
    await expect(page.getByRole('button', { name: '点击完成验证', exact: true })).toBeVisible()
  })
}
