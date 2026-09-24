import { describe, expect, it } from 'vitest'
import { webcrypto } from 'node:crypto'
import { LocalWorkspace, safeParts, sourceName, type LocalDirectoryHandle, type LocalFileHandle } from '@/domain/local-workspace'

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
function fixture(initial: Record<string, string>) {
  const disk = new Map(Object.entries(initial)); let reads = 0; let writes = 0
  const missing = () => new DOMException('not found', 'NotFoundError')
  function directory(prefix = ''): LocalDirectoryHandle {
    return {
      kind: 'directory', name: prefix.split('/').filter(Boolean).pop() || 'project',
      async queryPermission() { return 'granted' }, async requestPermission() { return 'granted' },
      async *entries() {
        const names = new Set([...disk.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length).split('/')[0]!))
        for (const name of names) {
          const child = prefix + name
          if (disk.has(child)) yield [name, await this.getFileHandle(name)]
          else yield [name, directory(child + '/')]
        }
      },
      async getDirectoryHandle(name) {
        if (![...disk.keys()].some(k => k.startsWith(prefix + name + '/'))) throw missing()
        return directory(prefix + name + '/')
      },
      async getFileHandle(name, options): Promise<LocalFileHandle> {
        const path = prefix + name
        if (!disk.has(path)) { if (!options?.create) throw missing(); disk.set(path, '') }
        return { kind: 'file', name,
          async getFile() { reads++; return new File([disk.get(path)!], name) },
          async createWritable() { let staged = ''; return {
            async write(text) { staged = text }, async close() { writes++; disk.set(path, staged) }, async abort() {}
          } }
        }
      }
    }
  }
  return { disk, root: directory(), counts: () => ({ reads, writes }) }
}
const signal = () => new AbortController().signal
describe('local workspace file boundary', () => {
  it.each(['../secret.ts', '/tmp/a.py', 'C:/a.py', 'a\\b.ts', 'a//b.ts', '.env', '.git/config', 'node_modules/a.ts', 'NUL.txt', 'a./b.ts'])('rejects unsafe path %s', path => {
    expect(() => safeParts(path)).toThrow()
  })
  it('lists without reading file bodies and excludes generated/secret/binary entries', async () => {
    const f = fixture({ 'src/a.ts': 'private code', '.env': 'KEY=secret', 'node_modules/a.js': 'dep', 'photo.png': 'binary', Dockerfile: 'FROM x' })
    const result = await new LocalWorkspace(f.root).list()
    expect(result.entries.map(x => x.name).sort()).toEqual(['Dockerfile', 'src'])
    expect(f.counts()).toEqual({ reads: 0, writes: 0 })
    expect(sourceName('.gitignore')).toBe(true)
  })
  it('paginates long Unicode text losslessly and requires a prior read before editing', async () => {
    const original = '代码🚀'.repeat(6000)
    const f = fixture({ 'src/a.ts': original }); const ws = new LocalWorkspace(f.root)
    await expect(ws.preview({ id: '1', name: 'workspace_edit', args: { path: 'src/a.ts', expectedHash: 'fake', oldText: '代码', newText: 'code' } })).rejects.toThrow('读取')
    let combined = ''; let offset: number | null = 0
    while (offset !== null) { const result = await ws.read('src/a.ts', offset); combined += result.content; offset = result.nextOffset }
    expect(combined).toBe(original); expect(f.counts().writes).toBe(0)
  })
  it('previews without writing, then applies and verifies a confirmed exact change', async () => {
    const f = fixture({ 'src/a.ts': 'const text = "before";\n' }); const ws = new LocalWorkspace(f.root)
    const read = await ws.read('src/a.ts')
    const change = await ws.preview({ id: '2', name: 'workspace_edit', args: { path: 'src/a.ts', expectedHash: read.hash, oldText: 'before', newText: '$& after' } })
    expect(f.counts().writes).toBe(0)
    const result = await ws.apply(change, signal(), { confirmed: true })
    expect(result.status).toBe('applied'); expect(f.disk.get('src/a.ts')).toBe('const text = "$& after";\n')
  })
  it('preserves an external edit made while approval was pending', async () => {
    const f = fixture({ 'a.py': 'old' }); const ws = new LocalWorkspace(f.root); const read = await ws.read('a.py')
    const change = await ws.preview({ id: '2', name: 'workspace_edit', args: { path: 'a.py', expectedHash: read.hash, oldText: 'old', newText: 'new' } })
    f.disk.set('a.py', 'external')
    await expect(ws.apply(change, signal(), { confirmed: true })).rejects.toThrow('已被修改')
    expect(f.disk.get('a.py')).toBe('external'); expect(f.counts().writes).toBe(0)
  })
  it('rejects ambiguous replacements, existing creates and cancelled writes', async () => {
    const f = fixture({ 'a.ts': 'same same' }); const ws = new LocalWorkspace(f.root); const read = await ws.read('a.ts')
    await expect(ws.preview({ id: '1', name: 'workspace_edit', args: { path: 'a.ts', expectedHash: read.hash, oldText: 'same', newText: 'x' } })).rejects.toThrow('只出现一次')
    await expect(ws.preview({ id: '2', name: 'workspace_create', args: { path: 'a.ts', content: 'overwrite' } })).rejects.toThrow('已存在')
    const change = await ws.preview({ id: '3', name: 'workspace_create', args: { path: 'new.ts', content: 'new' } })
    const controller = new AbortController(); controller.abort()
    await expect(ws.apply(change, controller.signal, { confirmed: true })).rejects.toThrow()
    expect(f.disk.has('new.ts')).toBe(false)
  })
  it('searches only authorized source files and reports real matches', async () => {
    const f = fixture({ 'src/a.ts': 'const answer = 42', '.env': 'answer=secret', 'node_modules/x.js': 'answer' }); const ws = new LocalWorkspace(f.root)
    const result = await ws.search('', 'answer', signal())
    expect(result.matches).toEqual([{ path: 'src/a.ts', line: 1, text: 'const answer = 42' }])
    expect(f.counts().writes).toBe(0)
  })
  it('enforces read-only even when the browser already grants write permission', async () => {
    const f = fixture({ 'a.ts': 'before' }); const ws = new LocalWorkspace(f.root)
    await ws.permissions.select('read-only')
    const read = await ws.read('a.ts')
    const change = await ws.preview({ id: '1', name: 'workspace_edit', args: { path: 'a.ts', expectedHash: read.hash, oldText: 'before', newText: 'after' } })
    const created = await ws.preview({ id: '2', name: 'workspace_create', args: { path: 'new.ts', content: 'new' } })
    await expect(ws.apply(change, signal(), { confirmed: true })).rejects.toThrow('只读')
    await expect(ws.apply(created, signal())).rejects.toThrow('只读')
    expect(f.disk.get('a.ts')).toBe('before'); expect(f.disk.has('new.ts')).toBe(false)
    expect(f.counts().writes).toBe(0)
  })
  it('requires per-change confirmation by default and allows auto after explicit browser authorization', async () => {
    const f = fixture({ 'a.ts': 'before' }); const ws = new LocalWorkspace(f.root)
    const read = await ws.read('a.ts')
    const change = await ws.preview({ id: '1', name: 'workspace_edit', args: { path: 'a.ts', expectedHash: read.hash, oldText: 'before', newText: 'after' } })
    await expect(ws.apply(change, signal())).rejects.toThrow('逐项确认')
    await ws.permissions.select('auto')
    expect((await ws.apply(change, signal())).status).toBe('applied')
    expect(f.disk.get('a.ts')).toBe('after')
    expect(new LocalWorkspace(f.root).permissions.mode).toBe('confirm')
  })
  it('still checks browser permissions and concurrent file changes in auto mode', async () => {
    const f = fixture({ 'a.ts': 'before' }); const ws = new LocalWorkspace(f.root)
    await ws.permissions.select('auto')
    const read = await ws.read('a.ts')
    const change = await ws.preview({ id: '1', name: 'workspace_edit', args: { path: 'a.ts', expectedHash: read.hash, oldText: 'before', newText: 'after' } })
    f.root.queryPermission = async () => 'denied'
    await expect(ws.apply(change, signal())).rejects.toThrow('尚未授予')
    f.root.queryPermission = async () => 'granted'; f.disk.set('a.ts', 'external')
    await expect(ws.apply(change, signal())).rejects.toThrow('已被修改')
    expect(f.disk.get('a.ts')).toBe('external'); expect(f.counts().writes).toBe(0)
  })
  it('aborts a staged change if the user revokes auto mode before commit', async () => {
    const f = fixture({ 'a.ts': 'before' }); const ws = new LocalWorkspace(f.root)
    await ws.permissions.select('auto')
    const read = await ws.read('a.ts')
    const change = await ws.preview({ id: '1', name: 'workspace_edit', args: { path: 'a.ts', expectedHash: read.hash, oldText: 'before', newText: 'after' } })
    const getFileHandle = f.root.getFileHandle.bind(f.root)
    f.root.getFileHandle = async (name, options) => {
      const handle = await getFileHandle(name, options)
      const createWritable = handle.createWritable.bind(handle)
      handle.createWritable = async (...args) => {
        const writer = await createWritable(...args)
        const write = writer.write.bind(writer)
        writer.write = async text => { await write(text); await ws.permissions.select('read-only') }
        return writer
      }
      return handle
    }
    await expect(ws.apply(change, signal())).rejects.toThrow('只读')
    expect(f.disk.get('a.ts')).toBe('before'); expect(f.counts().writes).toBe(0)
  })
  it('does not commit an existing file when stopped during the final conflict check', async () => {
    const f = fixture({ 'a.ts': 'before' }); const ws = new LocalWorkspace(f.root)
    await ws.permissions.select('auto')
    const read = await ws.read('a.ts')
    const change = await ws.preview({ id: '1', name: 'workspace_edit', args: { path: 'a.ts', expectedHash: read.hash, oldText: 'before', newText: 'after' } })
    const controller = new AbortController()
    let announceRead!: () => void; let resumeRead!: () => void; let applyReads = 0
    const beforeCommitRead = new Promise<void>(resolve => { announceRead = resolve })
    const canFinishRead = new Promise<void>(resolve => { resumeRead = resolve })
    const getFileHandle = f.root.getFileHandle.bind(f.root)
    f.root.getFileHandle = async (name, options) => {
      const handle = await getFileHandle(name, options)
      const getFile = handle.getFile.bind(handle)
      handle.getFile = async () => {
        if (++applyReads === 2) { announceRead(); await canFinishRead }
        return getFile()
      }
      return handle
    }
    const applying = ws.apply(change, controller.signal)
    await beforeCommitRead
    controller.abort(); resumeRead()
    await expect(applying).rejects.toThrow()
    expect(f.disk.get('a.ts')).toBe('before'); expect(f.counts().writes).toBe(0)
  })
})
