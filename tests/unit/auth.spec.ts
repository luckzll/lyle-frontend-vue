import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authState, clearAuth, hasAuth, initializeAuth, isAuthTokenExpired, refreshAuth, setAuth } from '@/auth'

function jwtWithExp(exp: number) {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp })}.signature`
}

describe('auth token expiry', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear()
    })
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(`session:${key}`) ?? null,
      setItem: (key: string, value: string) => values.set(`session:${key}`, value),
      removeItem: (key: string) => values.delete(`session:${key}`),
      clear: () => values.clear()
    })
    localStorage.clear()
  })

  it('keeps auth when token has not expired', () => {
    const token = jwtWithExp(Math.floor(Date.now() / 1000) + 60)

    setAuth({ id: 1, username: 'lyle', role: 'USER' }, token)

    expect(isAuthTokenExpired(token)).toBe(false)
    expect(hasAuth()).toBe(true)
    expect(localStorage.getItem('lyle-token')).toBeNull()
    expect(localStorage.getItem('lyle-user')).toBeNull()
  })

  it('clears auth when token is expired', () => {
    const token = jwtWithExp(Math.floor(Date.now() / 1000) - 60)

    setAuth({ id: 1, username: 'lyle', role: 'USER' }, token)

    expect(isAuthTokenExpired(token)).toBe(true)
    expect(hasAuth()).toBe(false)
    expect(localStorage.getItem('lyle-user')).toBeNull()
    expect(localStorage.getItem('lyle-token')).toBeNull()
  })

  it('clears malformed tokens', () => {
    setAuth({ id: 1, username: 'lyle', role: 'USER' }, 'bad-token')

    expect(hasAuth()).toBe(false)
    expect(localStorage.getItem('lyle-token')).toBeNull()
  })

  it('purges legacy persisted credentials', () => {
    localStorage.setItem('lyle-token', 'legacy')
    localStorage.setItem('lyle-user', '{"id":1}')

    setAuth(
      { id: '1', username: 'lyle', role: 'USER' },
      jwtWithExp(Math.floor(Date.now() / 1000) + 60)
    )

    expect(localStorage.getItem('lyle-token')).toBeNull()
    expect(localStorage.getItem('lyle-user')).toBeNull()
  })

  it('renews an expired access token before protected navigation checks auth', async () => {
    vi.useFakeTimers()
    const user = { id: 1, username: 'lyle', role: 'USER' }
    setAuth(user, jwtWithExp(Math.floor(Date.now() / 1000) + 900))
    vi.advanceTimersByTime(901_000)
    expect(hasAuth()).toBe(false)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user, accessToken: jwtWithExp(Math.floor(Date.now() / 1000) + 900), expiresInSeconds: 900 })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await initializeAuth()).toBe(true)
    expect(hasAuth()).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', expect.objectContaining({
      method: 'POST', credentials: 'include'
    }))
  })

  it('shares renewal between navigation and concurrent API requests', async () => {
    const user = { id: 1, username: 'lyle', role: 'USER' }
    setAuth(user, jwtWithExp(Math.floor(Date.now() / 1000) - 1))
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user, accessToken: jwtWithExp(Math.floor(Date.now() / 1000) + 900) })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await Promise.all([refreshAuth(), initializeAuth(), initializeAuth()])).toEqual([true, true, true])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('requires login when the refresh session has expired or been revoked', async () => {
    setAuth({ id: 1, username: 'lyle', role: 'USER' }, jwtWithExp(Math.floor(Date.now() / 1000) - 1))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    expect(await initializeAuth()).toBe(false)
    expect(authState.status).toBe('anonymous')
    expect(authState.accessToken).toBe('')
  })

  it('does not refresh valid or explicitly cleared authentication', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    setAuth({ id: 1, username: 'lyle', role: 'USER' }, jwtWithExp(Math.floor(Date.now() / 1000) + 900))
    expect(await initializeAuth()).toBe(true)
    clearAuth()
    expect(await initializeAuth()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  afterEach(() => {
    clearAuth()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})
