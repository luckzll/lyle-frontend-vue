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
  await page.getByRole('menuitem', { name: /\/图片/ }).click()
  await page.getByLabel('选择图片').setInputFiles(imagePath)
  await expect(page.getByText(`v62-${suffix}.png`)).toBeVisible()

  await page.getByTestId('chat-input').fill('/文件')
  await page.getByRole('menuitem', { name: /^\/文件\s/ }).click()
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
  await expect(page.getByRole('button', { name: '添加附件' })).toBeVisible()
  await expect(page.getByText('拖拽图片或文件到这里', { exact: true })).toHaveCount(0)
  await expect(page.getByText('选择附件', { exact: true })).toHaveCount(0)
})

for (const width of [320, 390]) {
  test(`${width}px composer exposes attachments, model and context without overflowing or duplicating send`, async ({ page }) => {
    await mockChatApis(page, async () => false)
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')

    const attach = page.getByTestId('chat-attach-trigger')
    const model = page.getByTestId('chat-model-select')
    const context = page.getByTestId('chat-context-summary')
    const send = page.getByRole('button', { name: '发送消息' })
    await expect(attach).toBeVisible()
    await expect(attach).toBeEnabled()
    await expect(model).toBeVisible()
    await expect(context).toBeVisible()
    await expect(send).toHaveCount(1)
    await expect(send).toBeDisabled()
    await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
    await page.getByTestId('chat-input').fill('移动端消息')
    await expect(send).toBeEnabled()

    const bounds = await page.locator('.chat-composer').evaluate((element) => {
      const composer = element.getBoundingClientRect()
      return {
        left: composer.left,
        right: composer.right,
        controls: Array.from(element.querySelectorAll<HTMLElement>('[data-testid="chat-attach-trigger"], [data-testid="chat-model-select"], [data-testid="chat-context-summary"], [data-testid="chat-submit"]'))
          .map((control) => {
            const rect = control.getBoundingClientRect()
            return { left: rect.left, right: rect.right, width: rect.width, height: rect.height }
          }),
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth
      }
    })
    expect(bounds.pageOverflow).toBeLessThanOrEqual(1)
    expect(bounds.controls).toHaveLength(4)
    expect(bounds.controls.every((control) => control.width > 0 && control.height > 0 && control.left >= bounds.left && control.right <= bounds.right + 1)).toBe(true)
    await context.click()
    await expect(page.getByRole('dialog', { name: '当前上下文' })).toBeVisible()
    await expect(page.getByTestId('chat-input')).toHaveValue('移动端消息')
  })
}

test('attachment entry supports keyboard selection, Escape and outside dismissal without losing the draft', async ({ page }) => {
  let submitted = 0
  await mockChatApis(page, async (route, pathname) => {
    if (pathname === '/api/chat/stream') submitted += 1
    if (pathname === '/api/chat/attachments' && route.request().method() === 'POST') {
      return json(route, {
        id: 'keyboard-attachment', kind: 'file', name: 'keyboard.txt', mimeType: 'text/plain', size: 8,
        status: 'READY', sourceType: 'picker', downloadUrl: '/chat/attachments/keyboard-attachment/content?disposition=attachment'
      })
    }
    return false
  })
  await page.goto('/')

  const input = page.getByTestId('chat-input')
  const trigger = page.getByTestId('chat-attach-trigger')
  const menu = page.getByRole('menu', { name: '附件命令' })
  const draft = '请结合我接下来选择的文件，保留这段草稿。'
  await expect(trigger).toBeEnabled()
  await input.fill(draft)
  await trigger.press('Enter')
  await expect(menu).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const imageItem = menu.getByRole('menuitem', { name: /^图片\s/ })
  const fileItem = menu.getByRole('menuitem', { name: /^文件\s/ })
  await imageItem.focus()
  await page.keyboard.press('ArrowDown')
  await expect(fileItem).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(imageItem).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).not.toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()
  await expect(input).toHaveValue(draft)

  await trigger.click()
  await expect(menu).toBeVisible()
  await input.click()
  await expect(menu).not.toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue(draft)
  expect(submitted).toBe(0)

  await trigger.click()
  await expect(menu).toBeVisible()
  await page.getByRole('heading', { name: 'AI 聊天', exact: true }).click()
  await expect(menu).not.toBeVisible()
  await expect(input).toHaveValue(draft)

  await trigger.press('Enter')
  await imageItem.focus()
  await page.keyboard.press('ArrowDown')
  await expect(fileItem).toBeFocused()
  const chooserReady = page.waitForEvent('filechooser')
  await page.keyboard.press('Enter')
  const chooser = await chooserReady
  await chooser.setFiles({ name: 'keyboard.txt', mimeType: 'text/plain', buffer: Buffer.from('keyboard') })
  await expect(menu).not.toBeVisible()
  await expect(page.locator('.attachment-card').filter({ hasText: 'keyboard.txt' })).toContainText('已就绪')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue(draft)
  expect(submitted).toBe(0)

  await input.fill('/')
  await expect(menu).toBeVisible()
  await input.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: /^\/图片\s/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).not.toBeVisible()
  await expect(input).toBeFocused()
  expect(submitted).toBe(0)
})

test('short viewports keep Home and End menu targets visible without scrolling the page', async ({ page }) => {
  await mockChatApis(page, async (route, pathname) => {
    if (pathname === '/api/runtime-config') {
      return json(route, { authLoginV63Enabled: false, chatWorkspaceDropEnabled: true, chatFolderAttachmentsEnabled: true })
    }
    return false
  })
  await page.setViewportSize({ width: 1707, height: 360 })
  await page.goto('/')
  await page.getByTestId('chat-input').fill('保留小高度视窗中的草稿')
  const baseline = await page.locator('.chat-composer').evaluate((element) => ({
    pageScrollTop: element.closest<HTMLElement>('.page')!.scrollTop,
    documentScrollTop: document.scrollingElement?.scrollTop || 0
  }))
  await page.getByTestId('chat-attach-trigger').press('Enter')
  const menu = page.getByRole('menu', { name: '附件命令' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveCount(3)

  const visiblePosition = () => menu.evaluate((element) => {
    const focused = document.activeElement as HTMLElement
    const itemRect = focused.getBoundingClientRect()
    const menuRect = element.getBoundingClientRect()
    const chatPage = element.closest<HTMLElement>('.page')!
    const visibleTop = menuRect.top + element.clientTop
    return {
      focusInside: element.contains(focused),
      itemTop: itemRect.top,
      itemBottom: itemRect.bottom,
      visibleTop,
      visibleBottom: visibleTop + element.clientHeight,
      menuTop: menuRect.top,
      pageTop: chatPage.getBoundingClientRect().top,
      menuScrollTop: element.scrollTop,
      pageScrollTop: chatPage.scrollTop,
      documentScrollTop: document.scrollingElement?.scrollTop || 0
    }
  })
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: /^打开本地项目\s/ })).toBeFocused()
  const end = await visiblePosition()
  expect(end.menuScrollTop).toBeGreaterThan(0)
  await page.keyboard.press('Home')
  await expect(menu.getByRole('menuitem', { name: /^图片\s/ })).toBeFocused()
  const home = await visiblePosition()
  expect(home.menuScrollTop).toBeLessThan(end.menuScrollTop)

  for (const position of [end, home]) {
    expect(position.focusInside).toBe(true)
    expect(position.itemTop).toBeGreaterThanOrEqual(position.visibleTop - 1)
    expect(position.itemBottom).toBeLessThanOrEqual(position.visibleBottom + 1)
    expect(position.menuTop).toBeGreaterThanOrEqual(position.pageTop - 1)
    expect(Math.abs(position.pageScrollTop - baseline.pageScrollTop)).toBeLessThanOrEqual(1)
    expect(Math.abs(position.documentScrollTop - baseline.documentScrollTop)).toBeLessThanOrEqual(1)
  }
  await expect(page.getByTestId('chat-input')).toHaveValue('保留小高度视窗中的草稿')
})

test('composer preserves Shift+Enter and IME composition while ordinary Enter submits once', async ({ page }) => {
  const submitted: Array<Record<string, unknown>> = []
  await mockChatApis(page, async (route, pathname) => {
    if (pathname !== '/api/chat/stream') return false
    submitted.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'event: delta\ndata: {"text":"键盘输入已接收。"}\n\nevent: done\ndata: {}\n\n'
    })
  })
  await page.goto('/')
  const input = page.getByTestId('chat-input')
  await input.fill('第一行')
  await input.press('End')
  await input.press('Shift+Enter')
  await input.pressSequentially('第二行')
  await expect(input).toHaveValue('第一行\n第二行')
  expect(submitted).toHaveLength(0)

  const compositionPrevented = await input.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const composingEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    element.dispatchEvent(composingEnter)
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    const nativeComposingEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true })
    element.dispatchEvent(nativeComposingEnter)
    return [composingEnter.defaultPrevented, nativeComposingEnter.defaultPrevented]
  })
  expect(compositionPrevented).toEqual([false, false])
  await expect(input).toHaveValue('第一行\n第二行')
  await expect(page.getByTestId('chat-submit')).toBeEnabled()
  expect(submitted).toHaveLength(0)

  await input.press('Enter')
  await expect(page.getByText('键盘输入已接收。', { exact: true })).toBeVisible()
  expect(submitted).toHaveLength(1)
  expect(submitted[0].message).toBe('第一行\n第二行')
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
  await expect(page.getByText('松开即可添加文件', { exact: true })).toBeVisible()
  const overlay = await page.locator('.workspace-drop-overlay').boundingBox()
  const composerBounds = await page.locator('.chat-composer').boundingBox()
  expect(overlay).not.toBeNull()
  expect(composerBounds).not.toBeNull()
  expect(overlay!.width).toBeLessThanOrEqual(composerBounds!.width + 2)
  expect(overlay!.height).toBeLessThanOrEqual(composerBounds!.height + 2)
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
  await page.getByRole('menuitem', { name: /\/图片/ }).click()
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

test('project menu connects locally without uploading directory contents', async ({ page }) => {
  let uploads = 0
  await mockChatApis(page, async (route, pathname) => {
    if (pathname === '/api/chat/attachments' && route.request().method() === 'POST') uploads++
    return false
  })
  await page.goto('/')
  await page.getByTestId('chat-input').fill('/项目')
  await page.getByRole('menuitem', { name: /^\/项目\s/ }).click()
  await expect(page).toHaveURL(/\/local-project$/)
  await expect(page.getByRole('heading', { name: '项目工作区', exact: true })).toBeVisible()
  expect(uploads).toBe(0)
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
  await page.getByRole('menuitem', { name: /^\/文件\s/ }).click()
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

test('upload rollback disables file drop but preserves local project entry', async ({ page }) => {
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
  await expect(page.getByRole('menuitem', { name: /^\/项目\s/ })).toHaveCount(1)
  await page.getByTestId('chat-input').press('Escape')
  await page.getByTestId('chat-attach-trigger').click()
  await expect(page.getByRole('menu', { name: '附件命令' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /^打开本地项目\s/ })).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['x'], 'disabled.txt', { type: 'text/plain' }))
    document.querySelector('.chat-composer')?.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }))
  })
  await expect(page.getByText('释放以使用文件或文件夹', { exact: true })).toHaveCount(0)
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
  const tokenPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const handled = await custom(route, pathname)
    if (handled !== false) return
    if (pathname === '/api/auth/refresh') {
      return json(route, {
        user: { id: 'v62-user', username: 'V6.2 用户', role: 'USER' },
        accessToken: `header.${tokenPayload}.signature`,
        expiresInSeconds: 3600
      })
    }
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
