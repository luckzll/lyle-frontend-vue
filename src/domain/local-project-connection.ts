import type { LocalDirectoryHandle } from './local-workspace'

export type LocalProjectConnectionCheck = { status: 'connected' | 'authorization' | 'missing' | 'unavailable' | 'stale'; error: string | null }
/** Restoration checks only existing read grants. Permission prompts belong to a direct user click. */
export async function checkLocalProjectConnection(handle: LocalDirectoryHandle, current: () => boolean = () => true): Promise<LocalProjectConnectionCheck> {
  try {
    const permission = await handle.queryPermission({ mode: 'read' })
    if (!current()) return { status: 'stale', error: null }
    if (permission !== 'granted') return { status: 'authorization', error: null }
    const entries = handle.entries()
    try { await entries.next() }
    finally { await entries.return?.().catch(() => undefined) }
    if (!current()) return { status: 'stale', error: null }
    return { status: 'connected', error: null }
  } catch (error) {
    if (!current()) return { status: 'stale', error: null }
    const missing = error && typeof error === 'object' && 'name' in error && error.name === 'NotFoundError'
    return { status: missing ? 'missing' : 'unavailable', error: missing ? '原项目目录已移动或删除，请重新选择目录' : '项目目录暂时无法读取，请检查浏览器权限或目录状态后重试' }
  }
}
