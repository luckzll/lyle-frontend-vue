import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalDirectoryHandle } from '@/domain/local-workspace'
const persistence = vi.hoisted(() => ({ store: vi.fn(), load: vi.fn(), remove: vi.fn(), pruneOwner: vi.fn(), clearMemory: vi.fn() }))
vi.mock('@/domain/local-project-handle-store', () => ({ localProjectHandleStore: persistence }))
import { clearLocalHandles, forgetProjectHandle, getProjectHandle, pruneProjectHandles, rememberProjectHandle, restoreProjectHandle } from '@/domain/local-workspace-history'

const owners = ['restored-root-owner', 'restored-other-owner']
const roots = () => ({ kind: 'directory', name: 'same-name', queryPermission: vi.fn(), requestPermission: vi.fn() } as unknown as LocalDirectoryHandle)
const bindingKey = (owner: string, project: string) => JSON.stringify([owner, project])
const ok = (handle?: LocalDirectoryHandle) => ({ status: 'ok' as const, persistent: true, error: null, ...(handle ? { handle } : {}) })
let saved: Map<string, LocalDirectoryHandle>
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }

beforeEach(() => {
  saved = new Map()
  for (const method of Object.values(persistence)) method.mockReset()
  persistence.store.mockImplementation(async (owner: string, project: string, handle: LocalDirectoryHandle) => { saved.set(bindingKey(owner, project), handle); return ok(handle) })
  persistence.load.mockImplementation(async (owner: string, project: string) => {
    const handle = saved.get(bindingKey(owner, project))
    return handle ? ok(handle) : { status: 'missing', persistent: true, error: null }
  })
  persistence.remove.mockImplementation(async (owner: string, project: string) => { saved.delete(bindingKey(owner, project)); return ok() })
  persistence.pruneOwner.mockImplementation(async (owner: string, retainedIds: Iterable<string>) => {
    const retained = new Set(retainedIds)
    for (const key of saved.keys()) { const [entryOwner, project] = JSON.parse(key); if (owner === entryOwner && !retained.has(project)) saved.delete(key) }
    return ok()
  })
})
afterEach(() => { for (const owner of owners) clearLocalHandles(owner) })

describe('project root memory and persistent binding integration', () => {
  it('remembers a root synchronously, then rehydrates only its owner/project after the runtime cache is cleared', async () => {
    const root = roots()
    const saving = rememberProjectHandle(owners[0]!, 'first', root)
    expect(getProjectHandle(owners[0]!, 'first')).toBe(root)
    await saving
    clearLocalHandles(owners[0]!)
    expect(saved.get(bindingKey(owners[0]!, 'first'))).toBe(root)
    expect(getProjectHandle(owners[0]!, 'first')).toBeUndefined()
    expect((await restoreProjectHandle(owners[0]!, 'first')).handle).toBe(root)
    expect(getProjectHandle(owners[0]!, 'first')).toBe(root)
    expect((await restoreProjectHandle(owners[1]!, 'first')).status).toBe('missing')
    expect((await restoreProjectHandle(owners[0]!, 'other-project')).status).toBe('missing')
    expect(root.queryPermission).not.toHaveBeenCalled()
    expect(root.requestPermission).not.toHaveBeenCalled()
  })
  it('preserves the current runtime root when persistence is unavailable', async () => {
    const root = roots()
    persistence.store.mockResolvedValue({ status: 'unavailable', persistent: false, error: 'IndexedDB blocked' })
    await rememberProjectHandle(owners[0]!, 'first', root)
    persistence.load.mockResolvedValue({ status: 'unavailable', persistent: false, error: 'IndexedDB blocked' })
    expect(await restoreProjectHandle(owners[0]!, 'first')).toMatchObject({ status: 'unavailable', persistent: false, handle: root })
  })
  it('does not hydrate an old owner after logout clears memory while a load is in flight', async () => {
    const pending = deferred<ReturnType<typeof ok>>()
    persistence.load.mockReturnValue(pending.promise)
    const restoring = restoreProjectHandle(owners[0]!, 'first')
    clearLocalHandles(owners[0]!)
    pending.resolve(ok(roots()))
    expect(await restoring).toMatchObject({ status: 'missing' })
    expect(getProjectHandle(owners[0]!, 'first')).toBeUndefined()
    expect(persistence.remove).not.toHaveBeenCalled()
    expect(persistence.pruneOwner).not.toHaveBeenCalled()
  })
  it('keeps the newly selected root if an older persisted load finishes afterward', async () => {
    const pending = deferred<ReturnType<typeof ok>>()
    persistence.load.mockReturnValue(pending.promise)
    const restoring = restoreProjectHandle(owners[0]!, 'first')
    const replacement = roots()
    await rememberProjectHandle(owners[0]!, 'first', replacement)
    pending.resolve(ok(roots()))
    expect((await restoring).handle).toBe(replacement)
    expect(getProjectHandle(owners[0]!, 'first')).toBe(replacement)
  })
  it('clears a missing/deleted binding immediately and prevents a pending load from reviving it', async () => {
    const root = roots()
    await rememberProjectHandle(owners[0]!, 'first', root)
    const pending = deferred<ReturnType<typeof ok>>()
    persistence.load.mockReturnValue(pending.promise)
    const restoring = restoreProjectHandle(owners[0]!, 'first')
    const removing = forgetProjectHandle(owners[0]!, 'first')
    expect(getProjectHandle(owners[0]!, 'first')).toBeUndefined()
    await removing; pending.resolve(ok(root))
    expect((await restoring).status).toBe('missing')
    expect(saved.has(bindingKey(owners[0]!, 'first'))).toBe(false)
  })
  it('prunes only deleted projects for the selected owner, including roots currently loading', async () => {
    const root = roots()
    await rememberProjectHandle(owners[0]!, 'retained', root)
    await rememberProjectHandle(owners[1]!, 'deleted', root)
    const pending = deferred<ReturnType<typeof ok>>()
    persistence.load.mockReturnValue(pending.promise)
    const restoring = restoreProjectHandle(owners[0]!, 'deleted')
    await pruneProjectHandles(owners[0]!, ['retained'])
    pending.resolve(ok(root))
    expect((await restoring).status).toBe('missing')
    expect(getProjectHandle(owners[0]!, 'deleted')).toBeUndefined()
    expect(getProjectHandle(owners[0]!, 'retained')).toBe(root)
    expect(saved.has(bindingKey(owners[1]!, 'deleted'))).toBe(true)
  })
})
