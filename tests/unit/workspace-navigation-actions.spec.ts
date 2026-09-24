import { createRenderer, h, nextTick, ssrContextKey, type App } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceNavigation from '@/app/WorkspaceNavigation.vue'
import { takeDirectorySelection } from '@/domain/local-directory-selection'

const api = vi.hoisted(() => ({ remove: vi.fn(), list: vi.fn(), pick: vi.fn() }))
vi.mock('@/api/app', () => ({ deleteConversation: api.remove, listConversations: api.list }))
vi.mock('@/domain/local-workspace', () => ({ chooseLocalDirectory: api.pick }))
type HostNode = { children: HostNode[]; parent?: HostNode }
const renderer = createRenderer<HostNode, HostNode>({
  createElement: () => ({ children: [] }), createText: () => ({ children: [] }), createComment: () => ({ children: [] }),
  setText() {}, setElementText() {}, patchProp() {},
  insert(child, parent) { child.parent = parent; parent.children.push(child) },
  remove(child) { if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child) },
  parentNode: node => node.parent || null, nextSibling: () => null,
})

let app: App | undefined; let router: Router; let state: any
async function settle() { for (let i = 0; i < 15; i++) { await nextTick(); await Promise.resolve() } }
async function mount(section = 'chat') {
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', name: 'chat', component: { render: () => null } },
    { path: '/local-project', name: 'local-project', component: { render: () => null } },
  ] })
  await router.push('/?conversationId=current'); await router.isReady()
  const Component = { ...WorkspaceNavigation, render: () => null }
  app = renderer.createApp(Component, { section, user: { id: '42' } }); app.use(router)
  app.provide(ssrContextKey, { modules: new Set<string>() })
  const instance = app.mount({ children: [] })
  state = (instance.$ as any).setupState
  await settle()
}
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('localStorage', { getItem: () => null })
  api.remove.mockReset().mockResolvedValue({}); api.list.mockReset().mockResolvedValue({ data: [] }); api.pick.mockReset()
})
afterEach(() => { app?.unmount(); app = undefined; vi.unstubAllGlobals() })
describe('sidebar deletion and folder selection', () => {
  it('waits for confirmation and clears current chat only after deletion succeeds', async () => {
    await mount(); state.pendingChatDelete = { id: 'current', title: 'Current' }; await settle()
    expect(api.remove).not.toHaveBeenCalled()
    await state.removeChat(); await settle()
    expect(api.remove).toHaveBeenCalledWith('current')
    expect(router.currentRoute.value.query.newChat).toBeTruthy()
    expect(state.pendingChatDelete).toBeNull()
  })
  it('keeps the current chat and offers retry when deletion fails', async () => {
    api.remove.mockRejectedValue(new Error('offline'))
    await mount(); state.pendingChatDelete = { id: 'current', title: 'Current' }
    await state.removeChat()
    expect(router.currentRoute.value.query.conversationId).toBe('current')
    expect(state.pendingChatDelete.id).toBe('current'); expect(state.actionError).toContain('重试')
  })
  it('calls the folder picker before navigation and hands the chosen handle to its owner', async () => {
    const handle = { kind: 'directory', name: 'chosen' }
    let resolve!: (value: any) => void
    api.pick.mockImplementation(() => new Promise(done => { resolve = done }))
    await mount('projects')
    const result = state.projectAction('add-project')
    expect(api.pick).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('chat')
    resolve(handle); await result; await settle()
    expect(router.currentRoute.value.name).toBe('local-project')
    const request = String(router.currentRoute.value.query.request)
    expect(takeDirectorySelection(request, '42')).toBe(handle)
    expect(takeDirectorySelection(request, '42')).toBeUndefined()
  })
  it('leaves navigation unchanged when the folder picker is cancelled', async () => {
    api.pick.mockRejectedValue(new DOMException('cancel', 'AbortError'))
    await mount('projects'); await state.projectAction('add-project')
    expect(router.currentRoute.value.query.conversationId).toBe('current')
    expect(state.actionError).toBe('')
  })
})
