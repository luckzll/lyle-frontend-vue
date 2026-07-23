import { expect, test } from '@playwright/test'

test('streamed explicit memory becomes a confirmable candidate with profile evidence', async ({ page }) => {
  test.setTimeout(120_000)
  const username = `memory_stream_${Date.now()}`
  const todoTitle = `进行中的验收任务-${Date.now()}`
  const operationTitle = `已拒绝的验收日历-${Date.now()}`

  await page.goto('/login')
  await page.getByTestId('register-tab').click()
  await page.getByTestId('username-input').fill(username)
  await page.getByTestId('password-input').fill('123456')
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL('/dashboard')
  await page.getByRole('link', { name: '聊天', exact: true }).click()

  await page.getByTestId('chat-input').fill('请记住：我不喜欢帽子。')
  await page.getByTestId('chat-submit').click()

  const assistant = page.locator('.message.assistant').last()
  const candidate = assistant.locator('.candidate-memory-card').filter({ hasText: '帽子' })
  await expect(candidate).toBeVisible({ timeout: 60_000 })
  await expect(candidate.locator('input').first()).toHaveValue('preferences.visual.dislikes')
  await expect(assistant).toContainText('确认后才会写入长期记忆')
  await expect(assistant).not.toContainText('已记住')
  await page.getByRole('button', { name: '上下文', exact: true }).click()
  await expect(page.getByRole('link', { name: '1 条记忆待确认' })).toBeVisible()

  await candidate.getByRole('button', { name: '确认', exact: true }).click()
  await expect(candidate).toHaveCount(0)
  await expect(page.getByRole('link', { name: /条记忆待确认/ })).toHaveCount(0)

  await page.getByRole('button', { name: '展开资料' }).click()
  await page.getByRole('link', { name: '记忆', exact: true }).click()
  const profile = page.locator('.memory-list-item').filter({ hasText: '视觉负向偏好' })
  await expect(profile).toContainText('帽子')
  await expect(profile).toContainText('证据 1')
  await profile.click()
  await page.getByRole('button', { name: '高级模式', exact: true }).click()
  await page.getByRole('button', { name: '技术详情', exact: true }).click()
  await expect(page.locator('.memory-row').filter({ hasText: '帽子' }).first()).toBeVisible()
  await page.getByRole('button', { name: '证据来源', exact: true }).click()
  await expect(page.locator('.memory-row').filter({ hasText: '帽子' }).first()).toContainText('conversation:')

  await page.getByRole('link', { name: '任务', exact: true }).click()
  await page.getByTestId('manual-todo-title').fill(todoTitle)
  await page.getByTestId('manual-todo-submit').click()
  await expect(page.locator('.task-row').filter({ hasText: todoTitle })).toBeVisible()

  await page.getByRole('link', { name: '聊天', exact: true }).click()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByTestId('chat-input').fill(`创建日历：明天下午三点${operationTitle}`)
  await page.getByTestId('chat-submit').click()
  const rejectButton = page.getByTestId('chat-operation-reject').first()
  await expect(rejectButton).toBeVisible()
  await rejectButton.click()

  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.getByTestId('chat-input').fill('你记得我什么？')
  await page.getByTestId('chat-submit').click()
  const recalledAnswer = page.locator('.message.assistant').last()
  await expect(recalledAnswer).toContainText('帽子')
  await expect(recalledAnswer).toContainText('已确认记忆')
  await expect(recalledAnswer).toContainText(`${todoTitle}（进行中）`)
  await expect(recalledAnswer).toContainText('创建日程')
  await expect(recalledAnswer).toContainText('已拒绝，未执行')
  await expect(recalledAnswer).not.toContainText('确认后才会正式生效')
  await expect(recalledAnswer).not.toContainText('已治理记忆')
  await expect(recalledAnswer).not.toContainText('质量检查拦截')
})
