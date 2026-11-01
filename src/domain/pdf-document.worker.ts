import { createPdfDocument } from './pdf-document'

self.onmessage = async (event: MessageEvent<{ content: string; title: string }>) => {
  try {
    const blob = await createPdfDocument(event.data.content, event.data.title)
    const bytes = await blob.arrayBuffer()
    // One request per worker; the caller terminates it after transfer.
    postMessage({ bytes }, { transfer: [bytes] })
  } catch (error) { postMessage({ error: error instanceof Error ? error.message : 'PDF 生成失败，请重试。' }) }
}
