import { describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { LocalWorkspace, type LocalDirectoryHandle } from '@/domain/local-workspace'
import { fileAttachmentWorkspace, folderFilesWorkspace, LocalConversationWorkspace } from '@/domain/local-workspace-attachments'
import { documentName, MAX_WORKSPACE_DOCUMENT_BYTES } from '@/domain/local-workspace-documents'

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
const signal = () => new AbortController().signal
function folder(file: File): LocalDirectoryHandle {
  return { kind: 'directory', name: 'docs', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    entries: async function* () { yield [file.name, await this.getFileHandle(file.name)] },
    getDirectoryHandle: async () => { throw new Error('missing') },
    getFileHandle: async () => ({ kind: 'file', name: file.name, getFile: async () => file, createWritable: async () => { throw new Error('no write') } }) }
}
describe('workspace document reads', () => {
  it.each(['report.pdf', 'notes.DOCX', 'budget.xlsx', 'macro.xlsm', 'legacy.xls', 'slides.pptx'])('lists %s without reading contents', async name => {
    const root = folder(new File(['bytes'], name)); const getFile = vi.fn(); const extract = vi.fn()
    const original = root.getFileHandle; root.getFileHandle = async name => ({ ...await original(name), getFile })
    const result = await new LocalWorkspace(root, extract).list()
    expect(result.entries).toEqual([{ kind: 'file', name, path: name, contentType: 'document' }])
    expect(getFile).not.toHaveBeenCalled(); expect(extract).not.toHaveBeenCalled()
    expect(documentName(name)).toBe(true)
  })
  it('reads actual selected bytes once, preserves Unicode pagination and marks partial extraction', async () => {
    const text = '内容🚀'.repeat(8000)
    const extract = vi.fn(async (file: File) => {
      expect(await file.text()).toBe('selected binary bytes')
      return { text, format: 'docx', truncated: true, warnings: ['已达到解析上限'] }
    })
    const workspace = new LocalWorkspace(folder(new File(['selected binary bytes'], 'notes.docx')), extract)
    let offset: number | null = 0; let combined = ''
    while (offset !== null) {
      const result = await workspace.executeRead({ id: 'r', name: 'workspace_read', args: { path: 'notes.docx', offset } }, signal())
      expect('content' in result).toBe(true)
      if (!('content' in result)) throw new Error('wrong read')
      expect(result).toMatchObject({ kind: 'document', access: 'read-only', truncated: true, warnings: ['已达到解析上限'] })
      combined += result.content; offset = result.nextOffset
    }
    expect(combined).toBe(text); expect(extract).toHaveBeenCalledTimes(1)
    await expect(workspace.preview({ id: 'w', name: 'workspace_edit', args: { path: 'notes.docx' } })).rejects.toThrow('不能')
  })
  it('invalidates parsed cache when document bytes change and does not cache failed reads', async () => {
    let file = new File(['one'], 'report.pdf'); const root = folder(file)
    root.getFileHandle = async () => ({ kind: 'file', name: file.name, getFile: async () => file, createWritable: async () => { throw new Error('no') } })
    const extract = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue({ text: 'parsed', format: 'pdf', truncated: false, warnings: [] })
    const ws = new LocalWorkspace(root, extract)
    await expect(ws.readDocument(file.name, 0, signal())).rejects.toThrow('unavailable')
    await ws.readDocument(file.name, 0, signal())
    file = new File(['two'], file.name); await ws.readDocument(file.name, 0, signal())
    expect(extract).toHaveBeenCalledTimes(3)
  })
  it('mounts Office/PDF files and fallback folder documents as current conversation attachments', async () => {
    const file = new File(['selected'], 'deck.pptx')
    expect((await fileAttachmentWorkspace(file).list()).entries[0]?.contentType).toBe('document')
    Object.defineProperty(file, 'webkitRelativePath', { value: 'materials/deck.pptx' })
    const workspace = folderFilesWorkspace([file])
    const convo = new LocalConversationWorkspace(undefined, [{ id: 'doc', name: 'materials', path: '@attachments/doc', kind: 'folder', writable: false, workspace }])
    expect((await convo.executeRead({ id: 'l', name: 'workspace_list', args: { path: '@attachments/doc' } }, signal())).entries?.[0]?.path).toBe('@attachments/doc/deck.pptx')
    await expect(new LocalConversationWorkspace(undefined, []).executeRead({ id: 'l', name: 'workspace_list', args: { path: '@attachments/doc' } }, signal())).rejects.toThrow('当前不可用')
  })
  it('rejects oversized, legacy or cancelled document requests before extraction', async () => {
    expect(() => fileAttachmentWorkspace(new File(['old'], 'old.doc'))).toThrow('转换')
    expect(() => fileAttachmentWorkspace(new File([new Uint8Array(MAX_WORKSPACE_DOCUMENT_BYTES + 1)], 'large.xlsx'))).toThrow('5 MB')
    const extract = vi.fn(); const ws = new LocalWorkspace(folder(new File(['x'], 'report.pdf')), extract)
    const controller = new AbortController(); controller.abort()
    await expect(ws.executeRead({ id: 'r', name: 'workspace_read', args: { path: 'report.pdf' } }, controller.signal)).rejects.toThrow()
    expect(extract).not.toHaveBeenCalled()
  })
})
