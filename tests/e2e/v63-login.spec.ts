import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => mockApi(route))
})

test('login starts empty, exposes accessible fields, and returns to the protected target', async ({ page }) => {
  await page.goto('/projects/42?tab=files')

  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(page.getByTestId('username-input')).toHaveValue('')
  await expect(page.getByTestId('password-input')).toHaveValue('')
  await expect(page.getByLabel('用户名')).toHaveAttribute('autocomplete', 'username')
  await expect(page.getByTestId('password-input')).toHaveAttribute('autocomplete', 'current-password')
  await page.getByTestId('password-input').fill('safe-password')
  await page.getByRole('button', { name: '显示密码' }).click()
  await expect(page.getByTestId('password-input')).toHaveAttribute('type', 'text')
  await page.getByTestId('username-input').fill('lyle-user')
  await page.getByTestId('auth-submit').click()

  await expect(page).toHaveURL('/projects/42?tab=files')
})

test('register changes autocomplete, clears password, and unsafe redirect falls back', async ({ page }) => {
  await page.goto('/login?redirect=https%3A%2F%2Fevil.example%2Fsteal')
  await page.getByTestId('username-input').fill('new-user')
  await page.getByTestId('password-input').fill('temporary-password')
  await page.getByTestId('register-tab').click()

  await expect(page.getByTestId('username-input')).toHaveValue('new-user')
  await expect(page.getByTestId('password-input')).toHaveValue('')
  await expect(page.getByTestId('password-input')).toHaveAttribute('autocomplete', 'new-password')
  await page.getByTestId('password-input').fill('safe-password')
  await page.getByTestId('auth-submit').click()

  await expect(page).toHaveURL('/dashboard')
})

test('login entry has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('.auth-page')).toBeVisible()

  const result = await new AxeBuilder({ page }).include('.auth-page').analyze()

  expect(result.violations.filter((item) => ['critical', 'serious'].includes(item.impact || ''))).toEqual([])
})

test('brand hierarchy is dominant and account tabs support arrow navigation', async ({ page }) => {
  await page.goto('/login')

  const brandSize = Number.parseFloat(await page.locator('.auth-brand strong').evaluate((element) => getComputedStyle(element).fontSize))
  const headingSize = Number.parseFloat(await page.getByRole('heading', { name: '欢迎回来' }).evaluate((element) => getComputedStyle(element).fontSize))
  expect(brandSize).toBeGreaterThan(headingSize)

  await page.getByTestId('login-tab').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('register-tab')).toBeFocused()
  await expect(page.getByTestId('register-tab')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('password-input')).toHaveAttribute('autocomplete', 'new-password')
  await page.keyboard.press('Home')
  await expect(page.getByTestId('login-tab')).toBeFocused()
  await expect(page.getByTestId('login-tab')).toHaveAttribute('aria-selected', 'true')
})

test('runtime login rollback switch restores the V6.2 entry shell', async ({ page }) => {
  await page.route('**/api/runtime-config', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authLoginV63Enabled: false, chatWorkspaceDropEnabled: true, chatFolderAttachmentsEnabled: true })
  }))

  await page.goto('/login')

  await expect(page.locator('.auth-page-v62')).toBeVisible()
  await expect(page.locator('.legacy-heading')).toContainText('Lyle AI')
  await expect(page.locator('.auth-brand')).toHaveCount(0)
})

test('runtime config does not block the login first paint', async ({ page }) => {
  await page.route('**/api/runtime-config', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authLoginV63Enabled: true, chatWorkspaceDropEnabled: true, chatFolderAttachmentsEnabled: true })
    })
  })

  await page.goto('/login')
  await expect(page.getByTestId('username-input')).toBeVisible({ timeout: 1_000 })
  expect(await page.evaluate(() => performance.now())).toBeLessThan(1_000)
})

test('login ambient uses production TOS and falls back to the local asset', async ({ page }) => {
  let productionRequests = 0
  await page.route('**/lyle-v6.3-login-ambient-64f68e40@2x.webp', async (route) => {
    productionRequests += 1
    await route.abort()
  })

  await page.goto('/login')

  const ambient = page.getByTestId('auth-ambient-image')
  await expect(ambient).toHaveAttribute('src', /^data:image\/svg\+xml/)
  expect(productionRequests).toBe(1)
  await expect(ambient).toHaveAttribute('loading', 'lazy')
  await expect(ambient).toHaveAttribute('fetchpriority', 'low')
})

async function mockApi(route: Route) {
  const pathname = new URL(route.request().url()).pathname
  if (pathname === '/api/auth/login' || pathname === '/api/auth/register') {
    const tokenPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { id: 42, username: 'lyle-user', role: 'USER' }, token: `head.${tokenPayload}.signature` })
    })
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
}
