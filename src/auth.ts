import type { User } from '@/api/types'

const USER_KEY = 'lyle-user'
const TOKEN_KEY = 'lyle-token'

export function getCurrentUser(): User | null {
  const raw = localStorage.getItem(USER_KEY)
  return raw ? JSON.parse(raw) as User : null
}

export function getAuthToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return atob(padded)
}

export function isAuthTokenExpired(token = getAuthToken()): boolean {
  if (!token) return true

  try {
    const payload = JSON.parse(decodeBase64Url(token.split('.')[1] || '')) as { exp?: number }
    if (!payload.exp) return true
    return payload.exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

export function hasAuth() {
  const token = getAuthToken()
  if (!getCurrentUser() || !token) return false
  if (isAuthTokenExpired(token)) {
    clearAuth()
    return false
  }
  return true
}

export function setAuth(user: User, token: string) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAuth() {
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(TOKEN_KEY)
}
