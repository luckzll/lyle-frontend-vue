export const CHAT_KNOWLEDGE_BASE_STORAGE_KEY = 'lyle.chat.knowledge-base-id'
export const CHAT_PROJECT_STORAGE_KEY = 'lyle.chat.project-id'

export function resolveKnowledgeBaseSelection(
  preferredId: string | null | undefined,
  availableIds: Iterable<string | number>
) {
  const normalized = String(preferredId || '').trim()
  if (!normalized) return ''
  return new Set(Array.from(availableIds, (id) => String(id))).has(normalized) ? normalized : ''
}

export function resolveProjectSelection(
  preferredId: string | number | null | undefined,
  availableIds: Iterable<string | number>
) {
  const normalized = Number(preferredId)
  if (!Number.isInteger(normalized) || normalized <= 0) return null
  return new Set(Array.from(availableIds, (id) => Number(id))).has(normalized) ? normalized : null
}
