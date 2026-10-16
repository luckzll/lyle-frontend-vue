import { expect, test, type Page, type Route } from '@playwright/test'

const now = new Date().toISOString()
const todo = (id: number, status: string, title = `待办 ${id}`) => ({
  id, title, status, dueAt: null, createdAt: now, updatedAt: now
})

async function json(route: Route, value: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) })
}

async function mockSession(page: Page) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await page.addInitScript((token) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify({ id: 'dashboard-flows', username: '首页流程验收', role: 'USER' }))
  }, `header.${payload}.signature`)
  await page.route(/^https?:\/\/[^/]+\/api\//, (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/users/me') return json(route, { id: 'dashboard-flows', username: '首页流程验收', role: 'USER' })
    if (path === '/api/conversations' || path === '/api/knowledge-bases') return json(route, [])
    return json(route, { items: [] })
  })
}

// Exercise a router navigation without reloading or accessing component internals.
async function navigateWithinApp(page: Page, url: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, url)
}

test('task deep links reveal completed and duplicate tasks and follow same-page query changes', async ({ page }) => {
  await mockSession(page)
  await page.route('**/api/agent-tools/todos**', (route) => json(route, {
    items: [todo(10, 'open'), todo(20, 'done', '已完成的目标任务'), todo(21, 'done', '已完成的目标任务'), todo(30, 'cancelled')]
  }))
  await page.goto('/tasks?taskId=21')
  const target = page.locator('[data-todo-id="21"]')
  await expect(target).toBeVisible()
  await expect(target).toBeFocused()
  await expect(target).toHaveClass(/task-row--source/)
  await expect(page.getByRole('button', { name: /^全部/ })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: /^进行中/ }).click()
  await expect(target).toHaveCount(0)
  await navigateWithinApp(page, '/tasks?taskId=30')
  await expect(page.locator('[data-todo-id="30"]')).toBeFocused()
})

test('task create query opens the existing drawer once and is consumed on close and success', async ({ page }) => {
  await mockSession(page)
  let items = [todo(10, 'open')]
  let writes = 0
  await page.route('**/api/agent-tools/todos**', (route) => {
    if (route.request().method() === 'POST') {
      writes += 1
      const created = todo(40, 'open', route.request().postDataJSON().title)
      items = [created, ...items]
      return json(route, created)
    }
    return json(route, { items })
  })
  await page.goto('/tasks?create=1')
  await expect(page.getByRole('dialog', { name: '新建待办' })).toBeVisible()
  await expect(page.getByTestId('manual-todo-title')).toBeFocused()
  await expect(page).toHaveURL('/tasks')
  expect(writes).toBe(0)
  await page.getByRole('button', { name: '关闭详情' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: '我的待办' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '新建待办' })).toHaveCount(0)

  await navigateWithinApp(page, '/tasks?create=1')
  await expect(page.getByRole('dialog', { name: '新建待办' })).toBeVisible()
  await page.getByTestId('manual-todo-title').fill('直接创建的首页待办')
  await page.getByTestId('manual-todo-submit').click()
  await expect(page.locator('[data-todo-id="40"]')).toBeVisible()
  await expect(page).toHaveURL('/tasks')
  await page.reload()
  await expect(page.getByRole('heading', { name: '我的待办' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '新建待办' })).toHaveCount(0)
  expect(writes).toBe(1)
})

test('automation create query focuses existing templates without creating or running anything', async ({ page }) => {
  await mockSession(page)
  let mutations = 0
  await page.route('**/api/experience/**', (route) => {
    if (route.request().method() !== 'GET' && !route.request().url().endsWith('/events')) mutations += 1
    if (route.request().url().endsWith('/onboarding')) return json(route, {
      completedAt: now, candidates: { projects: [{ id: 7, name: '演示计划' }], workspaces: [] }
    })
    return json(route, { items: [] })
  })
  await page.route('**/api/workbench/automations**', (route) => {
    if (route.request().method() !== 'GET') mutations += 1
    return json(route, { items: [] })
  })
  await page.goto('/automations?create=1')
  await expect(page.getByRole('heading', { name: '结果模板' })).toBeFocused()
  await expect(page.getByLabel('自动化意图')).toBeVisible()
  await expect(page).toHaveURL('/automations')
  await page.getByRole('button', { name: '收起模板' }).click()
  await expect(page.getByRole('heading', { name: '结果模板' })).toHaveCount(0)
  await navigateWithinApp(page, '/automations?create=1')
  await expect(page.getByRole('heading', { name: '结果模板' })).toBeFocused()
  await expect(page).toHaveURL('/automations')
  expect(mutations).toBe(0)
})
