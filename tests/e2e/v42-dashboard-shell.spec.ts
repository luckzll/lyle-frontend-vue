import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'

const NOW = '2026-07-11T08:00:00.000Z'
const PROJECT_ID = 42
const PROJECT_NAME = 'Lyle V4.2 升级'

const briefing = {
  id: 7,
  projectId: PROJECT_ID,
  briefingType: 'daily',
  title: '今日工作简报',
  content: '优先完成 V4.2 验收并处理发布风险。',
  todayFocus: ['完成 V4.2 发布前验收'],
  projects: [
    {
      id: PROJECT_ID,
      name: PROJECT_NAME,
      slug: 'lyle-v42',
      description: '个人 AI 工作台体验升级',
      status: 'active',
      currentStage: '发布验收',
      priority: 10,
      lastActivityAt: NOW,
      createdAt: '2026-07-01T08:00:00.000Z',
      updatedAt: NOW
    }
  ],
  goals: [],
  dueTasks: [
    {
      id: 11,
      title: '完成移动端验收',
      status: 'open',
      dueAt: '2026-07-11T10:00:00.000Z',
      conversationId: 'dashboard-fixture',
      createdAt: NOW,
      updatedAt: NOW
    }
  ],
  overdueTasks: [
    {
      id: 12,
      title: '修复导航回归',
      status: 'open',
      dueAt: '2026-07-10T10:00:00.000Z',
      conversationId: 'dashboard-fixture',
      createdAt: NOW,
      updatedAt: NOW
    }
  ],
  pendingOperations: [],
  createdAt: NOW
}

const confirmations = {
  items: [
    {
      pendingOperationId: 91,
      actionTitle: '发布 V4.2 到生产环境',
      toolName: 'release',
      operationType: 'deploy',
      riskLevel: 'high',
      status: 'pending',
      reason: '生产发布需要人工确认。',
      impactResources: ['frontend'],
      reversible: true,
      requiresSecondConfirmation: true,
      source: 'dashboard-fixture',
      createdAt: NOW,
      updatedAt: NOW
    }
  ]
}

const results = {
  items: [
    {
      id: 301,
      sourceType: 'automation',
      sourceId: 'v42-inspection',
      projectId: PROJECT_ID,
      status: 'completed',
      title: 'V4.2 设计系统巡检',
      conclusion: '设计 Token 与关键页面检查已完成。',
      completedItems: ['设计 Token', '应用壳层'],
      risks: [],
      recommendedActions: [],
      dataScope: ['frontend'],
      durationMs: 1250,
      createdAt: NOW
    }
  ]
}

const needsAttention = {
  items: [
    {
      id: 302,
      sourceType: 'automation',
      sourceId: 'v42-attention',
      projectId: PROJECT_ID,
      automationId: 17,
      status: 'failed',
      title: '发布巡检需要处理',
      conclusion: '上游连接暂时不可用。',
      completedItems: [],
      risks: ['连接超时'],
      recommendedActions: [],
      dataScope: ['frontend'],
      createdAt: NOW
    }
  ]
}

const connections = {
  items: [
    {
      id: 'github',
      type: 'github',
      name: 'GitHub',
      status: 'healthy',
      displayReason: '连接正常',
      nextAction: '无需处理',
      diagnosable: true,
      capabilities: ['repository'],
      lastCheckedAt: NOW
    }
  ]
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
  })
}

async function installAuthenticatedSession(page: Page) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString('base64url')
  const token = `header.${payload}.signature`

  await page.addInitScript(({ authToken }) => {
    localStorage.setItem('lyle-token', authToken)
    localStorage.setItem('lyle-user', JSON.stringify({
      id: 'v42-dashboard-user',
      username: 'V4.2 验收用户',
      role: 'USER'
    }))
  }, { authToken: token })
}

async function mockDashboardAndChatApis(page: Page) {
  await page.route('**/api/users/me', (route) => fulfillJson(route, {
    id: 'v42-dashboard-user',
    username: 'V4.2 验收用户',
    role: 'USER'
  }))
  await page.route('**/api/agent-tools/reminders**', (route) => fulfillJson(route, { items: [] }))
  await page.route('**/api/briefings/today**', (route) => fulfillJson(route, briefing))
  await page.route('**/api/experience/confirmations**', (route) => fulfillJson(route, confirmations))
  await page.route('**/api/experience/execution/needs-attention', (route) => fulfillJson(route, needsAttention))
  await page.route('**/api/experience/execution/results**', (route) => fulfillJson(route, results))
  await page.route('**/api/experience/connections/recommended**', (route) => fulfillJson(route, connections))
  await page.route('**/api/experience/events', (route) => fulfillJson(route, { accepted: true }))
  await page.route('**/api/missions/digest**', (route) => fulfillJson(route, { items: [], completedRuns: 0, attentionCount: 0 }))
  await page.route('**/api/exceptions**', (route) => fulfillJson(route, { items: [] }))

  // Chat initializes these reads before focusing the handed-off draft.
  await page.route('**/api/knowledge-bases', (route) => fulfillJson(route, []))
  await page.route('**/api/projects?**', (route) => fulfillJson(route, { items: briefing.projects }))
  await page.route('**/api/conversations', (route) => fulfillJson(route, []))
  await page.route('**/api/agent-tools/todos**', (route) => fulfillJson(route, { items: [] }))
  await page.route('**/api/agent-tools/operations**', (route) => fulfillJson(route, { items: [] }))
  await page.route('**/api/agent-tasks**', (route) => fulfillJson(route, { items: [] }))
  await page.route('**/api/memory/current**', (route) => fulfillJson(route, {
    summary: '',
    short_term: [],
    structured: [],
    structured_all: [],
    profiles: [],
    fragments: [],
    semantic: [],
    vector: [],
    retrieved: []
  }))
}

test.beforeEach(async ({ page }) => {
  await installAuthenticatedSession(page)
  await mockDashboardAndChatApis(page)
})

test('legacy knowledge address redirects and unknown routes show a useful 404 page', async ({ page }) => {
  await page.goto('/knowledge?source=legacy')
  await expect(page).toHaveURL('/knowledge-bases?source=legacy')
  await expect(page.getByRole('heading', { level: 1, name: '知识库' })).toBeVisible()

  await page.goto('/missing-v42-page')
  await expect(page.getByTestId('not-found-page')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: '这里暂时没有内容' })).toBeVisible()
  await expect(page.getByRole('link', { name: '前往工作台' })).toBeVisible()
})

test('account menu opens settings and signs out from the shared shell', async ({ page }) => {
  await page.goto('/dashboard')

  const sidebar = page.locator('.app-sidebar')
  const sidebarAccount = sidebar.getByRole('button', { name: /打开 V4\.2 验收用户 账号菜单/ })
  await sidebarAccount.click()
  const accountMenu = page.getByRole('menu', { name: '账号菜单' })
  await expect(accountMenu).toBeVisible()
  await expect(accountMenu.getByRole('menuitem', { name: '设置' })).toBeVisible()
  await expect(accountMenu.getByRole('menuitem', { name: '退出登录' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(accountMenu).toBeHidden()
  await expect(sidebarAccount).toBeFocused()

  await sidebarAccount.click()
  await accountMenu.getByRole('menuitem', { name: '设置' }).click()
  await expect(page).toHaveURL('/settings')
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()

  await page.goto('/dashboard')
  await sidebarAccount.click()
  await page.getByRole('menu', { name: '账号菜单' }).getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('lyle-token'))).toBeNull()
})

test('chat debug information stays behind the explicit developer entry', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('调试信息')).toHaveCount(0)

  await page.goto('/settings')
  await page.getByText('系统技术信息', { exact: true }).click()
  const debugEntry = page.getByRole('link', { name: '进入对话调试模式' })
  await expect(debugEntry).toHaveAttribute('href', '/?debug=1')
  await debugEntry.click()

  await expect(page).toHaveURL('/?debug=1')
  await expect(page.getByLabel('调试信息')).toBeChecked()
  await page.getByRole('button', { name: '退出调试' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByLabel('调试信息')).toHaveCount(0)
})

test('new chat keeps one empty state and a compact composer across breakpoints', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1150 })
  await page.goto('/')

  await expect(page.getByRole('region', { name: '今天想推进什么？' })).toBeVisible()
  await expect(page.getByRole('log', { name: '对话消息' })).toHaveCount(0)
  await expect(page.locator('.chat-list .message')).toHaveCount(0)
  await expect(page.getByText('你好，我是 Lyle。')).toHaveCount(0)
  await expect(page.getByText('新的会话已经准备好。')).toHaveCount(0)

  // The first-use attachment hint adds a dismissible row above the compact footer.
  await page.getByRole('button', { name: '关闭附件提示' }).click()
  const desktopComposerHeight = await page.locator('.chat-input').evaluate((element) => (
    element.getBoundingClientRect().height
  ))
  expect(desktopComposerHeight).toBeLessThanOrEqual(110)

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileLayout = await page.evaluate(() => {
    const list = document.querySelector('.chat-list')?.getBoundingClientRect()
    const starter = document.querySelector('.chat-starter')?.getBoundingClientRect()
    const composer = document.querySelector('.chat-input')?.getBoundingClientRect()
    return {
      listBottom: list?.bottom || 0,
      starterBottom: starter?.bottom || 0,
      composerTop: composer?.top || 0,
      composerHeight: composer?.height || 0,
      overflow: document.documentElement.scrollWidth > window.innerWidth
    }
  })
  expect(mobileLayout.composerHeight).toBeLessThanOrEqual(110)
  expect(mobileLayout.starterBottom).toBeLessThanOrEqual(mobileLayout.listBottom)
  expect(mobileLayout.composerTop).toBeGreaterThanOrEqual(mobileLayout.listBottom)
  expect(mobileLayout.overflow).toBe(false)
})

test('chat uses one contained message scrollbar and keeps the composer in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.addInitScript(() => {
    localStorage.setItem('lyle.chat.active-conversation', 'scroll-layout')
  })
  await page.route('**/api/conversations', (route) => fulfillJson(route, [
    { id: 'scroll-layout', title: '长对话滚动验收' }
  ]))
  await page.route('**/api/chat/messages/scroll-layout', (route) => fulfillJson(route, [
    {
      id: 'scroll-user',
      conversationId: 'scroll-layout',
      role: 'user',
      content: '请整理这份长内容',
      createdAt: NOW
    },
    {
      id: 'scroll-assistant',
      conversationId: 'scroll-layout',
      role: 'assistant',
      content: Array.from({ length: 80 }, (_, index) => `### 第 ${index + 1} 项\n\n这是用于验证聊天滚动区域的内容。`).join('\n\n'),
      createdAt: NOW
    }
  ]))

  await page.goto('/')
  await expect(page.getByRole('log', { name: '对话消息' })).toBeVisible()

  const layout = await page.evaluate(() => {
    const list = document.querySelector('.chat-list') as HTMLElement | null
    const composer = document.querySelector('.chat-input') as HTMLElement | null
    const listRect = list?.getBoundingClientRect()
    const composerRect = composer?.getBoundingClientRect()
    return {
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      listClientHeight: list?.clientHeight || 0,
      listScrollHeight: list?.scrollHeight || 0,
      listOverflowY: list ? getComputedStyle(list).overflowY : '',
      listScrollbarWidth: list ? getComputedStyle(list).scrollbarWidth : '',
      listBottom: listRect?.bottom || 0,
      composerTop: composerRect?.top || 0,
      composerBottom: composerRect?.bottom || 0,
      viewportHeight: window.innerHeight
    }
  })

  expect(layout.documentScrollHeight).toBeLessThanOrEqual(layout.documentClientHeight)
  expect(layout.listScrollHeight).toBeGreaterThan(layout.listClientHeight)
  expect(layout.listOverflowY).toBe('auto')
  expect(layout.listScrollbarWidth).toBe('none')
  expect(layout.composerTop).toBeGreaterThanOrEqual(layout.listBottom)
  expect(layout.composerBottom).toBeLessThanOrEqual(layout.viewportHeight)
})

test('V4.2 dashboard presents work and hands a project draft to chat once', async ({ page }) => {
  await page.goto('/dashboard')

  const focusSection = page.locator('section[aria-labelledby="today-focus-title"]')
  const attentionSection = page.locator('section[aria-labelledby="attention-title"]')
  const resultsSection = page.locator('section[aria-labelledby="recent-results-title"]')
  const projectsSection = page.locator('section[aria-labelledby="active-projects-title"]')

  await expect(focusSection.getByRole('heading', { name: '今日重点' })).toBeVisible()
  await expect(focusSection.getByText('修复导航回归')).toBeVisible()
  await expect(attentionSection.getByRole('heading', { name: '待我处理' })).toBeVisible()
  await expect(attentionSection.getByText('发布 V4.2 到生产环境')).toBeVisible()
  await expect(resultsSection.getByRole('heading', { name: '最近结果' })).toBeVisible()
  await expect(resultsSection.getByText('V4.2 设计系统巡检')).toBeVisible()
  await expect(projectsSection.getByRole('heading', { name: '活跃项目' })).toBeVisible()
  await expect(projectsSection.getByText(PROJECT_NAME)).toBeVisible()

  const executionNavigation = page.locator('.app-sidebar__link[href="/execution-center"]')
  await expect(executionNavigation.locator('.app-sidebar__badge')).toHaveText('2')
  await expect(executionNavigation.locator('.app-sidebar__badge')).toHaveAttribute('aria-label', '2 项需处理')
  await expect(page.locator('.app-sidebar__link[href="/tasks"] .app-sidebar__badge')).toHaveCount(0)

  const draft = '请把 Lyle V4.2 的发布风险整理成今天的执行清单'
  await page.getByLabel('关联项目').selectOption(String(PROJECT_ID))
  await page.getByLabel('今天想推进什么？').fill(draft)
  await page.getByRole('button', { name: '开始推进' }).click()

  await expect(page).toHaveURL('/')
  expect(new URL(page.url()).search).toBe('')
  expect(page.url()).not.toContain(encodeURIComponent(draft))
  await expect(page.getByTestId('chat-input')).toHaveValue(draft)
  await page.getByRole('button', { name: '上下文', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '当前上下文' })).toContainText(PROJECT_NAME)
  expect(await page.evaluate((text) => JSON.stringify(sessionStorage).includes(text), draft)).toBe(false)

  await page.getByRole('link', { name: '工作台', exact: true }).click()
  await page.locator('.workspace-heading').filter({ has: page.getByRole('button', { name: '新建聊天', exact: true }) }).hover()
  await page.getByRole('button', { name: '新建聊天', exact: true }).click()
  await expect(page.getByTestId('chat-input')).toHaveValue('')
})

test('chat context can be selected from the composer and survives navigation until explicitly cleared', async ({ page }) => {
  const knowledgeBase = {
    id: 'kb-v42',
    name: 'V4.2 产品资料',
    createdAt: NOW
  }
  await page.route('**/api/knowledge-bases', (route) => fulfillJson(route, [knowledgeBase]))

  await page.goto('/')
  const summary = page.getByTestId('chat-context-summary')
  await expect(summary).toHaveText('选择项目计划 / 知识库')
  await summary.click()

  const projectSelect = page.getByTestId('chat-project-select')
  const knowledgeSelect = page.getByTestId('chat-knowledge-select')
  await projectSelect.selectOption(String(PROJECT_ID))
  await knowledgeSelect.selectOption(knowledgeBase.id)
  await expect(summary).toHaveText(`${PROJECT_NAME} / ${knowledgeBase.name}`)
  expect(await page.evaluate(() => localStorage.getItem('lyle.chat.project-id'))).toBe(String(PROJECT_ID))
  expect(await page.evaluate(() => localStorage.getItem('lyle.chat.knowledge-base-id'))).toBe(knowledgeBase.id)

  await page.getByRole('link', { name: '工作台', exact: true }).click()
  await page.locator('.workspace-heading').filter({ has: page.getByRole('button', { name: '新建聊天', exact: true }) }).hover()
  await page.getByRole('button', { name: '新建聊天', exact: true }).click()
  await expect(summary).toHaveText(`${PROJECT_NAME} / ${knowledgeBase.name}`)

  await page.getByRole('button', { name: '新对话', exact: true }).click()
  await summary.click()
  await expect(projectSelect).toHaveValue(String(PROJECT_ID))
  await expect(knowledgeSelect).toHaveValue(knowledgeBase.id)

  await projectSelect.selectOption('')
  await knowledgeSelect.selectOption('')
  await expect(summary).toHaveText('选择项目计划 / 知识库')
  expect(await page.evaluate(() => localStorage.getItem('lyle.chat.project-id'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('lyle.chat.knowledge-base-id'))).toBeNull()
})

test('chat accepts a knowledge-base handoff and removes unavailable stored context', async ({ page }) => {
  const knowledgeBase = {
    id: 'kb-handoff',
    name: '交付资料',
    createdAt: NOW
  }
  await page.route('**/api/knowledge-bases', (route) => fulfillJson(route, [knowledgeBase]))

  await page.goto(`/?knowledgeBaseId=${knowledgeBase.id}`)
  const summary = page.getByTestId('chat-context-summary')
  await expect(summary).toHaveText(knowledgeBase.name)
  await summary.click()
  await expect(page.getByTestId('chat-knowledge-select')).toHaveValue(knowledgeBase.id)
  await expect(page).toHaveURL('/')
  expect(await page.evaluate(() => localStorage.getItem('lyle.chat.knowledge-base-id'))).toBe(knowledgeBase.id)

  await page.evaluate(() => {
    localStorage.setItem('lyle.chat.knowledge-base-id', 'missing-kb')
    localStorage.setItem('lyle.chat.project-id', '999')
  })
  await page.reload()
  await expect(summary).toHaveText('选择项目计划 / 知识库')
  await summary.click()
  await expect(page.getByTestId('chat-knowledge-select')).toHaveValue('')
  await expect(page.getByTestId('chat-project-select')).toHaveValue('')
  expect(await page.evaluate(() => localStorage.getItem('lyle.chat.knowledge-base-id'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('lyle.chat.project-id'))).toBeNull()
})

test('unscoped chat automation handoff does not inherit the automation page default project', async ({ page }) => {
  const originalIntent = '每天检查代码健康并生成简报'
  let draftPayload: Record<string, unknown> | null = null

  await page.route('**/api/conversations', (route) => {
    if (route.request().method() === 'POST') return fulfillJson(route, { id: 'handoff-conversation', title: originalIntent })
    return fulfillJson(route, [])
  })
  await page.route('**/api/chat/stream', (route) => {
    const suggestion = {
      id: 'workflow-draft',
      type: 'workflow',
      title: '保存为工作流',
      description: '创建草稿，不自动运行。',
      riskLevel: 'read_only',
      status: 'pending',
      action: 'create_workflow',
      payload: { workflow: { description: originalIntent } }
    }
    const body = [
      'event: delta',
      'data: {"text":"已准备安全预览。"}',
      '',
      'event: meta',
      `data: ${JSON.stringify({ executionSuggestions: [suggestion] })}`,
      '',
      'event: done',
      'data: {}',
      '',
      ''
    ].join('\n')
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body })
  })
  await page.route('**/api/experience/templates', (route) => fulfillJson(route, { items: [] }))
  await page.route('**/api/experience/onboarding', (route) => fulfillJson(route, {
    completedAt: NOW,
    selectedProjectId: PROJECT_ID,
    candidates: { projects: [{ id: PROJECT_ID, name: PROJECT_NAME }], workspaces: [] }
  }))
  await page.route('**/api/workbench/automations', (route) => fulfillJson(route, { items: [] }))
  await page.route('**/api/experience/drafts/from-intent', (route) => {
    draftPayload = route.request().postDataJSON() as Record<string, unknown>
    return fulfillJson(route, {
      kind: 'draft',
      draft: {
        id: 901,
        templateId: 'workspace_health_check',
        title: '代码健康巡检',
        userGoal: originalIntent,
        projectId: null,
        workspaceId: null,
        schedule: 'daily:09:00',
        timezone: 'Asia/Shanghai',
        allowedSources: ['项目数据'],
        riskSummary: { level: 'read_only', writes: false, message: '只读取已授权范围，不修改文件或外部系统。' },
        status: 'draft',
        expiresAt: '2026-07-12T00:00:00.000Z'
      }
    })
  })
  await page.route('**/api/experience/drafts/901/discard', (route) => fulfillJson(route, {}))

  await page.goto('/')
  await page.getByTestId('chat-input').fill(originalIntent)
  await page.getByTestId('chat-submit').click()
  const workflowCard = page.locator('.candidate-memory-card').filter({ hasText: '保存为工作流' })
  await workflowCard.getByRole('button', { name: '生成安全预览' }).click()

  await expect(page).toHaveURL('/automations')
  // An unscoped handoff must wait for an explicit project selection.
  await expect(page.getByRole('textbox', { name: '自动化意图' })).toHaveValue(originalIntent)
  await expect(page.getByRole('status')).toContainText('先创建一个项目或连接工作区')
  expect(draftPayload).toBeNull()
})

test('V4.2 shell mobile navigation restores focus and avoids horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: '今日重点' })).toBeVisible()

  const openNavigation = page.getByRole('button', { name: '打开主导航' })
  await openNavigation.click()
  await expect(page.getByRole('dialog', { name: 'Lyle AI' })).toBeVisible()
  const mobileNavigation = page.getByRole('dialog', { name: 'Lyle AI' })
  const mobileExecutionNavigation = page.locator('.mobile-navigation__link[href="/execution-center"]')
  await expect(mobileExecutionNavigation.locator('.mobile-navigation__badge')).toHaveText('2')
  await expect(mobileExecutionNavigation.locator('.mobile-navigation__badge')).toHaveAttribute('aria-label', '2 项需处理')

  const mobileAccount = mobileNavigation.getByRole('button', { name: /打开 V4\.2 验收用户 账号菜单/ })
  await mobileAccount.click()
  await expect(mobileNavigation.getByRole('menu', { name: '账号菜单' })).toBeVisible()
  await mobileNavigation.getByRole('button', { name: /关闭 V4\.2 验收用户 账号菜单/ }).click()
  await expect(mobileNavigation.getByRole('menu', { name: '账号菜单' })).toBeHidden()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Lyle AI' })).toBeHidden()
  await expect(openNavigation).toBeFocused()

  const hasHorizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > window.innerWidth
    || document.body.scrollWidth > window.innerWidth
  ))
  expect(hasHorizontalOverflow).toBe(false)
})

test('V4.2 mobile chat keeps context optional and restores focus after Escape', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('chat-input')).toBeVisible()
  await expect(page.getByRole('button', { name: '整理项目 归纳目标、进展、风险和下一步 开始' })).toBeVisible()

  const contextButton = page.getByRole('button', { name: '上下文', exact: true })
  await expect(page.getByRole('dialog', { name: '当前上下文' })).toHaveCount(0)
  await contextButton.click()
  const contextDialog = page.getByRole('dialog', { name: '当前上下文' })
  await expect(contextDialog).toBeVisible()
  await expect(page.getByTestId('context-panel-backdrop')).toBeVisible()

  await contextButton.focus()
  await expect(contextDialog.getByRole('button', { name: '关闭上下文栏' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(contextDialog).toHaveCount(0)
  await expect(contextButton).toBeFocused()

  await contextButton.click()
  const selectHeights = await contextDialog.locator('select').evaluateAll((items) => (
    items.map((item) => item.getBoundingClientRect().height)
  ))
  expect(selectHeights).toEqual([44, 44, 44])
  const backdrop = page.getByTestId('context-panel-backdrop')
  await backdrop.click({ position: { x: 2, y: 2 } })
  await expect(contextDialog).toHaveCount(0)
  await expect(contextButton).toBeFocused()
})

test('V4.2 dashboard has no critical or serious axe violations', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: '今日重点' })).toBeVisible()

  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const severeViolations = result.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious'
  )
  const violationSummary = severeViolations
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`)
    .join('\n')

  expect(severeViolations, violationSummary).toEqual([])
})
