import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalWorkspace, type LocalDirectoryHandle, type LocalFileHandle } from '@/domain/local-workspace'
import { createLocalProject, createLocalSessionForProject, loadLocalHistory, saveLocalHistory } from '@/domain/local-workspace-history'
import { addLocalAttachment, attachmentManifest, clearLocalAttachments, fileAttachmentWorkspace, folderFilesWorkspace,
  LocalConversationWorkspace, localAttachments, removeLocalAttachment, resetAttachmentPermissions,
  type AttachmentScope, type PickedFileHandle } from '@/domain/local-workspace-attachments'

const owners = ['attachment-owner', 'attachment-other']
const scope: AttachmentScope = { owner: owners[0]!, projectId: 'project-a', sessionId: 'session-a' }
const signal = () => new AbortController().signal
let disk: Map<string, string>

function virtualDirectory(initial: Record<string, string>, name = 'sample-project') {
  const files = new Map(Object.entries(initial))
  const counts = { reads: 0, writes: 0 }
  let writePermission: PermissionState = 'prompt'
  const requestPermission = vi.fn(async (options: { mode: 'read' | 'readwrite' }): Promise<PermissionState> => {
    if (options.mode === 'readwrite') writePermission = 'granted'
    return 'granted'
  })
  const queryPermission = vi.fn(async (options: { mode: 'read' | 'readwrite' }): Promise<PermissionState> => options.mode === 'read' ? 'granted' : writePermission)
  const missing = () => new DOMException('missing', 'NotFoundError')
  const fileHandle = (path: string): PickedFileHandle => ({
    kind: 'file', name: path.split('/').pop()!, requestPermission, queryPermission,
    async getFile() { counts.reads++; return new File([files.get(path)!], path.split('/').pop()!) },
    async createWritable() {
      let staged = ''
      return { async write(value: string) { staged = value }, async close() { counts.writes++; files.set(path, staged) }, async abort() {} }
    }
  })
  const directory = (prefix = ''): LocalDirectoryHandle => ({
    kind: 'directory', name: prefix.split('/').filter(Boolean).pop() || name, requestPermission, queryPermission,
    async *entries() {
      const childNames = new Set([...files.keys()].filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length).split('/')[0]!))
      for (const childName of childNames) {
        const path = prefix + childName
        yield [childName, files.has(path) ? fileHandle(path) : directory(path + '/')]
      }
    },
    async getDirectoryHandle(childName) {
      if (![...files.keys()].some(path => path.startsWith(prefix + childName + '/'))) throw missing()
      return directory(prefix + childName + '/')
    },
    async getFileHandle(childName, options): Promise<LocalFileHandle> {
      const path = prefix + childName
      if (!files.has(path)) { if (!options?.create) throw missing(); files.set(path, '') }
      return fileHandle(path)
    }
  })
  return { root: directory(), fileHandle, files, counts, requestPermission }
}

function folderFile(name: string, content: string, path: string) {
  return Object.defineProperty(new File([content], name), 'webkitRelativePath', { value: path }) as File
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  disk = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => disk.get(key) ?? null,
    setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) })
})
afterEach(() => { for (const owner of owners) clearLocalAttachments(owner); vi.unstubAllGlobals() })

describe('local conversation attachment boundaries', () => {
  it('isolates the same-named attachment by owner, project and session', async () => {
    const variants: AttachmentScope[] = [scope,
      { ...scope, owner: owners[1]! }, { ...scope, projectId: 'project-b' }, { ...scope, sessionId: 'session-b' }]
    const added = variants.map((entry, index) => addLocalAttachment(entry, {
      name: 'config.ts', kind: 'file', workspace: fileAttachmentWorkspace(new File([`scope-${index}`], 'config.ts')), writable: false
    }))
    expect(new Set(added.map(item => item.id)).size).toBe(4)
    for (const [index, entry] of variants.entries()) {
      expect(localAttachments(entry)).toHaveLength(1)
      const router = new LocalConversationWorkspace(undefined, localAttachments(entry))
      const result = await router.executeRead({ id: 'read', name: 'workspace_read', args: { path: `${added[index]!.path}/config.ts` } }, signal())
      expect(result).toMatchObject({ content: `scope-${index}` })
      for (const foreign of added.filter(item => item.id !== added[index]!.id)) {
        await expect(router.executeRead({ id: 'foreign', name: 'workspace_read', args: { path: `${foreign.path}/config.ts` } }, signal())).rejects.toThrow('该会话附件当前不可用')
      }
    }
  })

  it('adds a folder to the existing conversation without creating a project or saving handles into history', () => {
    const project = createLocalProject('existing-project')
    const session = createLocalSessionForProject(project)
    const history = { projects: [project], sessions: [session], activeProjectId: project.id, activeId: session.id }
    expect(saveLocalHistory(scope.owner, history).ok).toBe(true)
    const storageBefore = [...disk]
    const folder = virtualDirectory({ 'src/main.ts': 'main()' })
    addLocalAttachment({ ...scope, projectId: project.id, sessionId: session.id }, {
      name: 'shared-src', kind: 'folder', workspace: new LocalWorkspace(folder.root), writable: true
    })
    expect([...disk]).toEqual(storageBefore)
    expect(loadLocalHistory(scope.owner).history).toEqual(history)
    expect(localAttachments({ ...scope, projectId: project.id, sessionId: session.id })).toHaveLength(1)
  })

  it('removes routing access, resets retained write policy, and preserves another account', async () => {
    const folder = virtualDirectory({ 'main.ts': 'before' })
    const workspace = new LocalWorkspace(folder.root)
    const added = addLocalAttachment(scope, { name: 'folder', kind: 'folder', workspace, writable: true })
    const otherScope = { ...scope, owner: owners[1]! }
    addLocalAttachment(otherScope, { name: 'other.ts', kind: 'file', workspace: fileAttachmentWorkspace(new File(['other'], 'other.ts')), writable: false })
    await workspace.permissions.select('auto')
    removeLocalAttachment(scope, added.id)
    expect(workspace.permissions.mode).toBe('confirm')
    const router = new LocalConversationWorkspace(undefined, localAttachments(scope))
    expect(router.connected).toBe(false)
    await expect(router.executeRead({ id: 'stale', name: 'workspace_read', args: { path: `${added.path}/main.ts` } }, signal())).rejects.toThrow('不可用')
    expect(localAttachments(otherScope)).toHaveLength(1)
    clearLocalAttachments(scope.owner)
    expect(localAttachments(otherScope)).toHaveLength(1)
  })

  it('resets attachment permissions independently of the connected project and another session', async () => {
    const first = virtualDirectory({ 'a.ts': 'a' }); const second = virtualDirectory({ 'b.ts': 'b' })
    const project = new LocalWorkspace(virtualDirectory({ 'project.ts': 'p' }).root)
    const one = new LocalWorkspace(first.root); const two = new LocalWorkspace(second.root)
    addLocalAttachment(scope, { name: 'one', kind: 'folder', workspace: one, writable: true })
    const otherScope = { ...scope, sessionId: 'session-b' }
    addLocalAttachment(otherScope, { name: 'two', kind: 'folder', workspace: two, writable: true })
    await Promise.all([one.permissions.select('auto'), two.permissions.select('auto'), project.permissions.select('auto')])
    resetAttachmentPermissions(scope)
    expect(one.permissions.mode).toBe('confirm')
    expect(two.permissions.mode).toBe('auto')
    expect(project.permissions.mode).toBe('auto')
    clearLocalAttachments(scope.owner, scope.sessionId)
    expect(localAttachments(scope)).toEqual([])
    expect(localAttachments(otherScope)).toHaveLength(1)
  })

  it('never falls through an unavailable attachment ID or escaping path into the project root', async () => {
    const project = virtualDirectory({ 'private.ts': 'project-only' })
    const resource = addLocalAttachment(scope, { name: 'allowed.ts', kind: 'file',
      workspace: fileAttachmentWorkspace(new File(['attached'], 'allowed.ts')), writable: false })
    const router = new LocalConversationWorkspace(new LocalWorkspace(project.root), localAttachments(scope))
    for (const path of ['@attachments/missing/private.ts', `${resource.path}/../private.ts`, `${resource.path}/.env`, `${resource.path}/node_modules/a.ts`]) {
      await expect(router.executeRead({ id: 'bad', name: 'workspace_read', args: { path } }, signal())).rejects.toThrow()
    }
    expect(project.counts.reads).toBe(0)
  })

  it('keeps pure Files and fallback folder selections read-only', async () => {
    const plain = fileAttachmentWorkspace(new File(['old'], 'plain.ts'))
    const file = addLocalAttachment(scope, { name: 'plain.ts', kind: 'file', workspace: plain, writable: false })
    const folder = folderFilesWorkspace([folderFile('main.ts', 'source', 'folder/src/main.ts'),
      folderFile('.env', 'secret', 'folder/.env'), folderFile('library.ts', 'dependency', 'folder/node_modules/library.ts')])
    const directory = addLocalAttachment(scope, { name: 'folder', kind: 'folder', workspace: folder, writable: false })
    const router = new LocalConversationWorkspace(undefined, localAttachments(scope))
    expect(await router.executeRead({ id: 'read', name: 'workspace_read', args: { path: `${directory.path}/src/main.ts` } }, signal())).toMatchObject({ content: 'source' })
    const listing = await router.executeRead({ id: 'list', name: 'workspace_list', args: { path: directory.path } }, signal())
    expect(listing).toMatchObject({ entries: [{ name: 'src' }] })
    await expect(plain.permissions.select('auto')).rejects.toThrow('未授予')
    await expect(folder.permissions.select('auto')).rejects.toThrow('未授予')
    await expect(router.preview({ id: 'edit', name: 'workspace_edit', args: { path: `${file.path}/plain.ts`, expectedHash: 'fake', oldText: 'old', newText: 'new' } })).rejects.toThrow('只读')
  })

  it('qualifies list and search results so a follow-up read stays inside the selected attachment', async () => {
    const folder = virtualDirectory({ 'src/a.ts': 'const value = 42', 'src/b.ts': 'const answer = 42' })
    const entry = addLocalAttachment(scope, { name: 'sample-project', kind: 'folder', workspace: new LocalWorkspace(folder.root), writable: true })
    const router = new LocalConversationWorkspace(undefined, localAttachments(scope))
    const result = await router.executeRead({ id: 'search', name: 'workspace_search', args: { path: entry.path, query: 'answer' } }, signal())
    expect(result).toMatchObject({ matches: [{ path: `${entry.path}/src/b.ts`, line: 1 }] })
    const listing = await router.executeRead({ id: 'list', name: 'workspace_list', args: { path: entry.path } }, signal())
    expect(listing).toMatchObject({ entries: [{ path: `${entry.path}/src` }] })
    const all = await router.executeRead({ id: 'all', name: 'workspace_list', args: { path: '' } }, signal())
    expect(all).toMatchObject({ entries: [{ path: entry.path }] })
  })

  it('edits a picked file only after a real read, exact diff, and its own browser authorization', async () => {
    const picked = virtualDirectory({ 'picked.ts': 'const oldValue = 1;' })
    const handle = picked.fileHandle('picked.ts')
    const file = await handle.getFile()
    const resource = addLocalAttachment(scope, { name: file.name, kind: 'file', workspace: fileAttachmentWorkspace(file, handle), writable: true })
    const project = virtualDirectory({ 'picked.ts': 'project untouched' })
    const projectWorkspace = new LocalWorkspace(project.root)
    const router = new LocalConversationWorkspace(projectWorkspace, localAttachments(scope))
    const path = `${resource.path}/picked.ts`
    const edit = { id: 'edit', name: 'workspace_edit', args: { path, expectedHash: 'not-read', oldText: 'oldValue', newText: 'newValue' } }
    await expect(router.preview(edit)).rejects.toThrow('必须读取')
    const read = await router.executeRead({ id: 'read', name: 'workspace_read', args: { path } }, signal()) as { hash: string }
    const change = await router.preview({ ...edit, args: { ...edit.args, expectedHash: read.hash } })
    expect(picked.counts.writes).toBe(0)
    await expect(router.apply(change, signal())).rejects.toThrow('逐项确认')
    await router.permissionsFor(path).select('auto')
    expect(projectWorkspace.permissions.mode).toBe('confirm')
    expect(picked.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(await router.apply(change, signal())).toMatchObject({ status: 'applied', path })
    expect(picked.files.get('picked.ts')).toBe('const newValue = 1;')
    expect(project.files.get('picked.ts')).toBe('project untouched')
    expect(project.counts.writes).toBe(0)
    await expect(router.preview({ id: 'new', name: 'workspace_create', args: { path: `${resource.path}/foreign.ts`, content: 'new' } })).rejects.toThrow('仅授权该文件')
  })

  it('rejects stale and ambiguous attached-file changes without overwriting external edits', async () => {
    const picked = virtualDirectory({ 'picked.ts': 'same same' })
    const handle = picked.fileHandle('picked.ts')
    const resource = addLocalAttachment(scope, { name: 'picked.ts', kind: 'file', workspace: fileAttachmentWorkspace(await handle.getFile(), handle), writable: true })
    const router = new LocalConversationWorkspace(undefined, localAttachments(scope))
    const path = `${resource.path}/picked.ts`
    const read = await router.executeRead({ id: 'read', name: 'workspace_read', args: { path } }, signal()) as { hash: string }
    await expect(router.preview({ id: 'edit', name: 'workspace_edit', args: { path, expectedHash: read.hash, oldText: 'same', newText: 'different' } })).rejects.toThrow('只出现一次')
    const change = await router.preview({ id: 'edit', name: 'workspace_edit', args: { path, expectedHash: read.hash, oldText: 'same same', newText: 'new' } })
    await router.permissionsFor(path).select('auto')
    picked.files.set('picked.ts', 'external')
    await expect(router.apply(change, signal())).rejects.toThrow('已被修改')
    expect(picked.files.get('picked.ts')).toBe('external')
    expect(picked.counts.writes).toBe(0)
  })

  it('caps attachment and image counts while keeping file handles out of the model manifest', () => {
    addLocalAttachment(scope, { name: 'one.png', kind: 'image', image: 'data:image/png;base64,test', writable: false })
    addLocalAttachment(scope, { name: 'two.png', kind: 'image', image: 'data:image/png;base64,test', writable: false })
    expect(() => addLocalAttachment(scope, { name: 'three.png', kind: 'image', image: 'data:image/png;base64,test', writable: false })).toThrow('2 张图片')
    for (let index = 0; index < 6; index++) addLocalAttachment(scope, { name: `source-${index}.ts`, kind: 'file', workspace: fileAttachmentWorkspace(new File(['source'], `source-${index}.ts`)), writable: false })
    expect(() => addLocalAttachment(scope, { name: 'extra.ts', kind: 'file', workspace: fileAttachmentWorkspace(new File(['source'], 'extra.ts')), writable: false })).toThrow('8 个附件')
    const manifest = attachmentManifest(localAttachments(scope), false)
    expect(manifest).toContain('read-only')
    expect(manifest).not.toContain('data:image')
    expect(manifest).not.toContain('createWritable')
  })
})
