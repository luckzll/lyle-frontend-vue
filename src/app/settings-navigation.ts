import type { Router } from 'vue-router'
import { reactive } from 'vue'
import { getCurrentUser } from '@/auth'

type SettingsLocation = { name?: string | symbol | null; path?: string }
type SettingsRouter = Pick<Router, 'resolve' | 'afterEach'>

const fallbackPath = '/dashboard'
const settingsRouteNames = new Set(['settings', 'usage', 'billing', 'billing-order'])
const storagePrefix = 'lyle:settings-return:'
const memoryPaths = reactive(new Map<string, string>())
let installedRouter: SettingsRouter | null = null
let uninstall: (() => void) | null = null

export function isSettingsLocation(route: SettingsLocation): boolean {
  if (typeof route.name === 'string' && settingsRouteNames.has(route.name)) return true
  const path = route.path?.split(/[?#]/, 1)[0] ?? ''
  return path === '/settings' || path.startsWith('/settings/')
}

function currentUserId(): string | null {
  const id = getCurrentUser()?.id
  return id == null || String(id).trim() === '' ? null : String(id)
}

function storageKey(userId: string): string {
  return `${storagePrefix}${encodeURIComponent(userId)}`
}

function validReturnPath(value: string): boolean {
  if (!installedRouter || !value.startsWith('/') || value.startsWith('//')
      || value !== value.trim() || /[\\\u0000-\u001f\u007f]/.test(value)) return false
  try {
    const route = installedRouter.resolve(value)
    return route.matched.length > 0 && route.name !== 'not-found'
      && route.name !== 'login' && route.meta.layout !== 'auth'
      && !route.matched.some((record) => record.path.includes(':pathMatch'))
      && !isSettingsLocation(route)
  } catch {
    return false
  }
}

export function getSettingsReturnPath(): string {
  const userId = currentUserId()
  if (!userId) return fallbackPath
  let value = memoryPaths.get(userId)
  if (value == null) {
    try {
      value = globalThis.sessionStorage?.getItem(storageKey(userId)) ?? ''
    } catch {
      // In-memory navigation still works when browser storage is unavailable.
    }
  }
  return value && validReturnPath(value) ? value : fallbackPath
}

export function installSettingsNavigation(router: SettingsRouter): () => void {
  uninstall?.()
  installedRouter = router
  memoryPaths.clear()
  let previousUserId: string | null = null
  let previousFullPath: string | null = null
  const removeHook = router.afterEach((to, from, failure) => {
    if (failure) return
    const userId = currentUserId()
    if (userId && previousUserId === userId && previousFullPath === from.fullPath
        && isSettingsLocation(to) && !isSettingsLocation(from) && validReturnPath(from.fullPath)) {
      memoryPaths.set(userId, from.fullPath)
      try {
        globalThis.sessionStorage?.setItem(storageKey(userId), from.fullPath)
      } catch {
        // Keep the return destination for this page even without sessionStorage.
      }
    }
    previousUserId = userId
    previousFullPath = to.fullPath
  })
  const dispose = () => {
    removeHook()
    if (uninstall === dispose) {
      installedRouter = null
      memoryPaths.clear()
      uninstall = null
    }
  }
  uninstall = dispose
  return dispose
}
