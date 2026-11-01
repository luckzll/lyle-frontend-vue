import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import MarkdownIt from 'markdown-it'
import fontUrl from '@/assets/pdf/NotoSansSC-Regular.ttf.gz?url'
import symbolsUrl from '@/assets/pdf/NotoEmoji.ttf.gz?url'
import fullFontUrl from '@/assets/pdf/NotoSansSC-Full.ttf.gz?url'

type Token = { type: string; content: string; tag: string; children?: Token[] | null; attrGet(name: string): string | number | null }
type Block = { kind: 'text'; text: string; level?: number; code?: boolean } | { kind: 'table'; rows: string[][] }
const markdown = new MarkdownIt({ html: false })
const fontRequests = new Map<string, Promise<ArrayBuffer>>()
async function fontBytes(url = fontUrl) {
  if (!fontRequests.has(url)) fontRequests.set(url, (async () => {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error('font download failed')
      const bytes = await response.arrayBuffer(); const signature = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength))
      // Serve gzip as an ordinary asset; decode to valid TrueType before embedding.
      if (signature[0] === 0x1f && signature[1] === 0x8b) {
        return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      }
      return bytes
    } catch { fontRequests.delete(url); throw new Error('PDF 中文字体加载失败，请检查网络后重试。') }
    finally { clearTimeout(timeout) }
  })())
  return fontRequests.get(url)!
}
function inline(token: Token) {
  if (!token.children) return token.content
  return token.children.map(child => {
    if (child.type === 'softbreak' || child.type === 'hardbreak') return '\n'
    if (child.type === 'image') return `图片：${child.content || '图片'} (${child.attrGet('src') || ''})`
    if (child.type === 'link_open') return ''
    if (child.type === 'link_close') return ''
    return child.type === 'text' || child.type === 'code_inline' ? child.content : ''
  }).join('')
}
export function pdfBlocks(content: string): Block[] {
  const tokens = markdown.parse(content, {}); const blocks: Block[] = []
  const lists: (number | undefined)[] = []; let prefix = ''
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at]!
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') lists.push(token.type === 'ordered_list_open' ? Number(token.attrGet('start') || 1) : undefined)
    else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') lists.pop()
    else if (token.type === 'list_item_open') {
      const index = lists.length - 1; const number = lists[index]
      prefix = '  '.repeat(Math.max(0, index)) + (number === undefined ? '• ' : `${number}. `)
      if (number !== undefined) lists[index] = number + 1
    } else if (token.type === 'heading_open') {
      blocks.push({ kind: 'text', text: inline(tokens[++at]!), level: Number(token.tag.slice(1)) })
    } else if (token.type === 'inline') { blocks.push({ kind: 'text', text: prefix + inline(token) }); prefix = '' }
    else if (token.type === 'fence' || token.type === 'code_block') blocks.push({ kind: 'text', text: token.content.replace(/\n$/, ''), code: true })
    else if (token.type === 'hr') blocks.push({ kind: 'text', text: '────────────────────' })
    else if (token.type === 'table_open') {
      const rows: string[][] = []; let cells: string[] = []
      while (++at < tokens.length && tokens[at]!.type !== 'table_close') {
        const item = tokens[at]!
        if (item.type === 'tr_open') cells = []
        else if (item.type === 'inline') cells.push(inline(item))
        else if (item.type === 'tr_close') rows.push(cells)
      }
      blocks.push({ kind: 'table', rows })
    }
  }
  return blocks
}

/** Chinese text stays searchable/selectable; no screenshots or print dialog. */
export async function createPdfDocument(content: string, title: string, suppliedFont?: Uint8Array, suppliedSymbols?: Uint8Array, suppliedFull?: Uint8Array): Promise<Blob> {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit)
  let chineseBytes = suppliedFont || new Uint8Array(await fontBytes())
  const available = new Set((fontkit.create(chineseBytes) as { characterSet: number[] }).characterSet)
  if (Array.from(content + title).some(char => /\p{Script=Han}/u.test(char) && !available.has(char.codePointAt(0)!))) {
    chineseBytes = suppliedFull || new Uint8Array(await fontBytes(fullFontUrl))
  }
  // Keep the fontTools-validated subset intact. Re-subsetting CJK composite glyphs
  // with this fontkit version can leave searchable but invisible characters.
  const font = await pdf.embedFont(chineseBytes, { subset: false })
  pdf.setTitle(title); pdf.setCreator('Lyle'); pdf.setProducer('Lyle / pdf-lib')
  const supported = new Set(font.getCharacterSet())
  let symbols: PDFFont | undefined; let symbolSet: Set<number> | undefined
  const clean = (value: string) => value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufe0e\ufe0f]/g, '')
  const blocks = pdfBlocks(content)
  if (blocks[0]?.kind !== 'text' || !blocks[0].level) blocks.unshift({ kind: 'text', text: title, level: 1 })
  for (const block of blocks) {
    const text = block.kind === 'text' ? block.text : block.rows.flat().join('\n')
    const missingFromPrimary = Array.from(clean(text)).some(char => char !== '\n' && !supported.has(char.codePointAt(0)!))
    if (missingFromPrimary && !symbols) {
      symbols = await pdf.embedFont(suppliedSymbols || await fontBytes(symbolsUrl), { subset: true })
      symbolSet = new Set(symbols.getCharacterSet())
    }
    const missing = Array.from(clean(text)).find(char => char !== '\n' && !supported.has(char.codePointAt(0)!) && !symbolSet?.has(char.codePointAt(0)!))
    if (missing) throw new Error(`PDF 字体暂不支持字符“${missing}”，请替换该字符后导出。`)
  }
  const fontFor = (char: string) => supported.has(char.codePointAt(0)!) ? font : symbols!
  const width = 595.28; const height = 841.89; const margin = 48; const bottom = 52; const usable = width - margin * 2
  const ink = rgb(0.12, 0.16, 0.23); const gray = rgb(0.40, 0.45, 0.52); const border = rgb(0.80, 0.83, 0.88)
  let page!: PDFPage; let y = 0
  function nextPage() {
    if (pdf.getPageCount() >= 200) throw new Error('PDF 超过 200 页，请分段导出。')
    page = pdf.addPage([width, height]); y = height - margin
  }
  nextPage()
  function ensure(space: number) { if (y - space < bottom) nextPage() }
  const widths = new Map<string, number>()
  function wrap(value: string, size: number, max: number) {
    const lines: string[] = []
    for (const paragraph of clean(value).split('\n')) {
      let line = ''; let used = 0
      for (const char of paragraph) {
        const key = `${size}:${char}`; let advance = widths.get(key)
        if (advance === undefined) { advance = fontFor(char).widthOfTextAtSize(char, size); widths.set(key, advance) }
        if (line && used + advance > max) { lines.push(line); line = ''; used = 0 }
        line += char; used += advance
      }
      lines.push(line)
    }
    return lines
  }
  function text(line: string, x: number, top: number, size: number, color = ink) {
    let run = ''; let selected: PDFFont | undefined
    function flush() { if (run && selected) { page.drawText(run, { x, y: top - size, size, font: selected, color }); x += selected.widthOfTextAtSize(run, size); run = '' } }
    for (const char of line) { const next = fontFor(char); if (selected && next !== selected) flush(); selected = next; run += char }
    flush()
  }
  for (const block of blocks) {
    if (block.kind === 'text') {
      const size = block.level ? [22, 17, 14, 12, 12, 11][block.level - 1]! : block.code ? 10 : 11
      const lineHeight = size * 1.65; const lines = wrap(block.text, size, usable - (block.code ? 16 : 0))
      // Keep section headings with the beginning of their paragraph/table.
      ensure(block.level ? lineHeight * lines.length + 90 : lineHeight * Math.min(lines.length, 3) + 10)
      if (block.level) y -= 8
      for (const line of lines) {
        ensure(lineHeight)
        if (block.code) page.drawRectangle({ x: margin, y: y - lineHeight, width: usable, height: lineHeight, color: rgb(0.95, 0.96, 0.98) })
        text(line, margin + (block.code ? 8 : 0), y, size); y -= lineHeight
      }
      y -= block.level ? 9 : 8
      continue
    }
    if (!block.rows.length) continue
    const columns = Math.max(...block.rows.map(row => row.length))
    if (columns > 10) throw new Error('PDF 表格超过 10 列，请拆分表格后导出。')
    const cellWidth = usable / columns; const size = 10; const step = 16; const padding = 7
    const cellsFor = (row: string[]) => Array.from({ length: columns }, (_, col) => wrap(row[col] || '', size, cellWidth - padding * 2))
    const heading = cellsFor(block.rows[0]!); const headerLines = Math.max(...heading.map(cell => cell.length))
    if (headerLines > 8) throw new Error('PDF 表头过长，请精简表头后导出。')
    const headerHeight = headerLines * step + padding * 2
    function row(cells: string[][], offset: number, count: number, header = false) {
      const rowHeight = count * step + padding * 2
      for (let col = 0; col < columns; col++) {
        page.drawRectangle({ x: margin + col * cellWidth, y: y - rowHeight, width: cellWidth, height: rowHeight, borderColor: border, borderWidth: 0.5, ...(header ? { color: rgb(0.94, 0.95, 0.98) } : {}) })
        for (let line = 0; line < count; line++) text(cells[col]![line + offset] || '', margin + col * cellWidth + padding, y - padding - line * step, size)
      }
      y -= rowHeight
    }
    ensure(headerHeight + step + padding * 2); row(heading, 0, headerLines, true)
    for (const values of block.rows.slice(1)) {
      const cells = cellsFor(values); const total = Math.max(...cells.map(cell => cell.length)); let offset = 0
      while (offset < total) {
        let available = Math.floor((y - bottom - padding * 2) / step)
        if (available < 1) { nextPage(); row(heading, 0, headerLines, true); available = Math.floor((y - bottom - padding * 2) / step) }
        const count = Math.min(available, total - offset); row(cells, offset, count); offset += count
      }
    }
    y -= 12
  }
  for (const [index, item] of pdf.getPages().entries()) {
    item.drawLine({ start: { x: margin, y: 35 }, end: { x: width - margin, y: 35 }, color: border, thickness: 0.5 })
    const label = `${index + 1} / ${pdf.getPageCount()}`
    item.drawText(label, { x: (width - font.widthOfTextAtSize(label, 9)) / 2, y: 20, font, size: 9, color: gray })
  }
  return new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' })
}
