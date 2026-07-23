import {
  onBeforeUnmount,
  onMounted,
  readonly,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue'
import { listConfirmations, listNeedsAttention } from '@/api/app'

const DEFAULT_POLL_INTERVAL = 60_000
export const EXECUTION_ATTENTION_CHANGED_EVENT = 'lyle:execution-attention-changed'

export function notifyExecutionAttentionChanged(delta?: number) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EXECUTION_ATTENTION_CHANGED_EVENT, { detail: { delta } }))
  }
}

export interface UseExecutionBadgePollingOptions {
  enabled?: MaybeRefOrGetter<boolean>
  pollInterval?: number
  loadCount?: () => Promise<number>
  autoStart?: boolean
}

async function loadExecutionAttentionCount() {
  const [confirmations, attention] = await Promise.all([
    listConfirmations(),
    listNeedsAttention()
  ])
  return confirmations.data.items.length + attention.data.items.length
}

export function useExecutionBadgePolling(options: UseExecutionBadgePollingOptions = {}) {
  const count = ref(0)
  const isRefreshing = ref(false)
  let timer: number | undefined
  let refreshPromise: Promise<void> | null = null

  const isEnabled = () => options.enabled === undefined || toValue(options.enabled)

  async function performRefresh() {
    if (!isEnabled()) {
      count.value = 0
      return
    }

    isRefreshing.value = true
    try {
      const nextCount = await (options.loadCount ?? loadExecutionAttentionCount)()
      if (isEnabled() && Number.isFinite(nextCount)) {
        count.value = Math.max(0, Math.trunc(nextCount))
      }
    } catch {
      // Navigation badges are ambient status. Keep the last successful value silently.
    } finally {
      isRefreshing.value = false
    }
  }

  async function refreshCount() {
    if (refreshPromise) return refreshPromise
    refreshPromise = performRefresh()
    try {
      await refreshPromise
    } finally {
      refreshPromise = null
    }
  }

  function clearCount() {
    count.value = 0
  }

  function startPolling() {
    if (timer || typeof window === 'undefined') return
    void refreshCount()
    timer = window.setInterval(
      () => void refreshCount(),
      options.pollInterval ?? DEFAULT_POLL_INTERVAL
    )
  }

  function stopPolling() {
    if (timer !== undefined) {
      window.clearInterval(timer)
      timer = undefined
    }
  }

  function handleAttentionChanged(event: Event) {
    const delta = Number((event as CustomEvent<{ delta?: number }>).detail?.delta)
    if (Number.isFinite(delta) && delta !== 0) count.value = Math.max(0, count.value + Math.trunc(delta))
    void refreshCount()
  }

  watch(isEnabled, (enabled) => {
    if (enabled) void refreshCount()
    else clearCount()
  })

  if (options.autoStart !== false) {
    onMounted(() => {
      startPolling()
      window.addEventListener(EXECUTION_ATTENTION_CHANGED_EVENT, handleAttentionChanged)
    })
    onBeforeUnmount(() => {
      stopPolling()
      window.removeEventListener(EXECUTION_ATTENTION_CHANGED_EVENT, handleAttentionChanged)
    })
  }

  return {
    count: readonly(count),
    isRefreshing: readonly(isRefreshing),
    refreshCount,
    clearCount,
    startPolling,
    stopPolling
  }
}
