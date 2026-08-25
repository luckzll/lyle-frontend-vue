import { describe, expect, it } from 'vitest'
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL_ID,
  resolveChatModelId
} from '../../src/domain/chat-model'

describe('chat model selection', () => {
  it('keeps every supported model id', () => {
    for (const option of CHAT_MODEL_OPTIONS) {
      expect(resolveChatModelId(option.id)).toBe(option.id)
    }
  })

  it('falls back to the token-saving default for unknown persisted values', () => {
    expect(resolveChatModelId('unsupported-model')).toBe(DEFAULT_CHAT_MODEL_ID)
    expect(resolveChatModelId(null)).toBe(DEFAULT_CHAT_MODEL_ID)
  })
})
