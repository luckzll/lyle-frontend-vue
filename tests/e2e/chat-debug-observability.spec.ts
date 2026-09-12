import { expect, test, type Locator, type Page, type Route } from '@playwright/test'

const NOW = '2026-09-04T08:00:00.000Z'

test.beforeEach(async ({ page }) => {
  await installAuthenticatedSession(page)
  await mockApis(page)
})

test('complete historical debug evidence survives refresh and stays behind debug mode', async ({ page }) => {
  await page.setViewportSize({ width: 1707, height: 932 })
  await page.goto('/?debug=1&conversationId=debug-complete')

  const ledger = page.getByTestId('chat-debug-ledger')
  await expect(ledger).toBeVisible()
  await expect(ledger).toHaveAttribute('data-debug-state', 'available')
  await expect(ledger.getByText('数据完整')).toBeVisible()
  await expandLedger(ledger)
  await expect(ledger.getByLabel('本轮执行路径')).toContainText('路由')
  await expect(ledger.getByLabel('本轮执行路径')).toContainText('知识库')

  const memory = page.getByTestId('debug-memory-section')
  await expect(memory).toContainText('当前项目')
  await expect(memory).toContainText('Lyle 知识库验收')
  await expect(memory).toContainText('Qdrant 候选 2 条')
  await expect(memory).toContainText('Milvus 候选 1 条')
  await memory.locator('.debug-recall-disclosure').click()
  await expect(memory).toContainText('长期摘要')
  await expect(memory).toContainText('短期记忆 · 用户')
  await expect(memory).toContainText('结构化记忆')
  await expect(memory).toContainText('向量召回片段')

  const rag = page.getByTestId('debug-rag-section')
  await expect(rag).toContainText('大模型知识库（kb-llm）')
  await expect(rag).toContainText('已执行，命中 1 个片段')
  await expect(rag).toContainText('检索 Query')
  await expect(rag).toContainText('Build Recall 长期记忆')
  await expect(rag).toContainText('大模型知识原理.docx')
  await rag.locator('.debug-source-card').click()
  await expect(rag).toContainText('Build 负责记忆构建，Recall 负责检索召回。')

  const tools = page.getByTestId('debug-tools-section')
  await expect(tools).toContainText('memory_snapshot')
  await expect(tools).toContainText('已读取记忆快照。')
  await expect(tools).toContainText('成功')

  const agents = page.getByTestId('debug-agent-section')
  await expect(agents).toContainText('理解与分流')
  await expect(agents).toContainText('记忆召回')
  await expect(agents).toContainText('知识库检索')
  await expect(agents).toContainText('生成回答')
  await expect(agents.locator('.debug-flow-step[data-agent="project_resolver"] > summary')).toContainText('未匹配')
  await expect(agents.locator('.debug-flow-step[data-agent="memory_agent"]').last()).toContainText('记忆整理')
  await agents.locator('.debug-flow-step[data-agent="project_resolver"] > summary').click()
  await expect(agents.locator('.debug-flow-step[data-agent="project_resolver"] p').filter({ hasText: '判断当前问题属于哪个项目' })).toBeVisible()
  await expect(agents).not.toContainText('已记录执行状态')

  await expect(page.getByTestId('debug-memory-summary')).toHaveText('注入 1 条 · 候选 4 条 · 排除 1 条')
  await expect(page.getByTestId('debug-rag-summary')).toHaveText('命中 1 个片段')
  await expect(page.getByTestId('debug-tools-summary')).toHaveText('调用 1 次')
  await expect(page.getByTestId('debug-agent-summary')).toHaveText('7 个节点')

  const assistantContent = page.locator('.message.assistant > .message-bubble.markdown').first()
  const composer = page.locator('.chat-input')
  const [assistantBox, composerBox, ledgerBox] = await Promise.all([
    assistantContent.boundingBox(),
    composer.boundingBox(),
    ledger.boundingBox()
  ])
  expect(assistantBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  expect(ledgerBox).not.toBeNull()
  expect(Math.abs((assistantBox?.x || 0) - (composerBox?.x || 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((assistantBox?.width || 0) - (composerBox?.width || 0))).toBeLessThanOrEqual(1)
  expect(assistantBox?.width).toBeCloseTo(920, 0)
  expect(ledgerBox?.width).toBeCloseTo(920, 0)
  expect(Math.abs(
    ((assistantBox?.x || 0) - (ledgerBox?.x || 0))
      - (((ledgerBox?.width || 0) - (assistantBox?.width || 0)) / 2)
  )).toBeLessThanOrEqual(1)
  const debugChildOffsets = await page.locator('.message.debug-message > :not(.debug-panel)').evaluateAll((elements) => {
    const content = document.querySelector<HTMLElement>('.message.debug-message > .message-bubble')
    const contentX = content?.getBoundingClientRect().x || 0
    return elements.map((element) => Math.abs(element.getBoundingClientRect().x - contentX))
  })
  expect(debugChildOffsets.every((offset) => offset <= 1)).toBe(true)
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - window.innerWidth,
    tables: Array.from(document.querySelectorAll<HTMLElement>('.debug-data-table, .debug-agent-table'))
      .map((table) => table.scrollWidth - table.clientWidth)
  }))
  expect(overflow.page).toBeLessThanOrEqual(1)
  expect(overflow.tables.every((value) => value <= 1)).toBe(true)

  await page.getByRole('button', { name: '上下文', exact: true }).click()
  const withContext = await responsiveMetrics(page)
  expect(Math.abs(withContext.ledgerX - withContext.composerX)).toBeLessThanOrEqual(1)
  expect(Math.abs(withContext.ledgerWidth - withContext.composerWidth)).toBeLessThanOrEqual(1)

  await page.reload()
  await expandLedger(page.getByTestId('chat-debug-ledger'))
  await expect(page.getByTestId('debug-memory-section')).toContainText('向量召回片段')
  await expect(page.getByTestId('debug-rag-section')).toContainText('大模型知识原理.docx')
  await expect(page.getByTestId('debug-tools-section')).toContainText('memory_snapshot')

  await page.goto('/?conversationId=debug-complete')
  await expect(page.getByTestId('chat-debug-ledger')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /使用了 1 条记忆/ })).toBeVisible()
  const sourceDisclosure = page.getByTestId('chat-sources')
  await expect(sourceDisclosure).not.toHaveAttribute('open', '')
  await expect(sourceDisclosure).toContainText('1 份文档 · 1 个片段')
  await sourceDisclosure.locator(':scope > summary').press('Enter')
  await expect(page.getByTestId('chat-source-document')).toHaveCount(1)
  const fragment = page.getByTestId('chat-source-fragment')
  await fragment.locator('summary').press('Enter')
  await expect(fragment.locator('.chat-source-full-text')).toHaveText('Build 负责记忆构建，Recall 负责检索召回。')
  await sourceDisclosure.locator(':scope > summary').press('Enter')
  await expect(fragment).not.toBeVisible()
})

test('debug ledger distinguishes an executed zero result from legacy missing data', async ({ page }) => {
  await page.goto('/?debug=1&conversationId=debug-zero')

  await expect(page.getByTestId('chat-debug-ledger')).toHaveAttribute('data-debug-state', 'available')
  await expect(page.getByTestId('chat-debug-ledger').getByText('数据完整')).toBeVisible()
  await expandLedger(page.getByTestId('chat-debug-ledger'))
  await expect(page.getByTestId('debug-memory-summary')).toHaveText('注入 0 条 · 候选 0 条 · 排除 0 条')
  await expect(page.getByTestId('debug-rag-summary')).toHaveText('命中 0 个片段')
  await expect(page.getByTestId('debug-tools-summary')).toHaveText('本轮未调用')
  await expect(page.getByTestId('debug-rag-section')).toContainText('已执行，但命中 0 个片段')
  await expect(page.getByTestId('debug-rag-section')).toContainText('检索已执行，但返回 0 个知识片段')
  await expect(page.getByTestId('debug-tools-section')).toContainText('本轮没有调用任何工具')

  await page.goto('/?debug=1&conversationId=debug-legacy')
  const legacyLedger = page.getByTestId('chat-debug-ledger')
  await expect(legacyLedger).toHaveAttribute('data-debug-state', 'legacy')
  await expect(legacyLedger.getByText('历史明细缺失')).toBeVisible()
  await expandLedger(legacyLedger)
  await expect(legacyLedger).toContainText('无法判断当时是未调用还是数据未记录')
  await expect(legacyLedger.getByTestId('debug-data-notice')).toHaveCount(1)
  await expect(legacyLedger.getByLabel('本轮执行路径').getByText('未记录', { exact: true })).toHaveCount(5)
  for (const testId of ['debug-memory-summary', 'debug-rag-summary', 'debug-tools-summary', 'debug-agent-summary']) {
    await expect(page.getByTestId(testId)).toHaveText('未记录')
  }
  for (const sectionId of ['debug-memory-section', 'debug-rag-section', 'debug-tools-section', 'debug-agent-section']) {
    await expect(page.getByTestId(sectionId).locator('.debug-empty')).toHaveText('未记录')
  }
  await expect(legacyLedger).not.toContainText('注入 0 条')
  await expect(legacyLedger).not.toContainText('本轮未调用')

  await page.goto('/?debug=1&conversationId=debug-unsupported')
  const unsupportedLedger = page.getByTestId('chat-debug-ledger')
  await expect(unsupportedLedger).toHaveAttribute('data-debug-state', 'unsupported')
  await expect(unsupportedLedger.getByText('版本不受支持')).toBeVisible()
  await expandLedger(unsupportedLedger)
  await expect(unsupportedLedger.getByTestId('debug-data-notice')).toHaveCount(1)
  await expect(unsupportedLedger.getByLabel('本轮执行路径').getByText('不支持', { exact: true })).toHaveCount(5)
  for (const testId of ['debug-memory-summary', 'debug-rag-summary', 'debug-tools-summary', 'debug-agent-summary']) {
    await expect(page.getByTestId(testId)).toHaveText('版本不支持')
  }
})

test('live metadata without a debug version is unavailable instead of legacy', async ({ page }) => {
  await page.goto('/?debug=1&conversationId=debug-complete')
  await page.getByTestId('chat-input').fill('验证本轮调试快照')
  await page.getByTestId('chat-submit').click()

  const ledger = page.getByTestId('chat-debug-ledger').last()
  await expect(ledger).toHaveAttribute('data-debug-state', 'unavailable')
  await expect(ledger.getByText('本轮明细不可用')).toBeVisible()
  await expandLedger(ledger)
  for (const testId of ['debug-memory-summary', 'debug-rag-summary', 'debug-tools-summary', 'debug-agent-summary']) {
    await expect(ledger.getByTestId(testId)).toHaveText('快照未返回')
  }
  await expect(ledger.getByTestId('debug-data-notice')).toHaveCount(1)
  await expect(ledger.getByLabel('本轮执行路径').getByText('未返回', { exact: true })).toHaveCount(5)
})

test('HTTP failure remains pending until backend history confirms completion', async ({ page }) => {
  let turnId = ''
  let completed = false
  await page.route('**/api/chat/stream', async route => {
    turnId = route.request().postDataJSON().turnId
    return json(route, { message: '上游服务暂时不可用' }, 503)
  })
  await page.route('**/api/chat/messages/debug-complete', route => json(route, [
    ...completeMessages(),
    ...(completed ? [{ id: 'recovered', role: 'assistant', content: '后台已完成的回答', turnId,
      metadata: { phase: 'COMPLETED' }, createdAt: NOW }] : [])
  ]))
  await page.goto('/?debug=1&conversationId=debug-complete')
  await page.getByTestId('chat-input').fill('触发 HTTP 失败')
  await page.getByTestId('chat-submit').click()
  const ledger = page.getByTestId('chat-debug-ledger').last()
  await expect(page.locator('.turn-status').getByText('暂时无法确认后台状态，正在重新查询，请勿重复提交。')).toBeVisible()
  await expect(ledger).toHaveAttribute('data-debug-state', 'pending')
  completed = true
  await expect(page.getByText('后台已完成的回答', { exact: true })).toBeVisible()
  await expect(ledger).not.toHaveAttribute('data-debug-state', 'pending')
})

test('backend-confirmed failure settles pending debug state after HTTP failure', async ({ page }) => {
  let turnId = ''
  await page.route('**/api/chat/stream', async route => {
    turnId = route.request().postDataJSON().turnId
    return json(route, { message: '上游服务暂时不可用' }, 503)
  })
  await page.route('**/api/chat/messages/debug-complete', route => json(route, [
    ...completeMessages(),
    ...(turnId ? [{ id: 'failed', role: 'assistant', content: '', turnId,
      metadata: { phase: 'FAILED', statusText: '后台确认执行失败' }, createdAt: NOW }] : [])
  ]))
  await page.goto('/?debug=1&conversationId=debug-complete')
  await page.getByTestId('chat-input').fill('触发 HTTP 失败')
  await page.getByTestId('chat-submit').click()

  const ledger = page.getByTestId('chat-debug-ledger').last()
  await expect(ledger).toHaveAttribute('data-debug-state', 'unavailable')
  await expect(ledger).not.toHaveAttribute('data-debug-state', 'pending')
  await expect(ledger.getByText('本轮明细不可用')).toBeVisible()
  await expect(ledger.getByTestId('debug-ledger-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(ledger.getByTestId('debug-ledger-body')).not.toBeVisible()
})

test('debug ledger keeps table overflow local and content aligned at responsive widths', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 })
  await page.goto('/?debug=1&conversationId=debug-complete')
  await expect(page.getByTestId('chat-debug-ledger')).toBeVisible()
  await expandLedger(page.getByTestId('chat-debug-ledger'))

  const narrow = await responsiveMetrics(page)
  expect(narrow.pageOverflow).toBeLessThanOrEqual(1)
  expect(narrow.tables.every((table) => table.overflowX === 'auto')).toBe(true)
  expect(narrow.tables.every((table) => table.right <= narrow.ledgerRight + 1)).toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = await responsiveMetrics(page)
  expect(mobile.pageOverflow).toBeLessThanOrEqual(1)
  expect(Math.abs(mobile.assistantX - mobile.composerX)).toBeLessThanOrEqual(1)
  expect(Math.abs(mobile.assistantWidth - mobile.composerWidth)).toBeLessThanOrEqual(1)
  expect(Math.abs(mobile.ledgerX - mobile.composerX)).toBeLessThanOrEqual(1)
  expect(Math.abs(mobile.ledgerWidth - mobile.composerWidth)).toBeLessThanOrEqual(1)
  expect(mobile.tables.every((table) => table.overflowX === 'auto')).toBe(true)
  expect(mobile.tables.some((table) => table.scrollWidth > table.clientWidth)).toBe(true)
})

test('expanded debug evidence does not move the mobile composer when typing or opening attachments', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?debug=1&conversationId=debug-complete')
  await expandLedger(page.getByTestId('chat-debug-ledger'))

  const readPosition = () => page.locator('.chat-composer').evaluate((element) => {
    const chatPage = element.closest<HTMLElement>('.page')!
    return {
      composerBottom: element.getBoundingClientRect().bottom,
      pageScrollTop: chatPage.scrollTop,
      pageOverflow: chatPage.scrollHeight - chatPage.clientHeight,
      documentScrollTop: document.scrollingElement?.scrollTop || 0,
      documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight
    }
  })
  const baseline = await readPosition()
  expect(baseline.pageOverflow).toBeLessThanOrEqual(1)
  expect(baseline.documentOverflow).toBeLessThanOrEqual(1)
  expect(baseline.composerBottom).toBeGreaterThan(0)
  expect(baseline.composerBottom).toBeLessThanOrEqual(844)

  async function expectPositionStable(stage: string) {
    const position = await readPosition()
    expect(position.pageOverflow, `${stage}: chat page must not gain vertical overflow`).toBeLessThanOrEqual(1)
    expect(position.documentOverflow, `${stage}: document must not gain vertical overflow`).toBeLessThanOrEqual(1)
    expect(Math.abs(position.pageScrollTop - baseline.pageScrollTop), `${stage}: chat page scroll position`).toBeLessThanOrEqual(2)
    expect(Math.abs(position.documentScrollTop - baseline.documentScrollTop), `${stage}: document scroll position`).toBeLessThanOrEqual(2)
    expect(Math.abs(position.composerBottom - baseline.composerBottom), `${stage}: composer bottom`).toBeLessThanOrEqual(2)
  }

  const input = page.getByTestId('chat-input')
  await input.click()
  await expect(input).toBeFocused()
  await expectPositionStable('focus input')
  await input.fill('输入区保持在底部')
  await input.press('End')
  await input.press('Shift+Enter')
  await expect(input).toHaveValue('输入区保持在底部\n')
  await expectPositionStable('type and insert newline')
  await page.getByTestId('chat-attach-trigger').click()
  await expect(page.getByRole('menu', { name: '附件命令' })).toBeVisible()
  await expectPositionStable('open attachment menu')
})

test('debug disclosure is keyboard accessible, keeps nested state and isolates copying and each message', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined }
    })
  })
  await page.goto('/?debug=1&conversationId=debug-multiple')

  const ledgers = page.getByTestId('chat-debug-ledger')
  await expect(ledgers).toHaveCount(2)
  const first = ledgers.first()
  const second = ledgers.last()
  const toggle = first.getByTestId('debug-ledger-toggle')
  const body = first.getByTestId('debug-ledger-body')
  const copy = first.getByTestId('debug-ledger-copy')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(body).not.toBeVisible()
  await expect(first.getByTestId('debug-memory-section')).not.toBeVisible()
  await expect(second.getByTestId('debug-ledger-body')).not.toBeVisible()
  const firstBodyId = await body.getAttribute('id')
  const secondBodyId = await second.getByTestId('debug-ledger-body').getAttribute('id')
  expect(firstBodyId).toBeTruthy()
  expect(secondBodyId).toBeTruthy()
  expect(firstBodyId).not.toBe(secondBodyId)
  await expect(toggle).toHaveAttribute('aria-controls', firstBodyId!)
  await expect(toggle.locator('[data-testid="debug-ledger-copy"]')).toHaveCount(0)

  await copy.click()
  await expect(copy).toContainText('已复制')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(body).not.toBeVisible()

  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(body).toBeVisible()
  await expect(second.getByTestId('debug-ledger-toggle')).toHaveAttribute('aria-expanded', 'false')

  const recall = first.locator('.debug-recall-disclosure')
  await recall.locator(':scope > summary').press('Enter')
  await expect(recall).toHaveAttribute('open', '')
  await expect(recall.locator('.debug-recall-detail')).toBeVisible()

  await copy.focus()
  await page.keyboard.press('Space')
  await expect(copy).toContainText('已复制')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(recall).toHaveAttribute('open', '')

  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(body).not.toBeVisible()
  await expect(recall.locator('.debug-recall-detail')).not.toBeVisible()
  await expect(first.getByTestId('debug-ledger-collapse')).not.toBeVisible()
  await page.keyboard.press('Tab')
  await expect(copy).toBeFocused()

  await toggle.press('Enter')
  await expect(body).toBeVisible()
  await expect(recall).toHaveAttribute('open', '')
  await expect(recall.locator('.debug-recall-detail')).toBeVisible()
  await second.getByTestId('debug-ledger-toggle').press('Enter')
  await expect(second.getByTestId('debug-ledger-body')).toBeVisible()
  await first.getByTestId('debug-ledger-collapse').press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await expect(second.getByTestId('debug-ledger-toggle')).toHaveAttribute('aria-expanded', 'true')
  await expect(second.getByTestId('debug-ledger-body')).toBeVisible()
})

test('a streaming result does not reopen a manually collapsed debug ledger', async ({ page }) => {
  let releaseResponse!: () => void
  const responseReady = new Promise<void>((resolve) => { releaseResponse = resolve })
  await page.route('**/api/chat/stream', async (route) => {
    await responseReady
    const body = [
      'event: delta',
      'data: {"text":"本轮回答已完成。"}',
      '',
      'event: meta',
      'data: {"debugVersion":"chat-debug-v1","sources":[],"agentTrace":[],"toolResults":[],"usedMemories":[]}',
      '',
      'event: turn.status',
      'data: {"turnId":"live-collapse-state","phase":"COMPLETED","message":"已完成"}',
      '',
      'event: done',
      'data: {}',
      '',
      ''
    ].join('\n')
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body })
  })

  try {
    await page.goto('/?debug=1&conversationId=debug-complete')
    const history = page.getByTestId('chat-debug-ledger').first()
    await expandLedger(history)
    await page.getByTestId('chat-input').fill('验证流式更新保持折叠')
    await page.getByTestId('chat-submit').click()

    const live = page.getByTestId('chat-debug-ledger').last()
    await expect(page.getByTestId('chat-debug-ledger')).toHaveCount(2)
    await expect(live).toHaveAttribute('data-debug-state', 'pending')
    await expandLedger(live)
    await live.getByTestId('debug-ledger-toggle').click()
    await expect(live.getByTestId('debug-ledger-body')).not.toBeVisible()
    await expect(history.getByTestId('debug-ledger-toggle')).toHaveAttribute('aria-expanded', 'true')

    releaseResponse()
    await expect(live).toHaveAttribute('data-debug-state', 'available')
    await expect(live.getByTestId('debug-ledger-toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(live.getByTestId('debug-ledger-body')).not.toBeVisible()
    await expect(history.getByTestId('debug-ledger-toggle')).toHaveAttribute('aria-expanded', 'true')
  } finally {
    releaseResponse()
  }
})

async function expandLedger(ledger: Locator) {
  const toggle = ledger.getByTestId('debug-ledger-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(ledger.getByTestId('debug-ledger-body')).not.toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(ledger.getByTestId('debug-ledger-body')).toBeVisible()
}

async function responsiveMetrics(page: Page) {
  return page.evaluate(() => {
    const assistant = document.querySelector<HTMLElement>('.message.assistant > .message-bubble')?.getBoundingClientRect()
    const composer = document.querySelector<HTMLElement>('.chat-input')?.getBoundingClientRect()
    const ledger = document.querySelector<HTMLElement>('[data-testid="chat-debug-ledger"]')?.getBoundingClientRect()
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      assistantX: assistant?.x || 0,
      assistantWidth: assistant?.width || 0,
      composerX: composer?.x || 0,
      composerWidth: composer?.width || 0,
      ledgerRight: ledger?.right || 0,
      ledgerX: ledger?.x || 0,
      ledgerWidth: ledger?.width || 0,
      tables: Array.from(document.querySelectorAll<HTMLElement>('.debug-data-table, .debug-agent-table')).map((table) => {
        const rect = table.getBoundingClientRect()
        return {
          right: rect.right,
          clientWidth: table.clientWidth,
          scrollWidth: table.scrollWidth,
          overflowX: getComputedStyle(table).overflowX
        }
      })
    }
  })
}

async function installAuthenticatedSession(page: Page) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  await page.addInitScript(({ token }) => {
    localStorage.setItem('lyle-token', token)
    localStorage.setItem('lyle-user', JSON.stringify({ id: 'debug-user', username: '调试用户', role: 'USER' }))
  }, { token: `header.${payload}.signature` })
}

async function mockApis(page: Page) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request()
    const path = decodeURIComponent(new URL(request.url()).pathname)
    if (path === '/api/runtime-config') return json(route, {
      authLoginV63Enabled: false,
      chatWorkspaceDropEnabled: true,
      chatFolderAttachmentsEnabled: true
    })
    if (path === '/api/users/me') return json(route, { id: 'debug-user', username: '调试用户', role: 'USER' })
    if (path === '/api/conversations') return json(route, [
      { id: 'debug-complete', title: '完整调试账本', createdAt: NOW, updatedAt: NOW },
      { id: 'debug-multiple', title: '多轮折叠调试账本', createdAt: NOW, updatedAt: NOW },
      { id: 'debug-zero', title: '零结果调试账本', createdAt: NOW, updatedAt: NOW },
      { id: 'debug-legacy', title: '旧历史', createdAt: NOW, updatedAt: NOW },
      { id: 'debug-unsupported', title: '不支持的调试版本', createdAt: NOW, updatedAt: NOW }
    ])
    if (path === '/api/chat/messages/debug-complete') return json(route, completeMessages())
    if (path === '/api/chat/messages/debug-multiple') return json(route, multipleMessages())
    if (path === '/api/chat/messages/debug-zero') return json(route, zeroMessages())
    if (path === '/api/chat/messages/debug-legacy') return json(route, legacyMessages())
    if (path === '/api/chat/messages/debug-unsupported') return json(route, unsupportedMessages())
    if (path === '/api/chat/stream') {
      if ((request.postData() || '').includes('触发 HTTP 失败')) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '上游服务暂时不可用' }) })
      }
      const body = [
        'event: delta',
        'data: {"text":"本轮回答已完成。"}',
        '',
        'event: meta',
        'data: {"sources":[],"agentTrace":[],"toolResults":[],"usedMemories":[]}',
        '',
        'event: turn.status',
        'data: {"turnId":"live-no-debug-version","phase":"COMPLETED","message":"已完成"}',
        '',
        'event: done',
        'data: {}',
        '',
        ''
      ].join('\n')
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body })
    }
    if (path === '/api/knowledge-bases') return json(route, [{ id: 'kb-llm', name: '大模型知识库', createdAt: NOW }])
    if (path === '/api/projects') return json(route, { items: [] })
    if (path === '/api/memory/current') return json(route, emptyMemory())
    if (new Set([
      '/api/agent-tools/todos',
      '/api/agent-tools/reminders',
      '/api/agent-tools/operations'
    ]).has(path)) return json(route, { items: [] })
    if (path === '/api/experience/events') return json(route, { accepted: true })
    return json(route, { items: [] })
  })
}

function completeMessages() {
  return [
    { id: 'm1', conversationId: 'debug-complete', role: 'user', content: 'Build 和 Recall 分别做什么？', metadata: {}, createdAt: NOW },
    {
      id: 'm2',
      conversationId: 'debug-complete',
      role: 'assistant',
      content: 'Build 负责构建，Recall 负责召回。',
      createdAt: NOW,
      metadata: {
        phase: 'COMPLETED',
        debugVersion: 'chat-debug-v1',
        debugTruncated: false,
        knowledgeBaseIds: ['kb-llm'],
        retrievalScope: {
          requested: true,
          executed: true,
          skipped: false,
          knowledgeBaseCount: 1,
          queryCount: 1,
          contextCount: 1,
          reason: '已选择知识库并执行检索。'
        },
        usedMemories: [{
          memoryId: 'profile:1',
          title: '当前项目',
          valueSummary: 'Lyle 知识库验收',
          reasonCode: 'PROJECT_CONTEXT',
          reliability: 'RELIABLE',
          sourceCount: 2
        }],
        memoryExclusions: { conflicted: 0, sensitive: 1, governed: 0 },
        projectContext: { resolver: { projectId: null, reason: '没有可匹配的活跃项目', linkedConversation: false } },
        agentTrace: [{
          agent: 'supervisor_agent',
          intent: 'knowledge',
          nextAgents: ['memory_agent', 'rag_agent', 'tool_agent'],
          elapsedMs: 4
        }, {
          agent: 'memory_agent',
          memoryContextChars: 420,
          memorySummary: {
            summaryChars: 18,
            summaryPreview: '用户正在完善 Lyle 的长期知识库。',
            shortTermCount: 1,
            shortTermPreview: [{ role: 'user', content: '验证知识库是否召回。' }],
            structuredCount: 1,
            structuredPreview: ['current_project=Lyle 知识库验收'],
            semanticCount: 2,
            vectorCount: 1,
            retrievedCount: 1,
            retrievedPreview: ['用户希望看到完整的调试证据。']
          },
          decision: { should_recall: true, depth: 'full', reason: '问题需要个人上下文。' },
          elapsedMs: 11
        }, {
          agent: 'rag_agent',
          contextCount: 1,
          queryCount: 1,
          queries: ['Build Recall 长期记忆'],
          sufficient: true,
          decision: { should_retrieve: true, depth: 'full', reason: '已选择知识库。' },
          elapsedMs: 25
        }, {
          agent: 'tool_agent',
          selectedTools: ['memory_snapshot'],
          toolCount: 1,
          decision: { should_call_tools: true, reason: '用户要求查看记忆状态。' },
          elapsedMs: 8
        }, {
          agent: 'writer_agent',
          answerChars: 24,
          writerInput: { memoryContextChars: 420, toolContextChars: 80, ragContextCount: 1, combinedContextChars: 500 },
          elapsedMs: 18
        }, {
          agent: 'project_resolver'
        }, {
          agent: 'memory_agent',
          action: 'candidate_ready',
          candidateCount: 0
        }],
        sources: [{
          docId: 'doc-llm',
          title: '大模型知识原理.docx #12',
          chunk: 'Build 负责记忆构建，Recall 负责检索召回。',
          score: '0.91',
          backend: 'qdrant',
          hitModes: 'dense+keyword'
        }],
        toolResults: [{
          tool: 'memory_snapshot',
          ok: true,
          summary: '已读取记忆快照。',
          operationType: 'memory.read',
          riskLevel: 'read',
          retryable: false,
          elapsedMs: 7
        }],
        review: { approved: true, score: 0.96, reason: '来源充分。' }
      }
    }
  ]
}

function multipleMessages() {
  return [0, 1].flatMap((turn) => completeMessages().map((message, index) => ({
    ...message,
    id: `multi-${turn}-${index}`,
    conversationId: 'debug-multiple'
  })))
}

function zeroMessages() {
  return [{
    id: 'z1',
    conversationId: 'debug-zero',
    role: 'assistant',
    content: '没有找到相关资料。',
    createdAt: NOW,
    metadata: {
      phase: 'COMPLETED',
      debugVersion: 'chat-debug-v1',
      knowledgeBaseIds: ['kb-llm'],
      retrievalScope: {
        requested: true,
        executed: true,
        skipped: false,
        knowledgeBaseCount: 1,
        queryCount: 1,
        contextCount: 0,
        reason: '检索完成但没有匹配片段。'
      },
      agentTrace: [{ agent: 'supervisor_agent', intent: 'knowledge' }, { agent: 'rag_agent', contextCount: 0, queryCount: 1 }],
      sources: [],
      toolResults: [],
      usedMemories: [],
      memoryExclusions: { conflicted: 0, sensitive: 0, governed: 0 },
      review: {}
    }
  }]
}

function legacyMessages() {
  return [{
    id: 'l1',
    conversationId: 'debug-legacy',
    role: 'assistant',
    content: '这是升级前保存的回答。',
    createdAt: NOW,
    metadata: { phase: 'COMPLETED', usedMemories: [] }
  }]
}

function unsupportedMessages() {
  return [{
    id: 'u1',
    conversationId: 'debug-unsupported',
    role: 'assistant',
    content: '这条回答来自更新的调试协议。',
    createdAt: NOW,
    metadata: { phase: 'COMPLETED', debugVersion: 'chat-debug-v2' }
  }]
}

function emptyMemory() {
  return { summary: '', short_term: [], structured: [], structured_all: [], profiles: [], fragments: [], semantic: [], vector: [], retrieved: [] }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}
