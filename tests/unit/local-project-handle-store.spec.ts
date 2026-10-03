import { describe, expect, it, vi } from 'vitest'
import type { LocalDirectoryHandle } from '@/domain/local-workspace'
import { createLocalProjectHandleStore } from '@/domain/local-project-handle-store'

type Row = { owner: string; projectId: string; handle: LocalDirectoryHandle }
type Request = { result?: unknown; onsuccess?: () => void; onerror?: () => void; onblocked?: () => void; onupgradeneeded?: () => void }
const key = (owner: string, projectId: string) => JSON.stringify([owner, projectId])
function handle(name = 'project'): LocalDirectoryHandle {
  return {
    kind: 'directory', name,
    entries: vi.fn(async function* () {}),
    getDirectoryHandle: vi.fn(), getFileHandle: vi.fn(),
    queryPermission: vi.fn(async () => 'granted' as const),
    requestPermission: vi.fn(async () => 'granted' as const),
  }
}

/** Minimal asynchronous IDB double: request success and transaction commit are separate events. */
class FakeIndexedDB {
  rows = new Map<string, Row>()
  writes: Row[] = []
  openThrow = false
  transactionThrow = false
  putThrow = false
  failRequest = false
  abortAfterSuccess = false
  holdNext = false
  blocked = false
  release: (() => void) | undefined
  onHeld: (() => void) | undefined
  close = vi.fn()
  factory = {
    open: vi.fn(() => {
      if (this.openThrow) throw new DOMException('blocked by private mode', 'SecurityError')
      const request: Request = {}
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true }, close: this.close,
          transaction: () => this.transaction(),
        }
        if (this.blocked) request.onblocked?.()
        else request.onsuccess?.()
      })
      return request
    }),
  } as unknown as IDBFactory

  private transaction() {
    if (this.transactionThrow) throw new DOMException('not allowed', 'InvalidStateError')
    const snapshot = new Map(this.rows)
    const hold = this.holdNext; this.holdNext = false
    const abortAfterSuccess = this.abortAfterSuccess; this.abortAfterSuccess = false
    const failRequest = this.failRequest; this.failRequest = false
    let pending = 0; let ended = false; let completing = false
    const tx = {
      oncomplete: undefined as (() => void) | undefined,
      onabort: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      abort: () => { if (!ended) { ended = true; queueMicrotask(() => tx.onabort?.()) } },
      objectStore: () => store,
    }
    const complete = () => {
      if (pending || ended) return
      ended = true; this.rows = snapshot; tx.oncomplete?.()
    }
    const maybeComplete = () => {
      if (pending || ended || completing) return
      completing = true
      if (hold) { this.release = complete; this.onHeld?.(); this.onHeld = undefined }
      else queueMicrotask(complete)
    }
    const request = (perform: () => unknown): Request => {
      const result: Request = {}; pending++
      queueMicrotask(() => {
        if (ended) return
        if (failRequest) { result.onerror?.(); ended = true; tx.onerror?.(); return }
        result.result = perform(); result.onsuccess?.(); pending--
        if (abortAfterSuccess) tx.abort()
        else maybeComplete()
      })
      return result
    }
    const store = {
      put: (row: Row) => {
        if (this.putThrow) throw new DOMException('uncloneable handle', 'DataCloneError')
        this.writes.push(row)
        return request(() => { snapshot.set(key(row.owner, row.projectId), { ...row }); return [row.owner, row.projectId] })
      },
      get: (parts: [string, string]) => request(() => snapshot.get(key(...parts))),
      delete: (parts: [string, string]) => request(() => { snapshot.delete(key(...parts)) }),
      openCursor: () => {
        const entries = [...snapshot.entries()]; let position = 0
        const cursorRequest: Request = {}; pending++
        const advance = () => queueMicrotask(() => {
          if (ended) return
          const entry = entries[position++]
          cursorRequest.result = entry ? {
            value: entry[1],
            delete: () => request(() => { snapshot.delete(entry[0]) }),
            continue: () => { pending++; advance() },
          } : null
          cursorRequest.onsuccess?.(); pending--; maybeComplete()
        })
        advance(); return cursorRequest
      },
    }
    return tx
  }
}

describe('local project directory handle persistence', () => {
  it('restores a native handle through a fresh store, partitioned by owner and project', async () => {
    const idb = new FakeIndexedDB(); const first = createLocalProjectHandleStore(() => idb.factory)
    const one = handle('one'); const two = handle('two'); const other = handle('other')
    expect(await first.store('alice', 'p1', one)).toMatchObject({ status: 'ok', persistent: true })
    await first.store('alice', 'p2', two); await first.store('bob', 'p1', other)
    const fresh = createLocalProjectHandleStore(() => idb.factory)
    expect((await fresh.load('alice', 'p1')).handle).toBe(one)
    expect((await fresh.load('alice', 'p2')).handle).toBe(two)
    expect((await fresh.load('bob', 'p1')).handle).toBe(other)
    expect((await fresh.load('bob', 'p2')).status).toBe('missing')
    expect(Object.keys(idb.writes[0]!)).toEqual(['owner', 'projectId', 'handle'])
    expect(idb.writes[0]!.handle).toBe(one)
    expect(one.queryPermission).not.toHaveBeenCalled(); expect(one.requestPermission).not.toHaveBeenCalled()
    expect(one.entries).not.toHaveBeenCalled()
  })

  it('uses a compound key without collisions between delimiters in owner and project', async () => {
    const idb = new FakeIndexedDB(); const store = createLocalProjectHandleStore(() => idb.factory)
    const first = handle('first'); const second = handle('second')
    await store.store('a:b', 'c', first); await store.store('a', 'b:c', second)
    expect((await store.load('a:b', 'c')).handle).toBe(first)
    expect((await store.load('a', 'b:c')).handle).toBe(second)
  })

  it('does not report persistence until the transaction completes', async () => {
    const idb = new FakeIndexedDB(); idb.holdNext = true
    const store = createLocalProjectHandleStore(() => idb.factory)
    const held = new Promise<void>(resolve => { idb.onHeld = resolve })
    let settled = false
    const saving = store.store('alice', 'p1', handle()).then(result => { settled = true; return result })
    await held; expect(settled).toBe(false); expect(idb.rows.size).toBe(0)
    idb.release!(); expect(await saving).toMatchObject({ status: 'ok', persistent: true })
    expect(idb.rows.size).toBe(1)
  })

  it('reports an abort after request success and keeps the current handle only in memory', async () => {
    const idb = new FakeIndexedDB(); idb.abortAfterSuccess = true
    const store = createLocalProjectHandleStore(() => idb.factory); const directory = handle()
    expect(await store.store('alice', 'p1', directory)).toMatchObject({ status: 'error', persistent: false, handle: directory })
    expect(idb.rows.size).toBe(0)
    const loaded = await store.load('alice', 'p1')
    expect(loaded.persistent).toBe(false); expect(loaded.handle).toBe(directory)
  })

  it.each(['absent', 'getter', 'open', 'blocked'] as const)('falls back to memory when IndexedDB is unavailable: %s', async mode => {
    const idb = new FakeIndexedDB(); idb.openThrow = mode === 'open'; idb.blocked = mode === 'blocked'
    const store = createLocalProjectHandleStore(() => {
      if (mode === 'getter') throw new DOMException('storage restricted', 'SecurityError')
      return mode === 'absent' ? undefined : idb.factory
    })
    const directory = handle()
    expect(await store.store('alice', 'p1', directory)).toMatchObject({ status: 'unavailable', persistent: false, handle: directory })
    expect(await store.load('alice', 'p1')).toMatchObject({ status: 'unavailable', persistent: false, handle: directory })
    expect((await store.load('bob', 'p1')).handle).toBeUndefined()
    store.clearMemory('alice')
    expect((await store.load('alice', 'p1')).handle).toBeUndefined()
  })

  it.each(['transaction', 'put', 'request'] as const)('returns errors for failed IDB work without rejecting: %s', async mode => {
    const idb = new FakeIndexedDB(); idb.transactionThrow = mode === 'transaction'; idb.putThrow = mode === 'put'; idb.failRequest = mode === 'request'
    const store = createLocalProjectHandleStore(() => idb.factory); const directory = handle()
    const result = await store.store('alice', 'p1', directory)
    expect(result).toMatchObject({ status: 'error', persistent: false, handle: directory })
    expect(result.error).not.toContain('uncloneable'); expect(result.error).not.toContain('not allowed')
    expect(idb.rows.size).toBe(0)
    idb.transactionThrow = false; idb.putThrow = false
    expect((await store.remove('alice', 'p1')).status).toBe('ok')
  })

  it('removes an older save even when its transaction is still committing', async () => {
    const idb = new FakeIndexedDB(); idb.holdNext = true
    const store = createLocalProjectHandleStore(() => idb.factory)
    const held = new Promise<void>(resolve => { idb.onHeld = resolve })
    const saving = store.store('alice', 'p1', handle()); await held
    const deleting = store.remove('alice', 'p1')
    idb.release!(); expect((await saving).handle).toBeUndefined()
    expect((await deleting).status).toBe('ok')
    expect((await createLocalProjectHandleStore(() => idb.factory).load('alice', 'p1')).status).toBe('missing')
  })

  it('supersedes queued saves and permits an explicit later reconnection', async () => {
    const idb = new FakeIndexedDB(); const store = createLocalProjectHandleStore(() => idb.factory)
    const saving = store.store('alice', 'p1', handle('old'))
    const deleting = store.remove('alice', 'p1')
    await Promise.all([saving, deleting]); expect(idb.rows.size).toBe(0)
    const next = handle('new'); await store.store('alice', 'p1', next)
    expect((await store.load('alice', 'p1')).handle).toBe(next)
  })

  it('prunes only the requested owner and preserves retained IDs and pending retained saves', async () => {
    const idb = new FakeIndexedDB(); const store = createLocalProjectHandleStore(() => idb.factory)
    await store.store('alice', 'remove', handle()); await store.store('bob', 'remove', handle('bob'))
    const keep = handle('keep'); const saving = store.store('alice', 'keep', keep)
    const pruning = store.pruneOwner('alice', ['keep'])
    await Promise.all([saving, pruning])
    const fresh = createLocalProjectHandleStore(() => idb.factory)
    expect((await fresh.load('alice', 'remove')).status).toBe('missing')
    expect((await fresh.load('alice', 'keep')).handle).toBe(keep)
    expect((await fresh.load('bob', 'remove')).handle?.name).toBe('bob')
  })

  it.each(['remove', 'prune', 'logout'] as const)('prevents late load hydration after %s', async operation => {
    const idb = new FakeIndexedDB(); const first = createLocalProjectHandleStore(() => idb.factory)
    await first.store('alice', 'p1', handle())
    const store = createLocalProjectHandleStore(() => idb.factory); idb.holdNext = true
    const held = new Promise<void>(resolve => { idb.onHeld = resolve })
    const loading = store.load('alice', 'p1'); await held
    const mutation = operation === 'remove' ? store.remove('alice', 'p1')
      : operation === 'prune' ? store.pruneOwner('alice', []) : (store.clearMemory('alice'), Promise.resolve())
    idb.release!(); expect((await loading).handle).toBeUndefined(); await mutation
    if (operation === 'logout') {
      // Logout removes runtime handles, retaining the saved connection for a later same-account session.
      expect((await store.load('alice', 'p1')).status).toBe('ok')
      store.clearMemory('alice'); idb.openThrow = true
      expect((await store.load('alice', 'p1')).handle).toBeUndefined()
    } else expect((await store.load('alice', 'p1')).status).toBe('missing')
  })

  it('keeps a failed deletion tombstoned in this runtime instead of reviving the persisted handle', async () => {
    const idb = new FakeIndexedDB(); const store = createLocalProjectHandleStore(() => idb.factory)
    await store.store('alice', 'p1', handle()); idb.transactionThrow = true
    expect((await store.remove('alice', 'p1')).status).toBe('error')
    idb.transactionThrow = false
    expect((await store.load('alice', 'p1')).status).toBe('missing')
  })

  it('reports malformed or mismatched stored records without accepting a foreign handle', async () => {
    const idb = new FakeIndexedDB(); const store = createLocalProjectHandleStore(() => idb.factory)
    idb.rows.set(key('alice', 'p1'), { owner: 'bob', projectId: 'p1', handle: handle() })
    expect(await store.load('alice', 'p1')).toMatchObject({ status: 'error', persistent: false })
    idb.rows.set(key('alice', 'p1'), { owner: 'alice', projectId: 'p1', handle: {} as LocalDirectoryHandle })
    expect((await store.load('alice', 'p1')).handle).toBeUndefined()
  })

  it('rejects invalid input as results before using IndexedDB', async () => {
    const idb = new FakeIndexedDB(); const store = createLocalProjectHandleStore(() => idb.factory)
    expect((await store.load('', 'p1')).status).toBe('error')
    expect((await store.load(Number.NaN, 'p1')).status).toBe('error')
    expect((await store.store('alice', '', handle())).status).toBe('error')
    expect((await store.store('alice', 'p1', {} as LocalDirectoryHandle)).status).toBe('error')
    expect((await store.pruneOwner('alice', [''])).status).toBe('error')
    expect(idb.factory.open).not.toHaveBeenCalled()
    expect(() => store.clearMemory('')).not.toThrow()
  })
})
