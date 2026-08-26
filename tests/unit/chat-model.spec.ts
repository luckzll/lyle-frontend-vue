import { describe, expect, it } from 'vitest'
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL_ID,
  isChatModelConnectionError,
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

  it('recognizes model connection failures that should offer a Qwen recovery', () => {
    expect(isChatModelConnectionError('当前模型暂时无法连接，请切换到 Qwen 模型。')).toBe(true)
    expect(isChatModelConnectionError('Connection error.')).toBe(true)
    expect(isChatModelConnectionError('模型服务当前限流了，请稍后再试。')).toBe(false)
  })
})
