import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { gunzipSync, gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { createDocumentBlob, documentFilename, saveDocumentFile } from '../../src/domain/document-export'
import { createPdfDocument, pdfBlocks } from '../../src/domain/pdf-document'

const font = new Uint8Array(gunzipSync(await readFile(new URL('../../src/assets/pdf/NotoSansSC-Regular.ttf.gz', import.meta.url))))
const symbols = new Uint8Array(gunzipSync(await readFile(new URL('../../src/assets/pdf/NotoEmoji.ttf.gz', import.meta.url))))
const fullFont = new Uint8Array(gunzipSync(await readFile(new URL('../../src/assets/pdf/NotoSansSC-Full.ttf.gz', import.meta.url))))
function embeddedFont(pdf: PDFDocument) {
  const fonts = pdf.getPages()[0]!.node.Resources()!.lookup(PDFName.of('Font'), PDFDict)
  const descendant = fonts.lookup(fonts.keys()[0]!, PDFDict).lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict)
  const stream = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict).lookup(PDFName.of('FontFile2'), PDFRawStream)
  return decodePDFRawStream(stream).decode()
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
afterEach(() => vi.unstubAllGlobals())
describe('direct Chinese PDF export', () => {
  it('keeps headings, list numbers, blank cells and image descriptions from Markdown', () => {
    const blocks = pdfBlocks('# 报告\n\n1. **第一项**\n2. 第二项\n\n| 名称 | 备注 |\n| --- | --- |\n| 内容 | |\n\n![流程图](https://example.com/chart.png)')
    expect(blocks).toContainEqual({ kind: 'text', text: '报告', level: 1 })
    expect(blocks).toContainEqual({ kind: 'text', text: '2. 第二项' })
    expect(blocks).toContainEqual({ kind: 'table', rows: [['名称', '备注'], ['内容', '']] })
    expect(blocks.at(-1)).toEqual({ kind: 'text', text: '图片：流程图 (https://example.com/chart.png)' })
  })
  it('returns a real PDF through the shared export flow and retries a failed font request', async () => {
    const fetchFont = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response(gzipSync(font)))
    vi.stubGlobal('fetch', fetchFont)
    await expect(createDocumentBlob('# 项目状态汇总报告\n中文正文', 'pdf', '报告')).rejects.toThrow('中文字体加载失败')
    const blob = await createDocumentBlob('# 项目状态汇总报告\n中文正文', 'pdf', '报告')
    expect(blob.type).toBe('application/pdf')
    expect(new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5))).toBe('%PDF-')
    const pdf = await PDFDocument.load(await blob.arrayBuffer())
    expect(pdf.getTitle()).toBe('报告')
    // Searchable text alone did not catch invisible CJK composite glyphs.
    expect(hash(embeddedFont(pdf))).toBe(hash(font))
    expect(documentFilename('项目状态汇总报告.docx', 'pdf')).toBe('项目状态汇总报告.pdf')
    expect(fetchFont).toHaveBeenCalledTimes(2)
    const writer = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) }
    const picker = vi.fn(async () => ({ name: '报告.pdf', createWritable: async () => writer }))
    const result = await saveDocumentFile(blob, '报告.pdf', 'pdf', { showSaveFilePicker: picker })
    expect(result.status).toBe('saved')
    expect(picker.mock.calls[0]![0]).toMatchObject({ types: [{ accept: { 'application/pdf': ['.pdf'] } }] })
    expect(writer.write).toHaveBeenCalledWith(blob)
  }, 30_000)
  it('renders long Chinese text, tables and a row spanning pages without dropping the ending', async () => {
    const rows = Array.from({ length: 105 }, (_, n) => `| 阶段${n + 1} | 已完成数据核对与方案评审 | ${n + 10} |`).join('\n')
    const text = '# 项目状态汇总报告\n\n## 一、项目进展\n\n✅ 当前项目按计划推进，预算为 120 万元。🎯\n\n1. 完成需求调研。\n2. 正在实施交付。\n\n## 二、任务明细\n\n| 阶段 | 说明 | 预算 |\n| --- | --- | --- |\n' + rows + '\n\n## 三、长行测试\n\n| 范围 | 内容 |\n| --- | --- |\n| 跨页长行 | ' + '项目文档编辑与中文导出。'.repeat(280) + '跨页长行结束。 |\n\n```text\nconst result = "中文与英文 code";\n```\n\n验收结束。'
    const blob = await createPdfDocument(text, '项目状态汇总报告', font, symbols)
    const bytes = new Uint8Array(await blob.arrayBuffer()); const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThan(3)
    expect(pdf.getPages().every(page => Math.abs(page.getWidth() - 595.28) < 0.01)).toBe(true)
    const folder = new URL('../../artifacts/pdf-export-2026-11-01/', import.meta.url)
    await mkdir(folder, { recursive: true }); await writeFile(new URL('pdf-export-qa.pdf', folder), bytes)
  }, 60_000)
  it('uses the full Chinese font for rare characters outside the common delivery subset', async () => {
    const blob = await createPdfDocument('生僻字：龘', '报告', font, symbols, fullFont)
    expect(hash(embeddedFont(await PDFDocument.load(await blob.arrayBuffer())))).toBe(hash(fullFont))
  }, 30_000)
  it('fails explicitly for unsupported characters and overly wide tables rather than exporting damaged text', async () => {
    await expect(createPdfDocument('未知字符\u{10ffff}', '报告', font, symbols)).rejects.toThrow('字体暂不支持')
    await expect(createPdfDocument('|'+Array(11).fill('列').join('|')+'|\n|'+Array(11).fill('---').join('|')+'|\n|'+Array(11).fill('内容').join('|')+'|', '报告', font)).rejects.toThrow('超过 10 列')
  }, 30_000)
})
