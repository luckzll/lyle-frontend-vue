import { DOCUMENT_MIMES } from './document-export'
import { splitDocumentTableRow } from './word-document'

export function spreadsheetRows(content: string): string[][] {
  return content.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim() && !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
    .map(line => line.includes('|') ? splitDocumentTableRow(line) : line.split('\t'))
}
export function presentationPages(content: string, title: string) {
  const pages: { title: string; body: string }[] = []
  let heading = title; let body: string[] = []
  const flush = () => { if (body.length || !pages.length) pages.push({ title: heading, body: body.join('\n') }); body = [] }
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const match = line.match(/^#{1,3}\s+(.+)/)
    if (match) { if (body.length) flush(); heading = match[1]!; continue }
    // Fixed line/character budgets keep arbitrary long input inside slide boundaries.
    for (let start = 0; start < Math.max(1, line.length); start += 42) {
      if (body.length >= 9) { flush(); heading = `${heading.replace(/（续）$/, '')}（续）` }
      body.push(line.slice(start, start + 42))
    }
  }
  if (body.length || !pages.length) flush()
  if (pages.length > 150) throw new Error('幻灯片超过 150 页，请分段生成。')
  if (pages.some(page => page.title.length > 80)) throw new Error('幻灯片标题超过 80 字，请缩短标题后再生成。')
  return pages
}
export async function createOfficeDraft(content: string, format: 'xlsx' | 'pptx', title: string): Promise<Blob> {
  if (format === 'xlsx') {
    const { default: ExcelJS } = await import('exceljs')
    const book = new ExcelJS.Workbook(); book.creator = 'Lyle'; book.title = title
    const sheet = book.addWorksheet('正文草稿')
    const rows = spreadsheetRows(content)
    if (rows.length > 5000 || rows.some(row => row.length > 100)) throw new Error('表格超过 5000 行或 100 列，请分段生成。')
    // Strings remain literal cells: never execute formulas from model/uploaded content.
    sheet.addRows(rows)
    sheet.eachRow(row => { row.height = 30; row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; cell.font = { name: 'Microsoft YaHei', size: 11 } }) })
    sheet.columns.forEach(column => { column.width = 28 })
    sheet.getRow(1).font = { bold: true, name: 'Microsoft YaHei', size: 12 }
    const bytes = await book.xlsx.writeBuffer()
    return new Blob([new Uint8Array(bytes)], { type: DOCUMENT_MIMES.xlsx })
  }
  const { default: PptxGenJS } = await import('pptxgenjs')
  const deck = new PptxGenJS(); deck.layout = 'LAYOUT_WIDE'; deck.author = 'Lyle'; deck.title = title
  deck.subject = '由正文草稿重新生成'
  const pages = presentationPages(content, title)
  for (const [index, page] of pages.entries()) {
    const slide = deck.addSlide(); slide.background = { color: 'F8FAFC' }
    slide.addText(page.title, { x: 0.6, y: 0.4, w: 12, h: 0.85, fontFace: 'Microsoft YaHei', fontSize: 26, bold: true, color: '1E293B', breakLine: false, fit: 'shrink' })
    slide.addText(page.body, { x: 0.65, y: 1.55, w: 12, h: 5.1, fontFace: 'Microsoft YaHei', fontSize: 20, color: '334155', valign: 'top', margin: 0, breakLine: false, fit: 'shrink' })
    slide.addText(`${index + 1} / ${pages.length}`, { x: 11.8, y: 7.08, w: 0.9, h: 0.2, fontSize: 10, color: '64748B' })
  }
  return await deck.write({ outputType: 'blob' }) as Blob
}
