import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { ScriptTarget, transpileModule } from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, reactive, ssrContextKey } from 'vue'
import MemoryView from '@/views/MemoryView.vue'

const state = vi.hoisted(() => ({ route: null as any, records: [] as any[], inbox: [] as any[], detail: vi.fn() }))
vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  useRouter: () => ({ replace: async (target: any) => { state.route.query = target.query || {} } })
}))
vi.mock('@/api/app', () => ({
  getMemoryRecords: async () => ({ data: { items: state.records } }),
  getMemoryInbox: async () => ({ data: { items: state.inbox } }),
  getMemoryGovernanceEvents: async () => ({ data: { items: [] } }),
  getMemoryFacts: async () => ({ data: { items: [], migration: { conflicts: [] } } }),
  getMemorySchemaStatus: async () => ({ data: { enabled: true, status: 'ready', version: 1, slotCount: 2 } }),
  getMemoryRecord: (id: string) => state.detail(id),
  correctMemoryRecord: vi.fn(), governMemoryRecord: vi.fn(), purgeMemoryRecord: vi.fn(),
  getMemoryPurgeJob: vi.fn(), retryMemoryPurgeJob: vi.fn(), resolveMemoryConflict: vi.fn(),
  reviseMemoryFact: vi.fn(), rebuildMemorySchema: vi.fn()
}))
vi.mock('@/components/feedback/ConfirmActionDialog.vue', () => ({ default: { render: () => null } }))

// A minimal Vue renderer exercises the real view and async handlers without a
// browser, DOM emulation or screenshot assertions.
type Node = { tag: string; props: Record<string, any>; children: Node[]; text: string; parent?: Node }
const node = (tag: string, text = ''): Node => ({ tag, text, props: {}, children: [] })
const renderer = createRenderer<Node, Node>({
  createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
  setText: (target, text) => { target.text = text },
  setElementText: (target, text) => { target.text = text; target.children = [] },
  patchProp: (target, key, _previous, value) => { target.props[key] = value },
  parentNode: target => target.parent || null,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
  insert: (target, parent, anchor) => {
    if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1)
    target.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(target)
    else parent.children.splice(index, 0, target)
  },
  remove: target => { if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1) }
})
// Vitest's node environment asks Vite for an SSR template. Compile that same
// template for the custom renderer while retaining the imported real setup.
const { descriptor } = parse(readFileSync(new URL('../../src/views/MemoryView.vue', import.meta.url), 'utf8'))
const bindings = compileScript(descriptor, { id: 'memory-state-test' }).bindings
const clientTemplate = compileTemplate({ source: descriptor.template!.content, filename: 'MemoryView.vue', id: 'memory-state-test', compilerOptions: { bindingMetadata: bindings, hoistStatic: false } }).code
const renderSource = clientTemplate.replace(/import \{([^}]+)\} from "vue"/g, (_, imports: string) => `const { ${imports.replace(/\bas\b/g, ':')} } = Vue`).replace('export function render', 'return function render')
const clientRender = transpileModule(renderSource, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText
// Native input plumbing is not part of this host; tests invoke the compiled
// onUpdate:modelValue callback directly, leaving all application state real.
const view = { ...MemoryView, render: new Function('Vue', clientRender)({ ...Vue, vModelText: {}, vModelSelect: {}, vModelRadio: {} }) }
const nodes = (target: Node): Node[] => [target, ...target.children.flatMap(nodes)]
const content = (target: Node): string => target.text + target.children.map(content).join('')
const hasClass = (target: Node, name: string) => String(target.props.class || '').split(' ').includes(name)
let root: Node
let unmount: () => void

async function settle() {
  for (let index = 0; index < 14; index++) await Promise.resolve()
  await nextTick()
}

function mount() {
  root = node('root')
  const app = renderer.createApp(view)
  app.provide(ssrContextKey, { modules: new Set() })
  app.component('RouterLink', { props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) })
  app.mount(root)
  unmount = () => app.unmount()
}

const record = (id: string, value: string) => ({
  memoryId: id, profileId: Number(id), schemaPath: `preferences.${id}`, title: `记忆 ${id}`, value, rawValue: value,
  status: 'ACTIVE', reliability: 'RELIABLE', confirmedByUser: true, sourceCount: 1,
  allowedActions: ['CORRECT', 'DISABLE', 'FORGET', 'PURGE'], usageDescription: '用于相关对话',
  sources: [{ sourceId: id, type: 'CONVERSATION', label: '原始对话', relation: 'SUPPORT',
    availability: 'AVAILABLE', excerpt: `来源 ${id}`, link: `/?conversationId=${id}` }], history: []
})

beforeEach(() => {
  state.route = reactive({ query: {} })
  state.records = [record('1', '偏好简洁回答'), record('2', '偏好深色界面')]
  state.inbox = []
  state.detail.mockReset().mockImplementation(async (id: string) => ({ data: state.records.find(item => item.memoryId === id) }))
  vi.stubGlobal('window', { setTimeout, clearTimeout })
})
afterEach(() => { unmount?.(); vi.unstubAllGlobals() })

describe('memory workspace selection and sources', () => {
  it('removes the old detail when a status-only filter has no matches and offers a reset', async () => {
    mount()
    await settle()
    const filter = nodes(root).find(item => item.tag === 'select' && item.props['aria-label'] === '筛选记忆状态')!
    filter.props['onUpdate:modelValue']('FORGOTTEN')
    await settle()
    expect(nodes(root).some(item => hasClass(item, 'memory-detail-pane'))).toBe(false)
    expect(content(root)).toContain('没有找到相关记忆')
    expect(nodes(root).some(item => item.tag === 'button' && content(item) === '清除筛选')).toBe(true)
  })

  it('keeps the latest selection when a previous detail response resolves late', async () => {
    mount()
    await settle()
    let finishFirst!: (value: any) => void
    state.detail.mockImplementation((id: string) => id === '1'
      ? new Promise(resolve => { finishFirst = resolve })
      : Promise.resolve({ data: state.records[1] }))
    nodes(root).find(item => hasClass(item, 'memory-row') && content(item).includes('记忆 1'))!.props.onClick()
    await settle()
    nodes(root).find(item => hasClass(item, 'memory-row') && content(item).includes('记忆 2'))!.props.onClick()
    await settle()
    finishFirst({ data: { ...state.records[0], value: '过时的详情' } })
    await settle()
    const detail = nodes(root).find(item => hasClass(item, 'memory-detail-pane'))!
    expect(content(detail)).toContain('偏好深色界面')
    expect(content(detail)).not.toContain('过时的详情')
  })

  it('opens an inbox deep link and preserves the reviewed record when switching to its detail', async () => {
    state.inbox = [{ inboxId: 'review:2', type: 'LOW_RELIABILITY', title: '核对深色偏好', description: '请核实', status: 'OPEN', memory: state.records[1] }]
    state.route.query = { inbox: 'review:2' }
    mount()
    await settle()
    const review = nodes(root).find(item => hasClass(item, 'inbox-generic-detail'))!
    expect(content(review)).toContain('核对深色偏好')
    await nodes(review).find(item => item.tag === 'button' && content(item) === '查看并纠正')!.props.onClick()
    await settle()
    expect(state.route.query).toEqual({ memory: '2' })
    expect(content(nodes(root).find(item => hasClass(item, 'memory-detail-pane'))!)).toContain('偏好深色界面')
  })

  it('does not expose a replay link or excerpt from an unavailable source', async () => {
    state.records[0].sources[0] = { ...state.records[0].sources[0], availability: 'UNAVAILABLE', excerpt: '不可展示的缓存', link: '/?conversationId=1', unavailableReason: '来源已删除' }
    mount()
    await settle()
    const detail = nodes(root).find(item => hasClass(item, 'memory-detail-pane'))!
    expect(content(detail)).toContain('来源已删除')
    expect(content(detail)).not.toContain('不可展示的缓存')
    expect(nodes(detail).some(item => hasClass(item, 'source-link'))).toBe(false)
  })
})
