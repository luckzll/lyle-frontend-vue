import { expect, type Page, type Route, test } from '@playwright/test'

test.describe('V4.2 execution and automation workspace', () => {
  test('keeps execution views in the URL and completes detail, retry, and confirmation flows', async ({ page, context }) => {
    await seedAuth(page, 'v42_execution')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await mockShellRequests(page)
    const productEvents: Array<Record<string, unknown>> = []
    await page.route('**/api/experience/events', (route) => {
      productEvents.push(route.request().postDataJSON() as Record<string, unknown>)
      return json(route, { accepted: true })
    })

    const now = new Date().toISOString()
    let confirmations = [
      confirmation(101, '删除外部发布分支', false, true, ['项目 7', 'release/v4.2'], now),
      confirmation(102, '更新项目周报', true, false, ['项目 9'], now)
    ]
    const completedResult = result(201, 'completed', '每日巡检已完成', now, {
      projectId: 7,
      automationId: 17,
      automationName: '发布巡检',
      sourceType: 'automation',
      sourceId: '17',
      traceRef: 'trace-201',
      completedItems: ['检查 8 个任务'],
      dataScope: ['项目 7']
    })
    const failedResult = result(202, 'failed', '发布流程需要重试', now, {
      projectId: 7,
      automationId: 17,
      automationName: '发布巡检',
      sourceType: 'workflow_run',
      sourceId: '501',
      risks: ['上游连接超时'],
      recommendedActions: [{ type: 'retry', label: '重新运行' }]
    })
    const otherProjectResult = result(203, 'completed', '其他项目结果', now, { projectId: 9, automationId: 18, automationName: '知识库周报' })
    const operations = [
      operation(301, '已发布项目周报', 'confirmed', 7, now),
      operation(302, '等待创建日程', 'pending', 9, now)
    ]
    let confirmationDetailCalls = 0
    let resultDetailCalls = 0
    let confirmCalls = 0
    let rejectCalls = 0
    let retryCalls = 0
    let dismissCalls = 0
    let restoreCalls = 0
    let dismissed = false

    await page.route('**/api/experience/confirmations', (route) => json(route, { items: confirmations }))
    await page.route('**/api/experience/confirmations/101', (route) => {
      confirmationDetailCalls += 1
      return json(route, confirmations.find((item) => item.pendingOperationId === 101))
    })
    await page.route('**/api/experience/confirmations/101/confirm', (route) => {
      confirmCalls += 1
      confirmations = confirmations.filter((item) => item.pendingOperationId !== 101)
      return json(route, { accepted: true })
    })
    await page.route('**/api/experience/confirmations/102/reject', (route) => {
      rejectCalls += 1
      confirmations = confirmations.filter((item) => item.pendingOperationId !== 102)
      return json(route, { accepted: true })
    })
    await page.route('**/api/experience/execution/results?**', (route) => {
      const attentionOnly = new URL(route.request().url()).searchParams.get('attentionOnly') === 'true'
      const items = [completedResult, failedResult, otherProjectResult].filter((item) => (
        !attentionOnly || (!dismissed && ['failed', 'partial', 'awaiting_confirmation'].includes(item.status))
      ))
      return json(route, { items, nextCursor: null, hasMore: false })
    })
    await page.route('**/api/experience/execution/results/202/dismiss', (route) => {
      dismissCalls += 1
      dismissed = true
      return json(route, { ...failedResult, dismissedAt: new Date().toISOString() })
    })
    await page.route('**/api/experience/execution/results/202/restore', (route) => {
      restoreCalls += 1
      dismissed = false
      return json(route, { ...failedResult, dismissedAt: null })
    })
    await page.route('**/api/experience/execution/results/201', (route) => {
      resultDetailCalls += 1
      return json(route, completedResult)
    })
    await page.route('**/api/experience/execution/needs-attention', (route) =>
      json(route, { items: dismissed ? [] : [failedResult] }))
    await page.route('**/api/agent-tools/operations?**', (route) => json(route, { items: operations }))
    await page.route('**/api/agent-tools/operations/302/confirm', (route) => json(route, { operation: operations[1], result: {} }))
    await page.route('**/api/agent-tools/operations/302/reject', (route) => json(route, { operation: operations[1] }))
    await page.route('**/api/workbench/workflow-runs/501/retry', (route) => {
      retryCalls += 1
      return json(route, { accepted: true })
    })

    // The legacy URL keeps its filters while redirecting into the history view.
    await page.goto('/operations?operationStatus=confirmed&projectId=7')
    await expectQuery(page, 'view', 'history')
    await expectQuery(page, 'operationStatus', 'confirmed')
    await expectQuery(page, 'projectId', '7')
    await expect(page.getByRole('button', { name: /历史记录/ })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: '已发布项目周报' })).toBeVisible()
    await expect(page.getByText('PRIVATE_OPERATION_CONTENT')).toHaveCount(0)
    await expect(page.getByText('PRIVATE_OPERATION_RESULT')).toHaveCount(0)

    await page.reload()
    await expectQuery(page, 'view', 'history')
    await expect(page.getByRole('button', { name: /历史记录/ })).toHaveAttribute('aria-current', 'page')

    await page.getByRole('button', { name: '最新结果' }).click()
    await expectQuery(page, 'view', 'results')
    await page.getByRole('button', { name: '筛选', exact: true }).click()
    const projectFilter = page.getByLabel('项目', { exact: true })
    const automationFilter = page.getByRole('combobox', { name: '自动化' })
    const statusFilter = page.getByRole('combobox', { name: '状态' })
    const timeFilter = page.getByRole('combobox', { name: '时间' })
    await projectFilter.fill('7')
    await projectFilter.dispatchEvent('change')
    await automationFilter.selectOption('17')
    await statusFilter.selectOption('completed')
    await timeFilter.selectOption('7d')
    await expectQuery(page, 'projectId', '7')
    await expectQuery(page, 'automationId', '17')
    await expectQuery(page, 'status', 'completed')
    await expectQuery(page, 'time', '7d')
    await expectQuery(page, 'view', 'results')

    const completedCard = page.getByRole('article').filter({ hasText: '每日巡检已完成' })
    await expect(completedCard).toBeVisible()
    await expect(page.getByText('其他项目结果')).toHaveCount(0)
    const projectSource = completedCard.getByRole('link', { name: '项目 #7' })
    const automationSource = completedCard.getByRole('link', { name: '自动化 · 发布巡检' })
    await expect(projectSource).toHaveAttribute('href', '/projects/7')
    await expect(automationSource).toHaveAttribute('href', '/automations?automationId=17')
    await completedCard.getByRole('button', { name: '技术详情' }).click()
    await expectQuery(page, 'resultId', '201')
    const resultDrawer = page.getByRole('dialog').filter({ hasText: '每日巡检已完成' })
    await expect(resultDrawer.getByRole('heading', { name: '每日巡检已完成' })).toBeVisible()
    await expect(resultDrawer.getByText('trace-201')).toBeVisible()
    expect(resultDetailCalls).toBe(1)

    await resultDrawer.getByRole('button', { name: '复制结果链接' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('/execution-center?view=results&resultId=201')
    expect(productEvents.filter((event) => event.eventType === 'result_source_opened')).toHaveLength(0)
    await resultDrawer.getByRole('button', { name: '关闭详情' }).click()
    await expectQuery(page, 'resultId', null)

    await automationSource.evaluate((element) => {
      element.addEventListener('click', (event) => event.preventDefault(), { capture: true, once: true })
    })
    await automationSource.click()
    await expect.poll(() => productEvents.filter((event) => event.eventType === 'result_source_opened').length).toBe(1)
    expect(productEvents.find((event) => event.eventType === 'result_source_opened')).toMatchObject({
      page: 'execution-center',
      actionType: 'automation',
      status: 'completed'
    })

    await statusFilter.selectOption('failed')
    await page.getByRole('button', { name: /需要处理/ }).click()
    await expectQuery(page, 'view', 'attention')
    const executionBadge = page.locator('.app-sidebar__link[href="/execution-center"] .app-sidebar__badge')
    await expect(executionBadge).toHaveText('3')
    const failedCard = page.getByRole('article').filter({ hasText: '发布流程需要重试' })
    await failedCard.getByRole('button', { name: '修复后重试' }).click()
    await expect.poll(() => retryCalls).toBe(1)
    await expect(page.getByText('已提交重试，最新状态已刷新。')).toBeVisible()
    await failedCard.getByRole('button', { name: '移出待处理' }).click()
    await expect.poll(() => dismissCalls).toBe(1)
    await expect(page.getByText('已移出待处理；执行历史仍保留。')).toBeVisible()
    await expect(failedCard).toHaveCount(0)
    await expect(executionBadge).toHaveText('2')
    await page.getByRole('button', { name: '撤销' }).click()
    await expect.poll(() => restoreCalls).toBe(1)
    await expect(page.getByText('已撤销，1 条结果已恢复到待处理。')).toBeVisible()
    await expect(failedCard).toBeVisible()
    await expect(executionBadge).toHaveText('3')
    await page.getByRole('button', { name: '全部知悉 1 条已结束结果' }).click()
    await expect.poll(() => dismissCalls).toBe(2)
    await expect(page.getByText('已移出 1 条待处理结果；执行历史仍保留。')).toBeVisible()
    await expect(failedCard).toHaveCount(0)
    await expect(executionBadge).toHaveText('2')

    await projectFilter.fill('')
    await projectFilter.dispatchEvent('change')
    await expectQuery(page, 'projectId', null)
    await page.getByRole('button', { name: /待我确认/ }).click()
    await expect(page.getByRole('button', { name: '待我确认 2' })).toHaveAttribute('aria-current', 'page')

    const highRiskCard = page.getByRole('article').filter({ hasText: '删除外部发布分支' })
    await highRiskCard.getByRole('button', { name: '查看详情' }).click()
    const confirmationDrawer = page.getByRole('dialog').filter({ hasText: '删除外部发布分支' })
    await expect(confirmationDrawer.getByRole('heading', { name: '删除外部发布分支' })).toBeVisible()
    await expect(confirmationDrawer.getByText('可能无法撤销')).toBeVisible()
    expect(confirmationDetailCalls).toBe(1)
    await confirmationDrawer.getByRole('button', { name: '关闭详情' }).click()

    await highRiskCard.getByRole('button', { name: '确认执行' }).click()
    const highRiskDialog = page.getByRole('dialog').filter({ hasText: '再次确认高风险操作' })
    await expect(highRiskDialog).toBeVisible()
    await expect(highRiskDialog).toContainText('属于高风险或不可撤销操作')
    await highRiskDialog.getByRole('button', { name: '确认并执行' }).click()
    await expect.poll(() => confirmCalls).toBe(1)
    await expect(page.getByRole('button', { name: '待我确认 1' })).toBeVisible()

    const lowRiskCard = page.getByRole('article').filter({ hasText: '更新项目周报' })
    await lowRiskCard.getByRole('button', { name: '拒绝' }).click()
    await expect.poll(() => rejectCalls).toBe(1)
    await expect(page.getByRole('button', { name: '待我确认', exact: true })).toBeVisible()
    await expect(page.getByText('暂时没有需要你确认的事')).toBeVisible()
    await expect.poll(() => productEvents.filter((event) => event.eventType === 'effective_progress_action').length).toBeGreaterThanOrEqual(3)
    expect(productEvents.filter((event) => event.eventType === 'effective_progress_action').map((event) => event.actionType)).toEqual(
      expect.arrayContaining(['result_action', 'confirmation'])
    )
    const allowedEffectiveProgressKeys = new Set(['eventType', 'page', 'actionType', 'projectId', 'status', 'durationMs'])
    expect(productEvents
      .filter((event) => event.eventType === 'effective_progress_action')
      .every((event) => Object.keys(event).every((key) => allowedEffectiveProgressKeys.has(key))))
      .toBe(true)
  })

  test('paginates result cards and reloads the first page with the latest server filters', async ({ page }) => {
    await seedAuth(page, 'v42_result_pagination')
    await mockShellRequests(page)

    const now = new Date().toISOString()
    const firstPageResult = result(401, 'completed', '首批巡检结果', now, {
      projectId: 7,
      automationId: 17,
      automationName: '发布巡检'
    })
    const nextPageResult = result(402, 'failed', '分页后的失败结果', now, {
      projectId: 7,
      automationId: 17,
      automationName: '发布巡检',
      risks: ['分页验证风险']
    })
    const listRequests: URL[] = []

    await page.route('**/api/experience/confirmations', (route) => json(route, { items: [] }))
    await page.route('**/api/agent-tasks**', (route) => json(route, { items: [agentTask('501', '仍在列表中的 Agent Task', now)] }))
    await page.route('**/api/experience/execution/needs-attention', (route) => json(route, { items: [nextPageResult] }))
    await page.route('**/api/agent-tools/operations?**', (route) => json(route, { items: [] }))
    await page.route('**/api/experience/execution/results?**', (route) => {
      const url = new URL(route.request().url())
      listRequests.push(url)
      const status = url.searchParams.get('status')
      const projectId = url.searchParams.get('projectId')
      const automationId = url.searchParams.get('automationId')
      const cursor = url.searchParams.get('cursor')
      const candidates = [firstPageResult, nextPageResult].filter((item) => (
        (!status || item.status === status)
        && (!projectId || String(item.projectId) === projectId)
        && (!automationId || String(item.automationId) === automationId)
      ))

      if (!status && cursor === 'page-2') return json(route, { items: [nextPageResult], nextCursor: null, hasMore: false })
      if (!status) return json(route, { items: [firstPageResult], nextCursor: 'page-2', hasMore: true })
      return json(route, { items: candidates, nextCursor: null, hasMore: false })
    })

    await page.goto('/execution-center?view=results')
    await expect(page.getByRole('heading', { name: '首批巡检结果' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '仍在列表中的 Agent Task' })).toBeVisible()
    await page.getByRole('button', { name: '加载更多' }).click()
    await expect(page.getByRole('heading', { name: '分页后的失败结果' })).toBeVisible()
    await expect(page.getByRole('button', { name: '加载更多' })).toHaveCount(0)

    await page.getByRole('button', { name: '筛选', exact: true }).click()
    const projectFilter = page.getByLabel('项目', { exact: true })
    const automationFilter = page.getByRole('combobox', { name: '自动化' })
    const statusFilter = page.getByRole('combobox', { name: '状态' })
    await projectFilter.fill('7')
    await projectFilter.dispatchEvent('change')
    await automationFilter.selectOption('17')
    await statusFilter.selectOption('failed')

    await expectQuery(page, 'projectId', '7')
    await expectQuery(page, 'automationId', '17')
    await expectQuery(page, 'status', 'failed')
    await expect.poll(() => listRequests.some((url) => (
      !url.searchParams.has('cursor')
      && url.searchParams.get('projectId') === '7'
      && url.searchParams.get('automationId') === '17'
      && url.searchParams.get('status') === 'failed'
      && url.searchParams.get('limit') === '30'
    ))).toBe(true)
    await expect(page.getByRole('heading', { name: '分页后的失败结果' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '首批巡检结果' })).toHaveCount(0)

    await statusFilter.selectOption('awaiting_confirmation')
    await expect(page.getByTestId('execution-filter-scope')).toContainText('Agent Task 暂时隐藏')
    await expect(page.getByRole('heading', { name: '仍在列表中的 Agent Task' })).toHaveCount(0)
    await expect(page.getByText('没有符合筛选的执行结果', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '清除结果专属筛选' }).click()
    await expectQuery(page, 'automationId', null)
    await expectQuery(page, 'status', null)
    await expect(page.getByRole('heading', { name: '仍在列表中的 Agent Task' })).toBeVisible()
  })

  test('surfaces paused workflow steps in confirmation inbox and resumes them without retrying', async ({ page }) => {
    await seedAuth(page, 'v42_workflow_confirmation')
    await mockShellRequests(page)

    const now = new Date().toISOString()
    let waiting = true
    let resumeCalls = 0
    let resumePayload: Record<string, unknown> | null = null
    const workflowConfirmation = result(293, 'awaiting_confirmation', '执行需要处理', now, {
      sourceType: 'workflow_run',
      sourceId: '93',
      conclusion: '执行已暂停，等待确认后可继续。',
      risks: ['确认验收口径尚未完成，请查看技术详情。'],
      recommendedActions: [
        { type: 'retry', label: '重试本次运行' },
        { type: 'view', label: '查看技术详情' }
      ]
    })

    await page.route('**/api/experience/confirmations', (route) => json(route, { items: [] }))
    await page.route('**/api/agent-tools/operations?**', (route) => json(route, { items: [] }))
    await page.route('**/api/experience/execution/results?**', (route) => {
      const status = new URL(route.request().url()).searchParams.get('status')
      const items = waiting && (!status || status === 'awaiting_confirmation') ? [workflowConfirmation] : []
      return json(route, { items, nextCursor: null, hasMore: false })
    })
    await page.route('**/api/workbench/workflow-runs/93/resume', (route) => {
      resumeCalls += 1
      resumePayload = route.request().postDataJSON() as Record<string, unknown>
      waiting = false
      return json(route, {
        id: 93,
        status: 'completed',
        steps: [{ title: '确认验收口径', status: 'completed', output: {} }]
      })
    })

    await page.goto('/execution-center?view=confirmations')
    await expect(page.getByRole('button', { name: '待我确认 1' })).toHaveAttribute('aria-current', 'page')
    const confirmationCard = page.getByRole('article').filter({ hasText: '确认验收口径' })
    await expect(confirmationCard).toBeVisible()
    await expect(confirmationCard.getByRole('button', { name: '确认并继续' })).toBeVisible()
    await expect(confirmationCard.getByRole('button', { name: '重试本次运行' })).toHaveCount(0)

    await page.getByRole('button', { name: '需要处理 1' }).click()
    const attentionCard = page.getByRole('article').filter({ hasText: '确认验收口径' })
    await expect(attentionCard.getByRole('button', { name: '确认并继续' })).toBeVisible()
    await attentionCard.getByRole('button', { name: '确认并继续' }).click()

    await expect.poll(() => resumeCalls).toBe(1)
    expect(resumePayload).toEqual({ confirmed: true, secondConfirmed: false })
    await expect(page.getByText('已确认，工作流已继续执行。')).toBeVisible()
    await expect(page.getByRole('button', { name: '待我确认', exact: true })).toBeVisible()
    await expect(attentionCard).toHaveCount(0)
  })

  test('keeps automation card actions independent and manages settings and deletion in drawers', async ({ page }) => {
    await seedAuth(page, 'v42_automation')
    await mockShellRequests(page)
    const productEvents: Array<Record<string, unknown>> = []
    await page.route('**/api/experience/events', (route) => {
      productEvents.push(route.request().postDataJSON() as Record<string, unknown>)
      return json(route, { accepted: true })
    })

    let automations = [
      automation(17, '发布巡检', 'enabled'),
      automation(18, '知识库周报', 'paused')
    ]
    const runCalls = new Map<number, number>()
    let pauseCalls = 0
    let enableCalls = 0
    let deleteCalls = 0
    let updatePayload: Record<string, unknown> | null = null
    let releaseFirstRun!: () => void
    let markFirstRunStarted!: () => void
    const firstRunGate = new Promise<void>((resolve) => { releaseFirstRun = resolve })
    const firstRunStarted = new Promise<void>((resolve) => { markFirstRunStarted = resolve })

    await page.route('**/api/experience/templates', (route) => json(route, { items: [] }))
    await page.route('**/api/experience/onboarding', (route) => json(route, {
      completedAt: '2026-07-11T00:00:00.000Z',
      candidates: { projects: [], workspaces: [] }
    }))
    await page.route('**/api/workbench/automations**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      const method = request.method()

      if (path.endsWith('/workbench/automations') && method === 'GET') {
        return json(route, { items: automations })
      }

      const match = path.match(/\/workbench\/automations\/(\d+)(?:\/(runs|pause|enable))?$/)
      if (!match) return json(route, { message: `Unexpected automation request: ${method} ${path}` }, 404)
      const id = Number(match[1])
      const action = match[2]

      if (action === 'runs' && method === 'POST') {
        runCalls.set(id, (runCalls.get(id) || 0) + 1)
        if (id === 17) {
          markFirstRunStarted()
          await firstRunGate
        }
        return json(route, { accepted: true })
      }
      if (action === 'pause' && method === 'POST') {
        pauseCalls += 1
        automations = automations.map((item) => item.id === id ? { ...item, status: 'paused', nextRunAt: null } : item)
        return json(route, { accepted: true })
      }
      if (action === 'enable' && method === 'POST') {
        enableCalls += 1
        automations = automations.map((item) => item.id === id ? { ...item, status: 'enabled' } : item)
        return json(route, { accepted: true })
      }
      if (!action && method === 'PATCH') {
        updatePayload = request.postDataJSON() as Record<string, unknown>
        automations = automations.map((item) => item.id === id ? { ...item, ...updatePayload } : item)
        return json(route, { updated: true })
      }
      if (!action && method === 'DELETE') {
        deleteCalls += 1
        automations = automations.filter((item) => item.id !== id)
        return json(route, { deleted: true })
      }
      return json(route, { message: `Unexpected automation action: ${method} ${path}` }, 404)
    })

    await page.goto('/automations?automationId=18')
    const firstCard = page.getByRole('article').filter({ hasText: '发布巡检' })
    const secondCard = page.getByRole('article').filter({ hasText: '知识库周报' })
    await expect(firstCard.getByText('运行中')).toBeVisible()
    await expect(secondCard.getByText('已暂停')).toBeVisible()
    await expect(secondCard).toBeFocused()

    await firstCard.getByRole('button', { name: '运行一次' }).click()
    await firstRunStarted
    await expect(firstCard.getByRole('button', { name: '运行一次' })).toBeDisabled()
    await expect(secondCard.getByRole('button', { name: '运行一次' })).toBeEnabled()
    await secondCard.getByRole('button', { name: '运行一次' }).click()
    await expect.poll(() => runCalls.get(18) || 0).toBe(1)

    releaseFirstRun()
    await expect.poll(() => runCalls.get(17) || 0).toBe(1)
    await expect(firstCard.getByRole('button', { name: '运行一次' })).toBeEnabled()

    await firstCard.getByRole('button', { name: '暂停' }).click()
    await expect.poll(() => pauseCalls).toBe(1)
    await expect(firstCard.getByText('已暂停')).toBeVisible()
    await firstCard.getByRole('button', { name: '恢复' }).click()
    await expect.poll(() => enableCalls).toBe(1)
    await expect(firstCard.getByText('运行中')).toBeVisible()

    await firstCard.getByRole('button', { name: '设置' }).click()
    const settingsDrawer = page.getByRole('dialog').filter({ hasText: '设置 · 发布巡检' })
    await expect(settingsDrawer).toBeVisible()
    await settingsDrawer.getByLabel('名称').fill('发布巡检（新版）')
    await settingsDrawer.getByText('高级执行设置', { exact: true }).click()
    await settingsDrawer.getByLabel('频率表达式').fill('daily:09:30')
    await settingsDrawer.getByRole('button', { name: '保存设置' }).click()
    await expect(settingsDrawer).not.toBeVisible()
    expect(updatePayload).toEqual(expect.objectContaining({
      name: '发布巡检（新版）',
      scheduleExpr: 'daily:09:30',
      timezone: 'Asia/Shanghai'
    }))
    await expect(page.getByRole('article').filter({ hasText: '发布巡检（新版）' })).toBeVisible()

    await secondCard.getByRole('button', { name: '删除' }).click()
    const deleteDialog = page.getByRole('dialog').filter({ hasText: '删除自动化' })
    await expect(deleteDialog).toContainText('历史执行结果仍会保留')
    await deleteDialog.getByRole('button', { name: '确认删除' }).click()
    await expect.poll(() => deleteCalls).toBe(1)
    await expect(page.getByRole('article').filter({ hasText: '知识库周报' })).toHaveCount(0)
    await expect.poll(() => productEvents.filter((event) => event.eventType === 'effective_progress_action').length).toBeGreaterThanOrEqual(3)
    expect(productEvents.filter((event) => event.eventType === 'effective_progress_action').map((event) => event.actionType)).toEqual(
      expect.arrayContaining(['automation_run', 'automation_enable'])
    )
  })
})

async function seedAuth(page: Page, username: string) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const token = `header.${payload}.signature`
  await page.addInitScript(({ token, username }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify({ id: 1, username, role: 'USER' }))
  }, { token, username })
}

async function mockShellRequests(page: Page) {
  await page.route('**/api/agent-tools/reminders?**', (route) => json(route, { items: [] }))
  await page.route('**/api/agent-tasks**', (route) => json(route, { items: [] }))
  await page.route('**/api/experience/confirmations', (route) => json(route, { items: [] }))
  await page.route('**/api/experience/execution/needs-attention', (route) => json(route, { items: [] }))
  await page.route('**/api/experience/events', (route) => json(route, { accepted: true }))
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body ?? {}) })
}

async function expectQuery(page: Page, key: string, value: string | null) {
  await expect.poll(() => new URL(page.url()).searchParams.get(key)).toBe(value)
}

function confirmation(
  id: number,
  title: string,
  reversible: boolean,
  requiresSecondConfirmation: boolean,
  impactResources: string[],
  createdAt: string
) {
  return {
    pendingOperationId: id,
    actionTitle: title,
    toolName: 'github',
    operationType: 'repository.write',
    riskLevel: requiresSecondConfirmation ? 'high' : 'write',
    reason: '此操作会修改外部资源。',
    impactResources,
    reversible,
    requiresSecondConfirmation,
    source: 'V4.2 发布自动化',
    createdAt
  }
}

function result(
  id: number,
  status: 'completed' | 'partial' | 'failed' | 'awaiting_confirmation',
  title: string,
  createdAt: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    sourceType: 'automation',
    sourceId: String(id),
    projectId: null,
    status,
    title,
    conclusion: status === 'failed' ? '本次执行未完成。' : '本次执行已完成。',
    completedItems: [],
    risks: [],
    recommendedActions: [],
    dataScope: [],
    durationMs: 820,
    traceRef: `trace-${id}`,
    createdAt,
    ...overrides
  }
}

function agentTask(id: string, title: string, updatedAt: string) {
  return {
    id,
    title,
    goal: '验证执行中心筛选范围',
    completionCriteria: [],
    constraints: {},
    projectId: '7',
    status: 'COMPLETED',
    riskLevel: 'READ',
    autonomyLevel: 0,
    version: 1,
    createdAt: updatedAt,
    updatedAt
  }
}

function operation(id: number, summary: string, status: string, projectId: number, createdAt: string) {
  return {
    id,
    toolName: 'todo',
    operationType: 'todo.create',
    riskLevel: 'write',
    summary,
    payload: { projectId, title: summary, content: 'PRIVATE_OPERATION_CONTENT' },
    status,
    sourceText: 'PRIVATE_OPERATION_SOURCE',
    result: status === 'confirmed' ? { content: 'PRIVATE_OPERATION_RESULT' } : null,
    createdAt,
    updatedAt: createdAt
  }
}

function automation(id: number, name: string, status: 'enabled' | 'paused') {
  return {
    id,
    workflowId: id + 100,
    name,
    status,
    triggerType: 'schedule',
    scheduleExpr: 'daily:10:00',
    timezone: 'Asia/Shanghai',
    nextRunAt: status === 'enabled' ? '2026-07-12T02:00:00.000Z' : null,
    lastRunAt: '2026-07-11T02:00:00.000Z',
    consecutiveFailures: 0,
    input: { projectId: 7 },
    maxRetries: 1,
    retryDelaySeconds: 60,
    notifyOnFailure: true,
    projectName: 'Lyle V4.2',
    lastRunStatus: 'completed',
    lastResultTitle: '最近一次运行成功',
    lastResultId: id + 200,
    needsAttention: false
  }
}
