import { describe, expect, it, vi } from 'vitest'

import { consumeSseBuffer, handleSseBlock } from '@/api/app'

describe('SSE parsing', () => {
  it('receives per-step events across chunks and ignores heartbeat comments and malformed progress', () => {
    const handlers = { onDelta: vi.fn(), onAgentStep: vi.fn(), onDone: vi.fn() }
    const first = consumeSseBuffer(': heartbeat\r\n\r\nevent:agent.step\r\ndata:{"turnId":"t","sequence":1,', handlers)
    expect(handlers.onAgentStep).not.toHaveBeenCalled()
    consumeSseBuffer(first + '"step":"rag_agent","status":"running"}\r\n\r\nevent:heartbeat\ndata:alive\n\nevent:agent.step\ndata:{"step":"fake"}\n\n', handlers)
    expect(handlers.onAgentStep).toHaveBeenCalledExactlyOnceWith({ turnId: 't', sequence: 1, step: 'rag_agent', status: 'running' })
    expect(handlers.onDelta).not.toHaveBeenCalled()
    expect(handlers.onDone).not.toHaveBeenCalled()
  })

  it('dispatches delta, meta, and error events from a complete buffer', () => {
    const handlers = {
      onDelta: vi.fn(),
      onMeta: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn()
    }

    const remaining = consumeSseBuffer(
      [
        'event: delta',
        'data: {"text":"紫藤花"}',
        '',
        'event: meta',
        'data: {"sources":[{"fileId":"1","title":"doc.txt","chunk":"hit"}],"candidateMemories":[{"schemaPath":"preferences.visual.dislikes","value":"帽子","status":"pending"}],"review":{"approved":true}}',
        '',
        'event: error',
        'data: {"message":"boom"}',
        '',
        'event: done',
        'data: {}',
        '',
        ''
      ].join('\n'),
      handlers
    )

    expect(remaining).toBe('')
    expect(handlers.onDelta).toHaveBeenCalledWith('紫藤花')
    expect(handlers.onMeta).toHaveBeenCalledWith({
      sources: [{ fileId: '1', title: 'doc.txt', chunk: 'hit' }],
      candidateMemories: [{ schemaPath: 'preferences.visual.dislikes', value: '帽子', status: 'pending' }],
      review: { approved: true }
    })
    expect(handlers.onError).toHaveBeenCalledWith('boom')
    expect(handlers.onDone).toHaveBeenCalled()
  })

  it('keeps an incomplete event in the returned buffer until more data arrives', () => {
    const handlers = {
      onDelta: vi.fn()
    }

    const partial = consumeSseBuffer('event: delta\ndata: {"text":"紫', handlers)
    expect(partial).toBe('event: delta\ndata: {"text":"紫')
    expect(handlers.onDelta).not.toHaveBeenCalled()

    const remaining = consumeSseBuffer(`${partial}藤花"}\n\n`, handlers)
    expect(remaining).toBe('')
    expect(handlers.onDelta).toHaveBeenCalledWith('紫藤花')
  })

  it('joins multi-line data payloads before JSON parsing', () => {
    const handlers = {
      onDelta: vi.fn()
    }

    handleSseBlock('event: delta\ndata: {"text":\ndata: "ok"}', handlers)

    expect(handlers.onDelta).toHaveBeenCalledWith('ok')
  })

  it('uses stable fallbacks for empty delta and missing error messages', () => {
    const handlers = {
      onDelta: vi.fn(),
      onError: vi.fn()
    }

    handleSseBlock('event: delta\ndata: {}', handlers)
    handleSseBlock('event: error\ndata: {}', handlers)

    expect(handlers.onDelta).toHaveBeenCalledWith('')
    expect(handlers.onError).toHaveBeenCalledWith('流式请求失败')
  })

  it('dispatches turn lifecycle and incremental image batch events', () => {
    const handlers = {
      onDelta: vi.fn(),
      onTurnStatus: vi.fn(),
      onImageBatchStarted: vi.fn(),
      onImageItem: vi.fn(),
      onImageBatchCompleted: vi.fn()
    }

    const remaining = consumeSseBuffer(
      [
        'event: turn.status',
        'data: {"turnId":"turn-1","phase":"GENERATING","message":"正在生成 2 张图片…"}',
        '',
        'event: image.batch.started',
        'data: {"turnId":"turn-1","batchId":"batch-1","count":2,"mode":"generate","concurrency":2,"referenceCount":0,"items":[{"index":0,"status":"RUNNING"},{"index":1,"status":"RUNNING"}]}',
        '',
        'event: image.item.completed',
        'data: {"turnId":"turn-1","batchId":"batch-1","count":2,"completedCount":1,"index":1,"status":"COMPLETED","imageUrl":"https://example.com/two.png"}',
        '',
        'event: image.item.failed',
        'data: {"turnId":"turn-1","batchId":"batch-1","count":2,"completedCount":1,"index":0,"status":"FAILED","error":"限流"}',
        '',
        'event: image.batch.completed',
        'data: {"turnId":"turn-1","batchId":"batch-1","status":"PARTIALLY_COMPLETED","count":2,"completedCount":1,"failedCount":1}',
        '',
        ''
      ].join('\n'),
      handlers
    )

    expect(remaining).toBe('')
    expect(handlers.onTurnStatus).toHaveBeenCalledWith({
      turnId: 'turn-1',
      phase: 'GENERATING',
      message: '正在生成 2 张图片…'
    })
    expect(handlers.onImageBatchStarted).toHaveBeenCalledOnce()
    expect(handlers.onImageItem).toHaveBeenCalledTimes(2)
    expect(handlers.onImageItem).toHaveBeenNthCalledWith(1, expect.objectContaining({
      index: 1,
      status: 'COMPLETED',
      imageUrl: 'https://example.com/two.png'
    }))
    expect(handlers.onImageItem).toHaveBeenNthCalledWith(2, expect.objectContaining({
      index: 0,
      status: 'FAILED',
      error: '限流'
    }))
    expect(handlers.onImageBatchCompleted).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PARTIALLY_COMPLETED',
      completedCount: 1,
      failedCount: 1
    }))
  })
})
