import { describe, expect, it } from 'vitest'

import {
  NEW_CONVERSATION_STORAGE_VALUE,
  resolveConversationToRestore
} from '@/domain/chat-session'

describe('chat session restoration', () => {
  it('restores the requested or last active conversation', () => {
    expect(resolveConversationToRestore({
      requestedId: '42',
      storedId: '41',
      conversationIds: ['41', '40'],
      allowRecent: true
    })).toBe('42')

    expect(resolveConversationToRestore({
      storedId: '41',
      conversationIds: ['42', '41'],
      allowRecent: true
    })).toBe('41')
  })

  it('falls back to the newest conversation but preserves an intentional new chat', () => {
    expect(resolveConversationToRestore({
      storedId: 'missing',
      conversationIds: ['42', '41'],
      allowRecent: true
    })).toBe('42')

    expect(resolveConversationToRestore({
      storedId: NEW_CONVERSATION_STORAGE_VALUE,
      conversationIds: ['42', '41'],
      allowRecent: true
    })).toBe('')
  })

  it('does not restore unrelated history during a project handoff', () => {
    expect(resolveConversationToRestore({
      storedId: '42',
      conversationIds: ['42'],
      allowRecent: false
    })).toBe('')
  })
})
