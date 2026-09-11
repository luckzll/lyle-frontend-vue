import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { computed } from 'vue'
import { getPricingReturnPath, getSettingsReturnPath, installSettingsNavigation, isSettingsLocation } from '@/app/settings-navigation'

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
      { path: '/pricing', name: 'pricing', component },
      { path: '/checkout/:orderNo', name: 'checkout', component },
      { path: '/billing/result/:orderNo', name: 'billing-result', component },
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
    for (const name of ['settings', 'usage', 'billing', 'billing-order', 'pricing']) {
      expect(isSettingsLocation({ name })).toBe(true)
    }
    for (const path of ['/settings', '/settings/', '/settings/usage', '/settings?tab=account', '/settings/billing/orders/A#receipt', '/pricing', '/pricing/', '/pricing?returnTo=%2Ftasks']) {
      expect(isSettingsLocation({ path })).toBe(true)
    }
    for (const path of ['/settings-backup', '/advanced-settings', '/billing/result/A', '/checkout/A', '//settings', '/pricing-old', '/pricing/catalog']) {
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
    '/login?redirect=%2Ftasks', '/settings', '/settings/usage', '/settings/billing/orders/1', '/pricing', '/checkout/A', '/billing/result/A',
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

  it('keeps the billing entry and the application entry separate through pricing and settings tabs', async () => {
    const appSource = '/projects/42?tab=goals#milestone'
    const pricingSource = '/settings/billing?filter=purchases#orders'
    await router.push(appSource)
    await router.push(pricingSource)
    await router.push('/pricing')

    expect(getPricingReturnPath()).toBe(pricingSource)
    expect(getSettingsReturnPath()).toBe(appSource)
    await router.push('/settings/usage')
    await router.push('/settings')
    expect(getSettingsReturnPath()).toBe(appSource)
  })

  it('returns directly to the task context when pricing was opened from tasks', async () => {
    const destination = computed(() => getPricingReturnPath())
    expect(destination.value).toBe('/settings/billing')
    const source = '/tasks?status=open&name=%E4%BB%BB%E5%8A%A1#today'
    await router.push(source)
    await router.push('/pricing')

    expect(destination.value).toBe(source)
    expect(getSettingsReturnPath()).toBe(source)
  })

  it('honors an explicit valid local destination without replacing the recorded origin', async () => {
    await router.push('/settings/billing#orders')
    await router.push('/pricing')

    expect(getPricingReturnPath('/tasks?status=open#budget')).toBe('/tasks?status=open#budget')
    expect(getPricingReturnPath('/settings/usage?period=month#details')).toBe('/settings/usage?period=month#details')
    expect(getPricingReturnPath()).toBe('/settings/billing#orders')
  })

  it('uses billing for a direct first pricing visit without recording the router start location', async () => {
    await router.push('/pricing')

    expect(getPricingReturnPath()).toBe('/settings/billing')
    expect(getSettingsReturnPath()).toBe('/dashboard')
    expect(storage.size).toBe(0)
  })

  it('restores both return destinations after refreshing pricing', async () => {
    await router.push('/projects/42?tab=tasks#active')
    await router.push('/settings/billing?filter=all#orders')
    await router.push('/pricing')
    dispose()
    router = makeRouter()
    dispose = installSettingsNavigation(router)
    await router.push('/pricing')

    expect(getPricingReturnPath()).toBe('/settings/billing?filter=all#orders')
    expect(getSettingsReturnPath()).toBe('/projects/42?tab=tasks#active')
  })

  it('preserves both origins through checkout, payment results and pricing query changes', async () => {
    await router.push('/tasks?status=open#today')
    await router.push('/settings/billing#orders')
    await router.push('/pricing')
    await router.push('/pricing?plan=lite')
    await router.push('/checkout/ORDER-1')
    await router.push('/pricing')
    await router.push('/billing/result/ORDER-1')
    await router.push('/pricing')

    expect(getPricingReturnPath()).toBe('/settings/billing#orders')
    expect(getSettingsReturnPath()).toBe('/tasks?status=open#today')
  })

  it.each([
    'https://example.com/private', '//example.com/private', '/\\example.com',
    '/login?redirect=%2Ftasks', '/pricing', '/pricing?plan=lite#top', '/checkout/A', '/billing/result/A',
    '/missing', ' /tasks', '/tasks\n', 'javascript:alert(1)', undefined, null, ['/tasks']
  ])('rejects an unsafe or looping explicit pricing return destination: %s', async (path) => {
    await router.push('/tasks#previous')
    await router.push('/pricing')

    expect(getPricingReturnPath(path)).toBe('/tasks#previous')
  })

  it.each(['/pricing', '/checkout/A', '/billing/result/A', '/login', '//example.com', '/missing'])('rejects an invalid saved pricing destination: %s', async (path) => {
    storage.set('lyle:pricing-return:1', path)
    await router.push('/pricing')

    expect(getPricingReturnPath()).toBe('/settings/billing')
  })

  it('isolates pricing origins by account and does not copy the previous account current page', async () => {
    await router.push('/settings/billing?private=1')
    await router.push('/pricing')
    auth.user = null
    expect(getPricingReturnPath()).toBe('/settings/billing')
    auth.user = { id: 2 }
    expect(getPricingReturnPath()).toBe('/settings/billing')
    await router.push('/settings/usage?private=2')
    auth.user = { id: 3 }
    await router.push('/pricing')
    expect(getPricingReturnPath()).toBe('/settings/billing')
    expect(storage.has('lyle:pricing-return:3')).toBe(false)
    auth.user = { id: 2 }
    await router.push('/tasks?owner=2')
    await router.push('/pricing')
    expect(getPricingReturnPath()).toBe('/tasks?owner=2')
    auth.user = { id: 1 }
    expect(getPricingReturnPath()).toBe('/settings/billing?private=1')
  })

  it('keeps the latest pricing entry when storage cannot be written', async () => {
    await router.push('/settings/billing')
    await router.push('/pricing')
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: () => { throw new Error('quota exceeded') }
    })
    await router.push('/tasks#new-origin')
    await router.push('/pricing')

    expect(getPricingReturnPath()).toBe('/tasks#new-origin')
  })

  it('keeps pricing navigation usable without any session storage access', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') }
    })
    expect(getPricingReturnPath()).toBe('/settings/billing')
    await router.push('/settings/billing#orders')
    await router.push('/pricing')

    expect(getPricingReturnPath()).toBe('/settings/billing#orders')
  })

  it('does not update either destination for a canceled pricing navigation', async () => {
    await router.push('/tasks')
    router.beforeEach((to) => to.name === 'pricing' ? false : true)
    await router.push('/pricing')

    expect(getPricingReturnPath()).toBe('/settings/billing')
    expect(getSettingsReturnPath()).toBe('/dashboard')
    expect(storage.size).toBe(0)
  })
})
