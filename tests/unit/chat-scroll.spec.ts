import { describe, expect, it } from 'vitest'
import { isConversationNearBottom } from '@/domain/chat-scroll'

describe('conversation scroll', () => {
  it('keeps streaming content anchored when the reader is already near the bottom', () => {
    expect(isConversationNearBottom({ scrollHeight: 1000, scrollTop: 530, clientHeight: 400 })).toBe(true)
  })

  it('preserves the reader position when older content is being read', () => {
    expect(isConversationNearBottom({ scrollHeight: 1800, scrollTop: 500, clientHeight: 600 })).toBe(false)
  })
})
