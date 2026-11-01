/** Keep font decoding and pagination off the chat UI thread. */
export async function createPdfExport(content: string, title: string, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted()
  if (typeof Worker === 'undefined') {
    const { createPdfDocument } = await import('./pdf-document')
    return createPdfDocument(content, title)
  }
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined; let timer: ReturnType<typeof setTimeout> | undefined
    function stop() { clearTimeout(start); clearTimeout(timer); worker?.terminate(); signal?.removeEventListener('abort', abort) }
    function abort() { stop(); reject(new DOMException('PDF 生成已取消。', 'AbortError')) }
    // Typing in an open editor must not start a new font decoder on every key.
    const start = setTimeout(() => {
      if (signal?.aborted) { abort(); return }
      try {
        worker = new Worker(new URL('./pdf-document.worker.ts', import.meta.url), { type: 'module' })
        timer = setTimeout(() => { stop(); reject(new Error('PDF 生成超时，请缩短正文后重试。')) }, 120_000)
        worker.onmessage = (event: MessageEvent<{ bytes?: ArrayBuffer; error?: string }>) => {
          stop()
          if (event.data.error) reject(new Error(event.data.error))
          else if (event.data.bytes instanceof ArrayBuffer) resolve(new Blob([event.data.bytes], { type: 'application/pdf' }))
          else reject(new Error('PDF 生成结果无效，请重试。'))
        }
        worker.onerror = () => { stop(); reject(new Error('PDF 生成失败，请刷新页面后重试。')) }
        worker.postMessage({ content, title })
      } catch { stop(); reject(new Error('当前浏览器无法生成 PDF，请更新浏览器后重试。')) }
    }, 200)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
