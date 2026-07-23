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
  await page.getByTestId('chat-input').fill('/图片')
  await page.getByRole('option', { name: /\/图片/ }).click()
  await page.getByLabel('选择图片').setInputFiles(imagePath)
  await expect(page.getByText(`v62-${suffix}.png`)).toBeVisible()

  await page.getByTestId('chat-input').fill('/文件')
  await page.getByRole('option', { name: /^\/文件\s/ }).click()
  await page.getByLabel('选择文件', { exact: true }).setInputFiles(filePath)
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
  await expect(page.getByRole('button', { name: '添加附件' })).toHaveCount(0)
  await expect(page.getByText('拖拽图片或文件到这里', { exact: true })).toHaveCount(0)
  await expect(page.getByText('选择附件', { exact: true })).toHaveCount(0)
})

test('390px composer has no horizontal overflow and keeps the single primary action', async ({ page }) => {
  await mockChatApis(page, async () => false)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expect(page.getByRole('button', { name: '添加附件' })).toHaveCount(0)
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
    const files = [
      new File([new Uint8Array([1])], 'drop-1.png', { type: 'image/png' }),
      new File([new Uint8Array([2])], 'drop-2.png', { type: 'image/png' })
    ]
    const transfer = {
      types: ['Files'],
      files,
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file }))
    }
    const composer = document.querySelector('.chat-composer')
    const event = new Event('dragenter', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    composer?.dispatchEvent(event)
  })
  await expect(page.getByText('释放以添加到对话', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const files = [
      new File([new Uint8Array([1])], 'drop-1.png', { type: 'image/png' }),
      new File([new Uint8Array([2])], 'drop-2.png', { type: 'image/png' })
    ]
    const transfer = {
      types: ['Files'],
      files,
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file }))
    }
    const composer = document.querySelector('.chat-composer')
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    composer?.dispatchEvent(event)
  })
  await expect(page.locator('.attachment-card')).toHaveCount(2)

  await page.getByTestId('chat-input').evaluate((element) => {
    const files = [new File([new Uint8Array([3])], 'paste.png', { type: 'image/png' })]
    const transfer = {
      types: ['Files'],
      files,
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file }))
    }
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: transfer })
    element.dispatchEvent(event)
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
  await page.getByTestId('chat-input').fill('/图片')
  await page.getByRole('option', { name: /\/图片/ }).click()
  await page.getByLabel('选择图片').setInputFiles(imagePath)
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

test('folder picker uploads stable relative paths and renders a grouped draft', async ({ page }) => {
  const multipartBodies: string[] = []
  let uploadIndex = 0
  await mockChatApis(page, async (route, pathname) => {
    if (pathname !== '/api/chat/attachments' || route.request().method() !== 'POST') return false
    uploadIndex += 1
    multipartBodies.push(route.request().postData() || '')
    const name = uploadIndex === 1 ? '2.txt' : '10.txt'
    return json(route, {
      id: `folder-${uploadIndex}`,
      kind: 'file',
      name,
      mimeType: 'text/plain',
      size: 1,
      status: 'READY',
      sourceType: 'folder_picker',
      folderGroupId: 'server-group',
      folderRoot: '资料',
      relativePath: `资料/${name}`,
      downloadUrl: `/chat/attachments/folder-${uploadIndex}/content?disposition=attachment`
    })
  })

  await page.goto('/')
  await page.getByTestId('chat-input').fill('/文件夹')
  await page.getByRole('option', { name: /^\/文件夹\s/ }).click()
  await page.getByLabel('选择文件夹').evaluate((element) => {
    const ten = new File(['a'], '10.txt', { type: 'text/plain' })
    const two = new File(['b'], '2.txt', { type: 'text/plain' })
    Object.defineProperty(ten, 'webkitRelativePath', { value: '资料/10.txt' })
    Object.defineProperty(two, 'webkitRelativePath', { value: '资料/2.txt' })
    Object.defineProperty(element, 'files', { configurable: true, value: [ten, two] })
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })

  await expect(page.locator('.folder-attachment-group')).toContainText('资料')
  await expect(page.locator('.folder-attachment-group .attachment-card')).toHaveCount(2)
  await expect(page.locator('.folder-attachment-group .attachment-card').nth(0)).toContainText('2.txt')
  await expect(page.locator('.folder-attachment-group .attachment-card').nth(1)).toContainText('10.txt')
  expect(multipartBodies).toHaveLength(2)
  expect(multipartBodies.every((body) => body.includes('folder_picker') && body.includes('资料/'))).toBe(true)
  expect(multipartBodies.some((body) => body.includes('/Users/') || body.includes('C:\\'))).toBe(false)
})

test('nested folder drop preserves top-level file and folder delivery order', async ({ page }) => {
  const multipartBodies: string[] = []
  await mockChatApis(page, async (route, pathname) => {
    if (pathname !== '/api/chat/attachments' || route.request().method() !== 'POST') return false
    const body = route.request().postData() || ''
    multipartBodies.push(body)
    const name = ['before.txt', '2.txt', '10.txt', 'after.txt'].find((candidate) => body.includes(`filename="${candidate}"`)) || 'unknown.txt'
    return json(route, {
      id: `nested-${name}`,
      kind: 'file',
      name,
      mimeType: 'text/plain',
      size: 1,
      status: 'READY',
      downloadUrl: `/chat/attachments/nested-${name}/content?disposition=attachment`
    })
  })

  await page.goto('/')
  await expect(page.getByTestId('chat-input')).toBeVisible()
  await page.evaluate(() => {
    type Entry = {
      isFile: boolean
      isDirectory: boolean
      name: string
      file?: (success: (file: File) => void) => void
      createReader?: () => { readEntries: (success: (entries: Entry[]) => void) => void }
    }
    const file = (name: string): Entry => ({
      isFile: true,
      isDirectory: false,
      name,
      file: (success) => success(new File([name], name, { type: 'text/plain' }))
    })
    const directory = (name: string, children: Entry[]): Entry => ({
      isFile: false,
      isDirectory: true,
      name,
      createReader: () => {
        let complete = false
        return { readEntries: (success) => { success(complete ? [] : children); complete = true } }
      }
    })
    const root = directory('资料', [directory('一级', [file('10.txt'), file('2.txt')])])
    const entries = [file('before.txt'), root, file('after.txt')]
    const dataTransfer = {
      types: ['Files'],
      files: [],
      items: entries.map((entry) => ({ kind: 'file', getAsEntry: () => entry, getAsFile: () => null }))
    }
    const dispatch = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      document.querySelector('.chat-composer')?.dispatchEvent(event)
      return event.defaultPrevented
    }
    dispatch('dragenter')
    dispatch('drop')
  })

  await expect(page.locator('.attachment-card').filter({ hasText: '已就绪' })).toHaveCount(4)
  await expect(page.locator('.folder-attachment-group')).toContainText('资料')
  await expect(page.locator('.folder-attachment-group .attachment-card').nth(0)).toContainText('2.txt')
  await expect(page.locator('.folder-attachment-group .attachment-card').nth(1)).toContainText('10.txt')
  const topLevelText = await page.locator('.attachment-tray').locator(':scope > *').allTextContents()
  expect(topLevelText[0]).toContain('before.txt')
  expect(topLevelText[1]).toContain('资料')
  expect(topLevelText[2]).toContain('after.txt')
  expect(multipartBodies.some((body) => body.includes('资料/一级/2.txt'))).toBe(true)
  expect(multipartBodies.some((body) => body.includes('资料/一级/10.txt'))).toBe(true)
})

test('sent attachment metadata is restored from history after refresh', async ({ page }) => {
  const suffix = Date.now()
  const attachmentName = `refresh-${suffix}.txt`
  const attachmentPath = join(tmpdir(), attachmentName)
  await writeFile(attachmentPath, 'refresh-safe')
  let sent = false

  await page.addInitScript(() => {
    if (!sessionStorage.getItem('v63-refresh-started')) {
      localStorage.setItem('lyle.chat.active-conversation', '__new_conversation__')
      sessionStorage.setItem('v63-refresh-started', '1')
    }
  })
  await mockChatApis(page, async (route, pathname) => {
    if (pathname === '/api/conversations' && route.request().method() === 'GET') {
      return json(route, sent ? [{ id: '100', title: '刷新恢复', createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z' }] : [])
    }
    if (pathname === '/api/chat/attachments' && route.request().method() === 'POST') {
      return json(route, {
        id: 'refresh-attachment-1', kind: 'file', name: attachmentName, mimeType: 'text/plain', size: 12,
        status: 'READY', sourceType: 'picker', downloadUrl: '/chat/attachments/refresh-attachment-1/content?disposition=attachment'
      })
    }
    if (pathname === '/api/chat/stream') {
      sent = true
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: delta\ndata: {"text":"附件已经保存。"}\n\nevent: turn.status\ndata: {"turnId":"turn-refresh","phase":"COMPLETED","message":"回复完成"}\n\nevent: done\ndata: {"turnId":"turn-refresh"}\n\n'
      })
    }
    if (pathname === '/api/chat/messages/100') {
      return json(route, sent ? [
        {
          id: 'message-user', conversationId: '100', role: 'user', content: '刷新后继续显示', createdAt: '2026-07-22T00:00:00Z',
          attachments: [{
            id: 'refresh-attachment-1', kind: 'file', name: attachmentName, mimeType: 'text/plain', size: 12,
            status: 'READY', sourceType: 'picker', position: 0,
            downloadUrl: '/chat/attachments/refresh-attachment-1/content?disposition=attachment'
          }]
        },
        { id: 'message-assistant', conversationId: '100', role: 'assistant', content: '附件已经保存。', createdAt: '2026-07-22T00:00:01Z' }
      ] : [])
    }
    return false
  })

  await page.goto('/')
  await page.getByTestId('chat-input').fill('/文件')
  await page.getByRole('option', { name: /^\/文件\s/ }).click()
  await page.getByLabel('选择文件', { exact: true }).setInputFiles(attachmentPath)
  await expect(page.locator('.attachment-card').filter({ hasText: '已就绪' })).toHaveCount(1)
  await page.getByTestId('chat-input').fill('刷新后继续显示')
  await page.getByTestId('chat-submit').click()
  await expect(page.getByText('附件已经保存。')).toBeVisible()

  await page.reload()
  await expect(page.getByText('刷新后继续显示', { exact: true })).toBeVisible()
  await expect(page.locator('.message-attachment').filter({ hasText: attachmentName })).toBeVisible()
  await expect(page.getByText('附件已经保存。', { exact: true })).toBeVisible()
})

test('runtime rollback switches disable workspace drop and folder attachment entry', async ({ page }) => {
  await mockChatApis(page, async (route, pathname) => {
    if (pathname !== '/api/runtime-config') return false
    return json(route, {
      authLoginV63Enabled: true,
      chatWorkspaceDropEnabled: false,
      chatFolderAttachmentsEnabled: false
    })
  })

  await page.goto('/')
  await page.getByTestId('chat-input').fill('/')
  await expect(page.getByRole('option', { name: /^\/文件夹\s/ })).toHaveCount(0)
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['x'], 'disabled.txt', { type: 'text/plain' }))
    document.querySelector('.chat-composer')?.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }))
  })
  await expect(page.getByText('释放以添加到对话', { exact: true })).toHaveCount(0)
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
