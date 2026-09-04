import { describe, expect, it } from 'vitest'
import {
  maskSensitiveText,
  sanitizeAgentTrace,
  sanitizeChatSources,
  sanitizeDebugVersion,
  sanitizeExecutionSuggestions,
  sanitizeKnowledgeBaseIds,
  sanitizeMemoryExclusions,
  sanitizeRetrievalScope,
  sanitizeToolResults,
  sanitizeUsedMemories
} from '@/domain/chat-safety'

describe('chat metadata safety boundary', () => {
  it('masks common credentials before text enters page state', () => {
    const masked = maskSensitiveText(
      'Authorization: Bearer abcdefghijklmnop postgresql://user:pass@db.local sk-abcdefghijklmnop token=raw-token'
    )

    expect(masked).not.toContain('abcdefghijklmnop')
    expect(masked).not.toContain('user:pass')
    expect(masked).not.toContain('raw-token')
    expect(masked).toBe('[已隐藏]')
  })

  it('recursively removes quoted JSON credentials and any authorization scheme', () => {
    const masked = maskSensitiveText(JSON.stringify({
      password: 'hunter2',
      Authorization: 'Basic dXNlcjpwYXNz',
      client_secret: 'plain-secret',
      nested: {
        headers: { 'x-api-key': 'private-key' },
        message: 'Bearer abcdefghijklmnop'
      }
    }))

    expect(masked).not.toContain('hunter2')
    expect(masked).not.toContain('dXNlcjpwYXNz')
    expect(masked).not.toContain('plain-secret')
    expect(masked).not.toContain('private-key')
    expect(masked).not.toContain('abcdefghijklmnop')
    expect(masked).toContain('[已隐藏]')
  })

  it.each([
    'Authorization: Basic "dXNlcjpwYXNz"',
    'Authorization: Digest username="u", nonce="private-nonce", response="private-signature"',
    'Authorization: AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE, Signature=private-signature',
    'AWS_SECRET_ACCESS_KEY=very-private-aws-secret',
    'config["password"]="LEAKME1234567890"',
    'config[ "password" ] = "LEAKME1234567890"',
    'headers["Authorization"]="Digest response=\\"LEAKME1234567890\\""',
    'payload="{\\"password\\":\\"hunter2\\"}"',
    JSON.stringify(JSON.stringify({ password: 'hunter2', Authorization: 'Basic dXNlcjpwYXNz' })),
    '-----BEGIN PRIVATE KEY-----\nvery-private-pkcs8-material\n-----END PRIVATE KEY-----'
  ])('fully hides credential-bearing trace text: %s', (value) => {
    expect(maskSensitiveText(value)).toBe('[已隐藏]')
  })

  it.each([
    '[["password","LEAKME1234567890"]]',
    '[["Authorization","Digest response=\\"LEAKME1234567890\\""]]',
    '[["AWS_SECRET_ACCESS_KEY","LEAKME1234567890"]]',
    '[["X-API-Key","LEAKME1234567890"]]',
    '[["X-Auth-Token","LEAKME1234567890"]]',
    '[["X-Amz-Security-Token","LEAKME1234567890"]]'
  ])('masks JSON key-value pair arrays: %s', (value) => {
    const masked = maskSensitiveText(value)

    expect(masked).not.toContain('LEAKME1234567890')
    expect(masked).toContain('[已隐藏]')
  })

  it('retains only the trace fields needed by the timeline and debug summary', () => {
    const [trace] = sanitizeAgentTrace([{
      agent: 'tool_agent',
      approved: true,
      selectedTools: ['project.inspect'],
      secretPrompt: 'must-not-survive',
      decision: {
        depth: 'single_step',
        reason: 'token=private-value',
        selected_tools: ['project.inspect'],
        raw_input: 'private conversation'
      }
    }])

    expect(trace.agent).toBe('tool_agent')
    expect(trace.approved).toBe(true)
    expect(trace.selectedTools).toEqual(['project.inspect'])
    expect(trace).not.toHaveProperty('secretPrompt')
    expect(trace.decision).not.toHaveProperty('raw_input')
    expect(JSON.stringify(trace)).not.toContain('private-value')
  })

  it('keeps the safe memory, RAG, routing and timing evidence used by the debug ledger', () => {
    const traces = sanitizeAgentTrace([
      {
        agent: 'supervisor_agent',
        intent: 'knowledge',
        nextAgents: ['memory_agent', 'rag_agent'],
        elapsedMs: 12,
        prompt: 'must-not-survive'
      },
      {
        agent: 'memory_agent',
        memoryContextChars: 320,
        memorySummary: {
          summaryChars: 80,
          summaryPreview: '正在整理 Lyle 知识库',
          shortTermCount: 2,
          shortTermPreview: [{ role: 'user', content: '继续验证知识库' }],
          structuredCount: 1,
          structuredPreview: ['current_project=Lyle'],
          semanticCount: 3,
          vectorCount: 2,
          retrievedCount: 2,
          retrievedPreview: ['用户正在验证 RAG']
        },
        decision: {
          should_recall: true,
          depth: 'full',
          reason: '与问题相关。'
        }
      },
      {
        agent: 'rag_agent',
        contextCount: 2,
        queryCount: 1,
        queries: ['HuggingFace 上的量化模型', 'token=LEAKME1234567890'],
        sufficient: true,
        decision: {
          should_retrieve: true,
          reason: '已选择知识库。'
        }
      }
    ])

    expect(traces[0]).toEqual(expect.objectContaining({
      intent: 'knowledge',
      nextAgents: ['memory_agent', 'rag_agent'],
      elapsedMs: 12
    }))
    expect(traces[0]).not.toHaveProperty('prompt')
    expect(traces[1].memorySummary).toEqual(expect.objectContaining({
      shortTermPreview: [{ role: 'user', content: '继续验证知识库' }],
      vectorCount: 2,
      retrievedPreview: ['用户正在验证 RAG']
    }))
    expect(traces[1].decision).toEqual(expect.objectContaining({ should_recall: true }))
    expect(traces[2]).toEqual(expect.objectContaining({
      sufficient: true,
      contextCount: 2,
      queryCount: 1,
      queries: ['HuggingFace 上的量化模型', '[已隐藏]']
    }))
    expect(JSON.stringify(traces[2])).not.toContain('LEAKME1234567890')
  })

  it('sanitizes memories, retrieval scope, knowledge ids and RAG sources before page state', () => {
    const memories = sanitizeUsedMemories([{
      memoryId: 'profile:12',
      title: '当前项目',
      valueSummary: 'token=LEAKME1234567890',
      reasonCode: 'PROJECT_CONTEXT',
      reliability: 'RELIABLE',
      sourceCount: 3,
      rawEvidence: 'must-not-survive'
    }])
    const scope = sanitizeRetrievalScope({
      requested: true,
      executed: true,
      skipped: false,
      knowledgeBaseCount: 1,
      queryCount: 2,
      contextCount: 1,
      reason: 'Authorization: Bearer abcdefghijklmnop',
      rawQuery: 'must-not-survive'
    })
    const sources = sanitizeChatSources([{
      docId: 'doc-1',
      title: '大模型知识原理.docx',
      chunk: 'password=hunter2',
      score: 0,
      backend: 'qdrant',
      rawVector: [1, 2, 3]
    }, null, 'invalid'])

    expect(memories).toEqual([expect.objectContaining({
      memoryId: 'profile:12',
      valueSummary: '[已隐藏]',
      sourceCount: 3
    })])
    expect(JSON.stringify(memories)).not.toContain('rawEvidence')
    expect(scope).toEqual(expect.objectContaining({ requested: true, executed: true, contextCount: 1 }))
    expect(scope?.reason).toBe('[已隐藏]')
    expect(scope).not.toHaveProperty('rawQuery')
    expect(sources).toHaveLength(1)
    expect(sources[0]).toEqual(expect.objectContaining({
      docId: 'doc-1',
      chunk: '[已隐藏]',
      score: '0',
      backend: 'qdrant'
    }))
    expect(sanitizeKnowledgeBaseIds(['kb-1', 'token=LEAKME1234567890'])).toEqual(['kb-1', '[已隐藏]'])
    expect(sanitizeMemoryExclusions({ conflicted: -2, sensitive: 2.9, governed: '4' })).toEqual({
      conflicted: 0,
      sensitive: 2,
      governed: 4
    })
    expect(sanitizeDebugVersion('chat-debug-v1')).toBe('chat-debug-v1')
    expect(sanitizeDebugVersion('chat-debug-v2')).toBeUndefined()
  })

  it('whitelists pending-operation previews and drops full payloads and results', () => {
    const [tool] = sanitizeToolResults([{
      tool: 'todo',
      ok: true,
      content: '已准备任务',
      requiresConfirmation: true,
      rawParameters: { credential: 'secret' },
      operation: {
        id: 9,
        toolName: 'todo',
        operationType: 'todo.create',
        riskLevel: 'write',
        summary: '创建任务',
        payload: { title: '发布验收', dueAt: '2026-07-12', privateBody: 'do not retain' },
        result: { privateResult: 'do not retain' },
        sourceText: 'private source',
        status: 'pending',
        createdAt: '2026-07-11T00:00:00Z',
        updatedAt: '2026-07-11T00:00:00Z'
      }
    }])

    expect(tool).not.toHaveProperty('rawParameters')
    expect(tool.content).toBe('创建任务')
    expect(tool.operation?.payload).toEqual({ title: '发布验收', dueAt: '2026-07-12' })
    expect(tool.operation).not.toHaveProperty('result')
    expect(tool.operation).not.toHaveProperty('sourceText')
  })

  it('replaces arbitrary raw tool content with a stable display summary', () => {
    const [tool] = sanitizeToolResults([{
      tool: 'connector.call',
      ok: false,
      content: '{"password":"hunter2","Authorization":"Basic dXNlcjpwYXNz"}'
    }])

    expect(tool.content).toBe('工具执行未完成。')
    expect(JSON.stringify(tool)).not.toContain('hunter2')
    expect(JSON.stringify(tool)).not.toContain('dXNlcjpwYXNz')
  })

  it('keeps only the explicit safe tool summary and observable status fields', () => {
    const [tool] = sanitizeToolResults([{
      tool: 'web_search',
      ok: true,
      content: 'raw result must not survive',
      summary: '检索完成，返回 3 条结果。',
      operationType: 'external.read',
      riskLevel: 'read',
      retryable: true,
      elapsedMs: 48,
      rawParameters: { token: 'secret' }
    }])

    expect(tool).toEqual(expect.objectContaining({
      tool: 'web_search',
      ok: true,
      content: '检索完成，返回 3 条结果。',
      operationType: 'external.read',
      riskLevel: 'read',
      retryable: true,
      elapsedMs: 48
    }))
    expect(JSON.stringify(tool)).not.toContain('raw result')
    expect(JSON.stringify(tool)).not.toContain('secret')
  })

  it('does not retain a private key smuggled through an operation summary', () => {
    const privateKey = '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----'
    const [tool] = sanitizeToolResults([{
      tool: 'todo',
      ok: true,
      content: 'ignored',
      requiresConfirmation: true,
      operation: {
        id: 11,
        toolName: 'todo',
        operationType: 'todo.create',
        riskLevel: 'write',
        summary: privateKey,
        payload: { title: '安全检查' },
        status: 'pending',
        createdAt: '2026-07-11T00:00:00Z',
        updatedAt: '2026-07-11T00:00:00Z'
      }
    }])

    expect(tool.content).toBe('[已隐藏]')
    expect(tool.operation?.summary).toBe('[已隐藏]')
    expect(JSON.stringify(tool)).not.toContain('private-material')
  })

  it('does not retain pair-array credentials smuggled through an operation summary', () => {
    const [tool] = sanitizeToolResults([{
      tool: 'connector.call',
      ok: false,
      content: 'ignored',
      requiresConfirmation: true,
      operation: {
        id: 12,
        toolName: 'connector.call',
        operationType: 'connector.call',
        riskLevel: 'write',
        summary: '[["X-API-Key","LEAKME1234567890"]]',
        payload: {},
        status: 'pending',
        createdAt: '2026-07-11T00:00:00Z',
        updatedAt: '2026-07-11T00:00:00Z'
      }
    }])

    expect(JSON.stringify(tool)).not.toContain('LEAKME1234567890')
    expect(tool.content).toContain('[已隐藏]')
    expect(tool.operation?.summary).toContain('[已隐藏]')
  })

  it('keeps only opaque ids or the minimum workflow intent in suggestion payloads', () => {
    const suggestions = sanitizeExecutionSuggestions([
      {
        id: 'cli-1',
        type: 'cli',
        title: '检查工作区',
        description: '只读检查',
        riskLevel: 'read',
        status: 'pending',
        action: 'open_workbench',
        payload: { workspaceId: 7, command: 'printenv SECRET' }
      },
      {
        id: 'workflow-1',
        type: 'workflow',
        title: '创建巡检',
        description: '生成预览',
        riskLevel: 'read',
        status: 'pending',
        action: 'create_workflow',
        payload: { workflow: { description: '每周巡检', rawSteps: [{ secret: 'x' }] } }
      }
    ])

    expect(suggestions[0].payload).toEqual({ workspaceId: 7 })
    expect(suggestions[1].payload).toEqual({ workflow: { description: '每周巡检' } })
  })
})
