import { describe, expect, it, vi } from 'vitest'
import type { LocalDirectoryHandle } from '@/domain/local-workspace'
import { LocalWorkspacePermissions } from '@/domain/local-workspace-permissions'

function permissions(requestPermission = vi.fn(async () => 'granted' as PermissionState)) {
  const root = { requestPermission } as unknown as LocalDirectoryHandle
  return { policy: new LocalWorkspacePermissions(root), requestPermission }
}

describe('local workspace permission selection', () => {
  it('requests auto write permission synchronously within the click call and scopes it to one instance', async () => {
    const { policy, requestPermission } = permissions()
    expect(policy.mode).toBe('confirm')
    const selection = policy.select('auto')
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(policy.mode).toBe('confirm')
    await selection
    expect(policy.mode).toBe('auto')
    expect(permissions().policy.mode).toBe('confirm')
  })

  it('keeps the previous policy if browser authorization is denied', async () => {
    const { policy } = permissions(vi.fn(async () => 'denied' as PermissionState))
    await policy.select('read-only')
    await expect(policy.select('auto')).rejects.toThrow('已保留原权限设置')
    expect(policy.mode).toBe('read-only')
  })

  it('does not let an earlier authorization dialog override a newer read-only selection', async () => {
    let resolve!: (permission: PermissionState) => void
    const { policy } = permissions(vi.fn(() => new Promise<PermissionState>(done => { resolve = done })))
    const selection = policy.select('auto')
    await policy.select('read-only')
    resolve('granted')
    await expect(selection).resolves.toBe('read-only')
    expect(() => policy.assertCanWrite(true)).toThrow('只读')
  })

  it('requests permission from the apply click and rechecks revocation before approving', async () => {
    let resolve!: (permission: PermissionState) => void
    const { policy, requestPermission } = permissions(vi.fn(() => new Promise<PermissionState>(done => { resolve = done })))
    const approval = policy.authorizeConfirmedWrite()
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    await policy.select('read-only')
    resolve('granted')
    await expect(approval).rejects.toThrow('只读')
  })
})
