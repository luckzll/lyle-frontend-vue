import { describe, expect, it } from 'vitest'
import { useAsyncAction } from '@/composables/useAsyncAction'

describe('useAsyncAction', () => {
  it('prevents the same keyed action from being submitted twice', async () => {
    const { isPending, run } = useAsyncAction()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    let calls = 0

    const first = run('save-1', async () => {
      calls += 1
      await blocked
      return 'done'
    })

    expect(isPending('save-1')).toBe(true)
    await expect(run('save-1', async () => 'duplicate')).resolves.toBeUndefined()
    expect(calls).toBe(1)

    release()
    await expect(first).resolves.toBe('done')
    expect(isPending('save-1')).toBe(false)
  })

  it('always releases the key after an error', async () => {
    const { isPending, run } = useAsyncAction()
    await expect(run('retry', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(isPending('retry')).toBe(false)
  })
})
