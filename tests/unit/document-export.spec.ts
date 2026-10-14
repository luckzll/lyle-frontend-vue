import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { createDocumentBlob, documentFilename, saveDocumentFile, type SavePickerWindow } from '../../src/domain/document-export'

describe('document export', () => {
  it('generates a real OOXML Word document with Chinese headings, tables and external links', async () => {
    const blob = await createDocumentBlob('# 项目周报\n\n**已完成**：文件读取。\n\n| 项目 | 状态 |\n| --- | --- |\n| Lyle | 正常 |\n\n[项目网站](https://example.com/report)\n\n```ts\nconst x = "<安全>"\n```', 'docx', '项目周报')
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
    expect(xml).toContain('项目周报'); expect(xml).toContain('Heading1')
    expect(xml).toContain('<w:tbl>'); expect(xml).toContain('Lyle'); expect(xml).toContain('<w:b')
    expect(xml).toContain('&lt;安全&gt;'); expect(rels).toContain('https://example.com/report')
    expect(zip.file('[Content_Types].xml')).not.toBeNull()
  })
  it('exports Markdown without losing the source or silently truncating it', async () => {
    const text = '# 周报\n\n| 进展 | 说明 |\n| --- | --- |\n| 完成 | 中文 |'
    expect(await (await createDocumentBlob(text, 'md', '周报')).text()).toBe(text)
    await expect(createDocumentBlob(' ', 'docx', '空')).rejects.toThrow('没有可导出')
    await expect(createDocumentBlob('x'.repeat(200001), 'md', '长')).rejects.toThrow('分段')
  })
  it('uses a filename rather than an arbitrary path and handles reserved Windows names', () => {
    expect(documentFilename('../周报:最终.docx', 'md')).toBe('.._周报_最终.md')
    expect(documentFilename('CON.docx', 'docx')).toBe('_CON.docx')
    expect(documentFilename('报告.docx', 'md')).toBe('报告.md')
    expect(documentFilename('', 'docx')).toBe('聊天整理.docx')
  })
  it('opens the picker in the click turn and reports success only after the write closes', async () => {
    let complete!: () => void
    const writer = { write: vi.fn(async () => {}), close: vi.fn(() => new Promise<void>(resolve => { complete = resolve })), abort: vi.fn(async () => {}) }
    const picker = vi.fn(async () => ({ name: '所选名称.docx', createWritable: async () => writer }))
    const browser: SavePickerWindow = { isSecureContext: true, showSaveFilePicker: picker }
    let finished = false
    const pending = saveDocumentFile(new Blob(['test']), '周报.docx', 'docx', browser).then(result => { finished = true; return result })
    expect(picker).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(writer.close).toHaveBeenCalledOnce())
    expect(finished).toBe(false)
    complete(); expect(await pending).toEqual({ status: 'saved', name: '所选名称.docx' })
  })
  it('does not write or download on picker cancellation and aborts a failed write', async () => {
    const cancelled = { showSaveFilePicker: vi.fn(async () => { throw new DOMException('cancelled', 'AbortError') }) }
    expect((await saveDocumentFile(new Blob(['test']), '周报.docx', 'docx', cancelled)).status).toBe('cancelled')
    const writer = { write: vi.fn(async () => { throw new Error('disk full') }), close: vi.fn(), abort: vi.fn(async () => {}) }
    const failed = { showSaveFilePicker: async () => ({ name: '周报.docx', createWritable: async () => writer }) }
    await expect(saveDocumentFile(new Blob(['test']), '周报.docx', 'docx', failed)).rejects.toThrow('disk full')
    expect(writer.abort).toHaveBeenCalledOnce(); expect(writer.close).not.toHaveBeenCalled()
  })
})
