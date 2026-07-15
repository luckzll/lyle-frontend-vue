import { expect, test } from '@playwright/test'

test('user can create a todo directly from the task page', async ({ page }) => {
  const username = `manual_todo_${Date.now()}`
  const title = `手动待办-${Date.now()}`

  await page.goto('/login')
  await page.getByTestId('register-tab').click()
  await page.getByTestId('username-input').fill(username)
  await page.getByTestId('password-input').fill('123456')
  await page.getByTestId('auth-submit').click()
  await expect(page).toHaveURL('/dashboard')

  await page.getByRole('link', { name: '任务', exact: true }).click()
  await page.getByTestId('manual-todo-title').fill(title)
  await page.getByTestId('manual-todo-submit').click()

  await expect(page.getByText('待办已创建')).toBeVisible()
  await expect(page.locator('.task-row').filter({ hasText: title })).toBeVisible()
})
