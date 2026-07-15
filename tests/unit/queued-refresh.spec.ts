import { describe, expect, it } from 'vitest'
import { createQueuedRefresh } from '@/composables/createQueuedRefresh'

describe('createQueuedRefresh', () => {
  it('queues one follow-up refresh when a forced request arrives during an active refresh', async () => {
    const releases: Array<() => void> = []
    let calls = 0
    const refresh = createQueuedRefresh(async () => {
      calls += 1
      await new Promise<void>((resolve) => releases.push(resolve))
    })

    const first = refresh.request()
    const forced = refresh.request(true)
    const coalesced = refresh.request(true)

    expect(calls).toBe(1)
    expect(refresh.isActive()).toBe(true)
    releases.shift()?.()
    await until(() => calls === 2)
    releases.shift()?.()
    await Promise.all([first, forced, coalesced])

    expect(calls).toBe(2)
    expect(refresh.isActive()).toBe(false)
  })

  it('shares an active refresh without scheduling another pass for a normal request', async () => {
    let release!: () => void
    let calls = 0
    const refresh = createQueuedRefresh(async () => {
      calls += 1
      await new Promise<void>((resolve) => { release = resolve })
    })

    const first = refresh.request()
    const shared = refresh.request()
    expect(calls).toBe(1)
    release()
    await Promise.all([first, shared])
    expect(calls).toBe(1)
  })
})

async function until(predicate: () => boolean) {
  for (let index = 0; index < 10 && !predicate(); index += 1) await Promise.resolve()
  expect(predicate()).toBe(true)
}
