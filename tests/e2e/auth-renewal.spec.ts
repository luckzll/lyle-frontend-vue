import { expect, test } from '@playwright/test'

for (const sessionValid of [true, false]) {
  test(`expired access token navigation ${sessionValid ? 'renews the session' : 'requires login for an expired session'}`, async ({ page }) => {
    const start = Date.now()
    let now = start
    let refreshCalls = 0
    await page.clock.setFixedTime(start)
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      if (new URL(route.request().url()).pathname === '/api/auth/refresh') {
        refreshCalls += 1
        if (!sessionValid && refreshCalls > 1) {
          await route.fulfill({ status: 401, json: { message: 'Session expired' } })
          return
        }
        const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + 900 })).toString('base64url')
        await route.fulfill({ json: {
          user: { id: 1, username: 'renewal_test', role: 'USER' },
          accessToken: `header.${payload}.signature`,
          expiresInSeconds: 900
        } })
        return
      }
      await route.fulfill({ json: { items: [], hasMore: false, nextCursor: null } })
    })
    await page.goto('/automations')
    await expect(page.getByRole('heading', { name: '把重复的事，交给 Lyle', exact: true })).toBeVisible()
    expect(refreshCalls).toBe(1)

    now = start + 901_000
    await page.clock.setFixedTime(now)
    await page.getByRole('link', { name: '执行中心', exact: true }).click()
    if (sessionValid) {
      await expect(page).toHaveURL(/\/execution-center/)
      await expect(page.getByRole('heading', { name: '执行中心', exact: true })).toBeVisible()
    } else {
      await expect(page).toHaveURL(/\/login\?redirect=/)
    }
    expect(refreshCalls).toBe(2)
  })
}
