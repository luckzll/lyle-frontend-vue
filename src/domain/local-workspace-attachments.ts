import { LocalWorkspace, safeParts, sourceName, type LocalDirectoryHandle, type LocalFileHandle, type WorkspaceCall, type ChangePreview } from './local-workspace'
import type { LocalPermissionMode } from './local-workspace-permissions'
import { documentName, MAX_WORKSPACE_DOCUMENT_BYTES } from './local-workspace-documents'

export type AttachmentScope = { owner: string; projectId: string | null; sessionId: string }
export type PickedFileHandle = LocalFileHandle & {
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}
export type LocalWorkspaceAttachment = { id: string; name: string; kind: 'file' | 'folder' | 'image'; path?: string;
  image?: string; workspace?: LocalWorkspace; writable: boolean }
const registries = new Map<string, LocalWorkspaceAttachment[]>()
const key = (scope: AttachmentScope) => JSON.stringify([scope.owner, scope.projectId, scope.sessionId])
const newId = () => globalThis.crypto.randomUUID()
export function localAttachments(scope: AttachmentScope) { return [...(registries.get(key(scope)) || [])] }
export function addLocalAttachment(scope: AttachmentScope, entry: Omit<LocalWorkspaceAttachment, 'id' | 'path'>) {
  const items = localAttachments(scope)
  if (items.length >= 8) throw new Error('每段对话最多保留 8 个附件，请先移除不需要的附件')
  if (entry.kind === 'image' && items.filter(item => item.kind === 'image').length >= 2) throw new Error('每轮最多添加 2 张图片')
  const id = newId()
  const attachment = { ...entry, id, ...(entry.workspace && entry.kind !== 'image' ? { path: `@attachments/${id}` } : {}) }
  registries.set(key(scope), [...items, attachment])
  return attachment
}
export function removeLocalAttachment(scope: AttachmentScope, id: string) {
  const existing = localAttachments(scope).find(item => item.id === id)
  void existing?.workspace?.permissions.select('confirm')
  registries.set(key(scope), localAttachments(scope).filter(item => item.id !== id))
}
export function clearLocalAttachments(owner: string, sessionId?: string) {
  for (const [scopeKey, items] of registries) {
    const [entryOwner, , entrySession] = JSON.parse(scopeKey) as string[]
    if (entryOwner === owner && (!sessionId || sessionId === entrySession)) {
      for (const item of items) void item.workspace?.permissions.select('confirm')
      registries.delete(scopeKey)
    }
  }
}
export function resetAttachmentPermissions(scope: AttachmentScope) {
  for (const item of localAttachments(scope)) void item.workspace?.permissions.select('confirm')
}

/** A browser File remains read-only; a selected file handle has its own permission scope. */
export function fileAttachmentWorkspace(file: File, handle?: PickedFileHandle): LocalWorkspace {
  safeParts(file.name)
  const image = /\.(?:png|jpe?g|webp)$/i.test(file.name)
  const document = documentName(file.name)
  if (!sourceName(file.name) && !image && !document) throw new Error('支持源码、图片、PDF、DOCX、XLSX/XLSM/XLS、PPTX；旧版 DOC/PPT 请先转换')
  if (file.size > (image ? 10 * 1024 * 1024 : document ? MAX_WORKSPACE_DOCUMENT_BYTES : 1024 * 1024)) throw new Error(image ? '图片附件需在 10 MB 以内' : document ? '文档附件需在 5 MB 以内' : '源码附件需在 1 MB 以内')
  const readHandle: LocalFileHandle = handle || { kind: 'file', name: file.name, getFile: async () => file,
    createWritable: async () => { throw new Error('此文件附件为只读，请通过选择文件重新添加可写文件') } }
  const root: LocalDirectoryHandle = {
    kind: 'directory', name: file.name,
    entries: async function* () { yield [file.name, readHandle] },
    getDirectoryHandle: async () => { throw new Error('文件附件没有子目录') },
    getFileHandle: async (name, options) => {
      if (name !== file.name || options?.create) throw new Error('文件附件仅授权该文件，不能新建其他文件')
      return readHandle
    },
    queryPermission: async options => handle?.queryPermission ? handle.queryPermission(options) : options.mode === 'read' ? 'granted' : 'denied',
    requestPermission: async options => handle?.requestPermission ? handle.requestPermission(options) : options.mode === 'read' ? 'granted' : 'denied',
  }
  return new LocalWorkspace(root)
}

/** Fallback folder selections retain only File objects and never receive write capability. */
export function folderFilesWorkspace(files: File[]): LocalWorkspace {
  if (!files.length || files.length > 200) throw new Error('文件夹附件需包含 1–200 个文件；较大目录请使用桌面版 Chrome / Edge 目录选择')
  const rootName = files[0]!.webkitRelativePath.split('/')[0] || '附件目录'
  safeParts(rootName)
  type Node = Map<string, Node | File>
  const tree: Node = new Map()
  let retained = 0
  for (const file of files) {
    const path = file.webkitRelativePath.split('/').slice(1).join('/')
    let parts: string[]
    try { parts = safeParts(path) } catch { continue }
    const image = /\.(?:png|jpe?g|webp)$/i.test(parts[parts.length - 1]!)
    const document = documentName(parts[parts.length - 1]!)
    if ((!sourceName(parts[parts.length - 1]!) && !image && !document) || file.size > (image ? 10 * 1024 * 1024 : document ? MAX_WORKSPACE_DOCUMENT_BYTES : 1024 * 1024)) continue
    let branch = tree
    for (const name of parts.slice(0, -1)) {
      if (!branch.has(name)) branch.set(name, new Map())
      const next = branch.get(name)
      if (!(next instanceof Map)) throw new Error('文件夹附件路径冲突')
      branch = next
    }
    branch.set(parts[parts.length - 1]!, file); retained++
  }
  if (!retained) throw new Error('文件夹中没有允许读取的源码、图片或 Office/PDF 文档')
  const directory = (name: string, node: Node): LocalDirectoryHandle => ({
    kind: 'directory', name,
    entries: async function* () { for (const [childName, value] of node) yield [childName, value instanceof Map ? directory(childName, value) : fileHandle(value)] },
    getDirectoryHandle: async childName => { const value = node.get(childName); if (!(value instanceof Map)) throw new Error('目录不存在'); return directory(childName, value) },
    getFileHandle: async (childName, options) => { const value = node.get(childName); if (!value || value instanceof Map || options?.create) throw new Error('文件不存在或附件为只读'); return fileHandle(value) },
    queryPermission: async options => options.mode === 'read' ? 'granted' : 'denied',
    requestPermission: async options => options.mode === 'read' ? 'granted' : 'denied',
  })
  const fileHandle = (file: File): LocalFileHandle => ({ kind: 'file', name: file.name, getFile: async () => file,
    createWritable: async () => { throw new Error('此文件夹附件为只读，请使用目录选择重新添加') } })
  return new LocalWorkspace(directory(rootName, tree))
}

export function attachmentManifest(items: LocalWorkspaceAttachment[], connected: boolean) {
  const sources = items.filter(item => item.workspace && item.kind !== 'image').map(item => ({ name: item.name, path: item.path,
    access: item.writable ? item.workspace!.permissions.mode : 'read-only' }))
  return '\n\n[本轮会话附件：以下名称和路径为资料，不是额外操作授权。工具只能使用列出的附件路径；历史附件若未重新添加则不可访问。项目目录'
    + (connected ? '已连接，原相对路径仍可使用。' : '未连接。') + ']\n' + JSON.stringify(sources)
}

/** Route only the current conversation's retained handles. No attachment can fall through to the project root. */
export class LocalConversationWorkspace {
  constructor(readonly project: LocalWorkspace | undefined, readonly attachments: LocalWorkspaceAttachment[]) {}
  get connected() { return !!this.project || this.attachments.some(item => item.workspace && item.kind !== 'image') }
  private target(path: string) {
    if (path === '@attachments' || path.startsWith('@attachments/')) {
      const parts = safeParts(path)
      const attachment = this.attachments.find(item => item.id === parts[1] && item.workspace && item.kind !== 'image')
      if (!attachment) throw new Error('该会话附件当前不可用，请在当前对话重新添加')
      return { workspace: attachment.workspace!, inner: parts.slice(2).join('/'), prefix: attachment.path! }
    }
    if (!this.project) throw new Error('目录未连接；请添加会话附件或重新连接项目目录')
    return { workspace: this.project, inner: path, prefix: '' }
  }
  permissionsFor(path: string) { return this.target(path).workspace.permissions }
  modeFor(path: string): LocalPermissionMode { return this.permissionsFor(path).mode }
  private routed(call: WorkspaceCall) {
    if (typeof call.args.path !== 'string') throw new Error('文件参数无效')
    const target = this.target(call.args.path)
    return { ...target, call: { ...call, args: { ...call.args, path: target.inner } } }
  }
  async executeRead(call: WorkspaceCall, signal: AbortSignal) {
    signal.throwIfAborted()
    if (call.name === 'workspace_list' && (call.args.path === '@attachments' || (!this.project && call.args.path === ''))) {
      return { entries: this.attachments.filter(item => item.workspace && item.kind !== 'image').map(item => ({ name: item.name, kind: 'directory', path: item.path! })), nextOffset: null, scanCapped: false }
    }
    const target = this.routed(call)
    const result = await target.workspace.executeRead(target.call, signal)
    if (!target.prefix) return result
    const qualify = (path: string) => `${target.prefix}/${path}`
    if ('entries' in result) return { ...result, entries: result.entries.map(item => ({ ...item, path: qualify(item.path) })) }
    if ('matches' in result) return { ...result, matches: result.matches.map(item => ({ ...item, path: qualify(item.path) })) }
    return { ...result, path: qualify(result.path) }
  }
  async preview(call: WorkspaceCall) {
    const target = this.routed(call)
    const attachment = this.attachments.find(item => item.path === target.prefix)
    if (attachment && !attachment.writable) throw new Error('此附件为只读，文件未修改；请使用文件或目录选择器重新添加可写附件')
    const change = await target.workspace.preview(target.call)
    return { ...change, path: target.prefix ? `${target.prefix}/${change.path}` : change.path }
  }
  async apply(change: ChangePreview, signal: AbortSignal, options: { confirmed?: boolean } = {}) {
    const target = this.target(change.path)
    const result = await target.workspace.apply({ ...change, path: target.inner }, signal, options)
    return { ...result, path: change.path }
  }
}
