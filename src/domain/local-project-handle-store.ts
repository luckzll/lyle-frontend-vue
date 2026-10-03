import type { LocalDirectoryHandle } from './local-workspace'

type Owner = string | number
export type LocalProjectHandleResult = {
  status: 'ok' | 'missing' | 'unavailable' | 'error'
  persistent: boolean
  handle?: LocalDirectoryHandle
  error: string | null
}
export interface LocalProjectHandleStore {
  store(owner: Owner, projectId: string, handle: LocalDirectoryHandle): Promise<LocalProjectHandleResult>
  load(owner: Owner, projectId: string): Promise<LocalProjectHandleResult>
  remove(owner: Owner, projectId: string): Promise<LocalProjectHandleResult>
  pruneOwner(owner: Owner, retainedProjectIds: Iterable<string>): Promise<LocalProjectHandleResult>
  clearMemory(owner: Owner): void
}

const DATABASE = 'lyle-local-project-handles-v1'
const STORE = 'project-handles'
const failure = (status: 'unavailable' | 'error', error: string): LocalProjectHandleResult => ({ status, persistent: false, error })
const missing = (): LocalProjectHandleResult => ({ status: 'missing', persistent: false, error: null })
function ownerId(owner: Owner) {
  if (typeof owner !== 'string' && (typeof owner !== 'number' || !Number.isSafeInteger(owner))) throw new Error('invalid owner')
  const id = String(owner).trim()
  if (!id || id.length > 128) throw new Error('invalid owner')
  return id
}
function projectId(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error('invalid project')
  return value
}
function directoryHandle(value: unknown): value is LocalDirectoryHandle {
  if (!value || typeof value !== 'object') return false
  const handle = value as LocalDirectoryHandle
  return handle.kind === 'directory' && typeof handle.name === 'string'
    && typeof handle.entries === 'function' && typeof handle.getDirectoryHandle === 'function'
    && typeof handle.getFileHandle === 'function' && typeof handle.queryPermission === 'function'
    && typeof handle.requestPermission === 'function'
}

type OpenResult = { database: IDBDatabase } | { result: LocalProjectHandleResult }
function openDatabase(getFactory: () => IDBFactory | undefined): Promise<OpenResult> {
  return new Promise(resolve => {
    let settled = false
    const finish = (result: OpenResult) => { if (!settled) { settled = true; resolve(result) } }
    try {
      const factory = getFactory()
      if (!factory) { finish({ result: failure('unavailable', '当前浏览器无法保存目录连接') }); return }
      const request = factory.open(DATABASE, 1)
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains(STORE)) {
            request.result.createObjectStore(STORE, { keyPath: ['owner', 'projectId'] })
          }
        } catch {
          try { request.transaction?.abort() } catch { /* An already finished upgrade needs no abort. */ }
          finish({ result: failure('error', '无法创建目录连接存储') })
        }
      }
      request.onsuccess = () => {
        if (settled) { request.result.close(); return }
        finish({ database: request.result })
      }
      request.onerror = () => finish({ result: failure('error', '无法打开目录连接存储') })
      request.onblocked = () => finish({ result: failure('unavailable', '目录连接存储暂时不可用') })
    } catch {
      finish({ result: failure('unavailable', '当前浏览器无法使用目录连接存储') })
    }
  })
}

type TransactionResult<T> = { status: 'ok'; value: T } | { status: 'error' }
// A successful request may still roll back. Only transaction completion confirms persistence.
function transact<T>(database: IDBDatabase, mode: IDBTransactionMode,
  work: (store: IDBObjectStore, setValue: (value: T) => void) => void): Promise<TransactionResult<T>> {
  return new Promise(resolve => {
    let transaction: IDBTransaction | undefined
    let value: T
    let settled = false
    const finish = (result: TransactionResult<T>) => {
      if (settled) return
      settled = true
      try { database.close() } catch { /* Closing cannot change a completed transaction. */ }
      resolve(result)
    }
    try {
      transaction = database.transaction(STORE, mode)
      transaction.oncomplete = () => finish({ status: 'ok', value })
      transaction.onabort = () => finish({ status: 'error' })
      transaction.onerror = () => finish({ status: 'error' })
      work(transaction.objectStore(STORE), result => { value = result })
    } catch {
      try { transaction?.abort() } catch { /* A synchronous failure can occur before transaction creation. */ }
      finish({ status: 'error' })
    }
  })
}

/** Stores native handles by structured clone; no paths, file contents or permission modes are saved. */
export function createLocalProjectHandleStore(
  getFactory: () => IDBFactory | undefined = () => globalThis.indexedDB,
): LocalProjectHandleStore {
  const memory = new Map<string, Map<string, LocalDirectoryHandle>>()
  const queues = new Map<string, Promise<void>>()
  const revisions = new Map<string, Map<string, number>>()
  const epochs = new Map<string, number>()
  const removed = new Map<string, Set<string>>()
  function revision(owner: string, id: string) {
    let projects = revisions.get(owner)
    if (!projects) { projects = new Map(); revisions.set(owner, projects) }
    if (!projects.has(id)) projects.set(id, 0)
    return projects.get(id)!
  }
  function invalidate(owner: string, id: string) {
    revisions.get(owner)!.set(id, revision(owner, id) + 1)
  }
  function cache(owner: string, id: string, handle: LocalDirectoryHandle) {
    let projects = memory.get(owner)
    if (!projects) { projects = new Map(); memory.set(owner, projects) }
    projects.set(id, handle)
  }
  function tombstone(owner: string, id: string) {
    let ids = removed.get(owner)
    if (!ids) { ids = new Set(); removed.set(owner, ids) }
    ids.add(id)
    memory.get(owner)?.delete(id)
    revision(owner, id); invalidate(owner, id)
  }
  function current(owner: string, id: string, rev: number, epoch: number) {
    return revision(owner, id) === rev && (epochs.get(owner) || 0) === epoch && !removed.get(owner)?.has(id)
  }
  function enqueue(owner: string, task: () => Promise<LocalProjectHandleResult>): Promise<LocalProjectHandleResult> {
    const pending = (queues.get(owner) || Promise.resolve()).then(task)
      .catch(() => failure('error', '目录连接存储操作失败'))
    const tail = pending.then(() => {})
    queues.set(owner, tail)
    void tail.then(() => { if (queues.get(owner) === tail) queues.delete(owner) })
    return pending
  }
  const invalid = () => Promise.resolve(failure('error', '账号、项目或目录连接无效'))
  return {
    store(owner, id, handle) {
      let key: string
      try { key = ownerId(owner); id = projectId(id); if (!directoryHandle(handle)) return invalid() } catch { return invalid() }
      revision(key, id); invalidate(key, id)
      const rev = revision(key, id); const epoch = epochs.get(key) || 0
      removed.get(key)?.delete(id)
      cache(key, id, handle)
      return enqueue(key, async () => {
        // A later delete/prune supersedes a save that has not started yet.
        if (revision(key, id) !== rev || removed.get(key)?.has(id)) return missing()
        const opened = await openDatabase(getFactory)
        if ('result' in opened) return { ...opened.result, ...(current(key, id, rev, epoch) ? { handle } : {}) }
        if (revision(key, id) !== rev || removed.get(key)?.has(id)) { opened.database.close(); return missing() }
        const result = await transact<void>(opened.database, 'readwrite', store => { store.put({ owner: key, projectId: id, handle }) })
        const response = result.status === 'ok'
          ? { status: 'ok' as const, persistent: true, error: null }
          : failure('error', '无法保存目录连接')
        return { ...response, ...(current(key, id, rev, epoch) ? { handle } : {}) }
      })
    },
    load(owner, id) {
      let key: string
      try { key = ownerId(owner); id = projectId(id) } catch { return invalid() }
      const rev = revision(key, id); const epoch = epochs.get(key) || 0
      const fallback = (result: LocalProjectHandleResult) => {
        const handle = current(key, id, rev, epoch) ? memory.get(key)?.get(id) : undefined
        return { ...result, ...(handle ? { handle } : {}) }
      }
      return enqueue(key, async () => {
        if (!current(key, id, rev, epoch)) return missing()
        const opened = await openDatabase(getFactory)
        if ('result' in opened) return fallback(opened.result)
        const result = await transact<unknown>(opened.database, 'readonly', (store, setValue) => {
          const request = store.get([key, id])
          request.onsuccess = () => setValue(request.result)
        })
        if (!current(key, id, rev, epoch)) return missing()
        if (result.status === 'error') return fallback(failure('error', '无法读取目录连接'))
        if (result.value === undefined) return fallback(missing())
        const record = result.value as { owner?: unknown; projectId?: unknown; handle?: unknown } | null
        if (!record || record.owner !== key || record.projectId !== id || !directoryHandle(record.handle)) {
          return fallback(failure('error', '保存的目录连接无法读取'))
        }
        cache(key, id, record.handle)
        return { status: 'ok', persistent: true, handle: record.handle, error: null }
      })
    },
    remove(owner, id) {
      let key: string
      try { key = ownerId(owner); id = projectId(id) } catch { return invalid() }
      tombstone(key, id)
      return enqueue(key, async () => {
        const opened = await openDatabase(getFactory)
        if ('result' in opened) return opened.result
        const result = await transact<void>(opened.database, 'readwrite', store => { store.delete([key, id]) })
        return result.status === 'ok' ? { status: 'ok', persistent: true, error: null } : failure('error', '无法移除目录连接')
      })
    },
    pruneOwner(owner, retainedProjectIds) {
      let key: string; let retained: Set<string>
      try { key = ownerId(owner); retained = new Set(Array.from(retainedProjectIds, projectId)) } catch { return invalid() }
      for (const id of revisions.get(key)?.keys() || []) if (!retained.has(id)) tombstone(key, id)
      return enqueue(key, async () => {
        const opened = await openDatabase(getFactory)
        if ('result' in opened) return opened.result
        const result = await transact<void>(opened.database, 'readwrite', store => {
          const request = store.openCursor()
          request.onsuccess = () => {
            try {
              const cursor = request.result
              if (!cursor) return
              const record = cursor.value as { owner?: unknown; projectId?: unknown }
              if (record?.owner === key && typeof record.projectId === 'string' && !retained.has(record.projectId)) cursor.delete()
              cursor.continue()
            } catch {
              try { request.transaction?.abort() } catch { /* The transaction may have already aborted. */ }
            }
          }
        })
        return result.status === 'ok' ? { status: 'ok', persistent: true, error: null } : failure('error', '无法清理目录连接')
      })
    },
    clearMemory(owner) {
      try {
        const key = ownerId(owner)
        memory.delete(key)
        epochs.set(key, (epochs.get(key) || 0) + 1)
      } catch { /* Invalid/logged-out owners have no cache to clear. */ }
    },
  }
}

export const localProjectHandleStore = createLocalProjectHandleStore()
