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

export function hasAuth() {
  return Boolean(getCurrentUser() && getAuthToken())
}

export function setAuth(user: User, token: string) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAuth() {
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(TOKEN_KEY)
}
