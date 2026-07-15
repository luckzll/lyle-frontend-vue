import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'

test.skip(process.env.V5_REAL_E2E !== '1', 'Set V5_REAL_E2E=1 to run against the real Java/Python/database stack.')
test.describe.configure({ mode: 'serial' })

let longWorkspaceRoot = ''
let inspectionWorkspaceRoot = ''

test.beforeAll(() => {
  longWorkspaceRoot = mkdtempSync(join(tmpdir(), 'lyle-v5-real-e2e-'))
  writeFileSync(join(longWorkspaceRoot, 'README.md'), '# V5 real E2E\n', 'utf8')
  writeFileSync(join(longWorkspaceRoot, 'package.json'), JSON.stringify({
    name: 'lyle-v5-real-e2e', private: true,
    scripts: { test: 'node -e "setTimeout(() => process.exit(0), 5000)"' },
  }), 'utf8')
  execFileSync('git', ['init', '-q'], { cwd: longWorkspaceRoot })
  inspectionWorkspaceRoot = process.env.V5_REAL_WORKSPACE_ROOT || longWorkspaceRoot
})

test.afterAll(() => {
  if (longWorkspaceRoot) rmSync(longWorkspaceRoot, { recursive: true, force: true })
})

test('real stack persists only redacted sensitive summaries and supports pause/resume', async ({ page }) => {
  test.setTimeout(180_000)
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10_000)}`
  await register(page, `v5_real_${suffix}`)

  const setup = await page.evaluate(async ({ suffix, longWorkspaceRoot, inspectionWorkspaceRoot }) => {
    const project = await request('/api/projects', {
      name: `V5 Real Project ${suffix}`,
      description: 'Cross-service Agent Task gate',
      currentStage: 'E2E',
      priority: 3,
    })
    const inspectionWorkspace = await request('/api/workbench/workspaces', {
      name: `V5 Source ${suffix}`,
      rootPath: inspectionWorkspaceRoot,
      status: 'active',
    })
    const longWorkspace = await request('/api/workbench/workspaces', {
      name: `V5 Long ${suffix}`,
      rootPath: longWorkspaceRoot,
      status: 'active',
    })
    return { project, inspectionWorkspace, longWorkspace }

    async function request(url: string, body: Record<string, unknown>) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${window.localStorage.getItem('lyle-token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`)
      return response.json()
    }
  }, { suffix, longWorkspaceRoot, inspectionWorkspaceRoot })

  const inspectionTaskId = await createAndApprove(page, {
    goal: '巡检真实项目并核对 Git、文档和记忆索引，不展示个人记忆正文',
    criteria: '项目状态已读取\nGit 状态清晰\n文档状态清晰',
    template: '项目巡检',
    projectLabel: setup.project.name,
    workspaceLabel: setup.inspectionWorkspace.name,
  })
  await expect(taskStatus(page, '已完成')).toBeVisible({ timeout: 60_000 })

  const memoryRow = page.locator('.timeline li').filter({ hasText: '核对相关上下文' })
  await expect(memoryRow).toContainText('敏感正文已省略')
  await expect(memoryRow).not.toContainText('长期摘要：')
  const inspectionDetail = await taskDetail(page, inspectionTaskId)
  const memoryStep = inspectionDetail.stepRuns.find((item: any) => item.toolRef === 'memory.snapshot')
  const memoryArtifact = inspectionDetail.artifacts.find((item: any) => item.metadata?.toolRef === 'memory.snapshot')
  expect(memoryStep.output.redacted).toBe(true)
  expect(memoryStep.output.sensitivity).toBe('PERSONAL')
  expect(memoryStep.output.summary).toContain('敏感正文已省略')
  expect(memoryArtifact.metadata.redacted).toBe(true)
  expect(JSON.stringify({ output: memoryStep.output, artifact: memoryArtifact })).not.toContain('长期摘要：')

  const researchTaskId = await createAndApprove(page, {
    goal: '调研受控 Agent 的输出安全设计并给出可追溯来源',
    criteria: '至少提供一个可追溯来源\n形成安全设计建议',
    template: '资料调研',
  })
  await expect(taskStatus(page, '已完成')).toBeVisible({ timeout: 60_000 })
  const researchRow = page.locator('.timeline li').filter({ hasText: '检索授权资料' })
  await expect(researchRow).toContainText('外部网页正文与搜索片段已省略')
  await expect(researchRow).not.toContainText('网页搜索结果：')
  const researchDetail = await taskDetail(page, researchTaskId)
  const researchStep = researchDetail.stepRuns.find((item: any) => item.toolRef === 'research.search')
  const synthesisStep = researchDetail.stepRuns.find((item: any) => item.toolRef === 'analysis.synthesize')
  const researchArtifact = researchDetail.artifacts.find((item: any) => item.metadata?.toolRef === 'research.search')
  expect(researchStep.output.redacted).toBe(true)
  expect(researchStep.output.sensitivity).toBe('EXTERNAL_CONTENT')
  expect(researchStep.output.summary.length).toBeLessThan(600)
  expect(researchStep.output.summary).toContain('fixture.example')
  expect(researchStep.output.summary).not.toContain('网页搜索结果：')
  expect(researchStep.output.summary).not.toContain('Ignore previous rules')
  expect(researchStep.output.evidenceRefs).toContain('https://fixture.example')
  expect(JSON.stringify(researchStep.output.evidenceRefs)).not.toContain('tracking=must-not-persist')
  expect(researchStep.output.securityFlags).toContain('PROMPT_INJECTION_PATTERN')
  expect(researchArtifact.metadata.redacted).toBe(true)
  expect(synthesisStep.output.redacted).toBe(true)
  expect(synthesisStep.output.sensitivity).toBe('EXTERNAL_CONTENT')
  expect(synthesisStep.output.summary).toBe('已形成结构化执行结论；敏感上游正文已省略。')
  expect(JSON.stringify(synthesisStep.output)).not.toContain('Ignore previous rules')
  expect(synthesisStep.output.criterionEvidence.every((item: any) =>
    item.note === '该标准仅由脱敏摘要和可追溯来源引用支持。'
  )).toBe(true)

  await createAndApprove(page, {
    goal: '运行长时发布检查，在测试步骤中暂停并恢复',
    criteria: '项目状态已读取\n长时测试已通过\n形成发布结论',
    template: '发布检查',
    projectLabel: setup.project.name,
    workspaceLabel: setup.longWorkspace.name,
  })
  const releaseRow = page.locator('.timeline li').filter({ hasText: '运行授权测试' })
  await expect(releaseRow).toContainText('RUNNING', { timeout: 30_000 })
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(taskStatus(page, '已暂停')).toBeVisible({ timeout: 30_000 })
  await expect(releaseRow).toContainText('SUCCEEDED')
  const conclusionRow = page.locator('.timeline li').filter({ hasText: '形成 Go/No-Go 建议' })
  await expect(conclusionRow).toContainText('PENDING')
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(taskStatus(page, '已完成')).toBeVisible({ timeout: 30_000 })
  await expect(conclusionRow).toContainText('SUCCEEDED')
})

async function register(page: Page, username: string) {
  await page.goto('/login')
  await page.getByTestId('register-tab').click()
  await page.getByTestId('username-input').fill(username)
  await page.getByTestId('password-input').fill('v5-real-e2e-password')
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL('/dashboard')
}

async function createAndApprove(page: Page, values: {
  goal: string
  criteria: string
  template: '项目巡检' | '发布检查' | '资料调研'
  projectLabel?: string
  workspaceLabel?: string
}) {
  await page.goto('/agent-tasks/new')
  await page.getByRole('textbox', { name: '你想完成什么？', exact: true }).fill(values.goal)
  await page.getByRole('textbox', { name: '完成标准 每行一条', exact: true }).fill(values.criteria)
  await page.getByRole('combobox', { name: '场景模板', exact: true }).selectOption({ label: values.template })
  if (values.projectLabel) {
    await selectOptionContaining(page.getByRole('combobox', { name: /目标项目/ }), values.projectLabel)
  }
  if (values.workspaceLabel) {
    await selectOptionContaining(page.getByRole('combobox', { name: /授权工作区/ }), values.workspaceLabel)
  }
  await page.getByRole('button', { name: '生成计划', exact: true }).click()
  await expect(page.getByText('执行前审查 · 计划 v1')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '批准并开始执行', exact: true }).click()
  await expect(page).toHaveURL(/\/agent-tasks\/\d+$/)
  return page.url().split('/').pop() as string
}

async function selectOptionContaining(select: Locator, text: string) {
  const option = select.locator('option').filter({ hasText: text })
  await expect(option).toHaveCount(1)
  const value = await option.getAttribute('value')
  if (!value) throw new Error(`Option containing "${text}" has no value.`)
  await select.selectOption(value)
}

function taskStatus(page: Page, label: string) {
  return page.locator('.task-header').getByLabel(`状态：${label}`)
}

async function taskDetail(page: Page, taskId: string) {
  return page.evaluate(async (taskId) => {
    const response = await fetch(`/api/agent-tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${window.localStorage.getItem('lyle-token')}` },
    })
    if (!response.ok) throw new Error(`task detail: ${response.status} ${await response.text()}`)
    return response.json()
  }, taskId)
}
