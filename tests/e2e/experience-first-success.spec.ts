import { expect, test } from '@playwright/test'

test('Product experience lets a first-time user run an inspection and enable a result template', async ({ page }) => {
  test.setTimeout(90_000)
  const username = `experience_first_success_${Date.now()}`

  await page.goto('/login')
  await page.getByTestId('register-tab').click()
  await page.getByTestId('username-input').fill(username)
  await page.getByTestId('password-input').fill('123456')
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL('/dashboard')

  await page.getByRole('link', { name: '自动化', exact: true }).click()
  await expect(page.getByRole('heading', { name: '先完成一次项目巡检' })).toBeVisible()
  await page.getByRole('button', { name: '运行一次项目巡检' }).click()
  await expect(page.getByText('首次项目巡检已完成，结果已进入执行中心。')).toBeVisible()

  await page.getByRole('link', { name: '查看执行结果' }).click()
  await expect(page.getByRole('heading', { name: '执行中心' })).toBeVisible()
  await page.getByRole('button', { name: /最新结果/ }).click()
  await expect(page.getByText('执行已完成')).toBeVisible()

  await page.getByRole('link', { name: '自动化', exact: true }).click()
  await page.getByRole('button', { name: '使用此模板', exact: true }).first().click()
  const preview = page.getByRole('dialog')
  await expect(preview.getByRole('heading', { name: '项目每日简报' })).toBeVisible()
  await preview.getByRole('button', { name: '确认启用' }).click()
  await expect(page.getByText('已启用。')).toBeVisible()
})
