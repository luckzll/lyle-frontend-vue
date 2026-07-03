import { describe, expect, it, vi } from 'vitest'

import { consumeSseBuffer, handleSseBlock } from '@/api/app'

describe('SSE parsing', () => {
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
        'data: {"sources":[{"fileId":"1","title":"doc.txt","chunk":"hit"}],"review":{"approved":true}}',
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
})
