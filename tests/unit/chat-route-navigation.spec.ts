import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { ScriptTarget, transpileModule } from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ssrContextKey } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import ChatView from '@/views/ChatView.vue'

const api = vi.hoisted(() => ({ messages: vi.fn() }))
vi.mock('@/api/app', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/app')>(),
  listConversations: async () => ({ data: [{ id: 'old-chat', title: '之前的工作讨论' }] }),
  listChatMessages: (id: string) => api.messages(id),
  listKnowledgeBases: async () => ({ data: [] }),
  listProjects: async () => ({ data: { items: [] } }),
  listAgentTodos: async () => ({ data: { items: [] } }),
  listAgentReminders: async () => ({ data: { items: [] } }),
  listPendingOperations: async () => ({ data: { items: [] } }),
  getCurrentMemory: async () => ({ data: {} }),
}))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => ({ consumeChatDraft: () => null }) }))

// Run the actual ChatView setup, router watchers and loaders. Render only the
// title/message surface so these navigation tests do not depend on native DOM UI.
type HostNode = { tag: string; text: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode }
const node = (tag: string, text = ''): HostNode => ({ tag, text, props: {}, children: [] })
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
  remove: target => { if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1) },
})
const { descriptor } = parse(readFileSync(new URL('../../src/views/ChatView.vue', import.meta.url), 'utf8'))
const bindings = compileScript(descriptor, { id: 'chat-route-test' }).bindings
const template = compileTemplate({
  source: '<section><h1>{{ activeConversationTitle }}</h1><p v-for="(message, index) in messages" :key="index">{{ message.content }}</p><button @click="newConversation">新对话</button></section>',
  filename: 'ChatView.vue', id: 'chat-route-test', compilerOptions: { bindingMetadata: bindings, hoistStatic: false },
}).code
const renderSource = template
  .replace(/import \{([^}]+)\} from "vue"/g, (_, imports: string) => `const { ${imports.replace(/\bas\b/g, ':')} } = Vue`)
  .replace('export function render', 'return function render')
const view = { ...ChatView, render: new Function('Vue', transpileModule(renderSource, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText)(Vue) }
const text = (target: HostNode): string => target.tag === '#comment' ? '' : target.text + target.children.map(text).join('')
const nodes = (target: HostNode): HostNode[] => [target, ...target.children.flatMap(nodes)]
let unmount: (() => void) | undefined
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); await nextTick() }

async function mount() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'chat', component: view }] })
  await router.push('/?conversationId=old-chat')
  await router.isReady()
  const root = node('root')
  const app = renderer.createApp({ render: () => h(RouterView) })
  app.provide(ssrContextKey, { modules: new Set() }); app.use(router); app.mount(root)
  unmount = () => app.unmount()
  await settle()
  return { root, router }
}

beforeEach(() => {
  const stored = new Map<string, string>()
  const localStorage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) }
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage, setTimeout, clearTimeout }))
  vi.stubGlobal('document', new EventTarget())
  api.messages.mockReset().mockResolvedValue({ data: [{ id: 'old-message', role: 'user', content: '上一段对话的内容', metadata: {} }] })
})
afterEach(() => { unmount?.(); unmount = undefined; vi.unstubAllGlobals() })

describe('ChatView route navigation', () => {
  it('clears an existing title and transcript when sidebar navigation requests a new chat', async () => {
    const { root, router } = await mount()
    expect(text(root)).toContain('之前的工作讨论')
    expect(text(root)).toContain('上一段对话的内容')
    await router.push('/?newChat=sidebar-1'); await settle()
    expect(nodes(root).find(item => item.tag === 'h1')?.text).toBe('新对话')
    expect(text(root)).not.toContain('上一段对话的内容')
    expect(window.localStorage.getItem('lyle.chat.active-conversation')).toBe('__new_conversation__')
    await router.push('/?conversationId=old-chat'); await settle()
    expect(text(root)).toContain('上一段对话的内容')
    nodes(root).find(item => item.tag === 'button')!.props.onClick()
    await settle()
    expect(router.currentRoute.value.query.newChat).toBeTruthy()
    expect(text(root)).not.toContain('上一段对话的内容')
  })

  it('does not let a pending old-history response refill a newly cleared conversation', async () => {
    let finishOldHistory!: (value: unknown) => void
    api.messages.mockReturnValueOnce(new Promise(resolve => { finishOldHistory = resolve }))
    const { root, router } = await mount()
    expect(api.messages).toHaveBeenCalledWith('old-chat')
    await router.push('/?newChat=sidebar-2'); await settle()
    finishOldHistory({ data: [{ id: 'old-message', role: 'user', content: '迟到的旧对话内容', metadata: {} }] })
    await settle()
    expect(nodes(root).find(item => item.tag === 'h1')?.text).toBe('新对话')
    expect(text(root)).not.toContain('迟到的旧对话内容')
    expect(router.currentRoute.value.query.newChat).toBe('sidebar-2')
  })
})
