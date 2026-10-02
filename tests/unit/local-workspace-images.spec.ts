import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compactWorkspaceImageHistory, compressWorkspaceImage, MAX_WORKSPACE_CLIENT_BYTES, MAX_WORKSPACE_IMAGE_URI, validateWorkspaceImages,
  workspaceImageToolResult, workspaceReadImageMessage } from '@/domain/local-workspace-images'
import { workspaceStepBody } from '@/api/local-workspace'
import { createLocalProject, createLocalSessionForProject, loadLocalHistory, recoverLocalTranscript, saveLocalHistory } from '@/domain/local-workspace-history'
import type { WorkspaceMessage } from '@/domain/local-workspace'

vi.mock('@/auth', () => ({ initializeAuth: vi.fn(async () => true), getAuthToken: vi.fn(() => '') }))

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='
const jpeg = `data:image/jpeg;base64,${btoa('\xff\xd8\xff\x00\xff\xd9')}`
const webp = `data:image/webp;base64,${btoa('RIFF\x04\x00\x00\x00WEBP')}`
let disk: Map<string, string>

function browserImageFixture(options: { width?: number; height?: number; decodeError?: boolean; outputs?: string[]; context?: boolean } = {}) {
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-test-image')
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const decode = vi.fn(async () => { if (options.decodeError) throw new Error('image decoder rejected the file') })
  vi.stubGlobal('Image', class {
    src = ''
    naturalWidth = options.width ?? 1600
    naturalHeight = options.height ?? 1200
    decode = decode
  })
  const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
  let outputIndex = 0
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => options.context === false ? null : context),
    toDataURL: vi.fn(() => options.outputs?.[Math.min(outputIndex++, options.outputs.length - 1)] ?? jpeg) }
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
  return { createUrl, revokeUrl, decode, canvas, context }
}

beforeEach(() => {
  disk = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => disk.get(key) ?? null,
    setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('bounded local workspace image inputs', () => {
  it('accepts bounded PNG, JPEG and WebP data and never aliases the caller array', () => {
    for (const image of [png, jpeg, webp]) expect(validateWorkspaceImages([image], 'user')).toEqual([image])
    const images = [png]
    const copy = validateWorkspaceImages(images, 'user')!
    copy.push(jpeg)
    expect(images).toEqual([png])
  })

  it.each([
    'https://example.com/private-image.png', 'file:///C:/private.png',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/gif;base64,R0lGODlh',
    'data:image/png;base64,AAAA', 'data:image/jpeg;base64,aW1wb3N0b3I=',
    'data:image/webp;base64,AAAA', 'data:image/png;base64,iVBORw0KGgo',
  ])('rejects URLs, unsupported types, mismatched signatures, and broken encoding: %s', image => {
    expect(() => validateWorkspaceImages([image], 'user')).toThrow()
  })

  it('rejects assistant/tool images, more than two pixels inputs, and overlarge encoded payloads', () => {
    expect(() => validateWorkspaceImages([png], 'assistant')).toThrow('格式无效')
    expect(() => validateWorkspaceImages([png], 'tool')).toThrow('格式无效')
    expect(() => validateWorkspaceImages([png, jpeg, webp], 'user')).toThrow('格式无效')
    expect(() => validateWorkspaceImages([png + 'A'.repeat(MAX_WORKSPACE_IMAGE_URI)], 'user')).toThrow()
    expect(validateWorkspaceImages(undefined, 'user')).toBeUndefined()
  })

  it('produces bounded browser pixels and releases the temporary URL', async () => {
    const browser = browserImageFixture()
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'test.png', { type: 'image/png' })
    expect(await compressWorkspaceImage(file)).toBe(jpeg)
    expect(browser.createUrl).toHaveBeenCalledWith(file)
    expect(browser.decode).toHaveBeenCalledOnce()
    expect(browser.context.drawImage).toHaveBeenCalledOnce()
    expect(browser.canvas.width).toBeLessThanOrEqual(1024)
    expect(browser.canvas.height).toBeLessThanOrEqual(1024)
    expect(browser.revokeUrl).toHaveBeenCalledWith('blob:local-test-image')
  })

  it('retries an overlarge encoded image rather than forwarding it above the URI limit', async () => {
    const browser = browserImageFixture({ outputs: [png + 'A'.repeat(MAX_WORKSPACE_IMAGE_URI), jpeg] })
    expect(await compressWorkspaceImage(new File(['bytes'], 'test.png', { type: 'image/png' }))).toBe(jpeg)
    expect(browser.canvas.toDataURL).toHaveBeenCalledTimes(2)
    expect(browser.context.drawImage).toHaveBeenCalledTimes(2)
    expect(browser.revokeUrl).toHaveBeenCalledOnce()
  })

  it.each([{ decodeError: true }, { width: 9000, height: 9000 }, { context: false },
    { outputs: [png + 'A'.repeat(MAX_WORKSPACE_IMAGE_URI)] }])('releases temporary browser resources on image-processing failure: %o', async options => {
    const browser = browserImageFixture(options)
    await expect(compressWorkspaceImage(new File(['bytes'], 'test.png', { type: 'image/png' }))).rejects.toThrow()
    expect(browser.revokeUrl).toHaveBeenCalledOnce()
  })

  it('rejects oversize or unsupported original files before requesting browser image decoding', async () => {
    const browser = browserImageFixture()
    await expect(compressWorkspaceImage(new File(['gif'], 'test.gif', { type: 'image/gif' }))).rejects.toThrow('PNG、JPEG 或 WebP')
    await expect(compressWorkspaceImage(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))).rejects.toThrow('10 MB')
    expect(browser.createUrl).not.toHaveBeenCalled()
  })
})

describe('real picture context after workspace tool replies', () => {
  it('keeps pixels out of the textual tool response and preserves the authorized path in the subsequent image message', () => {
    const packed = workspaceImageToolResult({ kind: 'image', path: '@attachments/a/screens/diagram.png', image: png,
      width: 1, height: 1, originalBytes: 100 })
    const tool = JSON.stringify(packed.result)
    expect(tool).toContain('@attachments/a/screens/diagram.png')
    expect(tool).toContain('图片内容尚未完成识别')
    expect(tool).not.toContain('data:image')
    expect(tool).not.toContain('base64')
    expect(packed.image).toEqual({ path: '@attachments/a/screens/diagram.png', image: png })
    const message = workspaceReadImageMessage([packed.image!])!
    expect(message).toMatchObject({ role: 'user', images: [png] })
    expect(message.content).toContain('@attachments/a/screens/diagram.png')
    expect(message.content).not.toContain('data:image')
  })

  it('never silently drops a third picture; callers must use explicit subsequent batches', () => {
    const reads = [{ path: 'one.png', image: png }, { path: 'two.jpg', image: jpeg }, { path: 'three.webp', image: webp }]
    expect(() => workspaceReadImageMessage(reads)).toThrow('格式无效')
    expect(workspaceReadImageMessage(reads.slice(0, 2))!.images).toEqual([png, jpeg])
    expect(workspaceReadImageMessage(reads.slice(2))!.images).toEqual([webp])
    expect(workspaceReadImageMessage([])).toBeUndefined()
  })

  it('retains the normal text tool shape and rejects invalid image results', () => {
    const text = { content: 'plain source', path: 'src/main.ts', nextOffset: null }
    expect(workspaceImageToolResult(text)).toEqual({ result: text })
    expect(() => workspaceImageToolResult({ kind: 'image', path: 'a.png', image: 'https://example.com/a.png' })).toThrow()
    expect(() => workspaceImageToolResult({ kind: 'image', image: png })).toThrow('无效')
  })

  it('accepts the complete read-tools → image-user → answer conversation when restoring history', () => {
    const first = workspaceImageToolResult({ kind: 'image', path: 'screen.png', image: png })
    const second = workspaceImageToolResult({ kind: 'image', path: '@attachments/a/prototype.jpg', image: jpeg })
    const messages: WorkspaceMessage[] = [
      { role: 'user', content: '请对比这两张图' },
      { role: 'assistant', content: '', tool_calls: [
        { id: 'one', name: 'workspace_read', args: { path: 'screen.png' } },
        { id: 'two', name: 'workspace_read', args: { path: '@attachments/a/prototype.jpg' } }
      ] },
      { role: 'tool', tool_call_id: 'one', content: JSON.stringify(first.result) },
      { role: 'tool', tool_call_id: 'two', content: JSON.stringify(second.result) },
      workspaceReadImageMessage([first.image!, second.image!])!,
      { role: 'assistant', content: '根据两张图片的实际内容，给出差异。' }
    ]
    expect(recoverLocalTranscript(messages)).toEqual(messages)
    const body = JSON.parse(workspaceStepBody(messages)) as { messages: WorkspaceMessage[] }
    expect(body.messages[4]!.images).toEqual([png, jpeg])
    expect(body.messages.filter(message => message.role === 'tool').every(message => !message.images && !message.content.includes('data:image'))).toBe(true)
  })

  it('rolls back an unfinished read round if an image user arrives before all tool responses', () => {
    const earlier: WorkspaceMessage[] = [{ role: 'user', content: '已完成问题' }, { role: 'assistant', content: '已完成回答' }]
    const messages: WorkspaceMessage[] = [...earlier,
      { role: 'user', content: '查看图片' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'one', name: 'workspace_read', args: { path: 'screen.png' } },
        { id: 'two', name: 'workspace_read', args: { path: 'missing.png' } }] },
      { role: 'tool', tool_call_id: 'one', content: '{}' },
      workspaceReadImageMessage([{ path: 'screen.png', image: png }])!,
      { role: 'assistant', content: '不应提交的回答' }
    ]
    expect(recoverLocalTranscript(messages)).toEqual(earlier)
  })

  it('restores a completed picture-read round whose previously analyzed image payload was cleared to an empty marker', () => {
    const messages: WorkspaceMessage[] = [
      { role: 'user', content: '分析目录中的图片' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'picture', name: 'workspace_read', args: { path: 'screen.png' } }] },
      { role: 'tool', tool_call_id: 'picture', content: '{"kind":"image","path":"screen.png","status":"read"}' },
      { role: 'user', content: '已分析图片来自 screen.png', images: [] },
      { role: 'assistant', content: '图片包含的实际内容已在本回答中整理。' }
    ]
    expect(recoverLocalTranscript(messages)).toEqual(messages)
    const project = createLocalProject('pictures'); const session = createLocalSessionForProject(project)
    session.transcript = messages
    expect(saveLocalHistory('image-owner', { projects: [project], sessions: [session], activeProjectId: project.id, activeId: session.id }).ok).toBe(true)
    expect(loadLocalHistory('image-owner').history.sessions[0]!.transcript).toEqual(messages)
  })
})

describe('image budget and per-project local history', () => {
  it('compacts two analyzed picture batches and then restores their complete tool sequence and the latest real pixels', () => {
    const largePng = `data:image/png;base64,${btoa('\x89PNG\r\n\x1a\n' + '\x00'.repeat(42_000))}`
    const images = [largePng, largePng]
    const messages: WorkspaceMessage[] = [{ role: 'user', content: '分批查看六张目录图片' }]
    for (let batch = 0; batch < 3; batch++) {
      const calls = [0, 1].map(index => ({ id: `read-${batch}-${index}`, name: 'workspace_read', args: { path: `screens/batch-${batch}-${index}.png` } }))
      messages.push({ role: 'assistant', content: batch ? `已根据第 ${batch} 批图片返回可见内容。` : '', tool_calls: calls })
      for (const call of calls) messages.push({ role: 'tool', tool_call_id: call.id,
        content: JSON.stringify({ kind: 'image', path: call.args.path, status: 'read' }) })
      messages.push(workspaceReadImageMessage(calls.map((call, index) => ({ path: call.args.path, image: images[index]! })))!)
    }
    expect(new TextEncoder().encode(JSON.stringify(messages)).length).toBeGreaterThan(190_000)
    const compacted = compactWorkspaceImageHistory(messages)
    expect(compacted).toHaveLength(messages.length)
    expect(compacted.map(message => message.role)).toEqual(messages.map(message => message.role))
    expect(compacted[4]!.images).toEqual([])
    expect(compacted[8]!.images).toEqual([])
    expect(compacted[12]!.images).toEqual(images)
    expect(compacted[4]!.content).toContain('screens/batch-0-0.png')
    expect(compacted[8]!.content).toContain('screens/batch-1-1.png')
    expect(messages[4]!.images).toEqual(images)
    expect(messages[8]!.images).toEqual(images)
    expect(new TextEncoder().encode(workspaceStepBody(compacted)).length).toBeLessThan(MAX_WORKSPACE_CLIENT_BYTES)
    const completed: WorkspaceMessage[] = [...compacted, { role: 'assistant', content: '六张图片的可见内容已逐批整理。' }]
    expect(recoverLocalTranscript(completed)).toEqual(completed)
    const project = createLocalProject('picture-batches'); const session = createLocalSessionForProject(project)
    session.transcript = completed
    expect(saveLocalHistory('image-owner', { projects: [project], sessions: [session], activeProjectId: project.id, activeId: session.id }).ok).toBe(true)
    expect(loadLocalHistory('image-owner').history.sessions[0]!.transcript).toEqual(completed)
  })

  it('retains the latest unprocessed pixels when the request still exceeds budget and requires a clear caller failure', () => {
    const largePng = `data:image/png;base64,${btoa('\x89PNG\r\n\x1a\n' + '\x00'.repeat(42_000))}`
    const messages: WorkspaceMessage[] = [
      { role: 'user', content: '旧截图', images: [png] }, { role: 'assistant', content: '已返回旧截图可见内容。' },
      { role: 'user', content: 'x'.repeat(100_000), images: [largePng, largePng] }
    ]
    const compacted = compactWorkspaceImageHistory(messages)
    expect(compacted[0]!.images).toEqual([])
    expect(compacted[2]!.images).toEqual([largePng, largePng])
    expect(() => workspaceStepBody(compacted)).toThrow('上下文已满')
    expect(messages[0]!.images).toEqual([png])
  })

  it('limits UTF-8 request bytes rather than relying on JavaScript character counts', () => {
    const within = [{ role: 'user' as const, content: '代码'.repeat(20_000), images: [png] }]
    expect(new TextEncoder().encode(workspaceStepBody(within)).length).toBeLessThan(MAX_WORKSPACE_CLIENT_BYTES)
    const over = [{ role: 'user' as const, content: '代码'.repeat(40_000), images: [png] }]
    expect(JSON.stringify(over).length).toBeLessThan(MAX_WORKSPACE_CLIENT_BYTES)
    expect(() => workspaceStepBody(over)).toThrow('上下文已满')
    expect(() => workspaceStepBody([{ role: 'assistant', content: 'bad', images: [png] }])).toThrow('格式无效')
  })

  it('round-trips inline image questions in their project and session without cloud access', () => {
    const first = createLocalProject('project-one'); const second = createLocalProject('project-two')
    const one = createLocalSessionForProject(first); const two = createLocalSessionForProject(second)
    one.turns = [{ question: '解释第一张图', answer: '图一回答', images: [png], activities: [], open: false, completed: true }]
    one.transcript = [{ role: 'user', content: '解释第一张图', images: [png] }, { role: 'assistant', content: '图一回答' }]
    two.turns = [{ question: '解释第二张图', answer: '图二回答', images: [jpeg], activities: [], open: false, completed: true }]
    two.transcript = [{ role: 'user', content: '解释第二张图', images: [jpeg] }, { role: 'assistant', content: '图二回答' }]
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect(saveLocalHistory('image-owner', { projects: [first, second], sessions: [one, two], activeProjectId: first.id, activeId: one.id }).ok).toBe(true)
    const loaded = loadLocalHistory('image-owner').history
    expect(loaded.sessions.find(item => item.id === one.id)!.transcript).toEqual(one.transcript)
    expect(loaded.sessions.find(item => item.id === two.id)!.transcript).toEqual(two.transcript)
    expect(loaded.sessions.find(item => item.id === one.id)!.turns[0]!.images).toEqual([png])
    expect(loaded.sessions.find(item => item.id === two.id)!.turns[0]!.images).toEqual([jpeg])
    expect(loadLocalHistory('different-owner').history.sessions).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves the existing snapshot when an unsupported image is proposed for history', () => {
    const project = createLocalProject('project'); const session = createLocalSessionForProject(project)
    const history = { projects: [project], sessions: [session], activeProjectId: project.id, activeId: session.id }
    expect(saveLocalHistory('image-owner', history).ok).toBe(true)
    const before = [...disk]
    session.transcript = [{ role: 'user', content: 'invalid', images: ['file:///private.png'] }, { role: 'assistant', content: 'bad' }]
    expect(saveLocalHistory('image-owner', history).ok).toBe(false)
    expect([...disk]).toEqual(before)
  })
})
