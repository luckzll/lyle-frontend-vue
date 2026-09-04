import { describe, expect, it } from 'vitest'

import { historyMessage, isActiveTurnPhase } from '@/domain/chat-history'

describe('persisted chat turn recovery', () => {
  it('restores a running image batch for refresh polling', () => {
    const message = historyMessage({
      id: '1',
      conversationId: '10',
      turnId: 'turn-1',
      role: 'assistant',
      content: '',
      createdAt: '2026-07-21T00:00:00',
      metadata: {
        phase: 'GENERATING',
        statusText: '已完成 1 / 2 张图片',
        imageBatch: {
          batchId: 'batch-1',
          count: 2,
          mode: 'edit',
          status: 'RUNNING',
          completedCount: 1,
          failedCount: 0,
          items: [
            { index: 0, status: 'COMPLETED', imageUrl: 'https://example.com/one.png' },
            { index: 1, status: 'RUNNING' }
          ]
        }
      }
    })

    expect(message.imageBatch).toEqual(expect.objectContaining({
      batchId: 'batch-1',
      status: 'RUNNING',
      completedCount: 1
    }))
    expect(message.imageBatch?.items[0].imageUrl).toBe('https://example.com/one.png')
    expect(isActiveTurnPhase(message.phase)).toBe(true)
  })

  it('restores cancelled cards and treats the turn as terminal', () => {
    const message = historyMessage({
      id: '2',
      conversationId: '10',
      turnId: 'turn-2',
      role: 'assistant',
      content: '已停止生成。',
      createdAt: '2026-07-21T00:00:00',
      metadata: {
        phase: 'FAILED',
        statusText: '已停止生成',
        imageBatch: {
          batchId: 'batch-2',
          count: 2,
          mode: 'generate',
          status: 'CANCELLED',
          completedCount: 0,
          failedCount: 0,
          items: [
            { index: 0, status: 'CANCELLED' },
            { index: 1, status: 'CANCELLED' }
          ]
        }
      }
    })

    expect(message.content).toBe('已停止生成。')
    expect(message.imageBatch?.items.map((item) => item.status)).toEqual(['CANCELLED', 'CANCELLED'])
    expect(isActiveTurnPhase(message.phase)).toBe(false)
  })

  it('restores structured attachments without parsing URLs from message text', () => {
    const message = historyMessage({
      id: '3',
      conversationId: '10',
      role: 'user',
      content: '请总结附件',
      createdAt: '2026-07-21T00:00:00',
      attachments: [{
        id: 'attachment-1',
        kind: 'file',
        name: '需求.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        downloadUrl: '/chat/attachments/attachment-1/content?disposition=attachment'
      }]
    })

    expect(message.content).toBe('请总结附件')
    expect(message.attachments).toEqual([expect.objectContaining({ id: 'attachment-1', name: '需求.pdf' })])
  })

  it('restores only valid V6.6 memory explanations from assistant metadata', () => {
    const message = historyMessage({
      id: '4',
      conversationId: '10',
      role: 'assistant',
      content: '已根据你的偏好调整。',
      createdAt: '2026-08-10T00:00:00',
      metadata: {
        usedMemories: [{
          memoryId: 'profile:12',
          title: '视觉偏好',
          valueSummary: '不喜欢人物戴帽子',
          reasonCode: 'QUESTION_RELEVANT',
          reliability: 'RELIABLE',
          sourceCount: 2
        }, { memoryId: '', title: '伪造记忆' }],
        memoryExclusions: { conflicted: 1, sensitive: 2, governed: 3 },
        memoryExplanationVersion: 'v1'
      }
    })

    expect(message.usedMemories).toEqual([expect.objectContaining({ memoryId: 'profile:12', sourceCount: 2 })])
    expect(message.id).toBe('4')
    expect(message.memoryExclusions).toEqual({ conflicted: 1, sensitive: 2, governed: 3 })
    expect(message.memoryExplanationVersion).toBe('v1')
    expect(message.debugDataState).toBe('legacy')
  })

  it('restores a complete sanitized debug ledger from assistant history', () => {
    const message = historyMessage({
      id: '5',
      conversationId: '10',
      role: 'assistant',
      content: 'Build 负责构建，Recall 负责召回。',
      createdAt: '2026-09-04T00:00:00Z',
      metadata: {
        debugVersion: 'chat-debug-v1',
        knowledgeBaseIds: ['kb-llm'],
        retrievalScope: {
          requested: true,
          executed: true,
          skipped: false,
          knowledgeBaseCount: 1,
          queryCount: 1,
          contextCount: 1,
          reason: '已选择知识库。'
        },
        agentTrace: [{
          agent: 'memory_agent',
          memorySummary: {
            summaryChars: 12,
            summaryPreview: '长期目标',
            shortTermCount: 1,
            shortTermPreview: [{ role: 'user', content: '验证知识库' }],
            structuredCount: 1,
            structuredPreview: ['current_project=Lyle'],
            semanticCount: 2,
            vectorCount: 1,
            retrievedCount: 1,
            retrievedPreview: ['正在验证 RAG']
          },
          secretPrompt: 'must-not-survive'
        }, {
          agent: 'rag_agent',
          contextCount: 1,
          queryCount: 1,
          queries: ['Build Recall 长期记忆'],
          sufficient: true
        }],
        sources: [{
          docId: 'doc-1',
          title: '大模型知识原理.docx #12',
          chunk: 'Build 与 Recall 的职责说明',
          score: '0.88',
          backend: 'qdrant',
          hitModes: 'dense'
        }],
        toolResults: [{
          tool: 'memory_snapshot',
          ok: true,
          content: 'raw output',
          summary: '已读取记忆快照。',
          elapsedMs: 9,
          password: 'must-not-survive'
        }],
        review: { approved: true, score: 0.94, reason: '引用充分。', rawReasoning: 'private' },
        usedMemories: [{
          memoryId: 'profile:12',
          title: '当前项目',
          valueSummary: 'Lyle',
          reasonCode: 'PROJECT_CONTEXT',
          reliability: 'RELIABLE',
          sourceCount: 2
        }],
        memoryExclusions: { conflicted: 1, sensitive: 2, governed: 3 },
        debugTruncated: false
      }
    })

    expect(message.debugDataState).toBe('available')
    expect(message.debugVersion).toBe('chat-debug-v1')
    expect(message.knowledgeBaseIds).toEqual(['kb-llm'])
    expect(message.retrievalScope).toEqual(expect.objectContaining({ executed: true, contextCount: 1 }))
    expect(message.agentTrace).toHaveLength(2)
    expect(message.agentTrace?.[0].memorySummary).toEqual(expect.objectContaining({
      shortTermPreview: [{ role: 'user', content: '验证知识库' }],
      vectorCount: 1
    }))
    expect(message.agentTrace?.[1].queries).toEqual(['Build Recall 长期记忆'])
    expect(message.sources).toEqual([expect.objectContaining({ title: '大模型知识原理.docx #12', score: '0.88' })])
    expect(message.toolResults).toEqual([expect.objectContaining({ tool: 'memory_snapshot', content: '已读取记忆快照。' })])
    expect(message.review).toEqual({ approved: true, score: 0.94, reason: '引用充分。' })
    expect(message.usedMemories).toEqual([expect.objectContaining({ memoryId: 'profile:12', valueSummary: 'Lyle' })])
    expect(JSON.stringify(message)).not.toContain('must-not-survive')
    expect(JSON.stringify(message)).not.toContain('rawReasoning')
  })

  it('distinguishes a complete zero-result ledger from legacy history', () => {
    const complete = historyMessage({
      id: '6',
      conversationId: '10',
      role: 'assistant',
      content: '没有找到相关资料。',
      createdAt: '2026-09-04T00:00:00Z',
      metadata: {
        debugVersion: 'chat-debug-v1',
        knowledgeBaseIds: ['kb-1'],
        retrievalScope: {
          requested: true,
          executed: true,
          skipped: false,
          knowledgeBaseCount: 1,
          queryCount: 1,
          contextCount: 0,
          reason: '检索完成。'
        },
        agentTrace: [],
        sources: [],
        toolResults: [],
        review: {},
        usedMemories: []
      }
    })
    const legacy = historyMessage({
      id: '7',
      conversationId: '10',
      role: 'assistant',
      content: '旧回答。',
      createdAt: '2026-08-01T00:00:00Z',
      metadata: { sources: [], toolResults: [] }
    })

    expect(complete.debugDataState).toBe('available')
    expect(complete.retrievalScope?.contextCount).toBe(0)
    expect(complete.sources).toEqual([])
    expect(complete.toolResults).toEqual([])
    expect(legacy.debugDataState).toBe('legacy')
  })

  it('marks unknown debug versions as unsupported instead of complete', () => {
    const unsupported = historyMessage({
      id: '8',
      conversationId: '10',
      role: 'assistant',
      content: '未来版本回答。',
      createdAt: '2026-09-05T00:00:00Z',
      metadata: {
        debugVersion: 'chat-debug-v2',
        retrievalScope: { requested: true, executed: true, contextCount: 0 },
        sources: [],
        toolResults: []
      }
    })
    const whitespace = historyMessage({
      id: '9',
      conversationId: '10',
      role: 'assistant',
      content: '无版本回答。',
      createdAt: '2026-09-05T00:00:00Z',
      metadata: { debugVersion: '   ' }
    })

    expect(unsupported.debugDataState).toBe('unsupported')
    expect(unsupported.debugDataState).not.toBe('available')
    expect(unsupported.debugVersion).toBeUndefined()
    expect(whitespace.debugDataState).toBe('legacy')
  })
})
