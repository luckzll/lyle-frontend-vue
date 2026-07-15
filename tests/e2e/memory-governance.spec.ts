import { expect, test } from '@playwright/test'

test('shows confirmed low-confidence memory in governance center', async ({ page }) => {
  const suffix = Date.now()
  const username = `memory_e2e_${suffix}`
  const memoryValue = `极简风格-${suffix}`

  await page.goto('/login')
  await page.getByTestId('register-tab').click()
  await page.getByTestId('username-input').fill(username)
  await page.getByTestId('password-input').fill('123456')
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL('/dashboard')

  await page.getByRole('button', { name: '展开资料' }).click()
  await page.getByRole('link', { name: '记忆', exact: true }).click()
  await page.getByTestId('memory-governance-tab').click()
  await page.getByRole('button', { name: '高级模式', exact: true }).click()
  await page.getByTestId('memory-key-input').fill('preference')
  await page.getByTestId('memory-value-input').fill(memoryValue)
  await page.locator('input[type="number"]').fill('0.65')
  await page.getByTestId('memory-save-button').click()

  const lowConfidenceSection = page.getByTestId('low-confidence-memory-section')
  await expect(lowConfidenceSection).toContainText(memoryValue)
  await expect(lowConfidenceSection).toContainText('需要核对')
})
