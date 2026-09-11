import { expect, test, type Page, type Route } from '@playwright/test'

const user = {
  id: 65,
  username: 'V6.5 验收用户',
  role: 'USER',
  status: 'ACTIVE',
  lastLoginAt: '2026-07-30T09:00:00'
}
const token = `header.${Buffer.from(JSON.stringify({
  sub: '65',
  exp: Math.floor(Date.now() / 1000) + 3600
})).toString('base64url')}.signature`

const product = {
  productCode: 'PRO',
  productType: 'PLAN',
  name: 'Pro',
  description: '适合持续使用 Lyle 的个人用户',
  priceVersionCode: 'PRO_30D_V1',
  amount: { currency: 'CNY', payableMinor: 2900, paidMinor: 0, formatted: '¥29.00' },
  includedCreditMicros: 50_000_000,
  validityDays: 30,
  benefits: ['更高 AI 额度', '完整订单与额度明细']
}
const account = {
  status: 'ACTIVE',
  plan: { code: 'FREE', name: '免费版', status: 'ACTIVE', benefits: ['基础聊天与记忆'] },
  availableCreditMicros: 100_000_000,
  totalGrantedCreditMicros: 100_000_000,
  totalConsumedCreditMicros: 0,
  nextExpiryAt: null,
  commercialQuotaEnforced: true,
  settlementMode: 'ACTIVE',
  checkoutEnabled: true
}
const order = {
  orderNo: 'L202607300001',
  status: 'CREATED',
  orderType: 'NEW_PURCHASE',
  productCode: product.productCode,
  priceVersionCode: product.priceVersionCode,
  product,
  amount: product.amount,
  paymentNo: null,
  paymentStatus: null,
  paymentProvider: null,
  refundStatus: null,
  refundSucceededAt: null,
  expiresAt: '2026-07-30T10:30:00',
  paidAt: null,
  fulfilledAt: null,
  createdAt: '2026-07-30T10:00:00'
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify(user))
  }, { token, user })
})

test('V6.5 uses server price snapshots and only completes after FULFILLED', async ({ page }) => {
  let createdPayload: Record<string, unknown> | null = null
  let statusCalls = 0
  await mockBillingApi(page, async (route, path) => {
    if (path === '/billing/orders' && route.request().method() === 'POST') {
      createdPayload = route.request().postDataJSON()
      return fulfill(route, order)
    }
    if (path === `/billing/orders/${order.orderNo}/checkout`) {
      return fulfill(route, {
        orderNo: order.orderNo,
        orderStatus: 'PENDING_PAYMENT',
        paymentNo: 'P202607300001',
        paymentStatus: 'PENDING',
        provider: 'MOCK',
        checkoutType: 'SANDBOX',
        action: null,
        expiresAt: order.expiresAt,
        sandbox: true
      })
    }
    if (path === `/billing/orders/${order.orderNo}/status`) {
      statusCalls += 1
      return fulfill(route, statusCalls >= 2
        ? { ...order, status: 'FULFILLED', paymentNo: 'P202607300001', paymentStatus: 'SUCCEEDED', fulfilledAt: '2026-07-30T10:01:00' }
        : { ...order, status: 'FULFILLING', paymentNo: 'P202607300001', paymentStatus: 'SUCCEEDED', paidAt: '2026-07-30T10:00:30' })
    }
    if (path === `/billing/orders/${order.orderNo}`) return fulfill(route, order)
    return false
  })

  await page.goto('/pricing?returnTo=/tasks')
  await expect(page.getByText('¥29.00', { exact: true })).toBeVisible()
  await expect(page.getByText('50 AI 额度', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '选择Pro' }).click()
  await expect(page).toHaveURL(new RegExp(`/checkout/${order.orderNo}`))
  expect(createdPayload).toMatchObject({
    priceVersionCode: 'PRO_30D_V1',
    purchaseIntent: 'NEW_PURCHASE'
  })
  expect(String(createdPayload?.clientRequestId)).toHaveLength(36)
  await expect(page.getByText('开发沙箱', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '我已完成支付' }).click()
  await expect(page).toHaveURL(new RegExp(`/billing/result/${order.orderNo}`))
  await expect(page.getByRole('heading', { name: '权益已到账' })).toBeVisible()
  await expect(page.getByRole('link', { name: '返回刚才的任务' })).toHaveAttribute('href', '/tasks')
})

test('支付宝 HTML form opens in a new tab and keeps the Lyle checkout available', async ({ page, context }) => {
  await context.route('**/alipay-sandbox', async (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().postData()).toContain('out_trade_no=P202607300001')
    await route.fulfill({
      status: 200,
      contentType: 'text/html;charset=UTF-8',
      body: '<!doctype html><html><body><h1>支付宝沙箱收银台</h1></body></html>'
    })
  })
  await mockBillingApi(page, async (route, path) => {
    if (path === `/billing/orders/${order.orderNo}/checkout`) {
      return fulfill(route, {
        orderNo: order.orderNo,
        orderStatus: 'PENDING_PAYMENT',
        paymentNo: 'P202607300001',
        paymentStatus: 'PENDING',
        provider: 'ALIPAY',
        checkoutType: 'HTML_FORM',
        action: '<form method="post" action="/alipay-sandbox"><input type="hidden" name="out_trade_no" value="P202607300001"></form>',
        expiresAt: order.expiresAt,
        sandbox: false
      })
    }
    if (path === `/billing/orders/${order.orderNo}/status`) return fulfill(route, order)
    return false
  })

  await page.goto(`/checkout/${order.orderNo}`)
  await expect(page.getByText('支付宝将在新标签页打开', { exact: false })).toBeVisible()
  const [alipayPage] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: '新标签页打开支付宝' }).click()
  ])
  await expect(page).toHaveURL(new RegExp(`/checkout/${order.orderNo}`))
  await expect(page.getByRole('button', { name: '稍后支付' })).toBeVisible()
  await expect(page.getByRole('button', { name: '取消订单' })).toBeVisible()
  await alipayPage.waitForLoadState()
  await expect(alipayPage).toHaveURL(/\/alipay-sandbox$/)
  await expect(alipayPage.getByRole('heading', { name: '支付宝沙箱收银台' })).toBeVisible()
})

test('微信 Native 支付在收银台生成可扫码二维码', async ({ page }) => {
  await mockBillingApi(page, async (route, path) => {
    if (path === `/billing/orders/${order.orderNo}/checkout`) {
      return fulfill(route, {
        orderNo: order.orderNo,
        orderStatus: 'PENDING_PAYMENT',
        paymentNo: 'P202607300002',
        paymentStatus: 'PENDING',
        provider: 'WECHAT_PAY',
        checkoutType: 'QR_CODE',
        action: 'weixin://wxpay/bizpayurl?pr=lyleAiWechatNativeTest',
        expiresAt: order.expiresAt,
        sandbox: false
      })
    }
    if (path === `/billing/orders/${order.orderNo}/status`) return fulfill(route, order)
    return false
  })

  await page.goto(`/checkout/${order.orderNo}`)
  await expect(page.getByText('请使用微信扫码支付', { exact: true })).toBeVisible()
  const qrCode = page.getByRole('img', { name: '微信支付二维码' })
  await expect(qrCode).toBeVisible()
  await expect(qrCode).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect(page.getByRole('button', { name: '新标签页打开支付宝' })).toHaveCount(0)
})

test('收银台可在支付宝和微信支付之间切换', async ({ page }) => {
  await mockBillingApi(page, async (route, path) => {
    if (path === `/billing/orders/${order.orderNo}/checkout`) {
      const provider = new URL(route.request().url()).searchParams.get('provider') || 'ALIPAY'
      const wechat = provider === 'WECHAT_PAY'
      return fulfill(route, {
        orderNo: order.orderNo,
        orderStatus: 'PENDING_PAYMENT',
        paymentNo: wechat ? 'P-WECHAT' : 'P-ALIPAY',
        paymentStatus: 'PENDING',
        provider,
        checkoutType: wechat ? 'QR_CODE' : 'HTML_FORM',
        action: wechat
          ? 'weixin://wxpay/bizpayurl?pr=dualProviderTest'
          : '<form method="post" action="/alipay-sandbox"></form>',
        expiresAt: order.expiresAt,
        sandbox: false,
        availableProviders: ['ALIPAY', 'WECHAT_PAY']
      })
    }
    if (path === `/billing/orders/${order.orderNo}/status`) return fulfill(route, order)
    return false
  })

  await page.goto(`/checkout/${order.orderNo}`)
  await page.getByRole('button', { name: /微信支付/ }).click()
  await expect(page.getByText('请使用微信扫码支付', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: '微信支付二维码' })).toBeVisible()

  await page.getByRole('button', { name: /支付宝/ }).click()
  await expect(page.getByRole('button', { name: '新标签页打开支付宝' })).toBeVisible()
  await expect(page.getByRole('img', { name: '微信支付二维码' })).toHaveCount(0)
})

test('V6.5 billing dashboard keeps credit, order and money language separate on mobile', async ({ page }) => {
  await mockBillingApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings/billing')

  await expect(page.getByRole('heading', { name: '套餐与账单' })).toBeVisible()
  await expect(page.getByText('免费版', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('100', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('免费额度到账', { exact: true })).toBeVisible()
  await expect(page.getByText('¥29.00', { exact: true })).toBeVisible()

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }))
  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.body).toBeLessThanOrEqual(1)
  await expectUsableWidth(page, '.lyle-shell', 388)
  await expectUsableWidth(page, '.settings-frame', 360)
  await expectUsableWidth(page, '.billing-page', 340)
})

test('V6.5 core commercial pages remain usable at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBillingApi(page, async (route, path) => {
    if (path === `/billing/orders/${order.orderNo}/checkout`) {
      return fulfill(route, {
        orderNo: order.orderNo,
        orderStatus: 'PENDING_PAYMENT',
        paymentNo: 'P202607300001',
        paymentStatus: 'PENDING',
        provider: 'MOCK',
        checkoutType: 'SANDBOX',
        action: null,
        expiresAt: order.expiresAt,
        sandbox: true
      })
    }
    if (path === `/billing/orders/${order.orderNo}/status`) {
      return fulfill(route, {
        ...order,
        status: 'FULFILLED',
        paymentNo: 'P202607300001',
        paymentStatus: 'SUCCEEDED',
        paidAt: '2026-07-30T10:00:30',
        fulfilledAt: '2026-07-30T10:01:00'
      })
    }
    return false
  })

  const pages = [
    { path: '/pricing', selector: '.pricing-page', shellSelector: '.lyle-shell', heading: '选择适合你的 Lyle' },
    { path: `/checkout/${order.orderNo}`, selector: '.checkout-page', heading: 'Pro' },
    { path: `/billing/result/${order.orderNo}`, selector: '.result-card', heading: '权益已到账' },
    { path: '/settings/billing', selector: '.billing-page', heading: '套餐与账单' },
    { path: `/settings/billing/orders/${order.orderNo}`, selector: '.order-page', heading: 'Pro' }
  ]

  for (const target of pages) {
    await page.goto(target.path)
    await expect(page.getByRole('heading', { name: target.heading, exact: true }).first()).toBeVisible()
    await expectUsableWidth(page, target.selector, 340)
    if (target.path.startsWith('/settings/')) {
      await expect(page.getByRole('link', { name: '返回应用', exact: true })).toBeVisible()
      await expect(page.locator('.settings-frame__nav')).toBeVisible()
      const settingsCategory = page.getByRole('combobox', { name: '设置分类', exact: true })
      await expect(settingsCategory).toBeVisible()
      await expect(settingsCategory).toHaveValue('/settings/billing')
      await expect(page.locator('.app-header')).toHaveCount(0)
      await expect(page.locator('.app-sidebar')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '打开主导航', exact: true })).toHaveCount(0)
    } else {
      await expectUsableWidth(page, target.shellSelector ?? '.app-header', 340)
    }
  }
})

test('套餐页保留工作台导航框架', async ({ page }) => {
  await mockBillingApi(page)
  await page.goto('/pricing')

  await expect(page.locator('.lyle-shell')).toBeVisible()
  await expect(page.locator('.app-sidebar')).toBeVisible()
  await expect(page.locator('.app-sidebar').getByRole('link', { name: '设置', exact: true })).toHaveCount(0)
  await expect(page.locator('.pricing-nav')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '选择适合你的 Lyle' })).toBeVisible()
})

test('V6.5 pay later keeps the order open and returns to billing', async ({ page }) => {
  let closeCalls = 0
  await mockBillingApi(page, async (route, path) => {
    if (path === `/billing/orders/${order.orderNo}/checkout`) {
      return fulfill(route, {
        orderNo: order.orderNo,
        orderStatus: 'PENDING_PAYMENT',
        paymentNo: 'P202607300001',
        paymentStatus: 'PENDING',
        provider: 'MOCK',
        checkoutType: 'SANDBOX',
        action: null,
        expiresAt: order.expiresAt,
        sandbox: true
      })
    }
    if (path === `/billing/orders/${order.orderNo}/close`) {
      closeCalls += 1
      return fulfill(route, { ...order, status: 'CLOSED' })
    }
    return false
  })

  await page.goto(`/checkout/${order.orderNo}`)
  await page.getByRole('button', { name: '稍后支付' }).click()
  await expect(page).toHaveURL(/\/settings\/billing$/)
  expect(closeCalls).toBe(0)
  await expect(page.getByRole('heading', { name: '套餐与账单' })).toBeVisible()
})

test('V6.5 order detail localizes purchase intent and payment provider', async ({ page }) => {
  await mockBillingApi(page, async (route, path) => {
    if (path === `/billing/orders/${order.orderNo}`) {
      return fulfill(route, {
        ...order,
        status: 'REFUNDED',
        paymentProvider: 'MOCK',
        refundStatus: 'SUCCEEDED',
        refundSucceededAt: '2026-07-30T02:02:00Z'
      })
    }
    return false
  })

  await page.goto(`/settings/billing/orders/${order.orderNo}`)
  await expect(page.getByText('新购', { exact: true })).toBeVisible()
  await expect(page.getByText('开发沙箱', { exact: true })).toBeVisible()
  await expect(page.getByText('NEW_PURCHASE', { exact: true })).toHaveCount(0)
  await expect(page.getByText('MOCK', { exact: true })).toHaveCount(0)
  const refundStep = page.locator('.timeline li').filter({ hasText: '退款已完成' })
  await expect(refundStep).toContainText('2026/07/30 10:02')
  await expect(refundStep).not.toContainText('等待处理')
})

test('V6.5 platform pending mode explains and blocks checkout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBillingApi(page, async (route, path) => {
    if (path === '/billing/account') {
      return fulfill(route, {
        ...account,
        checkoutEnabled: false,
        commercialQuotaEnforced: false,
        settlementMode: 'SHADOW'
      })
    }
    if (path === '/billing/orders' && route.request().method() === 'GET') {
      return fulfill(route, [order])
    }
    return false
  })

  await page.goto('/pricing')
  const notice = page.getByRole('status')
  await expect(notice).toContainText('支付功能尚未开放')
  await expect(notice).toContainText('现有套餐与 AI 额度不受影响')
  const disabledCheckout = page.getByRole('button', { name: '支付暂未开放' })
  await expect(disabledCheckout).toBeDisabled()
  await expect(page.getByRole('button', { name: '继续支付' })).toHaveCount(0)
  await expectUsableWidth(page, '.pricing-page', 340)
})

async function expectUsableWidth(page: Page, selector: string, minimumWidth: number) {
  const geometry = await page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      width: rect.width,
      left: rect.left,
      right: rect.right,
      viewport: window.innerWidth
    }
  })
  expect(geometry.width).toBeGreaterThanOrEqual(minimumWidth)
  expect(geometry.left).toBeGreaterThanOrEqual(-1)
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1)
}

async function mockBillingApi(
  page: Page,
  override?: (route: Route, path: string) => Promise<boolean | void>
) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '')
    if (override && await override(route, path) !== false) return
    if (path === '/runtime-config') return fulfill(route, {})
    if (path === '/users/me') return fulfill(route, user)
    if (path === '/billing/catalog') return fulfill(route, [product])
    if (path === '/billing/account') return fulfill(route, account)
    if (path === '/billing/account/ledger') {
      return fulfill(route, [{
        entryType: 'FREE_GRANT',
        direction: 'CREDIT',
        creditMicros: 100_000_000,
        balanceAfterMicros: 100_000_000,
        sourceType: 'FREE_CYCLE',
        sourceId: 'WELCOME',
        occurredAt: '2026-07-30T09:00:00',
        expiresAt: null,
        metadata: {}
      }])
    }
    if (path === '/billing/orders') return fulfill(route, [{ ...order, status: 'FULFILLED', paymentStatus: 'SUCCEEDED' }])
    if (path === '/billing/refunds') return fulfill(route, [])
    if (path === `/billing/orders/${order.orderNo}`) return fulfill(route, order)
    return fulfill(route, { items: [] })
  })
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  })
}
