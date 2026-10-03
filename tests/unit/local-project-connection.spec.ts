import { describe, expect, it, vi } from 'vitest'
import { checkLocalProjectConnection } from '@/domain/local-project-connection'
import { LocalWorkspace, type LocalDirectoryHandle } from '@/domain/local-workspace'

function handle(permission: PermissionState = 'granted', probe?: () => Promise<IteratorResult<[string, LocalDirectoryHandle]>>) {
  const requestPermission = vi.fn(async () => 'granted' as PermissionState)
  const queryPermission = vi.fn(async () => permission)
  const next = vi.fn(probe || (async () => ({ done: true as const, value: undefined })))
  const close = vi.fn(async () => ({ done: true as const, value: undefined }))
  const root = { kind: 'directory', name: 'project', queryPermission, requestPermission,
    entries: () => ({ next, return: close, [Symbol.asyncIterator]() { return this } }),
  } as unknown as LocalDirectoryHandle
  return { root, requestPermission, queryPermission, next, close }
}

describe('automatic local project connection checks', () => {
  it('accepts an empty directory with an existing read grant without requesting any permission', async () => {
    const sample = handle()
    expect(await checkLocalProjectConnection(sample.root)).toEqual({ status: 'connected', error: null })
    expect(sample.queryPermission).toHaveBeenCalledWith({ mode: 'read' })
    expect(sample.next).toHaveBeenCalledOnce()
    expect(sample.close).toHaveBeenCalledOnce()
    expect(sample.requestPermission).not.toHaveBeenCalled()
    expect(new LocalWorkspace(sample.root).permissions.mode).toBe('confirm')
  })
  it.each(['prompt', 'denied'] as const)('retains a %s binding for a later user authorization click', async permission => {
    const sample = handle(permission)
    expect(await checkLocalProjectConnection(sample.root)).toEqual({ status: 'authorization', error: null })
    expect(sample.next).not.toHaveBeenCalled()
    expect(sample.requestPermission).not.toHaveBeenCalled()
  })
  it('distinguishes a deleted directory from a temporary IO error', async () => {
    const missing = handle('granted', async () => { throw new DOMException('gone', 'NotFoundError') })
    expect(await checkLocalProjectConnection(missing.root)).toMatchObject({ status: 'missing', error: expect.stringContaining('移动或删除') })
    expect(missing.close).toHaveBeenCalledOnce()
    const unavailable = handle('granted', async () => { throw new DOMException('temporarily blocked', 'NotReadableError') })
    expect(await checkLocalProjectConnection(unavailable.root)).toMatchObject({ status: 'unavailable', error: expect.stringContaining('暂时无法读取') })
    expect(unavailable.requestPermission).not.toHaveBeenCalled()
  })
  it('does not probe or restore a handle after the owner/project/session changes during a permission query', async () => {
    let resolve!: (value: PermissionState) => void
    const sample = handle()
    sample.queryPermission.mockImplementation(() => new Promise(done => { resolve = done }))
    let active = true
    const checking = checkLocalProjectConnection(sample.root, () => active)
    active = false; resolve('granted')
    expect(await checking).toEqual({ status: 'stale', error: null })
    expect(sample.next).not.toHaveBeenCalled()
  })
  it('does not restore a handle if the scope changes while directory existence is checked', async () => {
    let resolve!: (value: IteratorResult<[string, LocalDirectoryHandle]>) => void
    const sample = handle('granted', () => new Promise(done => { resolve = done }))
    let active = true
    const checking = checkLocalProjectConnection(sample.root, () => active)
    await Promise.resolve()
    active = false; resolve({ done: true, value: undefined })
    expect(await checking).toEqual({ status: 'stale', error: null })
    expect(sample.close).toHaveBeenCalledOnce()
  })
  it('treats permission API failures as unavailable and never requests readwrite permission', async () => {
    const sample = handle()
    sample.queryPermission.mockRejectedValue(new DOMException('restricted browser', 'SecurityError'))
    expect(await checkLocalProjectConnection(sample.root)).toMatchObject({ status: 'unavailable' })
    expect(sample.next).not.toHaveBeenCalled()
    expect(sample.requestPermission).not.toHaveBeenCalled()
  })
})
