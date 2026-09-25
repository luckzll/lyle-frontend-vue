import { ALLOWED_PROJECT_DOTFILES, CHAT_EXACT_FILENAMES, CHAT_FILE_EXTENSIONS } from './chat-attachment'
import { IGNORED_PROJECT_DIRECTORIES } from './directory-entry'
import { LocalWorkspacePermissions } from './local-workspace-permissions'

export interface LocalFileHandle {
  kind: 'file'; name: string
  getFile(): Promise<File>
  createWritable(options?: { mode?: string }): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>
}
export interface LocalDirectoryHandle {
  kind: 'directory'; name: string
  isSameEntry?(other: LocalDirectoryHandle): Promise<boolean>
  entries(): AsyncIterableIterator<[string, LocalDirectoryHandle | LocalFileHandle]>
  getDirectoryHandle(name: string): Promise<LocalDirectoryHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}
export type WorkspaceCall = { id: string; name: string; args: Record<string, unknown> }
export type WorkspaceMessage = { role: 'user' | 'assistant' | 'tool'; content: string; tool_calls?: WorkspaceCall[]; tool_call_id?: string }
export type ChangePreview = { path: string; before: string; after: string; hash: string | null; oldText: string; newText: string }
const MAX_BYTES = 1024 * 1024
const CODE_EXTENSIONS = new Set<string>(CHAT_FILE_EXTENSIONS.filter(e => !['pdf', 'docx', 'xlsx'].includes(e)))

export function safeParts(path: string, root = false) {
  if (root && path === '') return []
  if (!path || path.length > 512 || /[\\:\u0000-\u001f\u007f]/.test(path)) throw new Error('只允许授权目录内的相对路径')
  const parts = path.split('/')
  if (parts.length > 16 || parts.some(p => !p || p === '.' || p === '..' || p.length > 128 || /[. ]$/.test(p)
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)
    || (p.startsWith('.') && !ALLOWED_PROJECT_DOTFILES.has(p)) || IGNORED_PROJECT_DIRECTORIES.has(p))) {
    throw new Error('路径不在允许读取的项目范围内')
  }
  return parts
}
export function sourceName(name: string) {
  try { safeParts(name) } catch { return false }
  return (CHAT_EXACT_FILENAMES as readonly string[]).includes(name) || CODE_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() || '')
}
export async function hashText(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
export function validateText(text: string) {
  if (new TextEncoder().encode(text).length > MAX_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new Error('只支持 1 MB 以内的 UTF-8 源码文本')
  }
}
function number(value: unknown, fallback = 0) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('分页参数无效')
  return value
}
function string(value: unknown) { if (typeof value !== 'string') throw new Error('文件参数无效'); return value }

export class LocalWorkspace {
  private observed = new Map<string, string>()
  readonly permissions: LocalWorkspacePermissions
  constructor(readonly root: LocalDirectoryHandle) { this.permissions = new LocalWorkspacePermissions(root) }
  async directory(path: string) {
    let dir = this.root
    for (const part of safeParts(path, true)) dir = await dir.getDirectoryHandle(part)
    return dir
  }
  private async target(path: string) {
    const parts = safeParts(path); const name = parts.pop()!
    if (!sourceName(name)) throw new Error('该文件不是支持的源码类型')
    return { dir: await this.directory(parts.join('/')), name }
  }
  private async text(path: string) {
    const { dir, name } = await this.target(path)
    const handle = await dir.getFileHandle(name)
    const file = await handle.getFile()
    if (file.size > MAX_BYTES) throw new Error('文件超过 1 MB 读取限制')
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer())
    validateText(text)
    return { handle, text, hash: await hashText(text) }
  }
  async list(path = '', offset = 0) {
    const dir = await this.directory(path)
    const entries: { name: string; kind: string; path: string }[] = []
    let scanned = 0; let scanCapped = false
    for await (const [name, handle] of dir.entries()) {
      if (++scanned > 3000) { scanCapped = true; break }
      try { safeParts(name) } catch { continue }
      if (handle.kind === 'file' && !sourceName(name)) continue
      entries.push({ name, kind: handle.kind, path: path ? `${path}/${name}` : name })
    }
    entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    return { entries: entries.slice(offset, offset + 100), nextOffset: offset + 100 < entries.length ? offset + 100 : null, scanCapped }
  }
  async read(path: string, offset = 0) {
    const file = await this.text(path)
    if (offset > file.text.length) throw new Error('读取位置超过文件末尾')
    this.observed.set(path, file.hash)
    if (offset > 0 && /[\uDC00-\uDFFF]/.test(file.text[offset] || '')) throw new Error('读取位置必须使用上次返回的 nextOffset')
    let end = Math.min(offset + 12000, file.text.length)
    if (end < file.text.length && /[\uD800-\uDBFF]/.test(file.text[end - 1] || '')) end--
    return { path, hash: file.hash, offset, content: file.text.slice(offset, end),
      nextOffset: end < file.text.length ? end : null, totalChars: file.text.length,
      offsetUnit: 'characters' }
  }
  async search(path: string, query: string, signal: AbortSignal) {
    if (!query || query.length > 200) throw new Error('搜索词需为 1–200 字符')
    const matches: { path: string; line: number; text: string }[] = []
    let scanned = 0; let bytes = 0; let skipped = 0; let truncated = false
    const deadline = Date.now() + 5000
    const walk = async (dir: LocalDirectoryHandle, prefix: string, depth: number) => {
      if (depth > 12) { truncated = true; return }
      for await (const [name, handle] of dir.entries()) {
        signal.throwIfAborted()
        if (++scanned > 1500 || bytes > 4 * MAX_BYTES || matches.length >= 60 || Date.now() > deadline) { truncated = true; return }
        try { safeParts(name) } catch { continue }
        const relative = prefix ? `${prefix}/${name}` : name
        if (handle.kind === 'directory') await walk(handle, relative, depth + 1)
        else if (sourceName(name)) {
          try {
            const { text } = await this.text(relative); bytes += new TextEncoder().encode(text).length
            const lines = text.split('\n')
            for (let i = 0; i < lines.length && matches.length < 60; i++) {
              const at = lines[i]!.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
              if (at >= 0) matches.push({ path: relative, line: i + 1, text: lines[i]!.slice(Math.max(0, at - 80), at + 240) })
            }
          } catch { skipped++ }
        }
        if (truncated) return
      }
    }
    await walk(await this.directory(path), path, 0)
    return { matches, truncated: truncated || matches.length >= 60, skipped }
  }
  async preview(call: WorkspaceCall): Promise<ChangePreview> {
    const path = string(call.args.path); await this.target(path)
    if (call.name === 'workspace_create') {
      const { dir, name } = await this.target(path)
      try { await dir.getFileHandle(name); throw new Error('目标文件已存在，请先读取再修改') }
      catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error }
      const content = string(call.args.content); validateText(content)
      return { path, before: '', after: content, hash: null, oldText: '', newText: content }
    }
    if (call.name !== 'workspace_edit') throw new Error('未知写入操作')
    const expected = string(call.args.expectedHash)
    if (!expected || this.observed.get(path) !== expected) throw new Error('修改前必须读取目标文件')
    const file = await this.text(path)
    if (file.hash !== expected) throw new Error('文件已变化，请重新读取后修改')
    const requestedOldText = string(call.args.oldText); const requestedNewText = string(call.args.newText)
    if (!requestedOldText || requestedOldText === requestedNewText) throw new Error('替换内容必须精确匹配且只出现一次')
    // Model output commonly uses LF even when a Windows source file uses CRLF.
    // Adapt only line endings; keep the unique-match and hash checks unchanged.
    const usesCrLf = file.text.includes('\r\n') && !file.text.replace(/\r\n/g, '').includes('\n')
    const lineEnding = usesCrLf ? '\r\n' : '\n'
    const adapt = (value: string) => value.replace(/\r\n/g, '\n').replace(/\n/g, lineEnding)
    const exactMatches = file.text.split(requestedOldText).length - 1
    if (exactMatches > 1) throw new Error('替换内容必须精确匹配且只出现一次；请重新读取文件并核对原文')
    const oldText = exactMatches === 1 ? requestedOldText : adapt(requestedOldText)
    if (file.text.split(oldText).length !== 2) throw new Error('替换内容必须精确匹配且只出现一次；请重新读取文件并核对原文')
    const newText = adapt(requestedNewText)
    if (oldText === newText) throw new Error('替换前后内容相同，文件未修改')
    const after = file.text.replace(oldText, () => newText); validateText(after)
    return { path, before: file.text, after, hash: expected, oldText, newText }
  }
  async apply(change: ChangePreview, signal: AbortSignal, options: { confirmed?: boolean } = {}) {
    this.permissions.assertCanWrite(options.confirmed)
    const write = async () => {
      signal.throwIfAborted()
      this.permissions.assertCanWrite(options.confirmed)
      if (await this.root.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('尚未授予本地目录写入权限')
      const { dir, name } = await this.target(change.path)
      let handle: LocalFileHandle
      if (change.hash === null) {
        try { await dir.getFileHandle(name); throw new Error('文件已被创建，已停止覆盖') }
        catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error }
        signal.throwIfAborted()
        this.permissions.assertCanWrite(options.confirmed)
        handle = await dir.getFileHandle(name, { create: true })
      } else {
        const current = await this.text(change.path)
        if (current.hash !== change.hash) throw new Error('文件已被修改，未应用此变更；请重新读取')
        handle = current.handle
      }
      this.permissions.assertCanWrite(options.confirmed)
      const writer = await handle.createWritable({ mode: 'exclusive' })
      try {
        // Finish an already-created file rather than leaving an empty file on cancellation.
        if (change.hash !== null) signal.throwIfAborted()
        this.permissions.assertCanWrite(options.confirmed)
        await writer.write(change.after)
        if (change.hash !== null) signal.throwIfAborted()
        const beforeCommit = await this.text(change.path)
        if (beforeCommit.hash !== (change.hash ?? await hashText(''))) throw new Error('写入期间文件发生变化，已停止应用')
        if (change.hash !== null) signal.throwIfAborted()
        this.permissions.assertCanWrite(options.confirmed)
        await writer.close()
      }
      catch (error) { await writer.abort().catch(() => undefined); throw error }
      const verified = await this.text(change.path)
      if (verified.text !== change.after) throw new Error('写入后文件发生变化，请重新检查')
      this.observed.set(change.path, verified.hash)
      return { status: 'applied', path: change.path, hash: verified.hash }
    }
    // Serializes this application's cooperating tabs; version checks also catch external edits.
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(`lyle-local:${this.root.name}:${change.path}`, { signal }, write)
    }
    return write()
  }
  async executeRead(call: WorkspaceCall, signal: AbortSignal) {
    signal.throwIfAborted()
    const path = string(call.args.path)
    if (call.name === 'workspace_list') return this.list(path, number(call.args.offset))
    if (call.name === 'workspace_read') return this.read(path, number(call.args.offset))
    if (call.name === 'workspace_search') return this.search(path, string(call.args.query), signal)
    throw new Error('不支持的本地工具')
  }
}

let staged: Promise<LocalDirectoryHandle | null> | null = null
export function stageLocalDrop(data: DataTransfer) {
  const items = Array.from(data.items || [])
  const directory = items.find(item => item.webkitGetAsEntry?.()?.isDirectory)
  if (!directory) return false
  const modern = directory as DataTransferItem & { getAsFileSystemHandle?: () => Promise<LocalDirectoryHandle | null> }
  // Capture within the original drop event, before awaiting anything.
  staged = modern.getAsFileSystemHandle?.() ?? Promise.resolve(null)
  return true
}
export async function takeLocalDrop() { const value = staged; staged = null; return value ? await value : null }
export async function chooseLocalDirectory() {
  const picker = (window as unknown as { showDirectoryPicker?: (options: object) => Promise<LocalDirectoryHandle> }).showDirectoryPicker
  if (!picker) throw new Error('当前浏览器不支持本地目录连接，请使用桌面版 Chrome 或 Edge')
  return picker({ mode: 'read', id: 'lyle-local-project' })
}
