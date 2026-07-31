import { expect, test } from '@playwright/test'

test.skip(process.env.V6_3_REAL_E2E !== '1', 'requires the V6.3 real backend stack')

test('covers V3 project plan controls and connector states', async ({ page }) => {
  test.setTimeout(120000)
  const suffix = Date.now()
  const username = `v3_e2e_${suffix}`
  const projectName = `V3 E2E 项目 ${suffix}`
  const planTitle = `V3 E2E 计划 ${suffix}`

  await page.goto('/login')
  await page.getByTestId('register-tab').click()
  await page.getByTestId('username-input').fill(username)
  await page.getByTestId('password-input').fill('123456')
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL('/dashboard')

  await page.getByRole('link', { name: '项目', exact: true }).click()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByPlaceholder('项目名称').fill(projectName)
  await page.getByPlaceholder('一句话定位').fill('验证 V3 项目空间')
  await page.getByPlaceholder('当前阶段').fill('E2E 验收')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible()

  const projectId = Number(page.url().split('/').pop())
  expect(projectId).toBeGreaterThan(0)

  await page.evaluate(async ({ projectId, planTitle }) => {
    const token = window.localStorage.getItem('lyle-token')
    const response = await fetch('/api/agent/plans', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        projectId,
        title: planTitle,
        objective: '验证计划确认、暂停和继续 UI',
        steps: [
          { title: '读取项目上下文', description: '低风险读操作' },
          { title: '等待确认写入', description: '涉及写入，必须暂停确认' }
        ]
      })
    })
    if (!response.ok) {
      throw new Error(await response.text())
    }
  }, { projectId, planTitle })

  await page.getByRole('button', { name: '计划' }).click()
  const planCard = page.locator('.goal-card').filter({ hasText: planTitle })
  await expect(planCard).toBeVisible()
  await expect(planCard).toContainText('待确认')

  await planCard.getByRole('button', { name: '确认执行' }).click()
  await expect(planCard).toContainText('已暂停')
  await expect(planCard).toContainText('待确认')

  await planCard.getByRole('button', { name: '继续' }).click()
  await expect(planCard).toContainText('已完成')

  await page.getByRole('button', { name: '展开系统' }).click()
  await page.getByRole('link', { name: '高级设置', exact: true }).click()
  await page.getByTestId('workbench-tab-connectors').click()
  await expect(page).toHaveURL('/advanced-settings?tab=connectors')
  await expect(page.getByRole('heading', { name: '高级设置' })).toBeVisible()
  await expect(page.getByRole('button', { name: /本地文档/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /GitHub/ })).toBeVisible()

  await page.getByRole('button', { name: /GitHub/ }).click()
  await expect(page.getByRole('button', { name: 'GitHub 需授权' })).toBeVisible()
  await page.getByPlaceholder('owner/repo').first().fill('owner/repo')
  await page.getByPlaceholder('搜索关键词，留空则列出').fill('bug')
  await page.getByRole('button', { name: '搜索' }).click()
  await expect(page.getByText('GitHub token 未配置')).toBeVisible()

  await page.getByRole('button', { name: /本地文档/ }).click()
  await page.getByPlaceholder('搜索关键词，留空则列出').fill('V3')
  await page.getByRole('button', { name: '搜索' }).click()
  await expect(page.getByText(/本地文档搜索命中/)).toBeVisible()
})
