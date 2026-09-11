import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test.skip(process.env.V6_3_REAL_E2E !== '1', 'requires the V6.3 real backend stack')

test('registers, uploads knowledge, debugs RAG, and chats with sources', async ({ page }) => {
  test.setTimeout(120_000)
  const suffix = Date.now()
  const username = `e2e_${suffix}`
  const knowledgeName = `E2E 知识库 ${suffix}`
  const filePath = join(tmpdir(), `lyle-e2e-${suffix}.txt`)
  const answerText = `紫藤花-${suffix}`

  await writeFile(filePath, `E2E 文档：答案是${answerText}。\n`, 'utf-8')

  await page.goto('/login')
  await page.getByTestId('register-tab').click()
  await page.getByTestId('username-input').fill(username)
  await page.getByTestId('password-input').fill('123456')
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL('/dashboard')

  await page.getByRole('button', { name: '展开资料' }).click()
  await page.getByRole('link', { name: '知识库' }).click()
  const createKnowledge = page.getByRole('region', { name: '知识库空状态' }).getByRole('button', { name: '新建知识库' })
  const createKnowledgeDialog = page.getByRole('dialog', { name: '新建知识库', exact: true })
  await createKnowledge.click()
  await expect(createKnowledgeDialog).toBeVisible()
  await expect(createKnowledgeDialog.getByTestId('knowledge-name-input')).toBeFocused()
  await createKnowledgeDialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(createKnowledgeDialog).toHaveCount(0)
  await expect(createKnowledge).toBeFocused()
  await expect(page.getByTestId('knowledge-name-input')).toHaveCount(0)
  await createKnowledge.click()
  await expect(createKnowledgeDialog).toBeVisible()
  await expect(createKnowledgeDialog.getByTestId('knowledge-name-input')).toBeFocused()
  await createKnowledgeDialog.getByTestId('knowledge-name-input').fill(knowledgeName)
  await createKnowledgeDialog.getByTestId('create-knowledge-button').click()
  await expect(createKnowledgeDialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: new RegExp(knowledgeName) })).toBeVisible()

  await page.getByTestId('knowledge-file-input').setInputFiles(filePath)
  await expect(page.getByText('文件已上传并完成入库。')).toBeVisible()
  await expect(page.locator('.file-row').filter({ hasText: `lyle-e2e-${suffix}.txt` })).toBeVisible()

  const retrievalToggle = page.locator('.retrieval-test').getByRole('button', { name: /检索测试/ })
  await expect(retrievalToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('rag-question-input')).toHaveCount(0)
  await retrievalToggle.click()
  await expect(retrievalToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('rag-question-input')).toBeVisible()
  await page.getByTestId('rag-question-input').fill('答案是什么？')
  await page.getByTestId('rag-debug-button').click()
  await expect(page.getByText(answerText)).toBeVisible()

  await page.getByRole('link', { name: '聊天' }).click()
  await page.getByRole('button', { name: '上下文', exact: true }).click()
  await page.getByTestId('chat-knowledge-select').selectOption({ label: knowledgeName })
  const chatQuestion = '请根据知识库回答：答案是什么？'
  await page.getByTestId('chat-input').fill(chatQuestion)
  await page.getByTestId('chat-submit').click()

  await expect(page.locator('.source-card').filter({ hasText: answerText })).toBeVisible({ timeout: 60_000 })

  await page.getByRole('link', { name: '记忆', exact: true }).click()
  const conversationTitle = chatQuestion.length > 18 ? `${chatQuestion.slice(0, 18)}...` : chatQuestion
  await page.getByTestId('memory-conversation-select').selectOption({ label: conversationTitle })
  await expect(page.locator('[data-testid="short-term-memory-row"]').filter({ hasText: chatQuestion })).toBeVisible()
})
