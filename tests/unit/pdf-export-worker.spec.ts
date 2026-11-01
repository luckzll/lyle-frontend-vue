import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPdfExport } from '../../src/domain/pdf-export'
const workers: FakeWorker[] = []
class FakeWorker {
  terminate = vi.fn(); postMessage = vi.fn()
  onmessage?: (event: { data: { bytes?: ArrayBuffer; error?: string } }) => void
  onerror?: () => void
  constructor() { workers.push(this) }
}
beforeEach(() => { workers.length = 0; vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('PDF background generation lifecycle', () => {
  it('does not start a decoder for a draft replaced while typing', async () => {
    const controller = new AbortController(); const result = createPdfExport('旧正文', '报告', controller.signal)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await rejected; await vi.advanceTimersByTimeAsync(300)
    expect(workers).toHaveLength(0)
  })
  it('terminates a running generation when its export card changes', async () => {
    const controller = new AbortController(); const result = createPdfExport('旧正文', '报告', controller.signal)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(200); expect(workers[0]!.postMessage).toHaveBeenCalledWith({ content: '旧正文', title: '报告' })
    controller.abort(); await rejected; expect(workers[0]!.terminate).toHaveBeenCalledOnce()
  })
  it('returns the transferred PDF and releases the worker', async () => {
    const result = createPdfExport('正文', '报告'); await vi.advanceTimersByTimeAsync(200)
    workers[0]!.onmessage!({ data: { bytes: new TextEncoder().encode('%PDF-1.7').buffer } })
    expect((await result).type).toBe('application/pdf')
    expect(await (await result).text()).toBe('%PDF-1.7')
    expect(workers[0]!.terminate).toHaveBeenCalledOnce()
  })
})
