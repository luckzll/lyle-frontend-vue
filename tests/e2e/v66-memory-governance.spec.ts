import { expect, test, type Page, type Route } from '@playwright/test'

const source = {
  sourceId: 'evidence:1',
  type: 'CONVERSATION',
  label: '与 Lyle 的对话',
  relation: 'SUPPORT',
  excerpt: '生成图片时不要给人物戴帽子。',
  occurredAt: '2026-08-10T06:32:00Z',
  availability: 'AVAILABLE',
  unavailableReason: null,
  conversationId: '66',
  messageId: '8801',
  chunkId: null,
  link: '/?conversationId=66&messageId=8801'
}

const record = {
  memoryId: 'profile:101',
  profileId: 101,
  schemaPath: 'preferences.visual.dislikes',
  title: '视觉负向偏好',
  value: '不喜欢人物戴帽子',
  rawValue: '不喜欢人物戴帽子',
  status: 'ACTIVE',
  reliability: 'RELIABLE',
  confidence: 0.92,
  confirmedByUser: true,
  sourceCount: 1,
  latestSource: source,
  usageDescription: 'Lyle 会在图片、视觉风格和人物形象相关的问题中使用它。',
  lastUsedAt: null,
  updatedAt: '2026-08-10T06:32:00Z',
  allowedActions: ['CORRECT', 'DISABLE', 'FORGET', 'PURGE'],
  sources: [source],
  history: []
}

const conflict = {
  id: 9,
  schemaPath: 'work.current_role',
  title: '当前角色',
  status: 'OPEN',
  version: 1,
  currentMemory: { ...record, memoryId: 'profile:102', profileId: 102, title: '当前角色', value: '产品经理', rawValue: '产品经理' },
  candidate: {
    fragmentId: 201,
    value: '产品设计师',
    source: {
      type: 'CONVERSATION',
      label: '与 Lyle 的对话',
      excerpt: '我现在已经转岗做产品设计师了。',
      occurredAt: '2026-08-10T06:32:00Z',
      conversationId: '66',
      messageId: '8801',
      chunkId: null
    }
  },
  createdAt: '2026-08-10T06:32:00Z',
  updatedAt: '2026-08-10T06:32:00Z'
}

test.beforeEach(async ({ page }) => {
  await installAuthenticatedSession(page)
})

test('correction dialog is a real modal with focus entry, containment and restoration', async ({ page }) => {
  await mockApis(page)
  await page.goto('/memory')
  const trigger = page.getByRole('button', { name: '纠正这条记忆' })
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: '纠正这条记忆' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(page.locator('dialog:modal')).toHaveCount(1)
  await expect(dialog.getByRole('textbox')).toBeFocused()

  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => {
      const modal = document.querySelector('dialog')
      return Boolean(modal?.contains(document.activeElement))
    })).toBe(true)
  }

  await dialog.getByRole('button', { name: '关闭' }).click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('all five conflict decisions enable confirmation and reach the API', async ({ page }) => {
  const submitted: string[] = []
  await mockApis(page, { onResolve: (resolution) => submitted.push(resolution) })
  const choices = [
    ['使用新的表达', 'USE_CANDIDATE'],
    ['保留原来的记忆', 'KEEP_CURRENT'],
    ['合并为新内容', 'MERGE'],
    ['两条都不使用', 'USE_NEITHER'],
    ['遗忘相关内容', 'FORGET']
  ] as const

  for (const [label, expectedResolution] of choices) {
    await page.goto('/memory')
    await page.getByRole('button', { name: /待我处理/ }).click()
    await page.getByRole('radio', { name: new RegExp(label) }).click()
    const confirm = page.getByRole('button', { name: '确认并更新记忆' })
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect.poll(() => submitted.at(-1)).toBe(expectedResolution)
  }
})

test('an unavailable source never exposes cached text or a replay link', async ({ page }) => {
  await mockApis(page, { unavailableSource: true })
  await page.goto('/memory')

  await expect(page.getByText('原消息已删除或当前用户无权访问')).toBeVisible()
  await expect(page.getByText('生成图片时不要给人物戴帽子。')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /查看原内容/ })).toHaveCount(0)
})

test('messageId replay loads the conversation, scrolls to and focuses the exact message', async ({ page }) => {
  await mockApis(page)
  await page.goto('/?conversationId=66&messageId=8801')

  const target = page.locator('[data-message-id="8801"]')
  await expect(target).toBeVisible()
  await expect(target).toHaveClass(/source-message-highlight/)
  await expect(target).toBeFocused()
  await expect(page.getByRole('status')).toContainText('已定位到这条记忆的原消息')
})

test('390px memory, conflict and chat explanation flows stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApis(page)
  await page.goto('/memory')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('option', { name: /视觉负向偏好/ }).click()
  await expect(page.getByRole('button', { name: '纠正这条记忆' })).toBeVisible()

  await page.goto('/memory')
  await page.getByRole('button', { name: /待我处理/ }).click()
  await page.getByRole('button', { name: /当前角色需要核对/ }).click()
  await page.getByRole('radio', { name: /使用新的表达/ }).click()
  await expect(page.getByRole('button', { name: '确认并更新记忆' })).toBeEnabled()

  await page.goto('/')
  await page.getByRole('button', { name: /使用了 1 条记忆/ }).click()
  const drawer = page.getByRole('dialog', { name: '本轮使用的记忆' })
  await expect(drawer).toBeVisible()
  await expect(drawer).toHaveAttribute('aria-modal', 'true')
  expect((await drawer.boundingBox())?.y || 0).toBeGreaterThan(200)
})

async function installAuthenticatedSession(page: Page) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await page.addInitScript(({ token }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify({ id: '42', username: 'V6.6 验收用户', role: 'USER' }))
  }, { token: `header.${payload}.signature` })
}

async function mockApis(
  page: Page,
  options: { unavailableSource?: boolean; onResolve?: (resolution: string) => void } = {}
) {
  const effectiveSource = options.unavailableSource
    ? { ...source, excerpt: '', availability: 'UNAVAILABLE', unavailableReason: '原消息已删除或当前用户无权访问', link: null }
    : source
  const effectiveRecord = { ...record, latestSource: effectiveSource, sources: [effectiveSource] }
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const url = new URL(route.request().url())
    const path = decodeURIComponent(url.pathname)
    if (path === '/api/users/me') return json(route, { id: '42', username: 'V6.6 验收用户', role: 'USER' })
    if (path === '/api/memory/records') return json(route, { items: [effectiveRecord], nextCursor: null })
    if (path === '/api/memory/records/profile:101') return json(route, effectiveRecord)
    if (path === '/api/memory/inbox') return json(route, { items: [{ inboxId: 'conflict:9', type: 'CONFLICT', title: '当前角色需要核对', description: '信息不一致', status: 'OPEN', createdAt: conflict.createdAt, conflict }], count: 1 })
    if (path === '/api/memory/governance-events') return json(route, { items: [], nextCursor: null })
    if (path === '/api/memory/conflicts/9:resolve') {
      const body = route.request().postDataJSON() as { resolution: string }
      options.onResolve?.(body.resolution)
      return json(route, { conflict: { ...conflict, status: 'RESOLVED' }, memory: effectiveRecord, resolution: body.resolution })
    }
    if (path.startsWith('/api/memory/records/profile:101:')) return json(route, { memory: effectiveRecord })
    if (path === '/api/conversations') return json(route, [{ id: '66', title: 'V6.6 来源回放', createdAt: '2026-08-10T06:00:00Z', updatedAt: '2026-08-10T06:32:00Z' }])
    if (path === '/api/chat/messages/66') return json(route, chatMessages())
    if (path === '/api/knowledge-bases') return json(route, [])
    if (path === '/api/briefings/today') return json(route, emptyBriefing())
    if (path === '/api/memory/current') return json(route, emptyMemory())
    if (new Set(['/api/agent-tools/todos', '/api/agent-tools/reminders', '/api/agent-tools/operations']).has(path)) return json(route, { items: [] })
    if (path === '/api/experience/events') return json(route, { accepted: true })
    return json(route, { message: `No V6.6 fixture for ${path}` }, 404)
  })
}

function chatMessages() {
  return [
    { id: '8800', conversationId: '66', turnId: 'turn-1', role: 'assistant', content: '之前的回答', metadata: {}, createdAt: '2026-08-10T06:20:00Z' },
    { id: '8801', conversationId: '66', turnId: 'turn-2', role: 'user', content: '生成图片时不要给人物戴帽子。', metadata: {}, createdAt: '2026-08-10T06:32:00Z' },
    { id: '8802', conversationId: '66', turnId: 'turn-2', role: 'assistant', content: '好的，我会保持人物不戴帽子。', metadata: { phase: 'COMPLETED', usedMemories: [{ memoryId: 'profile:101', title: '视觉负向偏好', valueSummary: '不喜欢人物戴帽子', reasonCode: 'QUESTION_RELEVANT', reliability: 'RELIABLE', sourceCount: 1 }] }, createdAt: '2026-08-10T06:32:05Z' }
  ]
}

function emptyMemory() {
  return { summary: '', short_term: [], structured: [], structured_all: [], profiles: [], fragments: [], semantic: [], vector: [], retrieved: [] }
}

function emptyBriefing() {
  return { id: null, projectId: null, briefingType: 'daily', title: '今日简报', content: '', todayFocus: [], projects: [], goals: [], dueTasks: [], overdueTasks: [], pendingOperations: [], createdAt: '2026-08-10T00:00:00Z' }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}
