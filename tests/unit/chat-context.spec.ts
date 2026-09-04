import { describe, expect, it } from 'vitest'

import {
  resolveKnowledgeBaseSelection,
  resolveProjectSelection
} from '@/domain/chat-context'

describe('chat context selection', () => {
  it('restores an available knowledge base and clears a missing target', () => {
    expect(resolveKnowledgeBaseSelection('kb-2', ['kb-1', 'kb-2'])).toBe('kb-2')
    expect(resolveKnowledgeBaseSelection('missing', ['kb-1', 'kb-2'])).toBe('')
    expect(resolveKnowledgeBaseSelection('', ['kb-1'])).toBe('')
  })

  it('restores only an available positive project id', () => {
    expect(resolveProjectSelection('42', [7, 42])).toBe(42)
    expect(resolveProjectSelection('12', [7, 42])).toBeNull()
    expect(resolveProjectSelection('invalid', [7, 42])).toBeNull()
  })
})
