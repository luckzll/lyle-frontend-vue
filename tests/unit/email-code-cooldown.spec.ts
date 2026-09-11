import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import type { EmailCodeCooldownScope } from '@/composables/useEmailCodeCooldown'

let cooldownModule: typeof import('@/composables/useEmailCodeCooldown')
let stored: Map<string, string>
let documentEvents: EventTarget
let windowEvents: EventTarget
let scopes: EffectScope[]
const initialTime = Date.parse('2030-01-01T00:00:00.000Z')

function mount(initial: EmailCodeCooldownScope | null = { purpose: 'login', email: 'member@example.com' }) {
  const value = ref<EmailCodeCooldownScope | null>(initial)
  const scope = effectScope()
  scopes.push(scope)
  const cooldown = scope.run(() => cooldownModule.useEmailCodeCooldown(() => value.value))!
  return { ...cooldown, value, stop: () => scope.stop() }
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(initialTime)
  stored = new Map()
  documentEvents = new EventTarget()
  windowEvents = new EventTarget()
  scopes = []
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key)
  })
  vi.stubGlobal('document', documentEvents)
  vi.stubGlobal('window', windowEvents)
  vi.resetModules()
  cooldownModule = await import('@/composables/useEmailCodeCooldown')
})

afterEach(() => {
  scopes.forEach(scope => scope.stop())
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('email code countdown', () => {
  it('starts at 60 by default, respects server seconds and does not shorten an existing deadline', () => {
    const cooldown = mount()
    cooldown.start()
    expect(cooldown.remainingSeconds.value).toBe(60)
    expect(cooldown.isCoolingDown.value).toBe(true)
    vi.advanceTimersByTime(10_000)
    expect(cooldown.remainingSeconds.value).toBe(50)
    cooldown.start(120)
    expect(cooldown.remainingSeconds.value).toBe(120)
    cooldown.start(30)
    expect(cooldown.remainingSeconds.value).toBe(120)
    vi.advanceTimersByTime(120_000)
    expect(cooldown.remainingSeconds.value).toBe(0)
    expect(cooldown.isCoolingDown.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recalculates elapsed time after browser suspension instead of counting missed interval ticks', () => {
    const cooldown = mount()
    cooldown.start(60)
    vi.setSystemTime(initialTime + 42_400)
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(cooldown.remainingSeconds.value).toBe(18)
    vi.setSystemTime(initialTime + 70_000)
    windowEvents.dispatchEvent(new Event('pageshow'))
    expect(cooldown.remainingSeconds.value).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restores the deadline from session storage after a fresh module and page load', async () => {
    const original = mount()
    original.start(60)
    original.stop()
    vi.setSystemTime(initialTime + 23_000)
    vi.resetModules()
    cooldownModule = await import('@/composables/useEmailCodeCooldown')
    const reloaded = mount()
    expect(reloaded.remainingSeconds.value).toBe(37)
    expect(stored.size).toBe(1)
    expect([...stored.keys()][0]).not.toContain('member')
    expect([...stored.keys()][0]).not.toContain('@')
    expect([...stored.values()]).toEqual([String(initialTime + 60_000)])
  })

  it('shares normalized-email limits across login, password reset and binding while isolating other emails', () => {
    const cooldown = mount({ purpose: 'login', email: ' Member@Example.COM ' })
    cooldown.start()
    cooldown.value.value = { purpose: 'password-reset', email: 'member@example.com' }
    expect(cooldown.remainingSeconds.value).toBe(60)
    cooldown.value.value = { purpose: 'bind:123', email: 'MEMBER@example.com' }
    expect(cooldown.remainingSeconds.value).toBe(60)
    cooldown.value.value = { purpose: 'login', email: 'another@example.com' }
    expect(cooldown.remainingSeconds.value).toBe(0)
    cooldown.value.value = { purpose: 'login', email: 'member@example.com' }
    expect(cooldown.remainingSeconds.value).toBe(60)
    expect(stored.size).toBe(1)
  })

  it('lets a password-only mode opt out without erasing its email code deadline', () => {
    const cooldown = mount()
    cooldown.start()
    cooldown.value.value = null
    expect(cooldown.remainingSeconds.value).toBe(0)
    expect(cooldown.isCoolingDown.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    vi.setSystemTime(initialTime + 15_000)
    cooldown.value.value = { purpose: 'login', email: 'member@example.com' }
    expect(cooldown.remainingSeconds.value).toBe(45)
  })

  it('uses the submitted scope snapshot when the form email changes before its request returns', () => {
    const cooldown = mount()
    const submitted = { ...cooldown.value.value! }
    cooldown.value.value = { purpose: 'login', email: 'second@example.com' }
    cooldown.start(60, submitted)
    expect(cooldown.remainingSeconds.value).toBe(0)
    cooldown.value.value = submitted
    expect(cooldown.remainingSeconds.value).toBe(60)
  })

  it('handles 429 seconds, case-insensitive headers and a default when Retry-After is absent', () => {
    const cooldown = mount()
    expect(cooldown.applyRateLimit({ response: { status: 429, headers: { 'Retry-After': '90' } } })).toBe(true)
    expect(cooldown.remainingSeconds.value).toBe(90)
    cooldown.value.value = { purpose: 'login', email: 'second@example.com' }
    expect(cooldown.applyRateLimit({ response: { status: 429 } })).toBe(true)
    expect(cooldown.remainingSeconds.value).toBe(60)
  })

  it('handles an SMTP 503 with an HTTP-date Retry-After but ignores 503 without a usable header', () => {
    const cooldown = mount()
    const headers = new Headers({ 'Retry-After': new Date(initialTime + 75_000).toUTCString() })
    expect(cooldown.applyRateLimit({ response: { status: 503, headers } })).toBe(true)
    expect(cooldown.remainingSeconds.value).toBe(75)
    cooldown.value.value = { purpose: 'login', email: 'second@example.com' }
    expect(cooldown.applyRateLimit({ response: { status: 503 } })).toBe(false)
    expect(cooldown.applyRateLimit({ response: { status: 503, headers: { 'retry-after': 'invalid' } } })).toBe(false)
    expect(cooldown.applyRateLimit({ response: { status: 400, headers: { 'retry-after': '90' } } })).toBe(false)
    expect(cooldown.remainingSeconds.value).toBe(0)
  })

  it('honors a valid zero or expired Retry-After without creating a new delay', () => {
    const cooldown = mount()
    expect(cooldown.applyRateLimit({ response: { status: 429, headers: { 'retry-after': '0' } } })).toBe(true)
    expect(cooldown.remainingSeconds.value).toBe(0)
    expect(cooldown.applyRateLimit({ response: { status: 503, headers: { 'retry-after': new Date(initialTime - 5000).toUTCString() } } })).toBe(true)
    expect(cooldown.remainingSeconds.value).toBe(0)
  })

  it('continues in memory when sessionStorage throws, and syncs another mounted form', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') }
    })
    const first = mount()
    const second = mount({ purpose: 'password-reset', email: 'member@example.com' })
    first.start()
    expect(second.remainingSeconds.value).toBe(60)
    vi.advanceTimersByTime(5000)
    expect(first.remainingSeconds.value).toBe(55)
    expect(second.remainingSeconds.value).toBe(55)
  })

  it('cleans up timers and listeners when disposed, including a late request result', () => {
    const cooldown = mount()
    cooldown.start()
    expect(vi.getTimerCount()).toBe(1)
    cooldown.stop()
    expect(vi.getTimerCount()).toBe(0)
    cooldown.start(90, { purpose: 'login', email: 'member@example.com' })
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    windowEvents.dispatchEvent(new Event('focus'))
    expect(vi.getTimerCount()).toBe(0)
    const nextPage = mount()
    expect(nextPage.remainingSeconds.value).toBe(90)
  })

  it('does not resurrect an expired persisted deadline after refresh', async () => {
    const cooldown = mount()
    cooldown.start()
    cooldown.stop()
    vi.setSystemTime(initialTime + 70_000)
    vi.resetModules()
    cooldownModule = await import('@/composables/useEmailCodeCooldown')
    expect(mount().remainingSeconds.value).toBe(0)
    expect(stored.size).toBe(0)
  })
})
