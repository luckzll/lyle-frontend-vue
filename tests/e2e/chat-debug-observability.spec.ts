import { expect, test, type Page, type Route } from '@playwright/test'

const NOW = '2026-09-04T08:00:00.000Z'

test.beforeEach(async ({ page }) => {
  await installAuthenticatedSession(page)
  await mockApis(page)
})

test('complete historical debug evidence survives refresh and stays behind debug mode', async ({ page }) => {
  await page.goto('/?debug=1&conversationId=debug-complete')

  const ledger = page.getByTestId('chat-debug-ledger')
  await expect(ledger).toBeVisible()
  await expect(ledger.getByText('数据完整')).toBeVisible()
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
  await expect(agents).toContainText('路由 Supervisor')
  await expect(agents).toContainText('记忆 Memory')
  await expect(agents).toContainText('知识库 RAG')
  await expect(agents).toContainText('回答生成 Writer')

  await page.reload()
  await expect(page.getByTestId('debug-memory-section')).toContainText('向量召回片段')
  await expect(page.getByTestId('debug-rag-section')).toContainText('大模型知识原理.docx')
  await expect(page.getByTestId('debug-tools-section')).toContainText('memory_snapshot')

  await page.goto('/?conversationId=debug-complete')
  await expect(page.getByTestId('chat-debug-ledger')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /使用了 1 条记忆/ })).toBeVisible()
})

test('debug ledger distinguishes an executed zero result from legacy missing data', async ({ page }) => {
  await page.goto('/?debug=1&conversationId=debug-zero')

  await expect(page.getByTestId('chat-debug-ledger').getByText('数据完整')).toBeVisible()
  await expect(page.getByTestId('debug-rag-section')).toContainText('已执行，但命中 0 个片段')
  await expect(page.getByTestId('debug-rag-section')).toContainText('检索已执行，但返回 0 个知识片段')
  await expect(page.getByTestId('debug-tools-section')).toContainText('本轮没有调用任何工具')

  await page.goto('/?debug=1&conversationId=debug-legacy')
  await expect(page.getByTestId('chat-debug-ledger').getByText('历史明细缺失')).toBeVisible()
  await expect(page.getByTestId('chat-debug-ledger')).toContainText('无法判断当时是未调用还是数据未记录')
})

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
      { id: 'debug-zero', title: '零结果调试账本', createdAt: NOW, updatedAt: NOW },
      { id: 'debug-legacy', title: '旧历史', createdAt: NOW, updatedAt: NOW }
    ])
    if (path === '/api/chat/messages/debug-complete') return json(route, completeMessages())
    if (path === '/api/chat/messages/debug-zero') return json(route, zeroMessages())
    if (path === '/api/chat/messages/debug-legacy') return json(route, legacyMessages())
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

function emptyMemory() {
  return { summary: '', short_term: [], structured: [], structured_all: [], profiles: [], fragments: [], semantic: [], vector: [], retrieved: [] }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}
