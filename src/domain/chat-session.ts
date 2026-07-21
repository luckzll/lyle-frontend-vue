export const NEW_CONVERSATION_STORAGE_VALUE = '__new_conversation__'

export function resolveConversationToRestore(options: {
  requestedId?: string
  storedId?: string | null
  conversationIds: string[]
  allowRecent: boolean
}): string {
  const requestedId = options.requestedId?.trim()
  if (requestedId) return requestedId
  if (!options.allowRecent) return ''

  const storedId = options.storedId?.trim()
  if (storedId === NEW_CONVERSATION_STORAGE_VALUE) return ''
  if (storedId && options.conversationIds.includes(storedId)) return storedId
  return options.conversationIds[0] || ''
}
