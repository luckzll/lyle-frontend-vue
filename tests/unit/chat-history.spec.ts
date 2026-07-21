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
})
