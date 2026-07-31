import { reactive } from 'vue'
import type { AuthResponse, User } from '@/api/types'

const LEGACY_USER_KEY = 'lyle-user'
const LEGACY_TOKEN_KEY = 'lyle-token'
const E2E_LEGACY_AUTH_ENABLED = import.meta.env.VITE_E2E_LEGACY_AUTH === 'true'

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous'

export const authState = reactive<{
  status: AuthStatus
  user: User | null
  accessToken: string
  expiresAt: number
}>({
  status: 'unknown',
  user: null,
  accessToken: '',
  expiresAt: 0
})

let refreshPromise: Promise<boolean> | null = null

if (!E2E_LEGACY_AUTH_ENABLED) purgeLegacyAuth()

export function getCurrentUser(): User | null {
  return authState.user
}

export function getAuthToken(): string {
  return authState.accessToken
}

export function isAuthTokenExpired(token = getAuthToken()): boolean {
  if (!token) return true
  if (token === authState.accessToken && authState.expiresAt > 0) {
    return authState.expiresAt <= Date.now()
  }
  try {
    const payload = JSON.parse(decodeBase64Url(token.split('.')[1] || '')) as { exp?: number }
    return !payload.exp || payload.exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

export function hasAuth(): boolean {
  return authState.status === 'authenticated'
    && Boolean(authState.user)
    && Boolean(authState.accessToken)
    && !isAuthTokenExpired()
}

export function setAuth(user: User, accessToken: string, expiresInSeconds = 900) {
  const tokenExpiresAt = readTokenExpiresAt(accessToken)
  if (!tokenExpiresAt) {
    clearAuth()
    return
  }
  authState.user = user
  authState.accessToken = accessToken
  authState.expiresAt = Math.min(
    tokenExpiresAt,
    Date.now() + Math.max(1, expiresInSeconds || 900) * 1000
  )
  authState.status = 'authenticated'
  purgeLegacyAuth()
}

export function clearAuth() {
  authState.user = null
  authState.accessToken = ''
  authState.expiresAt = 0
  authState.status = 'anonymous'
  purgeLegacyAuth()
}

export async function initializeAuth(): Promise<boolean> {
  if (authState.status !== 'unknown') return hasAuth()
  if (restoreE2ELegacyAuth()) return true
  return refreshAuth()
}

export async function refreshAuth(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = performRefresh()
  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

export async function logoutCurrentDevice(): Promise<void> {
  await authenticatedAuthRequest('/api/auth/logout').catch(() => undefined)
  clearAuth()
}

export async function logoutAllDevices(): Promise<void> {
  await authenticatedAuthRequest('/api/auth/logout-all')
  clearAuth()
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return atob(padded)
}

function readTokenExpiresAt(token: string): number {
  try {
    const payload = JSON.parse(decodeBase64Url(token.split('.')[1] || '')) as { exp?: number }
    return payload.exp ? payload.exp * 1000 : 0
  } catch {
    return 0
  }
}

async function performRefresh(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) {
      clearAuth()
      return false
    }
    const payload = await response.json() as AuthResponse
    setAuth(payload.user, payload.accessToken || payload.token || '', payload.expiresInSeconds)
    return hasAuth()
  } catch {
    clearAuth()
    return false
  }
}

async function authenticatedAuthRequest(path: string): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(authState.accessToken ? { Authorization: `Bearer ${authState.accessToken}` } : {})
    }
  })
  if (!response.ok && response.status !== 204) {
    throw new Error(`账号操作失败（${response.status}）`)
  }
}

function purgeLegacyAuth() {
  try {
    globalThis.localStorage?.removeItem(LEGACY_USER_KEY)
    globalThis.localStorage?.removeItem(LEGACY_TOKEN_KEY)
    globalThis.sessionStorage?.removeItem(LEGACY_USER_KEY)
    globalThis.sessionStorage?.removeItem(LEGACY_TOKEN_KEY)
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

function restoreE2ELegacyAuth(): boolean {
  if (!E2E_LEGACY_AUTH_ENABLED) return false
  try {
    const accessToken = globalThis.localStorage?.getItem(LEGACY_TOKEN_KEY) || ''
    const rawUser = globalThis.localStorage?.getItem(LEGACY_USER_KEY) || ''
    if (!accessToken || !rawUser) return false
    const user = JSON.parse(rawUser) as User
    setAuth(user, accessToken, 3600)
    return hasAuth()
  } catch {
    purgeLegacyAuth()
    return false
  }
}
