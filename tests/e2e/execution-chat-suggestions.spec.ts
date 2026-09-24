import { expect, test } from '@playwright/test'

test.skip(process.env.V6_3_REAL_E2E !== '1', 'requires the V6.3 real backend stack')

test('shows execution suggestions and requires an explicit user action', async ({ page }) => {
  const suffix = Date.now()
  const originalIntent = '用 MCP 检查代码，并保存为每天执行的工作流'

  await page.route('**/api/chat/stream', async (route) => {
    const suggestions = [
      {
        id: 'cli-preview',
        type: 'cli',
        title: '检查当前代码状态',
        description: '先在工作台预览 git status --short。',
        riskLevel: 'read_only',
        status: 'pending',
        action: 'open_workbench',
        payload: { command: 'git status --short' }
      },
      {
        id: 'mcp-tool',
        type: 'mcp',
        title: '使用 MCP 工具',
        description: '打开工作台检查工具参数后再调用。',
        riskLevel: 'read_only',
        status: 'pending',
        action: 'open_workbench',
        payload: { toolId: 1 }
      },
      {
        id: 'workflow-draft',
        type: 'workflow',
        title: '保存为工作流',
        description: '创建草稿，不自动运行。',
        riskLevel: 'read_only',
        status: 'pending',
        action: 'create_workflow',
        payload: {
          workflow: {
            name: `Chat Draft ${suffix}`,
            description: originalIntent,
            steps: [{ title: '汇总结果', stepType: 'summarize', outputKey: 'summary' }]
          }
        }
      }
    ]
    const body = [
      'event: delta',
      'data: {"text":"建议已经准备好。"}',
      '',
      'event: meta',
      `data: ${JSON.stringify({ executionSuggestions: suggestions })}`,
      '',
      'event: done',
      'data: {}',
      '',
      ''
    ].join('\n')
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body })
  })

  await page.goto('/login')
  await page.getByTestId('register-tab').click()
  await page.getByTestId('username-input').fill(`execution_chat_${suffix}`)
  await page.getByTestId('password-input').fill('123456')
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL('/dashboard')
  await page.getByRole('button', { name: '新建聊天', exact: true }).click()

  await page.getByTestId('chat-input').fill(originalIntent)
  await page.getByTestId('chat-submit').click()

  await expect(page.getByText('执行建议')).toBeVisible()
  await expect(page.getByText('3 条')).toBeVisible()
  await expect(page.getByText('检查当前代码状态')).toBeVisible()
  await expect(page.getByText('使用 MCP 工具')).toBeVisible()
  const cliCard = page.locator('.candidate-memory-card').filter({ hasText: '检查当前代码状态' })
  await cliCard.getByRole('button', { name: '检查命令' }).click()
  await expect(page).toHaveURL(/\/advanced-settings\?tab=cli$/)
  await expect(page.getByTestId('workbench-tab-cli')).toHaveClass(/active/)
  await expect(page.getByRole('heading', { name: 'CLI 命令' })).toBeVisible()

  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(desktopOverflow).toBeLessThanOrEqual(1)

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(mobileOverflow).toBeLessThanOrEqual(1)
  await expect(page.getByTestId('workbench-tab-cli')).toBeVisible()

  await page.getByRole('button', { name: '打开主导航' }).click()
  await page.getByRole('dialog', { name: 'Lyle AI' }).getByRole('button', { name: '新建聊天', exact: true }).click()
  await page.getByTestId('chat-input').fill(originalIntent)
  await page.getByTestId('chat-submit').click()
  const workflowCard = page.locator('.candidate-memory-card').filter({ hasText: '保存为工作流' })
  await workflowCard.getByRole('button', { name: '生成安全预览' }).click()

  await expect(page).toHaveURL('/automations')
  expect(page.url()).not.toContain(encodeURIComponent(originalIntent))
  const preview = page.getByRole('dialog').filter({ hasText: '此预览不会执行任何操作' })
  await expect(preview.getByRole('button', { name: '确认启用' })).toBeVisible()
  await expect(preview).toContainText('此预览不会执行任何操作')
  await preview.getByRole('button', { name: '取消' }).click()
})
