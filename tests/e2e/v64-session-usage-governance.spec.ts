import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'

type MockIdentity = {
  id: number
  username: string
  token: string
  workTitle: string
  totalTokens: number
}

test('hourly usage fills gaps, exposes exact values and handles string totals', async ({ page }) => {
  const identity = identityFor(42, '用量趋势用户', '用量趋势回归', 46_884)
  let empty = false
  await installLegacySession(page, identity)
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^\/api/, '')
    if (path === '/usage/trend') {
      return fulfill(route, empty ? [] : url.searchParams.get('period') === 'month'
        ? [{ bucket: '10-16', totalTokens: '46884', callCount: '20' }]
        : [
            { bucket: '11:00', totalTokens: '39813', callCount: '16' },
            { bucket: '15:00', totalTokens: '7071', callCount: '4' }
          ])
    }
    if (path === '/usage/by-task') {
      return fulfill(route, [
        { taskType: 'CHAT', label: '对话回答', description: '对话', totalTokens: '42897', callCount: '16', estimatedCostMicros: '90000' },
        { taskType: 'OTHER', label: '其他 AI 调用', description: '其他', totalTokens: '2468', callCount: '2', estimatedCostMicros: '5000' },
        { taskType: 'INTENT', label: '意图识别', description: '意图', totalTokens: '1519', callCount: '2', estimatedCostMicros: '5000' }
      ])
    }
    return fulfillV64Route(route, identity)
  })
  await page.goto('/settings/usage')
  const chart = page.getByRole('group', { name: '今日 Token 用量折线图' })
  await expect(chart.getByRole('button')).toHaveCount(24)
  await chart.getByRole('button', { name: '11:00，39,813 Token，16 次调用', exact: true }).hover()
  await expect(page.locator('.trend-detail')).toContainText('11:00–12:00 · 39,813 Token · 16 次调用')
  await chart.getByRole('button', { name: '12:00，0 Token，0 次调用', exact: true }).focus()
  await expect(page.locator('.trend-detail')).toContainText('12:00–13:00 · 0 Token · 0 次调用')
  const line = await chart.locator('.trend-line').getAttribute('d')
  expect(line?.match(/L /g)).toHaveLength(23)
  const positions = line!.split(/ [ML] /).map((point) => point.replace(/^M /, '').split(' ').map(Number))
  expect(positions.slice(12, 15).every(([, y]) => y === 150)).toBe(true)
  expect(positions[11][1]).toBe(0)
  await expect(page.locator('.breakdown-table tbody tr').nth(0)).toContainText('91%')
  await expect(page.locator('.breakdown-table tbody tr').nth(1)).toContainText('5%')
  await expect(page.locator('.breakdown-table tbody tr').nth(2)).toContainText('3%')
  await page.mouse.click(20, 20)
  await page.screenshot({ path: 'artifacts/usage-hourly-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await chart.getByRole('button', { name: '15:00，7,071 Token，4 次调用', exact: true }).click()
  await expect(page.locator('.trend-detail')).toContainText('15:00–16:00 · 7,071 Token · 4 次调用')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  const labels = await page.locator('.trend-labels span').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect()
    return { left: rect.left, right: rect.right }
  }))
  expect(labels.every((label, index) => index === 0 || label.left > labels[index - 1].right)).toBe(true)
  await page.screenshot({ path: 'artifacts/usage-hourly-mobile.png', fullPage: true })
  await page.getByRole('tab', { name: '本月', exact: true }).click()
  const monthChart = page.getByRole('group', { name: '本月 Token 用量折线图' })
  await expect(monthChart.locator('.trend-dot')).toHaveCount(1)
  await expect(monthChart.getByRole('button')).toHaveCount(1)
  empty = true
  await page.getByRole('tab', { name: '今日', exact: true }).click()
  await expect(chart.getByRole('button')).toHaveCount(24)
  await expect(page.locator('.trend-detail')).toContainText('今日暂无 AI 用量')
  await expect(chart.getByRole('button', { name: /，0 Token，0 次调用/ })).toHaveCount(24)
})

test('V6.4 refresh restores the account session after a full page reload', async ({ page }) => {
  const identity = identityFor(42, '会话恢复用户', '恢复后的私有对话', 12_340)
  let refreshCalls = 0
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '')
    if (path === '/auth/refresh') {
      refreshCalls += 1
      return fulfill(route, {
        user: userFor(identity),
        accessToken: identity.token,
        expiresInSeconds: 3600
      })
    }
    return fulfillV64Route(route, identity)
  })

  await page.goto('/settings')
  await expect(page.locator('.identity-card').getByText(identity.username, { exact: true })).toBeVisible()
  await expect(page.getByText('此浏览器', { exact: false })).toBeVisible()
  expect(refreshCalls).toBe(1)

  await page.reload()
  await expect(page.locator('.identity-card').getByText(identity.username, { exact: true })).toBeVisible()
  await expect.poll(() => refreshCalls).toBe(2)
  expect(await page.evaluate(() => localStorage.getItem('lyle-token'))).toBeNull()
})

test('V6.4 quota, period tabs, semantic tables and mobile layout work together', async ({ page }) => {
  const identity = identityFor(42, '额度用户', '今日额度对话', 50_000)
  const requestedPeriods: string[] = []
  let policyUpdate: Record<string, number> | null = null
  await installLegacySession(page, identity)
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^\/api/, '')
    if (path.startsWith('/usage/')) {
      expect(route.request().headers().authorization).toBe(`Bearer ${identity.token}`)
    }
    if (path === '/usage/summary' || path === '/usage/turns') {
      requestedPeriods.push(url.searchParams.get('period') || '')
    }
    if (path === '/usage/policy' && route.request().method() === 'PUT') {
      policyUpdate = route.request().postDataJSON()
    }
    return fulfillV64Route(route, identity, url.searchParams.get('period') === 'month')
  })

  await page.goto('/settings/usage')
  await expect(page.getByText('已达上限', { exact: true })).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(2)

  const todayTab = page.getByRole('tab', { name: '今日' })
  const monthTab = page.getByRole('tab', { name: '本月' })
  await todayTab.focus()
  await todayTab.press('ArrowRight')
  await expect(monthTab).toBeFocused()
  await expect(monthTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'usage-month-tab')
  await expect(page.getByText('本月额度对话', { exact: true })).toBeVisible()
  expect(requestedPeriods).toContain('month')

  await page.getByRole('button', { name: '调整额度' }).click()
  await page.getByLabel('提醒阈值（Token）').fill('45000')
  await page.getByLabel('每日硬上限（Token）').fill('60000')
  await page.getByRole('button', { name: '保存额度' }).click()
  await expect.poll(() => policyUpdate).toMatchObject({
    dailySoftTokenLimit: 45_000,
    dailyHardTokenLimit: 60_000
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('link', { name: /查看对话/ }).first()).toBeVisible()
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }))
  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.body).toBeLessThanOrEqual(1)
})

test('V6.4 keeps two users usage and recent turns isolated in separate sessions', async ({ browser }) => {
  const userA = identityFor(42, '用户甲', '甲的私有对话', 12_345)
  const userB = identityFor(84, '用户乙', '乙的私有对话', 67_890)
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  try {
    await installContextSession(contextA, userA)
    await installContextSession(contextB, userB)
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()
    await mockIdentityApi(pageA, userA)
    await mockIdentityApi(pageB, userB)

    await Promise.all([pageA.goto('/settings/usage'), pageB.goto('/settings/usage')])
    await expect(pageA.getByText(userA.workTitle, { exact: true })).toBeVisible()
    await expect(pageB.getByText(userB.workTitle, { exact: true })).toBeVisible()
    await expect(pageA.getByText(userB.workTitle, { exact: true })).toHaveCount(0)
    await expect(pageB.getByText(userA.workTitle, { exact: true })).toHaveCount(0)
  } finally {
    await Promise.all([contextA.close(), contextB.close()])
  }
})

async function mockIdentityApi(page: Page, identity: MockIdentity) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '')
    if (path.startsWith('/usage/')) {
      const authorization = route.request().headers().authorization
      if (authorization !== `Bearer ${identity.token}`) {
        return fulfill(route, { detail: 'forbidden' }, 403)
      }
    }
    return fulfillV64Route(route, identity)
  })
}

async function installLegacySession(page: Page, identity: MockIdentity) {
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify(user))
  }, { token: identity.token, user: userFor(identity) })
}

async function installContextSession(context: BrowserContext, identity: MockIdentity) {
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify(user))
  }, { token: identity.token, user: userFor(identity) })
}

async function fulfillV64Route(route: Route, identity: MockIdentity, month = false) {
  const path = new URL(route.request().url()).pathname.replace(/^\/api/, '')
  if (path === '/runtime-config') return fulfill(route, {})
  if (path === '/users/me') return fulfill(route, userFor(identity))
  if (path === '/auth/session') {
    return fulfill(route, {
      createdAt: '2026-07-24T09:00:00',
      lastUsedAt: '2026-07-24T16:00:00',
      expiresAt: '2026-08-23T09:00:00',
      current: true
    })
  }
  if (path === '/billing/account') {
    return fulfill(route, {
      status: 'ACTIVE',
      plan: {
        code: 'FREE',
        name: '免费版',
        status: 'ACTIVE',
        benefits: ['基础聊天与记忆']
      },
      availableCreditMicros: 100_000_000,
      totalGrantedCreditMicros: 100_000_000,
      totalConsumedCreditMicros: 0,
      nextExpiryAt: null,
      commercialQuotaEnforced: false,
      settlementMode: 'SHADOW',
      checkoutEnabled: false
    })
  }
  if (path === '/usage/summary') {
    return fulfill(route, {
      period: month ? 'month' : 'today',
      periodStart: '2026-07-01T00:00:00',
      periodEnd: '2026-08-01T00:00:00',
      totalTokens: month ? identity.totalTokens + 40_000 : identity.totalTokens,
      inputTokens: identity.totalTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      callCount: 8,
      estimatedCostMicros: 100_000,
      reportedRatio: 100,
      estimatedRatio: 0,
      measurementStatus: 'REPORTED'
    })
  }
  if (path === '/usage/by-task') {
    return fulfill(route, [{
      taskType: 'CHAT',
      label: '对话回答',
      description: '用于日常对话与问题回答',
      totalTokens: identity.totalTokens,
      estimatedCostMicros: 100_000,
      callCount: 8
    }])
  }
  if (path === '/usage/trend') {
    return fulfill(route, [{ bucket: month ? '07-24' : '16:00', totalTokens: identity.totalTokens, callCount: 8 }])
  }
  if (path === '/usage/turns') {
    return fulfill(route, [{
      turnId: `${identity.id}-turn`,
      conversationId: `${identity.id}-conversation`,
      workTitle: month ? '本月额度对话' : identity.workTitle,
      taskType: 'CHAT',
      taskLabel: '对话回答',
      totalTokens: identity.totalTokens,
      estimatedCostMicros: 100_000,
      callCount: 8,
      measurementSource: 'PROVIDER_REPORTED',
      occurredAt: '2026-07-24T16:00:00'
    }])
  }
  if (path === '/usage/policy') {
    return fulfill(route, {
      dailySoftTokenLimit: 40_000,
      dailyHardTokenLimit: 50_000,
      dailySoftCostMicros: 800_000,
      dailyHardCostMicros: 1_200_000,
      turnMaxCalls: 12,
      turnMaxInputTokens: 100_000,
      turnMaxOutputTokens: 16_000,
      turnMaxCostMicros: 200_000,
      usedTokens: 50_000,
      usedCostMicros: 860_000,
      usedPercent: 100,
      remainingTokens: 0,
      status: 'EXHAUSTED',
      resetsAt: '2026-07-25T00:00:00'
    })
  }
  return fulfill(route, { items: [] })
}

function identityFor(
  id: number,
  username: string,
  workTitle: string,
  totalTokens: number
): MockIdentity {
  const payload = Buffer.from(JSON.stringify({
    sub: String(id),
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64url')
  return { id, username, workTitle, totalTokens, token: `header.${payload}.signature-${id}` }
}

function userFor(identity: MockIdentity) {
  return {
    id: identity.id,
    username: identity.username,
    role: 'USER',
    status: 'ACTIVE',
    lastLoginAt: '2026-07-24T09:00:00'
  }
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  })
}
