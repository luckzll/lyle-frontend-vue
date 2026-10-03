import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { ScriptTarget, transpileModule } from 'typescript'
import * as Vue from 'vue'
import { createRenderer, createSSRApp, h, nextTick, ref, ssrContextKey } from 'vue'
import { renderToString } from '@vue/server-renderer'
import LocalWorkspaceAttachmentMenu from '@/components/chat/LocalWorkspaceAttachmentMenu.vue'

const { descriptor } = parse(readFileSync(new URL('../../src/components/chat/LocalWorkspaceAttachmentMenu.vue', import.meta.url), 'utf8'))
const bindings = compileScript(descriptor, { id: 'local-attachment-menu-test' }).bindings
const template = compileTemplate({ source: descriptor.template!.content, filename: 'LocalWorkspaceAttachmentMenu.vue',
  id: 'local-attachment-menu-test', compilerOptions: { bindingMetadata: bindings, hoistStatic: false } }).code
const renderSource = template.replace(/import \{([^}]+)\} from "vue"/g,
  (_, imports: string) => `const { ${imports.replace(/\bas\b/g, ':')} } = Vue`)
  .replace('export function render', 'return function render')
const mountedMenu = { ...LocalWorkspaceAttachmentMenu, render: new Function('Vue',
  transpileModule(renderSource, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText)(Vue) }

// Mount the real menu and exercise its public events with focus-capable host nodes.
type HostNode = {
  tag: string; text: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode
  contains: (other: HostNode | null) => boolean
  querySelectorAll: (selector: string) => HostNode[]
  focus: () => void
}
const descendants = (target: HostNode): HostNode[] => [target, ...target.children.flatMap(descendants)]
let activeElement: HostNode | undefined
function node(tag: string, text = ''): HostNode {
  const target: HostNode = { tag, text, props: {}, children: [],
    contains: other => Boolean(other && descendants(target).includes(other)),
    querySelectorAll: () => descendants(target).filter(item => item.props.role === 'menuitem'),
    focus: () => { activeElement = target; target.props.onFocus?.({ target }) } }
  return target
}
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
const listeners = new Map<string, (event: any) => void>()
let unmount: (() => void) | undefined
beforeEach(() => {
  activeElement = undefined
  listeners.clear()
  vi.stubGlobal('document', {
    get activeElement() { return activeElement },
    addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
    removeEventListener: (type: string, listener: (event: any) => void) => { if (listeners.get(type) === listener) listeners.delete(type) }
  })
})
afterEach(() => { unmount?.(); unmount = undefined; vi.unstubAllGlobals() })
async function settle() { await nextTick(); await nextTick() }
function key(key: string) { return { key, preventDefault: vi.fn(), stopPropagation: vi.fn() } }
function invoke(listener: ((event: any) => void) | ((event: any) => void)[], event: any) {
  for (const handler of Array.isArray(listener) ? listener : [listener]) handler(event)
}
function mount(disabledInitially = false) {
  const root = node('root')
  const disabled = ref(disabledInitially)
  const picked = { images: vi.fn(), files: vi.fn(), folder: vi.fn() }
  const app = renderer.createApp({ render: () => h(mountedMenu, {
    disabled: disabled.value, onPickImages: picked.images, onPickFiles: picked.files, onPickFolder: picked.folder
  }) })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  unmount = () => app.unmount()
  const trigger = () => descendants(root).find(item => item.props['data-testid'] === 'local-attach-trigger')!
  const menu = () => descendants(root).find(item => item.props.role === 'menu')
  const items = () => descendants(root).filter(item => item.props.role === 'menuitem')
  return { root, disabled, picked, trigger, menu, items }
}

describe('local workspace attachment menu', () => {
  it('shows one accessible plus trigger, with the choices hidden until opened', async () => {
    const html = await renderToString(createSSRApp(LocalWorkspaceAttachmentMenu))
    expect(html).toContain('aria-label="添加附件"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="menuitem"')
    const mounted = mount()
    mounted.trigger().props.onClick()
    await settle()
    expect(mounted.items()).toHaveLength(3)
    expect(mounted.menu()?.props['aria-label']).toBe('添加到当前对话')
    expect(mounted.trigger().props['aria-controls']).toBe(mounted.menu()?.props.id)
    expect(activeElement).toBe(mounted.items()[0])
    expect(descendants(mounted.root).map(item => item.text).join('')).not.toContain('新建项目')
  })

  it('supports direction keys, Home/End and Esc, returning focus to the plus button', async () => {
    const mounted = mount()
    invoke(mounted.trigger().props.onKeydown, key('ArrowUp'))
    await settle()
    expect(activeElement).toBe(mounted.items()[2])
    const down = key('ArrowDown')
    mounted.menu()?.props.onKeydown(down)
    expect(down.preventDefault).toHaveBeenCalledOnce()
    expect(activeElement).toBe(mounted.items()[0])
    mounted.menu()?.props.onKeydown(key('End'))
    expect(activeElement).toBe(mounted.items()[2])
    mounted.menu()?.props.onKeydown(key('Home'))
    expect(activeElement).toBe(mounted.items()[0])
    const escape = key('Escape')
    mounted.menu()?.props.onKeydown(escape)
    await settle()
    expect(escape.stopPropagation).toHaveBeenCalledOnce()
    expect(mounted.menu()).toBeUndefined()
    expect(activeElement).toBe(mounted.trigger())
  })

  it.each(['images', 'files', 'folder'] as const)('emits only the %s picker synchronously and dismisses the menu', async choice => {
    const mounted = mount()
    mounted.trigger().props.onClick()
    await settle()
    const index = ['images', 'files', 'folder'].indexOf(choice)
    mounted.items()[index].props.onClick()
    expect(mounted.picked[choice]).toHaveBeenCalledOnce()
    expect(Object.values(mounted.picked).reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(1)
    await settle()
    expect(mounted.menu()).toBeUndefined()
    expect(activeElement).toBe(mounted.trigger())
  })

  it('dismisses on outside pointer or focus without stealing focus from another control', async () => {
    const mounted = mount()
    mounted.trigger().props.onClick()
    await settle()
    listeners.get('pointerdown')?.({ target: mounted.items()[1] })
    expect(mounted.menu()).toBeDefined()
    const outside = node('input')
    outside.focus()
    listeners.get('pointerdown')?.({ target: outside })
    await settle()
    expect(mounted.menu()).toBeUndefined()
    expect(activeElement).toBe(outside)
    mounted.trigger().props.onClick()
    await settle()
    const tab = key('Tab')
    mounted.menu()?.props.onKeydown(tab)
    expect(tab.preventDefault).not.toHaveBeenCalled()
    await settle()
    expect(mounted.menu()).toBeUndefined()
    mounted.trigger().props.onClick()
    await settle()
    const menuRoot = descendants(mounted.root).find(item => item.props.class === 'local-attachment-menu')!
    menuRoot.props.onFocusout({ relatedTarget: outside })
    outside.focus()
    await settle()
    expect(mounted.menu()).toBeUndefined()
    expect(activeElement).toBe(outside)
  })

  it('closes and blocks new picks when disabled, and removes its outside listener on unmount', async () => {
    const mounted = mount()
    mounted.trigger().props.onClick()
    await settle()
    const pendingItem = mounted.items()[0]
    mounted.disabled.value = true
    await settle()
    expect(mounted.menu()).toBeUndefined()
    expect(mounted.trigger().props.disabled).toBe(true)
    pendingItem.props.onClick()
    mounted.trigger().props.onClick()
    await settle()
    expect(mounted.menu()).toBeUndefined()
    expect(mounted.picked.images).not.toHaveBeenCalled()
    unmount?.()
    unmount = undefined
    expect(listeners.size).toBe(0)
  })
})
