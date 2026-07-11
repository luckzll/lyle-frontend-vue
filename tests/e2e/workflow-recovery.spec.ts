import { expect, type Page, test } from '@playwright/test'

test('recovers, retries, cancels, and second-confirms V4 workflow runs', async ({ page }) => {
  test.setTimeout(120000)
  const suffix = Date.now()
  const username = `workflow_recovery_${suffix}`

  await page.goto('/login')
  await page.getByTestId('register-tab').click()
  await page.getByTestId('username-input').fill(username)
  await page.getByTestId('password-input').fill('123456')
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL('/')

  const setup = await page.evaluate(async (suffix) => {
    const workspace = await workbenchRequest('/api/workbench/workspaces', {
      name: `E2E Workspace ${suffix}`,
      rootPath: '/Users/luckzll/Desktop/Lyle/ai-app/frontend-vue',
      status: 'active'
    })
    const resumable = await workbenchRequest('/api/workbench/workflows', {
      name: `E2E Resume ${suffix}`,
      steps: [
        { title: 'Dry-run Git Add', stepType: 'cli', commandTemplate: 'git add -n .', sortOrder: 0 },
        { title: '汇总', stepType: 'summarize', sortOrder: 1 }
      ]
    })
    const resumableRun = await workbenchRequest(`/api/workbench/workflows/${resumable.id}/runs`, {
      workspaceId: workspace.id
    })
    return { workspaceId: workspace.id, resumableId: resumable.id, resumableRunId: resumableRun.id }

    async function workbenchRequest(url: string, body: Record<string, unknown>) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${window.localStorage.getItem('lyle-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    }
  }, suffix)

  await page.getByRole('link', { name: '工具', exact: true }).click()
  await page.getByTestId('workbench-tab-runs').click()
  await page.setViewportSize({ width: 1170, height: 1000 })
  const runLayout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    summaryWidths: Array.from(document.querySelectorAll('.run-summary')).map((item) =>
      Math.round(item.getBoundingClientRect().width)
    )
  }))
  expect(runLayout.overflow).toBeLessThanOrEqual(1)
  expect(Math.min(...runLayout.summaryWidths)).toBeGreaterThan(120)
  const resumableCard = page.locator('.workflow-run-card').filter({ hasText: `#${setup.resumableRunId} / workflow ${setup.resumableId}` })
  await expect(resumableCard).toContainText('paused')
  await expect(resumableCard).toContainText('awaiting_confirmation')
  const unconfirmedStatus = await page.evaluate(async (runId) => {
    const response = await fetch(`/api/workbench/workflow-runs/${runId}/resume`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${window.localStorage.getItem('lyle-token')}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    })
    return response.status
  }, setup.resumableRunId)
  expect(unconfirmedStatus).toBe(400)
  await expect(resumableCard).toContainText('paused')
  await resumableCard.getByRole('button', { name: '确认继续', exact: true }).click()
  await expect(resumableCard).toContainText('completed')
  await expect(resumableCard).toContainText('Dry-run Git Add:completed')

  const failed = await createFailedRun(page, suffix, setup.workspaceId)
  await page.reload()
  const failedCard = page.locator('.workflow-run-card').filter({ hasText: `#${failed.runId} / workflow ${failed.workflowId}` })
  await expect(failedCard).toContainText('failed')
  await failedCard.getByRole('button', { name: '重试', exact: true }).click()
  await expect(failedCard).toContainText('paused')
  await expect(failedCard.getByRole('button', { name: '取消', exact: true })).toBeVisible()
  await failedCard.getByRole('button', { name: '取消', exact: true }).click()
  await expect(failedCard).toContainText('cancelled')
  await expect(failedCard).toContainText('不应运行:cancelled')

  const highRisk = await createHighRiskRun(page, suffix, setup.workspaceId)
  await page.reload()
  const highRiskCard = page.locator('.workflow-run-card').filter({ hasText: `#${highRisk.runId} / workflow ${highRisk.workflowId}` })
  await expect(highRiskCard).toContainText('paused')
  await highRiskCard.getByRole('button', { name: '确认继续', exact: true }).click()
  await expect(highRiskCard.getByRole('button', { name: '二次确认继续', exact: true })).toBeVisible()
  await highRiskCard.getByRole('button', { name: '取消', exact: true }).click()
  await expect(highRiskCard).toContainText('cancelled')

  const policyResult = await page.evaluate(async (workspaceId) => {
    await request(`/api/workbench/workspaces/${workspaceId}/policies`, {
      commandPattern: 'git status*',
      policy: 'allow',
      riskLevel: 'read_only'
    })
    return request(`/api/workbench/workspaces/${workspaceId}/commands/run`, { command: 'rg TODO' })

    async function request(url: string, body: Record<string, unknown>) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${window.localStorage.getItem('lyle-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    }
  }, setup.workspaceId)
  expect(policyResult.blocked).toBe(true)
  expect(policyResult.commandPolicy.reason).toContain('白名单')

  const conditionalRuns = await page.evaluate(async (workspaceId) => {
    const workflow = await request('/api/workbench/workflows', {
      name: `E2E Conditional ${Date.now()}`,
      steps: [
        {
          title: 'Inspect',
          stepType: 'cli',
          commandTemplate: 'git status --short',
          outputKey: 'inspect',
          sortOrder: 0
        },
        {
          title: 'Conditional summary',
          stepType: 'summarize',
          outputKey: 'summary',
          inputTemplate: { previous: '{{steps.inspect.summary}}' },
          condition: { path: 'input.includeSummary', operator: 'truthy' },
          sortOrder: 1
        }
      ]
    })
    const skipped = await request(`/api/workbench/workflows/${workflow.id}/runs`, {
      workspaceId,
      input: { includeSummary: false }
    })
    const completed = await request(`/api/workbench/workflows/${workflow.id}/runs`, {
      workspaceId,
      input: { includeSummary: true }
    })
    return { skipped, completed }

    async function request(url: string, body: Record<string, unknown>) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${window.localStorage.getItem('lyle-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    }
  }, setup.workspaceId)
  expect(conditionalRuns.skipped.status).toBe('completed')
  expect(conditionalRuns.skipped.steps[1].status).toBe('skipped')
  expect(conditionalRuns.completed.steps[1].status).toBe('completed')
  expect(conditionalRuns.completed.steps[1].input.previous).toBe(
    conditionalRuns.completed.steps[0].output.summary
  )

  const automationFailure = await page.evaluate(async ({ workflowId, workspaceId }) => {
    const automation = await request('/api/workbench/automations', 'POST', {
      workflowId,
      name: `E2E Failure ${Date.now()}`,
      triggerType: 'schedule',
      scheduleExpr: 'daily@09:00',
      timezone: 'Asia/Shanghai',
      status: 'paused',
      input: { workspaceId },
      maxRetries: 1,
      retryDelaySeconds: 10,
      notifyOnFailure: true
    })
    const run = await request(`/api/workbench/automations/${automation.id}/runs`, 'POST', { input: { workspaceId } })
    const reminders = await request('/api/agent-tools/reminders?limit=20', 'GET')
    await request(`/api/workbench/automations/${automation.id}`, 'DELETE')
    const remaining = await request('/api/workbench/automations', 'GET')
    return { automationId: automation.id, run, reminders, remaining }

    async function request(url: string, method: string, body?: Record<string, unknown>) {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${window.localStorage.getItem('lyle-token')}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    }
  }, { workflowId: failed.workflowId, workspaceId: setup.workspaceId })
  expect(automationFailure.run.status).toBe('failed')
  expect(automationFailure.run.attempt).toBe(1)
  expect(automationFailure.run.willRetry).toBe(false)
  expect(automationFailure.reminders.items.some((item: any) =>
    item.sourceType === 'automation' && Number(item.sourceId) === Number(automationFailure.run.id)
  )).toBe(true)
  expect(automationFailure.remaining.items.some((item: any) =>
    Number(item.id) === Number(automationFailure.automationId)
  )).toBe(false)

  const planConversion = await page.evaluate(async () => {
    const plan = await request('/api/agent/plans', 'POST', {
      title: `E2E Plan ${Date.now()}`,
      objective: '验证计划转换工作流',
      status: 'awaiting_confirmation',
      steps: [
        { title: '读取项目状态', description: '检查当前代码状态', toolName: 'workspace.git_status' },
        { title: '整理结果', description: '形成可复用摘要' }
      ]
    })
    const first = await request(`/api/workbench/workflows/from-plan/${plan.id}`, 'POST', {})
    const second = await request(`/api/workbench/workflows/from-plan/${plan.id}`, 'POST', {})
    const workflows = await request('/api/workbench/workflows', 'GET')
    return { plan, first, second, workflows }

    async function request(url: string, method: string, body?: Record<string, unknown>) {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${window.localStorage.getItem('lyle-token')}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    }
  })
  expect(planConversion.first.id).toBe(planConversion.second.id)
  expect(planConversion.first.createdFromPlanId).toBe(planConversion.plan.id)
  expect(planConversion.first.steps).toHaveLength(2)
  expect(planConversion.workflows.items.filter((item: any) =>
    Number(item.createdFromPlanId) === Number(planConversion.plan.id)
  )).toHaveLength(1)

  const eventTrigger = await page.evaluate(async ({ workflowId, workspaceId }) => {
    const todo = await request('/api/agent-tools/todos', 'POST', {
      title: `E2E Due Task ${Date.now()}`,
      dueAt: new Date(Date.now() - 60_000).toISOString()
    })
    const automation = await request('/api/workbench/automations', 'POST', {
      workflowId,
      name: `E2E Task Due ${Date.now()}`,
      triggerType: 'task_due',
      timezone: 'Asia/Shanghai',
      status: 'enabled',
      input: { workspaceId, taskId: todo.id },
      maxRetries: 0,
      retryDelaySeconds: 10,
      notifyOnFailure: true
    })
    const first = await request(`/api/workbench/automations/${automation.id}/check-trigger`, 'POST', {})
    const second = await request(`/api/workbench/automations/${automation.id}/check-trigger`, 'POST', {})
    const reminders = await request('/api/agent-tools/reminders?limit=30', 'GET')
    await request(`/api/workbench/automations/${automation.id}`, 'DELETE', undefined, false)
    await request(`/api/agent-tools/todos/${todo.id}`, 'DELETE', undefined, false)
    return { first, second, reminders }

    async function request(
      url: string,
      method: string,
      body?: Record<string, unknown>,
      parseJson = true
    ) {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${window.localStorage.getItem('lyle-token')}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (!response.ok) throw new Error(await response.text())
      return parseJson ? response.json() : { ok: true }
    }
  }, { workflowId: planConversion.first.id, workspaceId: setup.workspaceId })
  expect(eventTrigger.first.triggered).toBe(true)
  expect(eventTrigger.first.event.type).toBe('task_due')
  expect(eventTrigger.first.run.status).toBe('completed')
  expect(eventTrigger.second.triggered).toBe(false)
  expect(eventTrigger.reminders.items.some((item: any) => item.sourceType === 'automation_event')).toBe(true)
})

async function createFailedRun(page: Page, suffix: number, workspaceId: number) {
  return page.evaluate(async ({ suffix, workspaceId }) => {
    const workflow = await request('/api/workbench/workflows', {
      name: `E2E Retry ${suffix}`,
      steps: [
        { title: '预期失败命令', stepType: 'cli', commandTemplate: "sh -c 'exit 1'", sortOrder: 0 },
        { title: '不应运行', stepType: 'summarize', sortOrder: 1 }
      ]
    })
    const run = await request(`/api/workbench/workflows/${workflow.id}/runs`, { workspaceId })
    const failed = await request(`/api/workbench/workflow-runs/${run.id}/resume`, { confirmed: true })
    return { workflowId: workflow.id, runId: failed.id }

    async function request(url: string, body: Record<string, unknown>) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${window.localStorage.getItem('lyle-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    }
  }, { suffix, workspaceId })
}

async function createHighRiskRun(page: Page, suffix: number, workspaceId: number) {
  return page.evaluate(async ({ suffix, workspaceId }) => {
    const workflow = await request('/api/workbench/workflows', {
      name: `E2E Second Confirm ${suffix}`,
      steps: [{ title: 'Push Dry Run', stepType: 'cli', commandTemplate: 'git push --dry-run', sortOrder: 0 }]
    })
    const run = await request(`/api/workbench/workflows/${workflow.id}/runs`, { workspaceId })
    return { workflowId: workflow.id, runId: run.id }

    async function request(url: string, body: Record<string, unknown>) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${window.localStorage.getItem('lyle-token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    }
  }, { suffix, workspaceId })
}
