import { computed, onScopeDispose, reactive, readonly, ref, watch } from 'vue'
import { normalizeEmail } from '@/domain/email'

export interface EmailCodeCooldownScope {
  purpose: string
  email: string
}

const defaultSeconds = 60
const storagePrefix = 'lyle:email-code-cooldown:v1:'
const memoryDeadlines = reactive(new Map<string, number>())

// A stable non-cryptographic fingerprint keeps plain email addresses out of
// storage. This countdown is presentation only; the server enforces limits.
function fingerprint(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index++) {
    first = Math.imul(first ^ value.charCodeAt(index), 0x01000193)
    second = Math.imul(second ^ value.charCodeAt(index), 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function scopeKey(scope: EmailCodeCooldownScope | null | undefined): string | null {
  const email = scope ? normalizeEmail(scope.email) : ''
  // EmailCodeService shares cooldowns across login, password reset and binding.
  return email ? `${storagePrefix}${fingerprint(email)}` : null
}

function readDeadline(key: string): number {
  let stored = 0
  try {
    const raw = globalThis.sessionStorage?.getItem(key)
    stored = raw == null ? 0 : Number(raw)
    if (!Number.isSafeInteger(stored) || stored <= Date.now()) {
      if (raw != null) globalThis.sessionStorage?.removeItem(key)
      stored = 0
    }
  } catch {
    stored = 0
    // The current page still counts down when storage is blocked or full.
  }
  const remembered = memoryDeadlines.get(key) ?? 0
  const deadline = Math.max(stored, remembered)
  return deadline > Date.now() ? deadline : 0
}

/** Returns whole seconds, including zero for a valid already-expired header. */
export function parseEmailCodeRetryAfter(value: unknown, now = Date.now()): number | null {
  if (Array.isArray(value)) value = value[0]
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const seconds = Number(raw)
    return Number.isFinite(seconds) ? Math.ceil(seconds) : null
  }
  if (!/[a-z]{3}/i.test(raw)) return null
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : null
}

function retryAfterHeader(headers: unknown): unknown {
  if (!headers || typeof headers !== 'object') return undefined
  const values = headers as Record<string, unknown> & { get?: (name: string) => unknown }
  try {
    if (typeof values.get === 'function') return values.get('retry-after')
    const key = Object.keys(values).find((name) => name.toLowerCase() === 'retry-after')
    return key ? values[key] : undefined
  } catch {
    return undefined
  }
}

export function useEmailCodeCooldown(getScope: () => EmailCodeCooldownScope | null | undefined) {
  const remainingSeconds = ref(0)
  const currentKey = computed(() => scopeKey(getScope()))
  let deadline = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false

  function stopTimer() {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  function tick() {
    remainingSeconds.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    if (!remainingSeconds.value) stopTimer()
  }

  function refresh() {
    if (disposed) return
    stopTimer()
    deadline = currentKey.value ? readDeadline(currentKey.value) : 0
    tick()
    if (remainingSeconds.value) timer = setInterval(tick, 1000)
  }

  function start(retryAfterSeconds?: number | null, scope = getScope()) {
    const key = scopeKey(scope)
    if (!key) return
    const seconds = typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.ceil(retryAfterSeconds) : defaultSeconds
    const proposedDeadline = Date.now() + seconds * 1000
    const nextDeadline = Math.max(readDeadline(key), Number.isSafeInteger(proposedDeadline) ? proposedDeadline : Date.now() + defaultSeconds * 1000)
    try {
      globalThis.sessionStorage?.setItem(key, String(nextDeadline))
    } catch {
      // Preserve the newer deadline in memory if writing sessionStorage fails.
    }
    memoryDeadlines.set(key, nextDeadline)
    refresh()
  }

  function applyRateLimit(error: unknown, scope = getScope()): boolean {
    const response = (error as { response?: { status?: number; headers?: unknown } } | null)?.response
    if (response?.status !== 429 && response?.status !== 503) return false
    const seconds = parseEmailCodeRetryAfter(retryAfterHeader(response.headers))
    if (seconds == null && response.status !== 429) return false
    if (seconds !== 0) start(seconds ?? defaultSeconds, scope)
    else refresh()
    return true
  }

  const stopWatching = watch(() => [currentKey.value, currentKey.value ? memoryDeadlines.get(currentKey.value) : 0], refresh, { immediate: true, flush: 'sync' })
  const onStorage = (event: StorageEvent) => {
    if (event.key == null || event.key === currentKey.value) refresh()
  }
  globalThis.document?.addEventListener('visibilitychange', refresh)
  globalThis.window?.addEventListener('focus', refresh)
  globalThis.window?.addEventListener('pageshow', refresh)
  globalThis.window?.addEventListener('storage', onStorage)
  onScopeDispose(() => {
    disposed = true
    stopTimer()
    stopWatching()
    globalThis.document?.removeEventListener('visibilitychange', refresh)
    globalThis.window?.removeEventListener('focus', refresh)
    globalThis.window?.removeEventListener('pageshow', refresh)
    globalThis.window?.removeEventListener('storage', onStorage)
  })

  return { remainingSeconds: readonly(remainingSeconds), isCoolingDown: computed(() => remainingSeconds.value > 0), start, applyRateLimit, refresh }
}
