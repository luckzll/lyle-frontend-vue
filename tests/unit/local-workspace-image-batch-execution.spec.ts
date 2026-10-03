import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { ScriptTarget, transpileModule } from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ssrContextKey, type App } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LocalWorkspaceView from '@/views/LocalWorkspaceView.vue'
import { authState } from '@/auth'
import type { User } from '@/api/types'
import { workspaceStep, workspaceStepBody } from '@/api/local-workspace'
import { compressWorkspaceImage, MAX_WORKSPACE_CLIENT_BYTES, validateWorkspaceImages } from '@/domain/local-workspace-images'
import { clearLocalHandles, createLocalProject, createLocalSessionForProject, loadLocalHistory, recoverLocalTranscript,
  rememberProjectHandle, saveLocalHistory, type LocalSession } from '@/domain/local-workspace-history'
import { clearLocalAttachments } from '@/domain/local-workspace-attachments'
import type { LocalDirectoryHandle, LocalFileHandle, WorkspaceCall, WorkspaceMessage } from '@/domain/local-workspace'

const mock = vi.hoisted(() => ({
  pixels: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z8C0AAAAASUVORK5CYII=',
  compress: vi.fn()
}))
vi.mock('@/domain/local-workspace-images', async original => ({
  ...await original<typeof import('@/domain/local-workspace-images')>(), compressWorkspaceImage: mock.compress
}))
vi.mock('@/api/local-workspace', async original => ({
  ...await original<typeof import('@/api/local-workspace')>(), workspaceStep: vi.fn()
}))

// The actual workspace setup/send loop is mounted. Only its DOM surface is
// replaced so file handles and model responses can be controlled without a browser.
const { descriptor } = parse(readFileSync(new URL('../../src/views/LocalWorkspaceView.vue', import.meta.url), 'utf8'))
const bindings = compileScript(descriptor, { id: 'image-batch-execution' }).bindings
const template = compileTemplate({ filename: 'LocalWorkspaceView.vue', id: 'image-batch-execution',
  source: '<section><button data-action="send" @click="input = \'请逐张识别所有图片\'; send()">发送</button><button data-action="stop" @click="stop">停止</button><p data-state="loading">{{ loading }}</p><p data-state="completed">{{ turns[turns.length - 1]?.completed }}</p><p data-state="error">{{ error }}</p></section>',
  compilerOptions: { bindingMetadata: bindings, hoistStatic: false } }).code
const source = template.replace(/import \{([^}]+)\} from "vue"/g,
  (_, imports: string) => `const { ${imports.replace(/\bas\b/g, ':')} } = Vue`)
  .replace('export function render', 'return function render')
const view = { ...LocalWorkspaceView, render: new Function('Vue',
  transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText)(Vue) }

type HostNode = { tag: string; text: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode }
const node = (tag: string, text = ''): HostNode => ({ tag, text, props: {}, children: [] })
const nodes = (target: HostNode): HostNode[] => [target, ...target.children.flatMap(nodes)]
const text = (target: HostNode): string => target.text + target.children.map(text).join('')
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: value => node('#text', value), createComment: value => node('#comment', value),
  setText: (target, value) => { target.text = value },
  setElementText: (target, value) => { target.text = value; target.children = [] },
  patchProp: (target, key, _old, value) => { target.props[key] = value },
  parentNode: target => target.parent || null,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
  insert: (target, parent, anchor) => {
    if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1)
    target.parent = parent
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at < 0) parent.children.push(target); else parent.children.splice(at, 0, target)
  },
  remove: target => { if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1) }
})

const owner = 'image-batch-execution-owner'
let app: App | undefined
let disk: Map<string, string>
let releaseRead: (() => void) | undefined
const read = (name: string, id = name): WorkspaceCall => ({ id, name: 'workspace_read', args: { path: name } })
const response = (calls: WorkspaceCall[] = [], content = '本批图片已分析'): WorkspaceMessage => ({ role: 'assistant', content, tool_calls: calls })
const originalCalls = () => [read('one.png'), read('two.png'), read('three.png'), read('four.png')]
async function settle() { for (let i = 0; i < 60; i++) { await nextTick(); await Promise.resolve() } }

function directory(failing?: string) {
  const opened: string[] = []
  const write = vi.fn(async () => { throw new Error('This read-only fixture must never write') })
  const bytes = Uint8Array.from(atob(mock.pixels.slice(mock.pixels.indexOf(',') + 1)), char => char.charCodeAt(0))
  const files = new Map<string, LocalFileHandle>(originalCalls().map(call => {
    const name = String(call.args.path)
    return [name, { kind: 'file', name, getFile: async () => {
      opened.push(name)
      if (name === failing) throw new DOMException('测试文件已删除', 'NotFoundError')
      return new File([bytes], name, { type: 'image/png' })
    }, createWritable: write }]
  }))
  const root: LocalDirectoryHandle = {
    kind: 'directory', name: 'images', async queryPermission() { return 'granted' }, async requestPermission() { return 'granted' },
    async *entries() { for (const item of files) yield item },
    async getDirectoryHandle() { throw new Error('Fixture has no subdirectory') },
    async getFileHandle(name, options) {
      if (options?.create) throw new Error('Creation must never run')
      const file = files.get(name)
      if (!file) throw new DOMException('No fixture file', 'NotFoundError')
      return file
    }
  }
  return { root, opened, write }
}

async function mount(sample = directory()) {
  const project = createLocalProject(sample.root.name)
  const session = createLocalSessionForProject(project)
  expect(saveLocalHistory(owner, { projects: [project], sessions: [session], activeProjectId: project.id, activeId: session.id }).ok).toBe(true)
  await rememberProjectHandle(owner, project.id, sample.root)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/local-project', name: 'local-project', component: view }] })
  await router.push(`/local-project?projectId=${project.id}&sessionId=${session.id}`)
  await router.isReady()
  const root = node('root')
  app = renderer.createApp({ render: () => h(RouterView) })
  app.provide(ssrContextKey, { modules: new Set() }); app.use(router); app.mount(root)
  await settle()
  const state = (name: string) => text(nodes(root).find(item => item.props['data-state'] === name)!)
  const click = (name: string) => nodes(root).find(item => item.props['data-action'] === name)!.props.onClick()
  const saved = (): LocalSession => loadLocalHistory(owner).history.sessions.find(item => item.id === session.id)!
  return { ...sample, state, click, saved }
}

beforeEach(() => {
  disk = new Map()
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('localStorage', { getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) })
  authState.user = { id: owner } as User
  vi.mocked(workspaceStep).mockReset()
  vi.mocked(compressWorkspaceImage).mockReset().mockResolvedValue(mock.pixels)
})
afterEach(async () => {
  app?.unmount(); app = undefined
  releaseRead?.(); releaseRead = undefined
  await settle()
  clearLocalHandles(owner); clearLocalHandles('other-image-owner'); clearLocalAttachments(owner)
  authState.user = null
  vi.unstubAllGlobals()
})

describe('actual local workspace image batch execution', () => {
  it('reads four real file handles as 2+2 before accepting a final answer, without executing a deferred write', async () => {
    const inputs: WorkspaceMessage[][] = []
    const write: WorkspaceCall = { id: 'deferred-write', name: 'workspace_create', args: { path: 'never.ts', content: 'must not run' } }
    let requests = 0
    vi.mocked(workspaceStep).mockImplementation(async messages => {
      inputs.push(structuredClone(messages))
      return requests++ === 0 ? response([...originalCalls(), write]) : response([], requests === 2 ? '先分析前两张' : '四张图片已逐张分析')
    })
    const mounted = await mount()
    mounted.click('send')
    await vi.waitFor(() => expect(mounted.state('completed')).toBe('true'))
    const saved = mounted.saved()
    expect(mounted.opened).toEqual(['one.png', 'two.png', 'three.png', 'four.png'])
    expect(compressWorkspaceImage).toHaveBeenCalledTimes(4)
    for (const [file] of vi.mocked(compressWorkspaceImage).mock.calls) {
      expect(file.type).toBe('image/png')
      expect(new Uint8Array(await file.arrayBuffer()).slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    }
    expect(mounted.write).not.toHaveBeenCalled()
    expect(workspaceStep).toHaveBeenCalledTimes(3)
    const vision = saved.transcript.filter(item => item.role === 'user' && item.images?.length)
    expect(vision.map(item => item.images!.length)).toEqual([2, 2])
    expect(vision[0]!.content).toContain('one.png'); expect(vision[1]!.content).toContain('four.png')
    for (const item of vision) expect(validateWorkspaceImages(item.images, 'user')).toEqual([mock.pixels, mock.pixels])
    for (const input of inputs) expect(new TextEncoder().encode(workspaceStepBody(input)).length).toBeLessThanOrEqual(MAX_WORKSPACE_CLIENT_BYTES)
    expect(saved.transcript.filter(item => item.role === 'tool')).toHaveLength(4)
    expect(saved.transcript.filter(item => item.role === 'tool').every(item => !item.content.includes('data:image'))).toBe(true)
    expect(saved.transcript.flatMap(item => item.tool_calls || []).some(call => call.name === 'workspace_create')).toBe(false)
    expect(recoverLocalTranscript(saved.transcript)).toEqual(saved.transcript)
    expect(saved.turns[0]!.answer).toBe('四张图片已逐张分析')
    expect(saved.turns[0]!.activities.filter(item => item.label === '读取文件').every(item => item.status === 'done')).toBe(true)
  })

  it('returns a failed queued file as an error and supplies no pixels for it', async () => {
    let requests = 0
    vi.mocked(workspaceStep).mockImplementation(async () => requests++ === 0 ? response(originalCalls()) : response())
    const mounted = await mount(directory('three.png'))
    mounted.click('send')
    await vi.waitFor(() => expect(mounted.state('completed')).toBe('true'))
    const saved = mounted.saved()
    expect(mounted.opened).toEqual(['one.png', 'two.png', 'three.png', 'four.png'])
    expect(compressWorkspaceImage).toHaveBeenCalledTimes(3)
    const vision = saved.transcript.filter(item => item.images?.length)
    expect(vision.map(item => item.images!.length)).toEqual([2, 1])
    expect(vision[1]!.content).not.toContain('three.png')
    expect(vision[1]!.content).toContain('four.png')
    const failure = saved.turns[0]!.activities.find(item => item.path === 'three.png')!
    expect(failure.status).toBe('error')
    expect(failure.detail).not.toContain('已读取真实图片')
    const failedReply = saved.transcript.find(item => item.role === 'tool' && item.tool_call_id === 'three.png')!
    expect(JSON.parse(failedReply.content)).toMatchObject({ status: 'error' })
    expect(recoverLocalTranscript(saved.transcript)).toEqual(saved.transcript)
  })

  it('drops an in-flight read and queued follow-ups when the owner changes, without updating another owner history', async () => {
    const otherOwner = 'other-image-owner'
    const otherProject = createLocalProject('other-project')
    const otherSession = createLocalSessionForProject(otherProject); otherSession.draft = 'private other-owner draft'
    saveLocalHistory(otherOwner, { projects: [otherProject], sessions: [otherSession], activeProjectId: otherProject.id, activeId: otherSession.id })
    const otherKey = `lyle:local-workspace-history:v1:${otherOwner}`
    const before = disk.get(otherKey)
    vi.mocked(workspaceStep).mockResolvedValue(response(originalCalls()))
    vi.mocked(compressWorkspaceImage).mockImplementationOnce(() => new Promise(resolve => { releaseRead = () => resolve(mock.pixels) }))
    const mounted = await mount()
    mounted.click('send')
    await vi.waitFor(() => expect(compressWorkspaceImage).toHaveBeenCalledOnce())
    authState.user = { id: otherOwner } as User
    releaseRead!(); releaseRead = undefined
    await settle()
    expect(workspaceStep).toHaveBeenCalledOnce()
    expect(mounted.opened).toEqual(['one.png'])
    expect(disk.get(otherKey)).toBe(before)
    expect(loadLocalHistory(owner).history.sessions[0]!.transcript).toEqual([])
    expect(loadLocalHistory(otherOwner).history.sessions[0]!.draft).toBe('private other-owner draft')
  })

  it('does not replay a stopped turn image queue when the same session sends a new question', async () => {
    vi.mocked(workspaceStep).mockResolvedValueOnce(response(originalCalls())).mockResolvedValue(response([], '新的问题已回答'))
    vi.mocked(compressWorkspaceImage).mockImplementationOnce(() => new Promise(resolve => { releaseRead = () => resolve(mock.pixels) }))
    const mounted = await mount()
    mounted.click('send')
    await vi.waitFor(() => expect(compressWorkspaceImage).toHaveBeenCalledOnce())
    mounted.click('stop')
    releaseRead!(); releaseRead = undefined
    await vi.waitFor(() => expect(mounted.state('loading')).toBe('false'))
    expect(mounted.state('completed')).toBe('false')
    mounted.click('send')
    await vi.waitFor(() => expect(mounted.state('completed')).toBe('true'))
    expect(mounted.opened).toEqual(['one.png'])
    expect(workspaceStep).toHaveBeenCalledTimes(2)
    const saved = mounted.saved()
    expect(saved.turns.map(turn => turn.completed)).toEqual([false, true])
    expect(saved.transcript).toHaveLength(2)
    expect(saved.transcript.some(item => item.images?.length || item.tool_calls?.length)).toBe(false)
  })

  it('reports unread queued images at the 16-step limit and leaves the turn incomplete', async () => {
    let requests = 0
    vi.mocked(workspaceStep).mockImplementation(async () => requests++ === 0 ? response(originalCalls())
      : response([read('one.png', `repeat-${requests}`)]))
    const mounted = await mount()
    mounted.click('send')
    await vi.waitFor(() => expect(mounted.state('error')).toContain('16 步上限'))
    expect(workspaceStep).toHaveBeenCalledTimes(16)
    expect(mounted.state('completed')).toBe('false')
    expect(mounted.state('error')).toContain('2 张图片未读取')
    expect(mounted.opened).not.toContain('three.png')
    expect(mounted.opened).not.toContain('four.png')
    const saved = mounted.saved()
    expect(saved.transcript).toEqual([])
    expect(saved.turns[0]!.completed).toBe(false)
    expect(saved.turns[0]!.activities.some(item => item.status === 'running' || item.status === 'waiting')).toBe(false)
  })
})
