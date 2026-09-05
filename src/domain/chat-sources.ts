import type { ChatSource } from '@/api/types'

export interface ChatSourceFragment {
  source: ChatSource
  /** Original source-array position, kept stable when documents are grouped. */
  index: number
  citationIndex: number
  label: string
  preview: string
}

export interface ChatSourceGroup {
  key: string
  title: string
  channels: string[]
  fragments: ChatSourceFragment[]
}

const RETRIEVAL_LABELS: Record<string, string> = {
  vector: '语义检索',
  keyword: '关键词匹配',
  parent_child: '关联段落'
}

export function chatSourceChannels(source: ChatSource): string[] {
  const modes = (source.hitModes || '').split(/[,，+|;/\s]+/).filter(Boolean)
  const backends = (source.backend || '').split(/[,，+|;/\s]+/).filter(Boolean)
  // Storage names are not independent information sources. Qdrant is the
  // vector search backend in this API; "memory" means its in-process store.
  const recordedModes = [
    ...modes,
    ...backends.filter(mode => mode === 'keyword' || mode === 'parent_child'),
    ...(!modes.length && backends.includes('qdrant') ? ['vector'] : [])
  ]
  return [...new Set(recordedModes.map(mode => RETRIEVAL_LABELS[mode]).filter(Boolean))]
}

export function chatSourceDocumentTitle(source: ChatSource): string {
  return source.title.trim().replace(/\s+#\d+\s*$/, '').trim() || '未命名文档'
}

function fragmentLabel(source: ChatSource, index: number): string {
  const section = source.parentTitle?.trim()
  if (section) return section
  const recordedIndex = source.chunkIndex?.trim() || source.title.match(/\s+#(\d+)\s*$/)?.[1]
  return recordedIndex && /^\d+$/.test(recordedIndex) ? `片段 ${recordedIndex}` : `片段 ${index + 1}`
}

export function groupChatSources(sources: readonly ChatSource[]): ChatSourceGroup[] {
  const groups = new Map<string, ChatSourceGroup>()
  sources.forEach((source, index) => {
    const documentId = source.docId.trim()
    // Same filenames do not prove document identity. Keep unknown identities
    // separate rather than merging distinct uploads or losing their citations.
    const key = documentId ? `document:${documentId}` : `unidentified:${index}`
    let group = groups.get(key)
    if (!group) {
      group = { key, title: chatSourceDocumentTitle(source), channels: [], fragments: [] }
      groups.set(key, group)
    }
    group.channels = [...new Set([...group.channels, ...chatSourceChannels(source)])]
    const normalized = source.chunk.replace(/\s+/g, ' ').trim()
    group.fragments.push({
      source,
      index,
      citationIndex: index + 1,
      label: fragmentLabel(source, index),
      preview: normalized.length > 160 ? `${normalized.slice(0, 160)}…` : normalized
    })
  })
  return [...groups.values()]
}

export function chatSourcesSummary(groups: readonly ChatSourceGroup[]): string {
  const fragments = groups.reduce((total, group) => total + group.fragments.length, 0)
  return `资料来源 · ${groups.length} 份文档 · ${fragments} 个片段`
}
