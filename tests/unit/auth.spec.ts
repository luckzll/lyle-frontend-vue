import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAuth, hasAuth, isAuthTokenExpired, setAuth } from '@/auth'

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
    localStorage.clear()
  })

  it('keeps auth when token has not expired', () => {
    const token = jwtWithExp(Math.floor(Date.now() / 1000) + 60)

    setAuth({ id: 1, username: 'lyle', role: 'USER' }, token)

    expect(isAuthTokenExpired(token)).toBe(false)
    expect(hasAuth()).toBe(true)
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

  afterEach(() => {
    clearAuth()
    vi.unstubAllGlobals()
  })
})
