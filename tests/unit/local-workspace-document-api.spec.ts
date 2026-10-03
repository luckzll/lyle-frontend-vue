import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_WORKSPACE_DOCUMENT_BYTES, MAX_WORKSPACE_DOCUMENT_CHARS } from '@/domain/local-workspace-documents'

const auth = vi.hoisted(() => ({ initializeAuth: vi.fn(), getAuthToken: vi.fn() }))
vi.mock('@/auth', () => auth)
import { extractWorkspaceDocument } from '@/api/local-workspace-documents'

const parsed = { text: '真实文档内容🚀', format: 'pdf', truncated: false, warnings: [] }
const fetchMock = vi.fn()
function documentFile(size = 32, name = 'report.pdf') {
  const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 37 + 129) % 256)
  return { file: new File([bytes], name, { type: 'application/pdf' }), bytes }
}
function response(value: unknown = parsed, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }

beforeEach(() => {
  auth.initializeAuth.mockReset().mockResolvedValue(true)
  auth.getAuthToken.mockReset().mockReturnValue('authored-unit-token')
  fetchMock.mockReset().mockResolvedValue(response())
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('stateless workspace document extraction API', () => {
  it.each([12287, 12288, 12289, 24579])('round-trips every binary byte for %i bytes across base64 block boundaries', async size => {
    const { file, bytes } = documentFile(size)
    Object.defineProperty(file, 'webkitRelativePath', { value: 'selected-folder/private-subfolder/report.pdf' })
    const controller = new AbortController()
    expect(await extractWorkspaceDocument(file, controller.signal)).toEqual(parsed)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/local-workspace/document/extract')
    expect(options).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer authored-unit-token' } })
    expect(options.signal).toBe(controller.signal)
    const body = JSON.parse(options.body)
    expect(Object.keys(body).sort()).toEqual(['data', 'name'])
    expect(body.name).toBe('report.pdf')
    expect(body.name).not.toContain('/')
    expect(options.body).not.toContain(file.webkitRelativePath)
    expect(body.data).toBe(Buffer.from(bytes).toString('base64'))
    expect(new Uint8Array(Buffer.from(body.data, 'base64'))).toEqual(bytes)
    expect(body.data).not.toContain('data:')
  })

  it('uses authenticated cookies without inventing an Authorization header when no bearer token exists', async () => {
    auth.getAuthToken.mockReturnValue('')
    await extractWorkspaceDocument(documentFile().file, new AbortController().signal)
    expect(fetchMock.mock.calls[0]![1].credentials).toBe('include')
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it.each([
    [400, '文档无法解析，可能已损坏、加密或格式不符'],
    [401, '请重新登录后读取文档'],
    [413, '文档超过 5 MB 读取限制'],
    [429, '文档读取过于频繁，请稍后重试'],
    [502, '文档解析服务暂不可用，请稍后重试'],
  ] as const)('provides the correct user-facing branch for HTTP %i without exposing upstream diagnostics', async (status, message) => {
    fetchMock.mockResolvedValue(response({ detail: 'provider-private-diagnostic' }, status))
    await expect(extractWorkspaceDocument(documentFile().file, new AbortController().signal)).rejects.toThrow(message)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    { ...parsed, text: 42 },
    { ...parsed, text: 'x'.repeat(MAX_WORKSPACE_DOCUMENT_CHARS + 1) },
    { ...parsed, format: null },
    { ...parsed, truncated: 'false' },
    { ...parsed, warnings: 'warning' },
    { ...parsed, warnings: Array(9).fill('warning') },
    { ...parsed, warnings: [100] },
    { ...parsed, warnings: ['x'.repeat(501)] },
    [],
  ])('rejects a malformed or unbounded extraction result without retrying or uploading elsewhere', async result => {
    fetchMock.mockResolvedValue(response(result))
    await expect(extractWorkspaceDocument(documentFile().file, new AbortController().signal)).rejects.toThrow('文档解析响应无效')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/local-workspace/document/extract')
  })

  it.each(['legacy.doc', 'legacy.ppt', 'binary.exe'])('rejects unsupported %s before reading bytes, authenticating or requesting', async name => {
    const { file } = documentFile(32, name)
    const reading = vi.spyOn(file, 'arrayBuffer')
    await expect(extractWorkspaceDocument(file, new AbortController().signal)).rejects.toThrow('旧版 DOC/PPT 请先转换')
    expect(reading).not.toHaveBeenCalled()
    expect(auth.initializeAuth).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([0, MAX_WORKSPACE_DOCUMENT_BYTES + 1])('rejects a %i byte document before file reads, authentication and upload', async size => {
    const { file } = documentFile(size)
    const reading = vi.spyOn(file, 'arrayBuffer')
    await expect(extractWorkspaceDocument(file, new AbortController().signal)).rejects.toThrow('5 MB')
    expect(reading).not.toHaveBeenCalled()
    expect(auth.initializeAuth).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not send file bytes when authentication fails', async () => {
    auth.initializeAuth.mockResolvedValue(false)
    await expect(extractWorkspaceDocument(documentFile().file, new AbortController().signal)).rejects.toThrow('请重新登录后读取文档')
    expect(auth.getAuthToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not read or request an already cancelled file', async () => {
    const { file } = documentFile()
    const reading = vi.spyOn(file, 'arrayBuffer')
    const controller = new AbortController(); controller.abort()
    await expect(extractWorkspaceDocument(file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(reading).not.toHaveBeenCalled()
    expect(auth.initializeAuth).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not authenticate or upload after cancellation while file bytes are loading', async () => {
    const { file, bytes } = documentFile()
    const reading = deferred<ArrayBuffer>()
    vi.spyOn(file, 'arrayBuffer').mockReturnValue(reading.promise)
    const controller = new AbortController()
    const extracting = extractWorkspaceDocument(file, controller.signal)
    controller.abort(); reading.resolve(bytes.buffer as ArrayBuffer)
    await expect(extracting).rejects.toMatchObject({ name: 'AbortError' })
    expect(auth.initializeAuth).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not upload after cancellation during an asynchronous auth refresh', async () => {
    const refreshing = deferred<boolean>()
    auth.initializeAuth.mockReturnValue(refreshing.promise)
    const controller = new AbortController()
    const extracting = extractWorkspaceDocument(documentFile().file, controller.signal)
    await vi.waitFor(() => expect(auth.initializeAuth).toHaveBeenCalledOnce())
    controller.abort(); refreshing.resolve(true)
    await expect(extracting).rejects.toMatchObject({ name: 'AbortError' })
    expect(auth.getAuthToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a late parser response after the caller scope is cancelled', async () => {
    const body = deferred<typeof parsed>()
    const json = vi.fn(() => body.promise)
    fetchMock.mockResolvedValue({ ok: true, status: 200, json })
    const controller = new AbortController()
    const extracting = extractWorkspaceDocument(documentFile().file, controller.signal)
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce())
    controller.abort(); body.resolve(parsed)
    await expect(extracting).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal)
  })
})
