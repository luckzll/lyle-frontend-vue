import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { computed } from 'vue'
import { getSettingsReturnPath, installSettingsNavigation, isSettingsLocation } from '@/app/settings-navigation'

const auth = vi.hoisted(() => ({ user: { id: 1 } as { id: number } | null }))
vi.mock('@/auth', () => ({ getCurrentUser: () => auth.user }))

function makeRouter() {
  const component = { render: () => null }
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'chat', component },
      { path: '/dashboard', name: 'dashboard', component },
      { path: '/tasks', name: 'tasks', component },
      { path: '/projects/:projectId', name: 'project-detail', component },
      { path: '/advanced-settings', name: 'advanced-settings', component },
      { path: '/login', name: 'login', component },
      { path: '/settings', name: 'settings', component },
      { path: '/settings/usage', name: 'usage', component },
      { path: '/settings/billing', name: 'billing', component },
      { path: '/settings/billing/orders/:orderNo', name: 'billing-order', component },
      { path: '/:pathMatch(.*)*', name: 'not-found', component }
    ]
  })
}

describe('settings return navigation', () => {
  let router: ReturnType<typeof makeRouter>
  let dispose: () => void
  let storage: Map<string, string>

  beforeEach(() => {
    auth.user = { id: 1 }
    storage = new Map()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    })
    router = makeRouter()
    dispose = installSettingsNavigation(router)
  })

  afterEach(() => {
    dispose()
    vi.unstubAllGlobals()
  })

  it('matches settings names and exact path boundaries without absorbing advanced settings', () => {
    for (const name of ['settings', 'usage', 'billing', 'billing-order']) {
      expect(isSettingsLocation({ name })).toBe(true)
    }
    for (const path of ['/settings', '/settings/', '/settings/usage', '/settings?tab=account', '/settings/billing/orders/A#receipt']) {
      expect(isSettingsLocation({ path })).toBe(true)
    }
    for (const path of ['/settings-backup', '/advanced-settings', '/billing/result/A', '/checkout/A', '//settings']) {
      expect(isSettingsLocation({ path })).toBe(false)
    }
  })

  it('returns to the app detail with its query and hash after internal settings navigation', async () => {
    const source = '/projects/42?tab=goals&name=%E9%A1%B9%E7%9B%AE#milestone'
    await router.push(source)
    await router.push('/settings')
    await router.push('/settings/usage')
    await router.push('/settings/billing/orders/ORDER-1')

    expect(getSettingsReturnPath()).toBe(source)
  })

  it('updates the destination on the next entry from an application page', async () => {
    const destination = computed(() => getSettingsReturnPath())
    expect(destination.value).toBe('/dashboard')
    await router.push('/projects/42')
    await router.push('/settings')
    expect(destination.value).toBe('/projects/42')
    await router.push('/tasks?status=open#today')
    await router.push('/settings/billing')

    expect(getSettingsReturnPath()).toBe('/tasks?status=open#today')
    expect(destination.value).toBe('/tasks?status=open#today')
  })

  it('keeps advanced settings as a valid application origin', async () => {
    await router.push('/advanced-settings?tab=connectors')
    await router.push('/settings')

    expect(getSettingsReturnPath()).toBe('/advanced-settings?tab=connectors')
  })

  it('uses the dashboard for a first direct settings visit instead of the router start location', async () => {
    await router.push('/settings/usage')

    expect(getSettingsReturnPath()).toBe('/dashboard')
    expect(storage.size).toBe(0)
  })

  it('restores the same account destination after a refresh inside settings', async () => {
    await router.push('/tasks?status=done#recent')
    await router.push('/settings')
    dispose()
    router = makeRouter()
    dispose = installSettingsNavigation(router)
    await router.push('/settings/billing')

    expect(getSettingsReturnPath()).toBe('/tasks?status=done#recent')
  })

  it('does not save a navigation that was canceled', async () => {
    await router.push('/tasks')
    router.beforeEach((to) => to.name === 'settings' ? false : true)
    await router.push('/settings')

    expect(getSettingsReturnPath()).toBe('/dashboard')
    expect(storage.size).toBe(0)
  })

  it.each([
    'https://example.com/private', '//example.com/private', '/\\example.com',
    '/login?redirect=%2Ftasks', '/settings', '/settings/usage', '/settings/billing/orders/1',
    '/missing', '/settings-backup', ' /tasks', '/tasks\n', 'javascript:alert(1)'
  ])('rejects an unsafe or non-application stored destination: %s', async (path) => {
    storage.set('lyle:settings-return:1', path)
    await router.push('/settings')

    expect(getSettingsReturnPath()).toBe('/dashboard')
  })

  it('does not expose another account destination on logout or account switching', async () => {
    await router.push('/projects/42?private=1')
    await router.push('/settings')
    auth.user = null
    expect(getSettingsReturnPath()).toBe('/dashboard')
    auth.user = { id: 2 }
    expect(getSettingsReturnPath()).toBe('/dashboard')
    await router.push('/tasks?status=open')
    await router.push('/settings/usage')
    expect(getSettingsReturnPath()).toBe('/tasks?status=open')
    auth.user = { id: 1 }
    expect(getSettingsReturnPath()).toBe('/projects/42?private=1')
  })

  it('does not assign the previous account current page as the new account origin', async () => {
    await router.push('/projects/42?private=1')
    auth.user = { id: 2 }
    await router.push('/settings')

    expect(getSettingsReturnPath()).toBe('/dashboard')
    expect(storage.has('lyle:settings-return:2')).toBe(false)
  })

  it('keeps navigation working when session storage throws', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') }
    })
    expect(getSettingsReturnPath()).toBe('/dashboard')
    await router.push('/tasks?status=open#today')
    await router.push('/settings')

    expect(getSettingsReturnPath()).toBe('/tasks?status=open#today')
  })

  it('uses the latest origin if storage can be read but a later write fails', async () => {
    await router.push('/projects/42')
    await router.push('/settings')
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: () => { throw new Error('quota exceeded') }
    })
    await router.push('/tasks')
    await router.push('/settings')

    expect(getSettingsReturnPath()).toBe('/tasks')
  })
})
