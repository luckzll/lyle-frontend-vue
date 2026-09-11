import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { ScriptTarget, transpileModule } from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ssrContextKey } from 'vue'
import KnowledgeBaseView from '@/views/KnowledgeBaseView.vue'

const api = vi.hoisted(() => ({
  list: vi.fn(), files: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn(), removeFile: vi.fn(), rebuildAll: vi.fn()
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/api/app', () => ({
  listKnowledgeBases: () => api.list(), listKnowledgeFiles: (id: string) => api.files(id),
  createKnowledgeBase: (name: string) => api.create(name), updateKnowledgeBase: (id: string, name: string) => api.rename(id, name),
  deleteKnowledgeBase: (id: string) => api.remove(id), deleteKnowledgeFile: (id: string, file: string) => api.removeFile(id, file),
  rebuildKnowledgeBaseFiles: (id: string) => api.rebuildAll(id),
  debugRag: vi.fn(), listRagChunks: vi.fn(), rebuildKnowledgeFile: vi.fn(), uploadKnowledgeFile: vi.fn()
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
    props: ['open', 'title', 'description', 'busy', 'confirmLabel'], emits: ['confirm', 'update:open'],
    setup: (props: any, { emit, slots }: any) => () => props.open ? h('section', {
      role: 'dialog', 'aria-label': props.title
    }, [
      h('p', props.description), slots.default?.(),
      h('button', { disabled: props.busy, onClick: () => emit('update:open', false) }, '取消'),
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

// Render the actual SFC setup and handlers with a lightweight host, following
// conversation-state.spec.ts. Only shared chrome and DOM directives are mocked.
type HostNode = {
  tag: string; text: string; props: Record<string, any>; children: HostNode[]; parent?: HostNode
  focus: () => void; select: () => void; scrollIntoView: () => void
}
const node = (tag: string, text = ''): HostNode => ({
  tag, text, props: {}, children: [], focus: vi.fn(), select: vi.fn(), scrollIntoView: vi.fn()
})
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
const { descriptor } = parse(readFileSync(new URL('../../src/views/KnowledgeBaseView.vue', import.meta.url), 'utf8'))
const bindings = compileScript(descriptor, { id: 'knowledge-state-test' }).bindings
const template = compileTemplate({
  source: descriptor.template!.content, filename: 'KnowledgeBaseView.vue', id: 'knowledge-state-test',
  compilerOptions: { bindingMetadata: bindings, hoistStatic: false }
}).code
const renderSource = template
  .replace(/import \{([^}]+)\} from "vue"/g, (_, imports: string) => `const { ${imports.replace(/\bas\b/g, ':')} } = Vue`)
  .replace('export function render', 'return function render')
const clientRender = transpileModule(renderSource, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText
const view = { ...KnowledgeBaseView, render: new Function('Vue', clientRender)({ ...Vue, vModelText: {} }) }
const nodes = (target: HostNode): HostNode[] => [target, ...target.children.flatMap(nodes)]
const text = (target: HostNode): string => target.tag === '#comment' ? '' : target.text + target.children.map(text).join('')
let root: HostNode
let unmount: (() => void) | undefined
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); await nextTick() }
function mount() {
  root = node('root')
  const app = renderer.createApp(view)
  app.provide(ssrContextKey, { modules: new Set() })
  app.component('RouterLink', { props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) })
  app.mount(root)
  unmount = () => app.unmount()
}
function button(label: string, container = root) {
  const found = nodes(container).find(item => item.tag === 'button' && (item.props['aria-label'] === label || text(item).trim() === label))
  expect(found, `button: ${label}`).toBeDefined()
  return found!
}
async function click(label: string, container = root) {
  button(label, container).props.onClick({ currentTarget: null, preventDefault() {}, stopPropagation() {} })
  await settle()
}
function dialog(title: string) { return nodes(root).find(item => item.props.role === 'dialog' && item.props['aria-label'] === title) }
function titles() { return nodes(root).filter(item => item.tag === 'h2').map(text) }
function input(testId: string) { return nodes(root).find(item => item.props['data-testid'] === testId)! }
const existing = { id: '1', name: '之前的工作资料', createdAt: '2026-09-11T00:00:00Z' }
const created = { ...existing, id: '2', name: '新的产品资料' }
const file = { id: 'file-1', knowledgeBaseId: existing.id, fileName: '工作手册.txt', parseStatus: 'completed', fileSize: 128, createdAt: existing.createdAt }

beforeEach(() => {
  api.list.mockReset().mockResolvedValue({ data: [existing] })
  api.files.mockReset().mockResolvedValue({ data: [file] })
  api.create.mockReset().mockResolvedValue({ data: created })
  api.rename.mockReset().mockResolvedValue({ data: { ...existing, name: '更新后的工作资料' } })
  api.remove.mockReset().mockResolvedValue({ data: {} })
  api.removeFile.mockReset().mockResolvedValue({ data: {} })
  api.rebuildAll.mockReset().mockResolvedValue({ data: [] })
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('document', { activeElement: null })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => { unmount?.(); unmount = undefined; vi.unstubAllGlobals() })

describe('knowledge state recovery', () => {
  it('keeps the incomplete list warning after creation and recovers historical libraries without changing selection', async () => {
    api.list.mockRejectedValue(new Error('列表不可用'))
    mount()
    await settle()
    expect(text(root)).toContain('知识库暂时无法加载')
    await click('新建知识库')
    input('knowledge-name-input').props['onUpdate:modelValue'](created.name)
    await settle()
    nodes(dialog('新建知识库')!).find(item => item.tag === 'form')!.props.onSubmit({ preventDefault() {} })
    await settle()
    expect(api.create).toHaveBeenCalledWith(created.name)
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(dialog('新建知识库')).toBeUndefined()
    expect(titles()).toContain(created.name)
    expect(text(root)).toContain('知识库列表加载失败，请稍后重试。')
    expect(text(root)).not.toContain('把你的资料，变成回答的依据')

    api.list.mockResolvedValue({ data: [existing, created] })
    await click('刷新')
    expect(text(root)).toContain(existing.name)
    expect(titles()).toContain(created.name)
    expect(text(root)).not.toContain('知识库列表加载失败，请稍后重试。')
  })

  it('ignores a list response captured before a successful rename', async () => {
    mount()
    await settle()
    let finishOldRead!: (value: { data: typeof existing[] }) => void
    api.list.mockImplementationOnce(() => new Promise(resolve => { finishOldRead = resolve }))
    await click('刷新')
    await click('知识库操作')
    await click('重命名')
    input('knowledge-rename-input').props['onUpdate:modelValue']('更新后的工作资料')
    await settle()
    nodes(root).find(item => item.tag === 'form' && String(item.props.class).includes('kb-title-edit'))!.props.onSubmit({ preventDefault() {} })
    await settle()
    expect(api.rename).toHaveBeenCalledWith(existing.id, '更新后的工作资料')
    expect(titles()).toContain('更新后的工作资料')
    finishOldRead({ data: [existing] })
    await settle()
    expect(titles()).toContain('更新后的工作资料')
    expect(text(root)).not.toContain(existing.name)
    expect(button('刷新').props.disabled).toBe(false)
  })

  it.each([
    { title: '删除知识库', menu: '删除知识库', confirm: '确认删除', message: '知识库删除失败，请重试。', action: 'remove', args: [existing.id] },
    { title: '删除文件', menu: '删除文件', confirm: '确认删除', message: '文件删除失败，请重试。', action: 'removeFile', args: [existing.id, file.id] },
    { title: '重新处理全部文件', menu: '重建全部索引', confirm: '开始处理', message: '文件重新处理失败，请重试。', action: 'rebuildAll', args: [existing.id] }
  ] as const)('$title keeps errors visible in the dialog and clears them before retrying the same target', async operation => {
    api[operation.action].mockRejectedValueOnce(new Error('服务暂不可用'))
    mount()
    await settle()
    const open = async () => {
      await click(operation.action === 'removeFile' ? `${file.fileName} 操作` : '知识库操作')
      await click(operation.menu)
    }
    await open()
    await click(operation.confirm, dialog(operation.title)!)
    expect(text(dialog(operation.title)!)).toContain(operation.message)
    expect(text(dialog(operation.title)!)).toContain(operation.action === 'removeFile' ? file.fileName : existing.name)
    expect(button(operation.confirm, dialog(operation.title)!).props.disabled).toBe(false)
    await click('取消', dialog(operation.title)!)
    await open()
    expect(text(dialog(operation.title)!)).not.toContain(operation.message)
    if (operation.action === 'remove') api.list.mockResolvedValue({ data: [] })
    if (operation.action === 'removeFile') api.files.mockResolvedValue({ data: [] })
    await click(operation.confirm, dialog(operation.title)!)
    expect(api[operation.action].mock.calls).toEqual([operation.args, operation.args])
    expect(dialog(operation.title)).toBeUndefined()
  })
})
