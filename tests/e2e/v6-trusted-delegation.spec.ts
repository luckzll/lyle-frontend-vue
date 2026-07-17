import { expect, test, type Page, type Route } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await seedAuth(page)
  await page.route('**/api/users/me', (route) => json(route, {
    id: '7', username: 'V6 验收用户', role: 'USER', createdAt: '2026-07-16T00:00:00Z',
  }))
  await page.route('**/api/agent-tools/reminders**', (route) => json(route, { items: [] }))
  await page.route('**/api/experience/confirmations**', (route) => json(route, { items: [] }))
  await page.route('**/api/experience/execution/needs-attention**', (route) => json(route, { items: [] }))
})

test('draft, shadow, grant approval and compensation stay in the controlled V6 flow', async ({ page }) => {
  let mission = missionFixture('DRAFT', 0)
  let createBody: Record<string, unknown> | undefined
  let compensated = false

  await page.route('**/api/projects**', (route) => json(route, {
    items: [{ id: 9, name: 'Lyle V6', status: 'active', priority: 3, createdAt: '', updatedAt: '' }],
  }))
  await page.route('**/api/workbench/workspaces', (route) => json(route, {
    items: [{ id: 47, name: 'Lyle Workspace', rootPath: '/workspace/lyle', status: 'active' }],
  }))
  await page.route('**/api/agent-actions/301/compensation', (route) => json(route, compensationFixture(compensated ? 'SUCCEEDED' : 'AVAILABLE')))
  await page.route('**/api/agent-actions/301:compensate', (route) => {
    compensated = true
    return json(route, compensationFixture('SUCCEEDED'))
  })
  await page.route(/^https?:\/\/[^/]+\/api\/missions(?:[/:?]|$)/, async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const path = url.pathname
    if (path === '/api/missions' && method === 'POST') {
      createBody = route.request().postDataJSON()
      expect(route.request().headers()['idempotency-key']).toBeTruthy()
      return json(route, mission)
    }
    if (path === '/api/missions/10:shadow' && method === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: 0, grantVersion: 1 })
      mission = missionFixture('SHADOW', 1)
      return json(route, {
        mission,
        summary: { allow: 6, requireConfirmation: 1, deny: 2 },
        decisions: shadowDecisions(),
        notice: 'Shadow Mode 是策略预演；正式运行仍会逐动作重新检查。',
      })
    }
    if (path === '/api/missions/10:activate' && method === 'POST') {
      mission = missionFixture('AWAITING_APPROVAL', 2)
      return json(route, mission)
    }
    if (path === '/api/missions/10/grants/1:approve' && method === 'POST') {
      mission = missionFixture('ACTIVE', 3)
      return json(route, mission)
    }
    if (path === '/api/missions/10' && method === 'GET') return json(route, mission)
    if (path === '/api/missions' && method === 'GET') return json(route, { items: [mission] })
    return json(route, { message: `No V6 fixture for ${method} ${path}` }, 404)
  })

  await page.goto('/missions/new')
  await page.getByPlaceholder('例如：每个工作日上午检查项目测试、未完成任务和文档缺口；可以创建一个内部跟进任务，但不要修改代码或联系任何人。')
    .fill('每个工作日上午检查项目测试、任务和文档缺口并保留证据')
  await page.getByText('允许创建单个项目内部任务').click()
  await page.getByRole('button', { name: '生成草稿并预演' }).click()

  await expect(page).toHaveURL('/missions/10/shadow')
  expect(createBody).toMatchObject({
    goal: '每个工作日上午检查项目测试、任务和文档缺口并保留证据',
    projectId: 9,
    workspaceId: 47,
    autoMaintainTasks: true,
    validityDays: 30,
  })
  await expect(page.getByText('6').first()).toBeVisible()
  await expect(page.getByText('git.commit')).toBeVisible()
  await expect(page.getByText('SYSTEM_RISK_FORBIDDEN').first()).toBeVisible()

  await page.getByRole('button', { name: '确认预演结果，进入授权批准' }).click()
  await expect(page).toHaveURL('/missions/10/grant')
  await expect(page.getByText('明确允许')).toBeVisible()
  await expect(page.getByText('Git commit、push、merge、tag 与正式发布')).toBeVisible()
  await page.getByRole('button', { name: '批准此授权并启用持续任务' }).click()

  await expect(page).toHaveURL('/missions/10')
  await expect(page.getByRole('heading', { name: 'Lyle 项目工作日健康守护' })).toBeVisible()
  await expect(page.getByText('运行中')).toBeVisible()
  await expect(page.getByText('逐动作重检')).toBeVisible()
  await expect(page.getByText('可撤销')).toBeVisible()
  await expect(page.getByText('2 / 60次')).toBeVisible()
  await expect(page.getByText('2,029 / 4,500,000 ms')).toBeVisible()
  await page.getByRole('button', { name: '撤销该自动变更' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '执行受控撤销' }).click()
  await expect(page.getByRole('status')).toContainText('补偿已完成')
  await expect(page.getByText('SUCCEEDED')).toBeVisible()
})

test('exception inbox exposes safe status and routes controlled actions to the task UI', async ({ page }) => {
  let exception = exceptionFixture('OPEN')
  await page.route('**/api/missions/10', (route) => json(route, missionFixture('ACTIVE', 3)))
  await page.route('**/api/exceptions**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/exceptions' && route.request().method() === 'GET') {
      return json(route, { items: [exception] })
    }
    if (path === '/api/exceptions/88' && route.request().method() === 'GET') return json(route, exception)
    if (path === '/api/exceptions/88:acknowledge') {
      exception = exceptionFixture('ACKNOWLEDGED')
      return json(route, exception)
    }
    return json(route, { message: `No exception fixture for ${path}` }, 404)
  })

  await page.goto('/exceptions')
  await expect(page.getByRole('heading', { name: '异常收件箱' })).toBeVisible()
  await page.getByText('持续任务动作已被安全拦截').click()
  await expect(page).toHaveURL('/exceptions/88')
  await expect(page.getByRole('heading', { name: '影响与最后安全状态' })).toBeVisible()
  await expect(page.getByText('该动作已停止或转入等待状态')).toBeVisible()
  await page.getByRole('button', { name: '标记已知悉' }).click()
  await expect(page.getByRole('status')).toContainText('不会因此自动扩大授权')
  await expect(page.getByText('ACKNOWLEDGED')).toBeVisible()
})

function missionFixture(status: string, version: number) {
  const active = status === 'ACTIVE'
  return {
    id: '10',
    projectId: '9',
    title: 'Lyle 项目工作日健康守护',
    goal: '每个工作日上午检查项目测试、任务和文档缺口并保留证据',
    completionCriteria: ['项目状态与测试证据已检查', '异常与建议可追溯'],
    constraints: { workspaceId: 47, forbidden: ['不提交 Git'] },
    templateId: 'project-health',
    status,
    activeGrantVersion: active ? 1 : null,
    notificationPolicy: { normalResults: 'DIGEST', exceptions: 'IMMEDIATE' },
    quietHours: { start: '22:00', end: '08:00' },
    singleRunBudget: { maxToolCalls: 12, maxModelTokens: 80000, maxCostMicros: 2000000, maxWallTimeMillis: 900000 },
    periodBudget: { maxToolCalls: 60, maxModelTokens: 400000, maxCostMicros: 10000000, maxWallTimeMillis: 4500000 },
    periodUsage: {
      completedSteps: 2,
      toolCalls: 2,
      modelTokens: 0,
      costMicros: 0,
      wallTimeMillis: 2029,
      periodStart: '2026-07-13T00:00:00Z',
      periodEnd: '2026-07-20T00:00:00Z',
    },
    periodType: 'WEEKLY',
    validFrom: '2026-07-16T00:00:00Z',
    expiresAt: '2026-08-15T00:00:00Z',
    nextRunAt: active ? '2026-07-17T01:00:00Z' : null,
    version,
    createdAt: '2026-07-16T00:00:00Z',
    updatedAt: '2026-07-16T00:00:00Z',
    grants: [{
      id: '20',
      missionId: '10',
      version: 1,
      status: active ? 'ACTIVE' : status === 'AWAITING_APPROVAL' ? 'PENDING_APPROVAL' : 'DRAFT',
      summary: '仅在项目、工作区、工具、预算和有效期内执行 R0/R1 动作。',
      rules: [
        {
          id: 'read-project',
          effect: 'allow',
          toolRefs: ['project.inspect'],
          operations: ['read'],
          resourceScope: { projectIds: [9] },
          allowedFields: [],
          maxRisk: 'R0',
          requiresReversible: false,
          maxCallsPerRun: 20,
        },
        {
          id: 'create-project-task',
          effect: 'allow',
          toolRefs: ['todo.propose'],
          operations: ['create'],
          resourceScope: { projectIds: [9] },
          allowedFields: ['title', 'dueAt', 'items'],
          maxRisk: 'R1',
          requiresReversible: true,
          maxCallsPerRun: 3,
        },
      ],
      budgetPolicy: { maxToolCalls: 60 },
      validFrom: '2026-07-16T00:00:00Z',
      expiresAt: '2026-08-15T00:00:00Z',
      contentHash: 'hash',
      createdAt: '2026-07-16T00:00:00Z',
    }],
    triggers: [{
      id: '30',
      missionId: '10',
      type: 'FIXED_TIME',
      config: { frequency: 'WEEKDAYS', time: '09:00' },
      timezone: 'Asia/Shanghai',
      misfirePolicy: 'RUN_ONCE',
      enabled: true,
      nextFireAt: '2026-07-17T01:00:00Z',
      version: 0,
    }],
    occurrences: [],
    recentRuns: active ? [{
      agentTaskId: '100',
      status: 'COMPLETED',
      title: '项目健康守护 · 自动运行',
      createdAt: '2026-07-16T01:00:00Z',
      updatedAt: '2026-07-16T01:05:00Z',
      occurrenceId: '40',
      scheduledFor: '2026-07-16T01:00:00Z',
      occurrenceStatus: 'COMPLETED',
    }] : [],
    recentDecisions: active ? [{
      id: '200',
      agentTaskId: '100',
      stepRunId: '301',
      grantVersion: 1,
      toolRef: 'todo.propose',
      operation: 'create',
      resourceRefHash: 'redacted',
      riskLevel: 'R1',
      reversibility: 'AVAILABLE',
      decision: 'ALLOW',
      reasonCode: 'MATCHED_R1_RULE',
      matchedRuleId: 'create-project-task',
      createdAt: '2026-07-16T01:03:00Z',
    }] : [],
    latestRun: null,
    availableActions: {
      DRAFT: ['SHADOW', 'REVOKE'],
      SHADOW: ['SHADOW', 'SUBMIT_APPROVAL', 'REVOKE'],
      AWAITING_APPROVAL: ['APPROVE_GRANT', 'REVOKE'],
      ACTIVE: ['RUN_NOW', 'PAUSE', 'REVOKE', 'EDIT_GRANT'],
    }[status] || [],
    shadowOnly: false,
  }
}

function shadowDecisions() {
  return [
    { title: '读取绑定项目状态', toolRef: 'project.inspect', operation: 'read', riskLevel: 'R0', writeIntent: false, input: { projectId: 9 }, decision: 'ALLOW', reasonCode: 'MATCHED_R0_RULE', matchedRuleId: 'read-project', reversibility: 'NOT_SUPPORTED' },
    { title: '创建一个项目内部任务', toolRef: 'todo.propose', operation: 'create', riskLevel: 'R1', writeIntent: true, input: { projectId: 9, title: '跟进异常' }, decision: 'REQUIRE_CONFIRMATION', reasonCode: 'R1_FEATURE_DISABLED', matchedRuleId: 'create-project-task', reversibility: 'AVAILABLE' },
    { title: '提交 Git 变更', toolRef: 'git.commit', operation: 'commit', riskLevel: 'R2', writeIntent: true, input: {}, decision: 'DENY', reasonCode: 'SYSTEM_RISK_FORBIDDEN', matchedRuleId: null, reversibility: 'NOT_SUPPORTED' },
    { title: '永久删除资源', toolRef: 'resource.delete', operation: 'delete', riskLevel: 'R3', writeIntent: true, input: {}, decision: 'DENY', reasonCode: 'SYSTEM_RISK_FORBIDDEN', matchedRuleId: null, reversibility: 'NOT_SUPPORTED' },
  ]
}

function compensationFixture(status: string) {
  return {
    id: '500',
    missionId: '10',
    agentTaskId: '100',
    stepRunId: '301',
    toolRef: 'todo.propose',
    operation: 'archive_created_todo',
    status,
    expiresAt: '2026-07-23T01:03:00Z',
    completedAt: status === 'SUCCEEDED' ? '2026-07-16T02:00:00Z' : null,
  }
}

function exceptionFixture(status: string) {
  return {
    id: '88',
    missionId: '10',
    agentTaskId: '100',
    type: 'AUTHORIZATION',
    severity: 'HIGH',
    title: '持续任务动作已被安全拦截',
    summary: '动作 git.commit 未满足当前委托边界：SYSTEM_RISK_FORBIDDEN。',
    evidenceRefs: ['authorization-decision://200'],
    availableActions: ['VIEW_EVIDENCE', 'ADJUST_GRANT', 'END_RUN'],
    status,
    createdAt: '2026-07-16T01:04:00Z',
    resolvedAt: null,
  }
}

async function seedAuth(page: Page) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const token = `header.${payload}.signature`
  await page.addInitScript(({ value }) => {
    localStorage.setItem('lyle-token', value)
    localStorage.setItem('lyle-user', JSON.stringify({ id: '7', username: 'V6 验收用户', role: 'USER' }))
  }, { value: token })
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
