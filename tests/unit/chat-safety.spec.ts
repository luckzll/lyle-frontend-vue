import { describe, expect, it } from 'vitest'
import {
  maskSensitiveText,
  sanitizeAgentTrace,
  sanitizeExecutionSuggestions,
  sanitizeToolResults
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
