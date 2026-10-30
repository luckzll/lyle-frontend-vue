export type DocumentFormat = 'docx' | 'md' | 'xlsx' | 'pptx'
export const DOCUMENT_MIMES: Record<DocumentFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', md: 'text/markdown',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}
export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const MAX_DOCUMENT_CHARACTERS = 200_000

export function documentTitle(content: string, fallback = '聊天整理') {
  const heading = content.match(/^#{1,6}\s+(.+)$/m)?.[1]
  return (heading || fallback).replace(/[*`#]/g, '').trim().slice(0, 70) || '聊天整理'
}

export function documentFilename(value: string, format: DocumentFormat) {
  let stem = value.trim().replace(/\.(docx|md|xlsx|xlsm|xls|pptx|pdf)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '')
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem)) stem = '_' + stem
  return `${stem.slice(0, 100) || '聊天整理'}.${format}`
}

export function wantsDocumentExport(question: string) {
  return /(?:word|docx|excel|xlsx|pptx?|powerpoint|pdf|markdown|\.md\b|导出|保存.{0,12}(?:文档|文件)|(?:整理|生成|做成).{0,16}(?:文档|报告|周报))/i.test(question)
}

export async function createDocumentBlob(content: string, format: DocumentFormat, title: string) {
  if (!content.trim()) throw new Error('没有可导出的正文。')
  if (content.length > MAX_DOCUMENT_CHARACTERS) throw new Error('内容超过 20 万字，请分段导出。')
  if (format === 'md') return new Blob([content], { type: 'text/markdown;charset=utf-8' })
  if (format === 'xlsx' || format === 'pptx') {
    const { createOfficeDraft } = await import('./office-draft-export')
    return createOfficeDraft(content, format, title)
  }
  const { createWordDocument } = await import('./word-document')
  return createWordDocument(content, title)
}

export interface DocumentFileHandle {
  name: string
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>
}
export interface SavePickerWindow {
  isSecureContext?: boolean
  showSaveFilePicker?: (options: object) => Promise<DocumentFileHandle>
}
export function canChooseDocumentLocation(browser: SavePickerWindow = window) {
  return browser.isSecureContext !== false && typeof browser.showSaveFilePicker === 'function'
}

/** Call directly from a user click, with the document already prepared. */
export async function saveDocumentFile(blob: Blob, filename: string, format: DocumentFormat, browser: SavePickerWindow = window) {
  if (!canChooseDocumentLocation(browser)) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = filename; link.hidden = true
    document.body.append(link)
    try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000) }
    return { status: 'downloaded' as const, name: filename }
  }
  let handle: DocumentFileHandle
  try {
    handle = await browser.showSaveFilePicker!({
      suggestedName: filename, startIn: 'documents', id: 'lyle-document-export',
      types: [{ description: `${format.toUpperCase()} 文档`,
        accept: { [DOCUMENT_MIMES[format]]: [`.${format}`] } }],
      excludeAcceptAllOption: true
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return { status: 'cancelled' as const, name: filename }
    throw error
  }
  const writer = await handle.createWritable()
  try { await writer.write(blob); await writer.close() }
  catch (error) { await writer.abort().catch(() => undefined); throw error }
  return { status: 'saved' as const, name: handle.name }
}
