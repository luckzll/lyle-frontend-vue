import type { Router } from 'vue-router'
import { reactive } from 'vue'
import { getCurrentUser } from '@/auth'

type SettingsLocation = { name?: string | symbol | null; path?: string }
type SettingsRouter = Pick<Router, 'resolve' | 'afterEach'>

const fallbackPath = '/dashboard'
const settingsRouteNames = new Set(['settings', 'usage', 'billing', 'billing-order', 'pricing'])
const storagePrefix = 'lyle:settings-return:'
const pricingStoragePrefix = 'lyle:pricing-return:'
const memoryPaths = reactive(new Map<string, string>())
const pricingMemoryPaths = reactive(new Map<string, string>())
let installedRouter: SettingsRouter | null = null
let uninstall: (() => void) | null = null

export function isSettingsLocation(route: SettingsLocation): boolean {
  if (typeof route.name === 'string' && settingsRouteNames.has(route.name)) return true
  const path = route.path?.split(/[?#]/, 1)[0] ?? ''
  return path === '/settings' || path.startsWith('/settings/') || path === '/pricing' || path === '/pricing/'
}

function isPricingLocation(route: SettingsLocation): boolean {
  return route.name === 'pricing' || /^\/pricing\/?(?:[?#]|$)/.test(route.path ?? '')
}

function currentUserId(): string | null {
  const id = getCurrentUser()?.id
  return id == null || String(id).trim() === '' ? null : String(id)
}

function storageKey(userId: string, prefix = storagePrefix): string {
  return `${prefix}${encodeURIComponent(userId)}`
}

function validReturnPath(value: string, allowSettings = false): boolean {
  if (!installedRouter || !value.startsWith('/') || value.startsWith('//')
      || value !== value.trim() || /[\\\u0000-\u001f\u007f]/.test(value)) return false
  try {
    const route = installedRouter.resolve(value)
    return route.matched.length > 0 && route.name !== 'not-found'
      && route.name !== 'login' && route.meta.layout !== 'auth'
      && !route.matched.some((record) => record.path.includes(':pathMatch'))
      && !isPricingLocation(route)
      && route.name !== 'checkout' && route.name !== 'billing-result'
      && !/^\/(?:checkout(?:\/|$)|billing\/result(?:\/|$))/.test(route.path)
      && (allowSettings || !isSettingsLocation(route))
  } catch {
    return false
  }
}

export function getSettingsReturnPath(): string {
  return getSavedReturnPath(memoryPaths, storagePrefix, fallbackPath)
}

function getSavedReturnPath(paths: Map<string, string>, prefix: string, fallback: string, allowSettings = false): string {
  const userId = currentUserId()
  if (!userId) return fallback
  let value = paths.get(userId)
  if (value == null) {
    try {
      value = globalThis.sessionStorage?.getItem(storageKey(userId, prefix)) ?? ''
    } catch {
      // In-memory navigation still works when browser storage is unavailable.
    }
  }
  return value && validReturnPath(value, allowSettings) ? value : fallback
}

export function getPricingReturnPath(value?: unknown): string {
  if (typeof value === 'string' && validReturnPath(value, true)) return value
  return getSavedReturnPath(pricingMemoryPaths, pricingStoragePrefix, '/settings/billing', true)
}

function rememberPath(paths: Map<string, string>, prefix: string, userId: string, path: string): void {
  paths.set(userId, path)
  try {
    globalThis.sessionStorage?.setItem(storageKey(userId, prefix), path)
  } catch {
    // Keep the return destination for this page even without sessionStorage.
  }
}

export function installSettingsNavigation(router: SettingsRouter): () => void {
  uninstall?.()
  installedRouter = router
  memoryPaths.clear()
  pricingMemoryPaths.clear()
  let previousUserId: string | null = null
  let previousFullPath: string | null = null
  const removeHook = router.afterEach((to, from, failure) => {
    if (failure) return
    const userId = currentUserId()
    if (userId && previousUserId === userId && previousFullPath === from.fullPath) {
      if (isSettingsLocation(to) && !isSettingsLocation(from) && validReturnPath(from.fullPath)) {
        rememberPath(memoryPaths, storagePrefix, userId, from.fullPath)
      }
      if (isPricingLocation(to) && !isPricingLocation(from) && validReturnPath(from.fullPath, true)) {
        rememberPath(pricingMemoryPaths, pricingStoragePrefix, userId, from.fullPath)
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
      pricingMemoryPaths.clear()
      uninstall = null
    }
  }
  uninstall = dispose
  return dispose
}
