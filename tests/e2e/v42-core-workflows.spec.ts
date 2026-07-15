import { expect, test, type Page, type Route } from '@playwright/test'

const NOW = '2026-07-11T08:00:00.000Z'

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  })
}

async function seedAuth(page: Page, userId: string) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString('base64url')
  const token = `header.${payload}.signature`

  await page.addInitScript(({ authToken, id }) => {
    localStorage.setItem('lyle-token', authToken)
    localStorage.setItem('lyle-user', JSON.stringify({ id, username: 'V4.2 核心流程用户', role: 'USER' }))
  }, { authToken: token, id: userId })
}

function emptyMemory() {
  return {
    summary: '',
    short_term: [],
    structured: [],
    structured_all: [],
    profiles: [],
    fragments: [],
    semantic: [],
    vector: [],
    retrieved: []
  }
}

test('completes the first inspection and enables an automation created from natural language', async ({ page }) => {
  await seedAuth(page, 'v42-first-success')

  let onboardingCompleted = false
  let enabled = false
  let firstRunPayload: Record<string, unknown> | null = null
  let intentPayload: Record<string, unknown> | null = null
  let enableCalls = 0

  const draft = {
    id: 701,
    templateId: 'project_weekly_report',
    title: '每周发布风险周报',
    userGoal: '每周五汇总项目发布风险并生成周报',
    projectId: 42,
    workspaceId: 8,
    schedule: 'weekly:fri:17:00',
    timezone: 'Asia/Shanghai',
    allowedSources: ['项目数据', '已授权工作区'],
    riskSummary: {
      level: 'read_only',
      writes: false,
      message: '只读取已授权范围，不修改文件或外部系统。'
    },
    status: 'draft',
    expiresAt: '2026-07-12T08:00:00.000Z'
  }

  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname

    if (pathname === '/api/agent-tools/reminders') return json(route, { items: [] })
    if (pathname === '/api/experience/confirmations') return json(route, { items: [] })
    if (pathname === '/api/experience/execution/needs-attention') return json(route, { items: [] })
    if (pathname === '/api/experience/events') return json(route, { accepted: true })
    if (pathname === '/api/experience/templates') return json(route, { items: [] })
    if (pathname === '/api/experience/onboarding' && request.method() === 'GET') {
      return json(route, {
        completedAt: onboardingCompleted ? NOW : null,
        selectedProjectId: 42,
        selectedWorkspaceId: 8,
        candidates: {
          projects: [{ id: 42, name: 'Lyle V4.2' }],
          workspaces: [{ id: 8, name: 'frontend-vue' }]
        }
      })
    }
    if (pathname === '/api/experience/onboarding/first-run') {
      firstRunPayload = request.postDataJSON() as Record<string, unknown>
      onboardingCompleted = true
      return json(route, { resultId: 601, status: 'completed' })
    }
    if (pathname === '/api/experience/drafts/from-intent') {
      intentPayload = request.postDataJSON() as Record<string, unknown>
      return json(route, { kind: 'draft', draft })
    }
    if (pathname === '/api/experience/drafts/701/enable') {
      enableCalls += 1
      enabled = true
      return json(route, { draft: { ...draft, status: 'enabled', automationId: 17 } })
    }
    if (pathname === '/api/workbench/automations') {
      return json(route, {
        items: enabled
          ? [{
              id: 17,
              projectId: 42,
              projectName: 'Lyle V4.2',
              name: draft.title,
              status: 'enabled',
              triggerType: 'schedule',
              scheduleExpr: draft.schedule,
              timezone: draft.timezone,
              consecutiveFailures: 0,
              input: { projectId: 42 },
              notifyOnFailure: true
            }]
          : []
      })
    }

    return json(route, { message: `No fixture for ${request.method()} ${pathname}` }, 404)
  })

  await page.goto('/automations')
  await expect(page.getByRole('heading', { name: '先完成一次项目巡检' })).toBeVisible()
  await page.getByRole('button', { name: '运行一次项目巡检' }).click()
  await expect(page.getByRole('status')).toContainText('首次项目巡检已完成')
  expect(firstRunPayload).toEqual({ projectId: 42, workspaceId: 8 })

  await page.getByLabel('自动化意图').fill('每周五汇总项目发布风险并生成周报')
  await page.getByRole('button', { name: '生成预览' }).click()
  const preview = page.getByRole('dialog', { name: draft.title })
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('此预览不会执行任何操作')
  expect(intentPayload).toEqual({
    text: '每周五汇总项目发布风险并生成周报',
    projectId: 42,
    workspaceId: 8
  })

  await preview.getByRole('button', { name: '确认启用' }).click()
  await expect(page.getByRole('status')).toContainText('“每周发布风险周报”已启用')
  await expect(page.getByRole('article').filter({ hasText: draft.title })).toContainText('运行中')
  expect(enableCalls).toBe(1)
})

test('confirms a chat candidate task with the edited title and deadline', async ({ page }) => {
  await seedAuth(page, 'v42-chat-task')

  let createdTaskPayload: Record<string, unknown> | null = null
  let conversationCreated = false

  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname

    if (pathname === '/api/agent-tools/reminders') return json(route, { items: [] })
    if (pathname === '/api/experience/confirmations') return json(route, { items: [] })
    if (pathname === '/api/experience/execution/needs-attention') return json(route, { items: [] })
    if (pathname === '/api/experience/events') return json(route, { accepted: true })
    if (pathname === '/api/knowledge-bases') return json(route, [])
    if (pathname === '/api/conversations' && request.method() === 'GET') {
      return json(route, conversationCreated ? [{ id: 'chat-task-1', title: '整理发布事项' }] : [])
    }
    if (pathname === '/api/conversations' && request.method() === 'POST') {
      conversationCreated = true
      return json(route, { id: 'chat-task-1', title: '整理发布事项' })
    }
    if (pathname === '/api/agent-tools/todos' && request.method() === 'GET') return json(route, { items: [] })
    if (pathname === '/api/agent-tools/todos' && request.method() === 'POST') {
      createdTaskPayload = request.postDataJSON() as Record<string, unknown>
      return json(route, {
        id: 81,
        ...createdTaskPayload,
        status: 'open',
        createdAt: NOW,
        updatedAt: NOW
      })
    }
    if (pathname === '/api/agent-tools/operations') return json(route, { items: [] })
    if (pathname === '/api/memory/current') return json(route, emptyMemory())
    if (pathname === '/api/chat/stream') {
      const body = [
        'event: delta',
        'data: {"text":"我整理出一项待确认任务。"}',
        '',
        'event: meta',
        `data: ${JSON.stringify({
          candidateTasks: [{
            type: 'todo',
            title: '完成 V4.2 发布检查',
            dueAt: '2026-07-12T09:30:00.000Z',
            source: '本轮对话',
            confidence: 0.94,
            status: 'pending'
          }]
        })}`,
        '',
        'event: done',
        'data: {}',
        '',
        ''
      ].join('\n')
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body })
    }

    return json(route, { message: `No fixture for ${request.method()} ${pathname}` }, 404)
  })

  await page.goto('/')
  await page.getByTestId('chat-input').fill('帮我整理发布事项并创建任务')
  await page.getByTestId('chat-submit').click()

  const taskCard = page.getByTestId('chat-candidate-task')
  await expect(taskCard).toBeVisible()
  await expect(taskCard.getByLabel('标题')).toHaveValue('完成 V4.2 发布检查')
  await taskCard.getByLabel('标题').fill('完成 V4.2 发布验收')
  await taskCard.getByRole('button', { name: '确认', exact: true }).click()

  await expect(taskCard).toHaveCount(0)
  expect(createdTaskPayload).toMatchObject({
    title: '完成 V4.2 发布验收',
    conversationId: 'chat-task-1'
  })
  expect(createdTaskPayload?.dueAt).toBe('2026-07-12T09:30:00.000Z')
})

test('keeps connection diagnostics independent while another card is still running', async ({ page }) => {
  await seedAuth(page, 'v42-connections')

  let githubCalls = 0
  let calendarCalls = 0

  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname

    if (pathname === '/api/agent-tools/reminders') return json(route, { items: [] })
    if (pathname === '/api/experience/confirmations') return json(route, { items: [] })
    if (pathname === '/api/experience/execution/needs-attention') return json(route, { items: [] })
    if (pathname === '/api/experience/connections/recommended') {
      return json(route, { items: [
        {
          id: 'github-main',
          type: 'github',
          name: 'GitHub 主连接',
          status: 'unavailable',
          displayReason: '等待诊断。',
          nextAction: '运行连接诊断',
          diagnosable: true,
          capabilities: ['读取仓库']
        },
        {
          id: 'calendar-main',
          type: 'calendar',
          name: '日历连接',
          status: 'unavailable',
          displayReason: '等待诊断。',
          nextAction: '运行连接诊断',
          diagnosable: true,
          capabilities: ['读取日程']
        }
      ] })
    }
    if (pathname === '/api/experience/connections/github-main/diagnose') {
      githubCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 250))
      return json(route, { message: 'GitHub 授权已失效' }, 503)
    }
    if (pathname === '/api/experience/connections/calendar-main/diagnose') {
      calendarCalls += 1
      return json(route, {
        id: 'calendar-main',
        type: 'calendar',
        name: '日历连接',
        status: 'healthy',
        displayReason: '连接正常。',
        nextAction: '无需处理',
        diagnosable: true,
        capabilities: ['读取日程'],
        lastCheckedAt: NOW
      })
    }

    return json(route, { message: `No fixture for ${request.method()} ${pathname}` }, 404)
  })

  await page.goto('/connections')
  const githubCard = page.getByRole('article').filter({ hasText: 'GitHub 主连接' })
  const calendarCard = page.getByRole('article').filter({ hasText: '日历连接' })

  await githubCard.getByRole('button', { name: '运行连接诊断' }).click()
  await expect(githubCard.getByRole('button', { name: '诊断中…' })).toBeDisabled()
  await expect(calendarCard.getByRole('button', { name: '运行连接诊断' })).toBeEnabled()

  await calendarCard.getByRole('button', { name: '运行连接诊断' }).click()
  await expect(calendarCard).toContainText('连接正常')
  await expect(githubCard.getByRole('alert')).toHaveText('GitHub 授权已失效')
  expect(githubCalls).toBe(1)
  expect(calendarCalls).toBe(1)
})
