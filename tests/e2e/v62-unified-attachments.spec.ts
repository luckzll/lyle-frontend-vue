import { expect, test, type Page, type Route } from '@playwright/test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await installAuthenticatedSession(page)
})

test('unified composer uploads images and files, then submits only attachment ids', async ({ page }) => {
  const suffix = Date.now()
  const imagePath = join(tmpdir(), `v62-${suffix}.png`)
  const filePath = join(tmpdir(), `v62-${suffix}.pdf`)
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  await writeFile(filePath, Buffer.from('%PDF-1.4\n'))

  let uploadIndex = 0
  let submitted: Record<string, unknown> = {}
  await mockChatApis(page, async (route, pathname) => {
    if (pathname === '/api/chat/attachments' && route.request().method() === 'POST') {
      uploadIndex += 1
      const image = uploadIndex === 1
      return json(route, {
        id: `attachment-${uploadIndex}`,
        kind: image ? 'image' : 'file',
        name: image ? `v62-${suffix}.png` : `v62-${suffix}.pdf`,
        mimeType: image ? 'image/png' : 'application/pdf',
        size: 8,
        status: 'READY',
        previewUrl: image ? `/chat/attachments/attachment-${uploadIndex}/content?disposition=inline` : null,
        downloadUrl: `/chat/attachments/attachment-${uploadIndex}/content?disposition=attachment`
      })
    }
    if (pathname === '/api/chat/stream') {
      submitted = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          'event: turn.status\ndata: {"turnId":"turn-v62","phase":"RESPONDING","message":"正在回复…"}\n\n',
          'event: delta\ndata: {"text":"已结合两个附件。"}\n\n',
          'event: turn.status\ndata: {"turnId":"turn-v62","phase":"COMPLETED","message":"回复完成"}\n\n',
          'event: done\ndata: {"turnId":"turn-v62"}\n\n'
        ].join('')
      })
    }
    return false
  })

  await page.goto('/')
  await page.getByRole('button', { name: '添加附件' }).click()
  await page.getByLabel('上传图片').setInputFiles(imagePath)
  await expect(page.getByText(`v62-${suffix}.png`)).toBeVisible()

  await page.getByRole('button', { name: '添加附件' }).click()
  await page.getByLabel('上传文件').setInputFiles(filePath)
  await expect(page.getByText(`v62-${suffix}.pdf`)).toBeVisible()
  await expect(page.locator('.attachment-card').filter({ hasText: '已就绪' })).toHaveCount(2)

  await page.getByTestId('chat-input').fill('请结合图片和文件给出结论')
  await page.getByTestId('chat-submit').click()

  await expect(page.getByText('已结合两个附件。')).toBeVisible()
  expect(submitted.message).toBe('请结合图片和文件给出结论')
  expect(submitted.attachmentIds).toEqual(['attachment-1', 'attachment-2'])
  expect(String(submitted.message)).not.toContain('http')
  await expect(page.locator('.sr-announcement')).toHaveText('2 个附件已随消息发送。')
  await expect(page.getByText('再次发送')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '添加附件' })).toBeVisible()
  await expect(page.getByText('拖拽图片或文件到这里', { exact: true })).toHaveCount(0)
  await expect(page.getByText('选择附件', { exact: true })).toHaveCount(0)
})

test('390px composer has no horizontal overflow and keeps the single primary action', async ({ page }) => {
  await mockChatApis(page, async () => false)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const attachmentButton = page.getByRole('button', { name: '添加附件' })
  await expect(attachmentButton).toBeVisible()
  expect((await attachmentButton.boundingBox())?.width).toBeGreaterThanOrEqual(44)
  expect((await attachmentButton.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await expect(page.getByText('拖拽图片或文件到这里', { exact: true })).toHaveCount(0)
  await expect(page.getByText('选择附件', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '发送消息' })).toBeDisabled()
  await page.getByTestId('chat-input').fill('移动端消息')
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('drop and paste share the attachment queue and preserve the text draft', async ({ page }) => {
  let uploadIndex = 0
  await mockChatApis(page, async (route, pathname) => {
    if (pathname !== '/api/chat/attachments') return false
    uploadIndex += 1
    return json(route, {
      id: `drop-paste-${uploadIndex}`,
      kind: 'image',
      name: `image-${uploadIndex}.png`,
      mimeType: 'image/png',
      size: 8,
      status: 'READY',
      previewUrl: `/chat/attachments/drop-paste-${uploadIndex}/content?disposition=inline`,
      downloadUrl: `/chat/attachments/drop-paste-${uploadIndex}/content?disposition=attachment`
    })
  })
  await page.goto('/')
  await page.getByTestId('chat-input').fill('不要丢失这段草稿')

  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array([1])], 'drop-1.png', { type: 'image/png' }))
    transfer.items.add(new File([new Uint8Array([2])], 'drop-2.png', { type: 'image/png' }))
    const composer = document.querySelector('.chat-composer')
    composer?.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }))
  })
  await expect(page.getByText('将附件放到这里', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array([1])], 'drop-1.png', { type: 'image/png' }))
    transfer.items.add(new File([new Uint8Array([2])], 'drop-2.png', { type: 'image/png' }))
    const composer = document.querySelector('.chat-composer')
    composer?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.locator('.attachment-card')).toHaveCount(2)

  await page.getByTestId('chat-input').evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array([3])], 'paste.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
  })
  await expect(page.locator('.attachment-card').filter({ hasText: '已就绪' })).toHaveCount(3)
  await expect(page.getByTestId('chat-input')).toHaveValue('不要丢失这段草稿')
  await page.locator('.attachment-card').filter({ hasText: 'drop-2.png' }).getByRole('button', { name: /移除/ }).click()
  await expect(page.locator('.attachment-card')).toHaveCount(2)
})

test('retry reuses the failed turn and its attachments without duplicating the user message', async ({ page }) => {
  const suffix = Date.now()
  const imageName = `retry-${suffix}.png`
  const imagePath = join(tmpdir(), imageName)
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  let uploadCount = 0
  const streamPayloads: Array<Record<string, unknown>> = []

  await mockChatApis(page, async (route, pathname) => {
    if (pathname === '/api/chat/attachments' && route.request().method() === 'POST') {
      uploadCount += 1
      return json(route, {
        id: 'retry-attachment-1',
        kind: 'image',
        name: imageName,
        mimeType: 'image/png',
        size: 8,
        status: 'READY',
        previewUrl: '/chat/attachments/retry-attachment-1/content?disposition=inline',
        downloadUrl: '/chat/attachments/retry-attachment-1/content?disposition=attachment'
      })
    }
    if (pathname === '/api/chat/stream') {
      const payload = route.request().postDataJSON() as Record<string, unknown>
      streamPayloads.push(payload)
      const turnId = String(payload.turnId)
      if (streamPayloads.length === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `event: turn.status\ndata: {"turnId":"${turnId}","phase":"FAILED","message":"附件处理失败"}\n\nevent: done\ndata: {"turnId":"${turnId}"}\n\n`
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: delta\ndata: {"text":"重试成功，附件仍在。"}\n\nevent: turn.status\ndata: {"turnId":"${turnId}","phase":"COMPLETED","message":"回复完成"}\n\nevent: done\ndata: {"turnId":"${turnId}"}\n\n`
      })
    }
    return false
  })

  await page.goto('/')
  await page.getByRole('button', { name: '添加附件' }).click()
  await page.getByLabel('上传图片').setInputFiles(imagePath)
  await expect(page.locator('.attachment-card').filter({ hasText: '已就绪' })).toHaveCount(1)
  await page.getByTestId('chat-input').fill('需要重试的附件消息')
  await page.getByTestId('chat-submit').click()
  await page.getByRole('button', { name: '重试', exact: true }).click()

  await expect(page.getByText('重试成功，附件仍在。')).toBeVisible()
  await expect(page.getByText('需要重试的附件消息', { exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: imageName, exact: true })).toHaveCount(1)
  expect(uploadCount).toBe(1)
  expect(streamPayloads).toHaveLength(2)
  expect(streamPayloads[1].turnId).toBe(streamPayloads[0].turnId)
  expect(streamPayloads[1].attachmentIds).toEqual(['retry-attachment-1'])
  expect(streamPayloads[1].retry).toBe(true)
})

async function installAuthenticatedSession(page: Page) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await page.addInitScript(({ token }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify({ id: 'v62-user', username: 'V6.2 用户', role: 'USER' }))
  }, { token: `header.${payload}.signature` })
}

async function mockChatApis(
  page: Page,
  custom: (route: Route, pathname: string) => Promise<boolean | void>
) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const handled = await custom(route, pathname)
    if (handled !== false) return
    if (pathname === '/api/conversations' && route.request().method() === 'POST') {
      return json(route, { id: '100', title: 'V6.2 会话', createdAt: '2026-07-21T00:00:00Z', updatedAt: '2026-07-21T00:00:00Z' })
    }
    if (pathname === '/api/conversations' || pathname === '/api/knowledge-bases') return json(route, [])
    if (pathname === '/api/agent-tools/todos' || pathname === '/api/agent-tools/reminders' || pathname === '/api/agent-tools/operations') return json(route, { items: [] })
    if (pathname === '/api/memory/current') return json(route, { summary: '', short_term: [], structured: [], structured_all: [], profiles: [], fragments: [], semantic: [], vector: [], retrieved: [] })
    if (pathname.startsWith('/api/chat/attachments/') && pathname.endsWith('/content')) return route.fulfill({ status: 200, body: 'attachment' })
    if (pathname === '/api/chat/stream') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: done\ndata: {}\n\n' })
    return json(route, {})
  })
}

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}
