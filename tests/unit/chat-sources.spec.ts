import { describe, expect, it } from 'vitest'
import type { ChatSource } from '@/api/types'
import { chatSourceChannels, chatSourceDocumentTitle, chatSourcesSummary, groupChatSources } from '@/domain/chat-sources'

const source = (overrides: Partial<ChatSource> = {}): ChatSource => ({
  docId: 'doc-a', title: '大模型知识原理.docx #2', chunk: 'LoRA 只训练低秩矩阵。', ...overrides
})

describe('grouped chat sources', () => {
  it('counts documents independently from their fragments and preserves citation order and source identity', () => {
    const sources = [source(), source({ docId: 'doc-b', title: '训练指南.pdf #3' }), source({ title: '大模型知识原理.docx #7' })]
    const groups = groupChatSources(sources)

    expect(chatSourcesSummary(groups)).toBe('资料来源 · 2 份文档 · 3 个片段')
    expect(groups[0].title).toBe('大模型知识原理.docx')
    expect(groups[0].fragments.map(fragment => fragment.citationIndex)).toEqual([1, 3])
    expect(groups[0].fragments.map(fragment => fragment.index)).toEqual([0, 2])
    expect(groups[0].fragments[1].source).toBe(sources[2])
    expect(groups[1].fragments[0].citationIndex).toBe(2)
  })

  it('does not merge different documents with identical filenames or unknown identities', () => {
    const groups = groupChatSources([
      source({ docId: 'a' }), source({ docId: 'b' }), source({ docId: '' }), source({ docId: '' })
    ])
    expect(groups).toHaveLength(4)
    expect(new Set(groups.map(group => group.key)).size).toBe(4)
  })

  it('retains every citation even when two returned fragments have identical content', () => {
    const repeated = source()
    const groups = groupChatSources([repeated, { ...repeated }])
    expect(groups).toHaveLength(1)
    expect(groups[0].fragments).toHaveLength(2)
    expect(chatSourcesSummary(groups)).toBe('资料来源 · 1 份文档 · 2 个片段')
  })

  it('combines actual retrieval modes without presenting storage engines as independent sources', () => {
    const groups = groupChatSources([
      source({ backend: 'qdrant', hitModes: 'vector,keyword' }),
      source({ backend: 'parent_child', hitModes: 'vector|parent_child' })
    ])
    expect(groups[0].channels).toEqual(['语义检索', '关键词匹配', '关联段落'])
    expect(chatSourceChannels(source({ backend: 'memory,unknown_engine' }))).toEqual([])
    expect(chatSourceChannels(source({ backend: 'qdrant' }))).toEqual(['语义检索'])
    expect(chatSourceChannels(source({ hitModes: 'keyword + vector;parent_child' })))
      .toEqual(['关键词匹配', '语义检索', '关联段落'])
  })

  it('uses recorded section labels and bounded previews while retaining the complete source text', () => {
    const chunk = `第一行\n\n${'内容'.repeat(150)}`
    const groups = groupChatSources([source({ chunk, parentTitle: '3.2 LoRA 的参数', chunkIndex: '7' })])
    const fragment = groups[0].fragments[0]
    expect(fragment.label).toBe('3.2 LoRA 的参数')
    expect(fragment.preview.length).toBeLessThanOrEqual(161)
    expect(fragment.preview).not.toContain('\n')
    expect(fragment.source.chunk).toBe(chunk)
    expect(groupChatSources([source({ chunkIndex: '7' })])[0].fragments[0].label).toBe('片段 7')
  })

  it('does not expose a document ID as the title of an unnamed document', () => {
    expect(chatSourceDocumentTitle(source({ title: '', docId: 'raw-internal-id' }))).toBe('未命名文档')
    expect(chatSourceDocumentTitle(source({ title: 'C#12 使用指南.pdf' }))).toBe('C#12 使用指南.pdf')
    expect(chatSourcesSummary([])).toBe('资料来源 · 0 份文档 · 0 个片段')
  })
})
