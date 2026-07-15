export function createQueuedRefresh(refresh: () => Promise<void>) {
  let activePromise: Promise<void> | null = null
  let rerunRequested = false

  async function runCycle() {
    let lastError: unknown
    let failed = false

    do {
      rerunRequested = false
      try {
        await refresh()
        failed = false
        lastError = undefined
      } catch (error) {
        failed = true
        lastError = error
      }
    } while (rerunRequested)

    if (failed) throw lastError
  }

  function request(rerunIfActive = false): Promise<void> {
    if (activePromise) {
      if (rerunIfActive) rerunRequested = true
      return activePromise
    }

    const cycle = runCycle()
    activePromise = cycle.finally(() => {
      activePromise = null
    })
    return activePromise
  }

  return {
    request,
    isActive: () => activePromise !== null
  }
}
