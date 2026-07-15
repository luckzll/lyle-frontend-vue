import { effectScope } from 'vue'
import { describe, expect, it } from 'vitest'
import { useExecutionBadgePolling } from '@/composables/useExecutionBadgePolling'

describe('useExecutionBadgePolling', () => {
  it('keeps the last successful count when a refresh fails', async () => {
    const scope = effectScope()
    const responses = [3, new Error('temporarily unavailable'), 5]
    const polling = scope.run(() => useExecutionBadgePolling({
      autoStart: false,
      loadCount: async () => {
        const next = responses.shift()
        if (next instanceof Error) throw next
        return next ?? 0
      }
    }))!

    await polling.refreshCount()
    expect(polling.count.value).toBe(3)

    await polling.refreshCount()
    expect(polling.count.value).toBe(3)

    await polling.refreshCount()
    expect(polling.count.value).toBe(5)
    scope.stop()
  })

  it('coalesces concurrent refresh requests', async () => {
    const scope = effectScope()
    let calls = 0
    let release!: () => void
    const polling = scope.run(() => useExecutionBadgePolling({
      autoStart: false,
      loadCount: async () => {
        calls += 1
        await new Promise<void>((resolve) => { release = resolve })
        return 4
      }
    }))!

    const first = polling.refreshCount()
    const second = polling.refreshCount()
    expect(calls).toBe(1)
    release()
    await Promise.all([first, second])
    expect(polling.count.value).toBe(4)
    scope.stop()
  })
})
