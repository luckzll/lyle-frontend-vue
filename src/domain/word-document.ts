import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'

type Inline = TextRun | ExternalHyperlink
function safeLink(value: string) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : '' } catch { return '' }
}
function inline(text: string): Inline[] {
  const runs: Inline[] = []
  const pattern = /(!?)\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*]+)\*/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index! > cursor) runs.push(new TextRun(text.slice(cursor, match.index)))
    if (match[3]) {
      const label = match[1] ? `图片：${match[2] || '查看原图'}` : match[2] || match[3]
      const url = safeLink(match[3])
      runs.push(url ? new ExternalHyperlink({ link: url, children: [new TextRun({ text: label, style: 'Hyperlink' })] }) : new TextRun(label))
    } else runs.push(new TextRun({ text: match[4] || match[5] || match[6] || match[7] || '',
      bold: Boolean(match[4] || match[5]), italics: Boolean(match[7]),
      ...(match[6] ? { font: 'Consolas', shading: { fill: 'F1F5F9' } } : {}) }))
    cursor = match.index! + match[0].length
  }
  if (cursor < text.length) runs.push(new TextRun(text.slice(cursor)))
  return runs.length ? runs : [new TextRun('')]
}
export function splitDocumentTableRow(line: string) {
  const value = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []; let cell = ''; let code = false
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === '\\' && value[i + 1] === '|') { cell += '|'; i++; continue }
    if (char === '`') code = !code
    if (char === '|' && !code) { cells.push(cell.trim()); cell = '' } else cell += char
  }
  cells.push(cell.trim()); return cells
}

export async function createWordDocument(content: string, title: string) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > 5000) throw new Error('段落过多，请分段导出。')
  const children: (Paragraph | Table)[] = []
  if (!/^#{1,6}\s/.test(lines.find(line => line.trim()) || '')) children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }))
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*```/.test(line)) {
      while (++i < lines.length && !/^\s*```/.test(lines[i]!)) children.push(new Paragraph({
        children: [new TextRun({ text: lines[i]!, font: 'Consolas', size: 19 })], shading: { fill: 'F1F5F9' }, spacing: { after: 0 } }))
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1]!)) {
      const rows = [splitDocumentTableRow(line)]; i++
      while (i + 1 < lines.length && lines[i + 1]!.trim() && lines[i + 1]!.includes('|')) rows.push(splitDocumentTableRow(lines[++i]!))
      const columns = Math.max(...rows.map(row => row.length))
      if (columns > 20) { for (const row of rows) children.push(new Paragraph(row.join(' | '))); continue }
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map((row, index) => new TableRow({
        tableHeader: index === 0, children: Array.from({ length: columns }, (_, column) => new TableCell({
          ...(index === 0 ? { shading: { fill: 'EDF2FF' } } : {}),
          children: [new Paragraph({ children: index === 0 ? [new TextRun({ text: row[column] || '', bold: true })] : inline(row[column] || '') })]
        })) })) }))
      children.push(new Paragraph('')); continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) { children.push(new Paragraph({ children: inline(heading[2]!), heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][heading[1]!.length - 1] })); continue }
    const list = line.match(/^(\s*)(?:([-+*])|(\d+)[.)])\s+(.+)$/)
    if (list) { children.push(new Paragraph({ children: inline((list[3] ? `${list[3]}. ` : '') + list[4]),
      ...(list[2] ? { bullet: { level: Math.min(4, Math.floor(list[1]!.length / 2)) } } : { indent: { left: 360, hanging: 300 } }) })); continue }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { children.push(new Paragraph('')); continue }
    children.push(new Paragraph({ children: inline(line.replace(/^>\s?/, '')), spacing: { after: line.trim() ? 120 : 60 } }))
  }
  return Packer.toBlob(new Document({ creator: 'Lyle AI', title,
    styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 }, paragraph: { spacing: { line: 330 } } } } },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }] }))
}
