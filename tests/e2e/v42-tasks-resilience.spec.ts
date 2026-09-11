import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await seedAuth(page)
  await page.route(/^https?:\/\/[^/]+\/api\/experience\/(confirmations|execution\/needs-attention)/, (route) => {
    return json(route, { items: [] })
  })
})

test('task page never presents a total API failure as an empty state', async ({ page }) => {
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/(todos|calendar|reminders)/, (route) => json(route, {
    message: '任务服务暂时不可用'
  }, 503))

  await page.goto('/tasks')

  const failure = page.getByRole('alert').filter({ hasText: '任务加载失败' })
  await expect(failure).toBeVisible()
  await expect(failure).toContainText('任务服务暂时不可用')
  await expect(page.getByText('暂无提醒。')).toHaveCount(0)
  await expect(page.getByText('从一件小事，开始推进')).toHaveCount(0)
  await expect(page.getByText('暂无待办。', { exact: false })).toHaveCount(0)
  await expect(page.getByText('当天暂无安排', { exact: false })).toHaveCount(0)

})

test('task page preserves successful sources and identifies a partial load failure', async ({ page }) => {
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/todos/, (route) => json(route, {
    items: [todo(41, '仍然可处理的待办')]
  }))
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/calendar/, (route) => json(route, {
    message: '日历服务维护中'
  }, 503))
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/reminders/, (route) => json(route, { items: [] }))

  await page.goto('/tasks')

  await expect(page.getByText('部分任务信息未能加载')).toBeVisible()
  await expect(page.getByText('日历暂时不可用')).toBeVisible()
  await expect(page.locator('.task-row').filter({ hasText: '仍然可处理的待办' })).toBeVisible()
  const calendarFailure = page.getByRole('alert').filter({ hasText: '日历加载失败' })
  await expect(calendarFailure).toContainText('日历服务维护中')
  await expect(page.getByText('暂无提醒。')).toBeVisible()
  await expect(page.getByText('当天暂无安排', { exact: false })).toHaveCount(0)

  const filterLayout = await page.locator('.todo-filter-tabs').evaluate((filter) => ({
    overflowX: getComputedStyle(filter).overflowX,
    buttonsStayOnOneLine: Array.from(filter.querySelectorAll('button')).every((button) => (
      getComputedStyle(button).whiteSpace === 'nowrap'
    )),
    pageOverflows: document.documentElement.scrollWidth > window.innerWidth
  }))
  expect(filterLayout).toEqual({
    overflowX: 'auto',
    buttonsStayOnOneLine: true,
    pageOverflows: false
  })
})

test('360px calendar action is entity-scoped, deduplicated, and reports success and reminder failure', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  const now = new Date().toISOString()
  let firstCalendarStatus = 'scheduled'
  let calendarUpdateCalls = 0
  let reminderUpdateCalls = 0
  let releaseCalendarUpdate!: () => void
  let markCalendarUpdateStarted!: () => void
  const calendarUpdateGate = new Promise<void>((resolve) => { releaseCalendarUpdate = resolve })
  const calendarUpdateStarted = new Promise<void>((resolve) => { markCalendarUpdateStarted = resolve })

  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/todos/, (route) => json(route, { items: [] }))
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/calendar(?:\?.*)?$/, (route) => json(route, {
    items: [
      calendarItem(77, '移动端发布检查', now, firstCalendarStatus),
      calendarItem(78, '另一个日历事件', now, 'scheduled')
    ]
  }))
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/calendar\/77\/status$/, async (route) => {
    calendarUpdateCalls += 1
    markCalendarUpdateStarted()
    await calendarUpdateGate
    firstCalendarStatus = 'done'
    return json(route, calendarItem(77, '移动端发布检查', now, firstCalendarStatus))
  })
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/reminders(?:\?.*)?$/, (route) => json(route, {
    items: [reminder(91, '移动端提醒', now)]
  }))
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/reminders\/91\/read$/, (route) => {
    reminderUpdateCalls += 1
    return json(route, { message: '提醒服务繁忙，请稍后重试' }, 503)
  })

  await page.goto('/tasks')
  const firstEvent = page.locator('.calendar-agenda-item').filter({
    has: page.getByText('移动端发布检查', { exact: true })
  })
  const otherEvent = page.locator('.calendar-agenda-item').filter({
    has: page.getByText('另一个日历事件', { exact: true })
  })
  const firstComplete = firstEvent.locator('button').first()

  await firstComplete.click()
  await calendarUpdateStarted
  await expect(firstComplete).toBeDisabled()
  await expect(firstComplete).toHaveText('处理中…')
  await expect(otherEvent.locator('button').first()).toBeEnabled()
  expect(calendarUpdateCalls).toBe(1)

  releaseCalendarUpdate()
  await expect(page.getByText('日历事件已完成')).toBeVisible()
  await expect(firstEvent).toHaveCount(0)
  expect(calendarUpdateCalls).toBe(1)

  const reminderRow = page.locator('.memory-row').filter({ hasText: '移动端提醒' })
  const readButton = reminderRow.getByRole('button', { name: '标记已读' })
  await readButton.click()
  await expect(page.getByText('提醒服务繁忙，请稍后重试')).toBeVisible()
  await expect(readButton).toBeEnabled()
  expect(reminderUpdateCalls).toBe(1)

  const hasHorizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > window.innerWidth
    || document.body.scrollWidth > window.innerWidth
  ))
  expect(hasHorizontalOverflow).toBe(false)
})

test('successful task completion and reschedule emit content-free progress events', async ({ page }) => {
  let currentTodo = todo(42, '不得进入埋点的待办正文')
  const productEvents: Array<Record<string, unknown>> = []

  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/todos(?:\?.*)?$/, (route) => json(route, {
    items: currentTodo.status === 'open' ? [currentTodo] : []
  }))
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/todos\/42\/due-at$/, async (route) => {
    const body = route.request().postDataJSON() as { dueAt?: string | null }
    currentTodo = { ...currentTodo, dueAt: body.dueAt ?? null, updatedAt: new Date().toISOString() }
    return json(route, currentTodo)
  })
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/todos\/42\/status$/, async (route) => {
    const body = route.request().postDataJSON() as { status: string }
    currentTodo = { ...currentTodo, status: body.status, updatedAt: new Date().toISOString() }
    return json(route, currentTodo)
  })
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/calendar/, (route) => json(route, { items: [] }))
  await page.route(/^https?:\/\/[^/]+\/api\/agent-tools\/reminders/, (route) => json(route, { items: [] }))
  await page.route(/^https?:\/\/[^/]+\/api\/experience\/events$/, async (route) => {
    productEvents.push(route.request().postDataJSON() as Record<string, unknown>)
    return json(route, { accepted: true })
  })

  await page.goto('/tasks')
  let taskRow = page.locator('.task-row').filter({ hasText: currentTodo.title })
  await taskRow.locator('summary').filter({ hasText: '调整时间' }).click()
  await taskRow.locator('input[type="datetime-local"]').fill('2026-07-12T09:00')
  await taskRow.getByRole('button', { name: '保存时间' }).click()
  await expect.poll(() => productEvents.length).toBe(1)
  expect(productEvents[0]).toEqual({
    eventType: 'effective_progress_action',
    page: 'tasks',
    actionType: 'task_reschedule',
    status: 'pending'
  })

  taskRow = page.locator('.task-row').filter({ hasText: currentTodo.title })
  await taskRow.getByRole('button', { name: '完成' }).click()
  await expect.poll(() => productEvents.length).toBe(2)
  expect(productEvents[1]).toEqual({
    eventType: 'effective_progress_action',
    page: 'tasks',
    actionType: 'task_complete',
    status: 'completed'
  })
  expect(JSON.stringify(productEvents)).not.toContain(currentTodo.title)
})

async function seedAuth(page: Page) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString('base64url')
  const token = `header.${payload}.signature`
  await page.addInitScript(({ authToken }) => {
    localStorage.setItem('lyle-token', authToken)
    localStorage.setItem('lyle-user', JSON.stringify({
      id: 'v42-task-resilience-user',
      username: 'V4.2 任务验收用户',
      role: 'USER'
    }))
  }, { authToken: token })
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  })
}

function todo(id: number, title: string) {
  const now = new Date().toISOString()
  return {
    id,
    title,
    status: 'open',
    dueAt: null,
    conversationId: 'v42-task-resilience',
    createdAt: now,
    updatedAt: now
  }
}

function calendarItem(id: number, title: string, startsAt: string, status: string) {
  return {
    id,
    title,
    startsAt,
    status,
    conversationId: 'v42-task-resilience',
    createdAt: startsAt,
    updatedAt: startsAt
  }
}

function reminder(id: number, title: string, createdAt: string) {
  return {
    id,
    sourceType: 'calendar',
    sourceId: 77,
    title,
    message: '请完成移动端发布检查。',
    status: 'unread',
    createdAt,
    readAt: null
  }
}
