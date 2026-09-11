import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { ScriptTarget, transpileModule } from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ssrContextKey } from 'vue'
import ConversationView from '@/views/ConversationView.vue'

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), remove: vi.fn() }))
vi.mock('@/api/app', () => ({
  listConversations: () => api.list(),
  createConversation: (title: string) => api.create(title),
  deleteConversation: (id: string) => api.remove(id)
}))
vi.mock('@/components/ui/AppButton.vue', async () => {
  const { h } = await import('vue')
  return { default: {
    props: ['type', 'disabled', 'loading'],
    setup: (props: any, { attrs, slots }: any) => () => h('button', {
      ...attrs, type: props.type || 'button', disabled: props.disabled || props.loading
    }, slots.default?.())
  } }
})
vi.mock('@/components/layout/DetailDrawer.vue', async () => {
  const { h } = await import('vue')
  return { default: {
    props: ['open', 'title'],
    setup: (props: any, { slots }: any) => () => props.open
      ? h('section', { role: 'dialog', 'aria-label': props.title }, slots.default?.()) : null
  } }
})
vi.mock('@/components/feedback/ConfirmActionDialog.vue', async () => {
  const { h } = await import('vue')
  return { default: {
    props: ['open', 'title', 'description', 'busy', 'confirmLabel'],
    emits: ['confirm', 'update:open'],
    setup: (props: any, { emit, slots }: any) => () => props.open ? h('section', {
      role: 'dialog', 'aria-label': props.title
    }, [
      h('p', props.description), slots.default?.(),
      h('button', { disabled: props.busy, onClick: () => emit('confirm') }, props.confirmLabel)
    ]) : null
  } }
})
vi.mock('@/components/feedback/LoadingState.vue', async () => {
  const { h } = await import('vue')
  return { default: { props: ['label'], setup: (props: any) => () => h('p', props.label) } }
})
vi.mock('@/components/feedback/ErrorState.vue', async () => {
  const { h } = await import('vue')
  return { default: {
    props: ['title', 'message'], emits: ['retry'],
    setup: (props: any, { emit }: any) => () => h('section', { role: 'alert' }, [
      h('p', props.title), h('p', props.message), h('button', { onClick: () => emit('retry') }, '重试')
    ])
  } }
})

// Keep the real SFC setup and async handlers. Only native rendering and shared
// dialogs are replaced; assertions exercise rendered state, not copied logic.
type HostNode = {
  tag: string; text: string; props: Record<string, any>; children: HostNode[]
  parent?: HostNode; focus: () => void
}
const node = (tag: string, text = ''): HostNode => ({ tag, text, props: {}, children: [], focus: vi.fn() })
const renderer = createRenderer<HostNode, HostNode>({
  createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
  setText: (target, text) => { target.text = text },
  setElementText: (target, text) => { target.text = text; target.children = [] },
  patchProp: (target, key, _old, value) => { target.props[key] = value },
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
const { descriptor } = parse(readFileSync(new URL('../../src/views/ConversationView.vue', import.meta.url), 'utf8'))
const bindings = compileScript(descriptor, { id: 'conversation-state-test' }).bindings
const template = compileTemplate({
  source: descriptor.template!.content, filename: 'ConversationView.vue', id: 'conversation-state-test',
  compilerOptions: { bindingMetadata: bindings, hoistStatic: false }
}).code
const renderSource = template
  .replace(/import \{([^}]+)\} from "vue"/g, (_, imports: string) => `const { ${imports.replace(/\bas\b/g, ':')} } = Vue`)
  .replace('export function render', 'return function render')
const clientRender = transpileModule(renderSource, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText
const view = { ...ConversationView, render: new Function('Vue', clientRender)({ ...Vue, vModelText: {} }) }
const nodes = (target: HostNode): HostNode[] => [target, ...target.children.flatMap(nodes)]
const text = (target: HostNode): string => target.tag === '#comment' ? '' : target.text + target.children.map(text).join('')
let root: HostNode
let unmount: (() => void) | undefined

async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve()
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
function button(label: string, container = root) {
  const found = nodes(container).find(item => item.tag === 'button' && (item.props['aria-label'] === label || text(item) === label))
  expect(found, `button: ${label}`).toBeDefined()
  return found!
}
function dialog(title: string) { return nodes(root).find(item => item.props.role === 'dialog' && item.props['aria-label'] === title) }
function rowTitles() { return nodes(root).filter(item => item.tag === 'h3').map(text) }
async function openCreator(title: string) {
  await button('新建会话').props.onClick({ currentTarget: null })
  const input = nodes(dialog('新建会话')!).find(item => item.tag === 'input')!
  input.props['onUpdate:modelValue'](title)
  await settle()
}
async function submitCreator() {
  nodes(dialog('新建会话')!).find(item => item.tag === 'form')!.props.onSubmit({ preventDefault() {} })
  await settle()
}
const conversation = (id: string, title: string) => ({ id, title, createdAt: '2026-09-11T00:00:00Z', updatedAt: '2026-09-11T00:00:00Z' })
const existing = conversation('1', '之前的项目讨论')
const created = conversation('2', '新的产品方案')

beforeEach(() => {
  api.list.mockReset().mockResolvedValue({ data: [existing] })
  api.create.mockReset().mockResolvedValue({ data: created })
  api.remove.mockReset().mockResolvedValue({ data: {} })
  vi.stubGlobal('HTMLElement', class {})
})
afterEach(() => { unmount?.(); unmount = undefined; vi.unstubAllGlobals() })

describe('conversation state recovery', () => {
  it('retains an incomplete-list warning after the first read fails and creation succeeds', async () => {
    api.list.mockRejectedValue(new Error('历史会话读取失败'))
    mount()
    await settle()
    expect(text(root)).toContain('会话暂时无法加载')
    expect(text(root)).not.toContain('把想法留下')

    await openCreator(created.title)
    await submitCreator()
    expect(api.create).toHaveBeenCalledWith(created.title)
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(rowTitles()).toContain(created.title)
    expect(text(root)).toContain('会话列表未完整加载')
    expect(text(root)).toContain('历史会话读取失败')
    expect(dialog('新建会话')).toBeUndefined()

    api.list.mockResolvedValue({ data: [existing, created] })
    await button('刷新会话').props.onClick()
    await settle()
    expect(rowTitles()).toEqual(expect.arrayContaining([existing.title, created.title]))
    expect(text(root)).not.toContain('会话列表未完整加载')
  })

  it('does not allow an older list response to erase a successfully created conversation', async () => {
    mount()
    await settle()
    let finishOldRead!: (value: { data: typeof existing[] }) => void
    api.list.mockImplementationOnce(() => new Promise(resolve => { finishOldRead = resolve }))
    button('刷新会话').props.onClick()
    await settle()

    await openCreator(created.title)
    await submitCreator()
    expect(rowTitles()).toContain(created.title)
    finishOldRead({ data: [existing] })
    await settle()
    expect(rowTitles()).toEqual(expect.arrayContaining([existing.title, created.title]))
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(button('刷新会话').props.disabled).toBe(false)
  })

  it('retains the delete target and inline failure so retry deletes the same conversation', async () => {
    api.list.mockResolvedValue({ data: [existing, created] })
    api.remove.mockRejectedValueOnce(new Error('删除请求暂时失败'))
    mount()
    await settle()
    button('删除会话：' + existing.title).props.onClick()
    await settle()
    button('确认删除', dialog('删除会话')!).props.onClick()
    await settle()

    const confirmation = dialog('删除会话')!
    expect(confirmation).toBeDefined()
    expect(text(confirmation)).toContain(existing.title)
    expect(text(confirmation)).toContain('删除请求暂时失败')
    expect(rowTitles()).toContain(existing.title)
    expect(button('确认删除', confirmation).props.disabled).toBe(false)

    button('确认删除', confirmation).props.onClick()
    await settle()
    expect(api.remove.mock.calls).toEqual([[existing.id], [existing.id]])
    expect(dialog('删除会话')).toBeUndefined()
    expect(rowTitles()).toEqual([created.title])
    expect(text(root)).toContain('会话已删除。')
  })

  it('keeps a failed creation draft in the drawer and allows retry without retyping', async () => {
    api.create.mockRejectedValueOnce(new Error('创建暂时失败'))
    mount()
    await settle()
    await openCreator(created.title)
    await submitCreator()
    expect(dialog('新建会话')).toBeDefined()
    expect(text(dialog('新建会话')!)).toContain('创建暂时失败')
    expect(rowTitles()).toEqual([existing.title])
    expect(button('创建会话', dialog('新建会话')!).props.disabled).toBe(false)

    await submitCreator()
    expect(api.create.mock.calls).toEqual([[created.title], [created.title]])
    expect(dialog('新建会话')).toBeUndefined()
    expect(rowTitles()).toContain(created.title)
  })
})
