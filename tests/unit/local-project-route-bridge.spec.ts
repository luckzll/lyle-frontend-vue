import { createRenderer, h, nextTick, ssrContextKey, type App } from 'vue'
import { createMemoryHistory, createRouter, isNavigationFailure, NavigationFailureType, RouterView, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LocalWorkspaceView from '@/views/LocalWorkspaceView.vue'
import { stageDirectorySelection } from '@/domain/local-directory-selection'
import { authState } from '@/auth'
import type { User } from '@/api/types'
import { chooseLocalDirectory, type LocalDirectoryHandle } from '@/domain/local-workspace'
import { clearLocalHandles, createLocalProject, createLocalSessionForProject, readLocalHistoryMetadata, rememberProjectHandle, saveLocalHistory, type LocalHistory } from '@/domain/local-workspace-history'

vi.mock('@/api/local-workspace', () => ({ workspaceStep: vi.fn() }))
vi.mock('@/domain/local-workspace', async original => ({ ...await original<typeof import('@/domain/local-workspace')>(), chooseLocalDirectory: vi.fn() }))

// Exercise real Vue Router lifecycle guards and the workspace setup without a browser/DOM.
type HostNode = { children: HostNode[]; parent?: HostNode }
const renderer = createRenderer<HostNode, HostNode>({
  createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }),
  setText() {}, setElementText() {}, patchProp() {},
  insert(child, parent) { child.parent = parent; parent.children.push(child) },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child) },
  parentNode: node => node.parent || null, nextSibling: () => null,
})
const ScriptOnlyWorkspace = { ...LocalWorkspaceView, render: () => null }
const owner = 'route-owner'
const key = `lyle:local-workspace-history:v1:${owner}`
let disk: Map<string, string>; let app: App | undefined; let router: Router

async function settle() { for (let i = 0; i < 45; i++) { await nextTick(); await Promise.resolve() } }
async function mount(path = '/local-project') {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/local-project', name: 'local-project', component: ScriptOnlyWorkspace }] })
  await router.push(path); await router.isReady()
  app = renderer.createApp({ render: () => h(RouterView) }); app.use(router)
  app.provide(ssrContextKey, { modules: new Set<string>() }); app.mount({ children: [] })
  await settle()
}
function fixture() {
  const first = createLocalProject('first'); const second = createLocalProject('second')
  const older = createLocalSessionForProject(first); older.updatedAt = 10; older.draft = 'preserve older draft'
  const latest = createLocalSessionForProject(first); latest.updatedAt = 20
  const other = createLocalSessionForProject(second)
  const history: LocalHistory = { projects: [first, second], sessions: [older, latest, other], activeProjectId: first.id, activeId: older.id }
  saveLocalHistory(owner, history)
  return { first, second, older, latest, other, history }
}
function handle(name = 'new-project'): LocalDirectoryHandle {
  return {
    kind: 'directory', name, async queryPermission() { return 'granted' }, async requestPermission() { return 'granted' },
    async *entries() {}, async getDirectoryHandle() { return this }, async getFileHandle() { throw new Error('not used') },
  }
}
beforeEach(() => {
  disk = new Map()
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('localStorage', { getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) })
  authState.user = { id: owner } as User
  vi.mocked(chooseLocalDirectory).mockReset()
})
afterEach(() => { app?.unmount(); app = undefined; clearLocalHandles(owner); authState.user = null; vi.unstubAllGlobals() })

describe('local project route bridge', () => {
  it('keeps old URLs working and opens the latest conversation for a project-only link', async () => {
    const data = fixture(); await mount()
    expect(router.currentRoute.value.query).toEqual({ projectId: data.first.id, sessionId: data.older.id })
    await router.push({ name: 'local-project', query: { projectId: data.first.id } }); await settle()
    expect(router.currentRoute.value.query).toEqual({ projectId: data.first.id, sessionId: data.latest.id })
    expect(readLocalHistoryMetadata(owner).activeId).toBe(data.latest.id)
    expect(JSON.parse(disk.get(key)!).sessions.find((item: { id: string }) => item.id === data.older.id).draft).toBe('preserve older draft')
  })

  it('opens explicit session links and rejects cross-project session mismatches', async () => {
    const data = fixture(); await mount(`/local-project?projectId=${data.second.id}&sessionId=${data.other.id}`)
    expect(readLocalHistoryMetadata(owner).activeId).toBe(data.other.id)
    await router.push({ name: 'local-project', query: { projectId: data.first.id, sessionId: data.other.id } }); await settle()
    expect(router.currentRoute.value.query).toEqual({ projectId: data.second.id, sessionId: data.other.id })
    expect(readLocalHistoryMetadata(owner).activeId).toBe(data.other.id)
  })

  it('creates a separate conversation in the requested project once per action token', async () => {
    const data = fixture(); await mount()
    const request = { projectId: data.second.id, action: 'new-chat', request: 'new-1' }
    await router.push({ name: 'local-project', query: request }); await settle()
    const created = router.currentRoute.value.query.sessionId
    expect(created).not.toBe(data.other.id)
    expect(router.currentRoute.value.query.projectId).toBe(data.second.id)
    expect(router.currentRoute.value.query.action).toBeUndefined()
    expect(readLocalHistoryMetadata(owner).sessions).toHaveLength(4)
    await router.push({ name: 'local-project', query: request }); await settle()
    expect(readLocalHistoryMetadata(owner).sessions).toHaveLength(4)
    expect(router.currentRoute.value.query.sessionId).toBe(created)
    await router.push({ name: 'local-project', query: { ...request, request: 'new-2' } }); await settle()
    expect(readLocalHistoryMetadata(owner).sessions).toHaveLength(5)
  })

  it('updates the URL when deleting a project’s last conversation without removing its project', async () => {
    const data = fixture(); await mount(`/local-project?projectId=${data.second.id}&sessionId=${data.other.id}`)
    const instance = router.currentRoute.value.matched[0]!.instances.default!
    const state = (instance.$ as unknown as { setupState: { deleteId: string | null; deleteConversation: () => Promise<void> } }).setupState
    state.deleteId = data.other.id
    await state.deleteConversation(); await settle()
    const metadata = readLocalHistoryMetadata(owner)
    expect(metadata.sessions.filter(item => item.projectId === data.second.id)).toEqual([])
    expect(metadata.projects.map(item => item.id)).toContain(data.second.id)
    expect(router.currentRoute.value.query).toEqual({ projectId: data.second.id })
    app!.unmount(); app = undefined; await mount(`/local-project?projectId=${data.second.id}`)
    expect(readLocalHistoryMetadata(owner).sessions.filter(item => item.projectId === data.second.id)).toEqual([])
  })

  it('blocks query switches while restoring a directory permission', async () => {
    const data = fixture()
    let release!: (value: PermissionState) => void
    const root = handle('first'); root.queryPermission = () => new Promise(resolve => { release = resolve })
    rememberProjectHandle(owner, data.first.id, root)
    await mount(`/local-project?projectId=${data.first.id}&sessionId=${data.older.id}`)
    const failure = await router.push({ name: 'local-project', query: { projectId: data.second.id, sessionId: data.other.id } })
    expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(true)
    expect(router.currentRoute.value.query.sessionId).toBe(data.older.id)
    release('granted'); await settle()
    expect(readLocalHistoryMetadata(owner).activeId).toBe(data.older.id)
  })

  it('consumes an add-project action and updates the URL to the chosen project and session', async () => {
    vi.mocked(chooseLocalDirectory).mockResolvedValue(handle())
    await mount('/local-project?action=add-project&request=add-1')
    expect(chooseLocalDirectory).toHaveBeenCalledTimes(1)
    const metadata = readLocalHistoryMetadata(owner)
    expect(metadata.projects).toHaveLength(1)
    expect(router.currentRoute.value.query).toEqual({ projectId: metadata.projects[0]!.id, sessionId: metadata.sessions[0]!.id })
    await router.push('/local-project?action=add-project&request=add-1'); await settle()
    expect(chooseLocalDirectory).toHaveBeenCalledTimes(1)
  })

  it('consumes cancelled add-project actions without reopening the picker', async () => {
    vi.mocked(chooseLocalDirectory).mockRejectedValue(new DOMException('cancel', 'AbortError'))
    await mount('/local-project?action=add-project&request=cancel-1')
    expect(router.currentRoute.value.query).toEqual({})
    await router.push('/local-project?action=add-project&request=cancel-1'); await settle()
    expect(chooseLocalDirectory).toHaveBeenCalledTimes(1)
    expect(readLocalHistoryMetadata(owner).projects).toEqual([])
  })
  it('asks before project removal, then cascades only its sessions and survives remount', async () => {
    const data = fixture(); await mount()
    await router.push({ name: 'local-project', query: { action: 'delete-project', request: 'delete-1', projectId: data.first.id } }); await settle()
    expect(readLocalHistoryMetadata(owner).projects).toHaveLength(2)
    const state = (router.currentRoute.value.matched[0]!.instances.default!.$ as any).setupState
    expect(state.deleteProjectId).toBe(data.first.id)
    await state.deleteProject(); await settle()
    expect(readLocalHistoryMetadata(owner).projects.map(p => p.id)).toEqual([data.second.id])
    expect(readLocalHistoryMetadata(owner).sessions.map(s => s.id)).toEqual([data.other.id])
    expect(router.currentRoute.value.query).toEqual({ projectId: data.second.id, sessionId: data.other.id })
    app!.unmount(); app = undefined; await mount()
    expect(readLocalHistoryMetadata(owner).projects.map(p => p.id)).toEqual([data.second.id])
  })

  it('removes a non-current child without disturbing the current draft', async () => {
    const data = fixture(); await mount()
    await router.push({ name: 'local-project', query: { action: 'delete-session', request: 'delete-2', projectId: data.first.id, sessionId: data.latest.id } }); await settle()
    const state = (router.currentRoute.value.matched[0]!.instances.default!.$ as any).setupState
    expect(state.deleteId).toBe(data.latest.id)
    await state.deleteConversation(); await settle()
    expect(readLocalHistoryMetadata(owner).sessions.map(s => s.id)).not.toContain(data.latest.id)
    expect(state.input).toBe('preserve older draft')
    expect(router.currentRoute.value.query.sessionId).toBe(data.older.id)
  })

  it('keeps records and the confirmation open when storage rejects deletion', async () => {
    const data = fixture(); await mount()
    const state = (router.currentRoute.value.matched[0]!.instances.default!.$ as any).setupState
    state.deleteProjectId = data.first.id
    const original = localStorage.setItem
    let writes = 0
    localStorage.setItem = (key, value) => { if (++writes === 2) throw new DOMException('full', 'QuotaExceededError'); original(key, value) }
    await state.deleteProject(); await settle()
    expect(state.deleteProjectId).toBe(data.first.id)
    expect(state.projects).toHaveLength(2)
    expect(readLocalHistoryMetadata(owner).projects).toHaveLength(2)
    expect(state.storageError).toBeTruthy()
    localStorage.setItem = original
  })

  it('consumes the handle chosen in the sidebar without reopening the picker', async () => {
    stageDirectorySelection('picked-1', owner, handle('chosen-folder'))
    await mount('/local-project?action=add-project&request=picked-1')
    expect(chooseLocalDirectory).not.toHaveBeenCalled()
    expect(readLocalHistoryMetadata(owner).projects[0]?.directoryName).toBe('chosen-folder')
  })

})
