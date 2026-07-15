import { expect, type Page, type Route, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await seedAuth(page)
  await page.route('**/api/users/me', (route) => json(route, {
    id: '7', username: 'V5 验收用户', role: 'USER', createdAt: '2026-07-14T00:00:00Z',
  }))
  await page.route('**/api/agent-tools/reminders**', (route) => json(route, { items: [] }))
  await page.route('**/api/experience/confirmations**', (route) => json(route, { items: [] }))
  await page.route('**/api/experience/execution/needs-attention**', (route) => json(route, { items: [] }))
})

test('failed plan save blocks approval of the stale plan', async ({ page }) => {
  let approveCalls = 0
  const task = planTask()
  await page.route('**/api/agent-tasks/1', (route) => json(route, task))
  await page.route('**/api/agent-tasks/1/plans/1', (route) => {
    if (route.request().method() === 'PUT') return json(route, { message: '保存失败' }, 500)
    return route.fallback()
  })
  await page.route('**/api/agent-tasks/1/plans/1:approve', (route) => {
    approveCalls += 1
    return json(route, task)
  })

  await page.goto('/agent-tasks/1/plan')
  await expect(page.getByText('执行前审查 · 计划 v1')).toBeVisible()
  await expect(page.locator('ol li')).toHaveCount(5)
  await page.getByLabel('步骤名称').first().fill('已修改但保存失败的步骤')
  await page.getByRole('button', { name: '批准并开始执行' }).click()

  await expect(page.getByRole('alert')).toContainText('保存失败')
  expect(approveCalls).toBe(0)
})

test('awaiting-input choice persists the body and routes a revised plan back to approval', async ({ page }) => {
  let task = awaitingInputTask()
  let submitted: Record<string, unknown> | undefined
  await page.route('**/api/agent-tasks/1/events**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: 'event: heartbeat\ndata: {}\n\n',
  }))
  await page.route('**/api/agent-tasks/1:provide-input', async (route) => {
    submitted = route.request().postDataJSON()
    task = { ...planTask(), version: 10, activePlanVersion: 2, plan: { ...planTask().plan, version: 2 } }
    return json(route, task)
  })
  await page.route('**/api/agent-tasks/1', (route) => json(route, task))

  await page.goto('/agent-tasks/1')
  await expect(page.getByText('需要你选择后续路径')).toBeVisible()
  await page.getByLabel('后续动作').selectOption('REVISE_PLAN')
  await page.getByPlaceholder('说明修复结果、要跳过的内容或新的执行要求。').fill('跳过失效连接，改用本地工作区检查并重新审批。')
  await page.getByRole('button', { name: '提交选择' }).click()

  await expect(page).toHaveURL('/agent-tasks/1/plan')
  expect(submitted).toMatchObject({
    expectedVersion: 9,
    action: 'REVISE_PLAN',
    input: '跳过失效连接，改用本地工作区检查并重新审批。',
  })
  await expect(page.getByText('执行前审查 · 计划 v2')).toBeVisible()
})

test('inspection created from UI carries the selected workspace into constraints', async ({ page }) => {
  let submitted: Record<string, unknown> | undefined
  await page.route('**/api/workbench/workspaces', (route) => json(route, {
    items: [{ id: 47, name: 'Lyle Backend', rootPath: '/workspace/backend', status: 'active' }],
  }))
  await page.route('**/api/projects**', (route) => json(route, {
    items: [{ id: 23, name: 'Lyle V5', status: 'active', priority: 3, createdAt: '', updatedAt: '' }],
  }))
  await page.route('**/api/agent-tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    submitted = route.request().postDataJSON()
    return json(route, { ...planTask(), status: 'DRAFT', version: 0, plan: undefined })
  })
  await page.route('**/api/agent-tasks/1/plan:generate', (route) => json(route, planTask()))
  await page.route('**/api/agent-tasks/1', (route) => json(route, planTask()))

  await page.goto('/agent-tasks/new')
  await page.getByPlaceholder('例如：检查 Lyle V5 是否可以发布，汇总测试失败和文档缺口；不要修改代码。').fill('检查项目并形成逐项证据报告')
  await page.getByRole('button', { name: '生成计划' }).click()

  await expect(page).toHaveURL('/agent-tasks/1/plan')
  expect(submitted).toMatchObject({
    templateId: 'project-inspection',
    projectId: 23,
    constraints: { workspaceId: 47, forbidden: [] },
  })
})

test('level 2 file target is persisted into the controlled patch constraints', async ({ page }) => {
  let submitted: Record<string, any> | undefined
  await page.route('**/api/workbench/workspaces', (route) => json(route, {
    items: [{ id: 47, name: 'Lyle Frontend', rootPath: '/workspace/frontend', status: 'active' }],
  }))
  await page.route('**/api/projects**', (route) => json(route, {
    items: [{ id: 23, name: 'Lyle V5', status: 'active', priority: 3, createdAt: '', updatedAt: '' }],
  }))
  await page.route('**/api/agent-tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    submitted = route.request().postDataJSON()
    return json(route, { ...planTask(), status: 'DRAFT', version: 0, plan: undefined })
  })
  await page.route('**/api/agent-tasks/1/plan:generate', (route) => json(route, planTask()))
  await page.route('**/api/agent-tasks/1', (route) => json(route, planTask()))

  await page.goto('/agent-tasks/new')
  await page.getByPlaceholder('例如：检查 Lyle V5 是否可以发布，汇总测试失败和文档缺口；不要修改代码。').fill('检查项目后补充文档并修改文件')
  await page.getByLabel('自主级别').selectOption('2')
  await page.getByLabel('工作区相对路径').fill('docs/v5-status.md')
  await page.getByLabel('确认后写入的完整内容').fill('# V5 status\n')
  await page.getByRole('button', { name: '生成计划' }).click()

  await expect(page).toHaveURL('/agent-tasks/1/plan')
  expect(submitted?.constraints).toMatchObject({
    workspaceId: 47,
    writeTarget: {
      workspaceId: 47,
      relativePath: 'docs/v5-status.md',
      newContent: '# V5 status\n',
    },
  })
})

test('save-only persists dirty plan before leaving approval', async ({ page }) => {
  let updateCalls = 0
  const task = planTask()
  await page.route('**/api/agent-tasks/1', (route) => json(route, task))
  await page.route('**/api/agent-tasks/1/plans/1', async (route) => {
    updateCalls += 1
    const body = route.request().postDataJSON() as Record<string, any>
    return json(route, {
      ...task,
      version: 4,
      activePlanVersion: 2,
      plan: { ...task.plan, version: 2, steps: body.steps },
    })
  })

  await page.goto('/agent-tasks/1/plan')
  await page.getByLabel('步骤名称').first().fill('已保存的项目读取步骤')
  await page.getByRole('button', { name: '仅保存计划' }).click()

  await expect(page).toHaveURL('/agent-tasks/1')
  expect(updateCalls).toBe(1)
})

test('plan generation can be cancelled and cancels the draft task', async ({ page }) => {
  let cancelCalls = 0
  await page.route('**/api/workbench/workspaces', (route) => json(route, {
    items: [{ id: 47, name: 'Lyle Backend', rootPath: '/workspace/backend', status: 'active' }],
  }))
  await page.route('**/api/projects**', (route) => json(route, {
    items: [{ id: 23, name: 'Lyle V5', status: 'active', priority: 3, createdAt: '', updatedAt: '' }],
  }))
  await page.route('**/api/agent-tasks', (route) => json(route, {
    ...planTask(), status: 'DRAFT', version: 0, plan: undefined,
  }))
  await page.route('**/api/agent-tasks?**', (route) => json(route, { items: [] }))
  await page.route('**/api/agent-tasks/1/plan:generate', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    return json(route, planTask())
  })
  await page.route('**/api/agent-tasks/1', (route) => json(route, {
    ...planTask(), status: 'PLANNING', version: 1, plan: undefined,
  }))
  await page.route('**/api/agent-tasks/1:cancel', (route) => {
    cancelCalls += 1
    return json(route, { ...planTask(), status: 'CANCELLED', version: 2, plan: undefined })
  })

  await page.goto('/agent-tasks/new')
  await page.getByPlaceholder('例如：检查 Lyle V5 是否可以发布，汇总测试失败和文档缺口；不要修改代码。').fill('检查项目并形成逐项证据报告')
  await page.getByRole('button', { name: '生成计划' }).click()
  await page.getByRole('button', { name: '取消生成' }).click()

  await expect(page).toHaveURL('/agent-tasks')
  expect(cancelCalls).toBe(1)
})

function planTask() {
  const budget = {
    maxSteps: 10,
    maxToolCalls: 20,
    maxModelTokens: 80000,
    maxCostMicros: 2000000,
    maxWallTimeMillis: 900000,
    maxRetriesPerStep: 2,
    maxConsecutiveNoProgress: 2,
  }
  const tools = ['project.inspect', 'workspace.git_status', 'workspace.docs_check', 'release.check', 'analysis.synthesize']
  const steps = tools.map((toolRef, index) => ({
    id: String(index + 1),
    stepKey: `step-${index + 1}`,
    position: index + 1,
    stepType: index === 4 ? 'ANALYZE' : 'TOOL',
    title: ['读取项目现状', '检查 Git 状态', '检查发布文档', '运行授权测试', '形成 Go/No-Go 建议'][index],
    purpose: '保留逐项证据。',
    toolRef,
    inputTemplate: {},
    dependencies: index ? [`step-${index}`] : [],
    riskLevel: 'READ',
    expectedArtifact: { type: 'EVIDENCE' },
    writeIntent: false,
  }))
  return {
    id: '1',
    title: 'V5 发布巡检',
    goal: '完成项目、Git、文档与测试检查并给出 Go/No-Go。',
    completionCriteria: ['项目状态已读取', 'Git 状态清晰', '文档完整', '所有测试通过', '给出 Go/No-Go'],
    constraints: { workspaceId: 9 },
    projectId: '2',
    conversationId: null,
    templateId: 'release-check',
    status: 'AWAITING_PLAN_APPROVAL',
    riskLevel: 'READ',
    autonomyLevel: 1,
    activePlanVersion: 1,
    currentRunId: null,
    version: 3,
    createdAt: '2026-07-14T00:00:00Z',
    updatedAt: '2026-07-14T00:00:00Z',
    plan: {
      id: '10', version: 1, source: 'MODEL', goal: '发布巡检', completionCriteria: [], constraints: {},
      accessScope: { workspaceIds: [9], network: 'NONE', allowedTools: tools }, budget,
      changeSummary: {}, approvalStatus: 'PENDING', steps,
    },
    artifacts: [],
    availableActions: ['EDIT_PLAN', 'APPROVE_PLAN', 'CANCEL'],
  }
}

function awaitingInputTask() {
  return {
    ...planTask(),
    status: 'AWAITING_INPUT',
    version: 9,
    currentRunId: '20',
    run: {
      id: '20', planVersion: 1, status: 'AWAITING_INPUT',
      budgetLimit: planTask().plan.budget,
      budgetUsed: { completedSteps: 2, toolCalls: 3, modelTokens: 0, costMicros: 0, elapsedMillis: 1000, retries: 1 },
      noProgressCount: 0, startedAt: '2026-07-14T00:00:00Z', updatedAt: '2026-07-14T00:01:00Z',
    },
    stepRuns: [],
    availableActions: ['PROVIDE_INPUT', 'RESUME', 'CANCEL'],
  }
}

async function seedAuth(page: Page) {
  const payload = Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString('base64url')
  await page.addInitScript(({ token }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify({ id: '7', username: 'V5 验收用户', role: 'USER' }))
  }, { token: `header.${payload}.signature` })
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}
