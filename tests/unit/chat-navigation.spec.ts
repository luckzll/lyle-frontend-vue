import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'
import type { Conversation } from '@/api/types'
import { useChatNavigation } from '@/composables/useChatNavigation'
import { notifyChatNavigationChanged } from '@/domain/chat-navigation'

const api = vi.hoisted(() => ({ list: vi.fn(), navigate: vi.fn() }))
vi.mock('@/api/app', () => ({ listConversations: () => api.list() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: api.navigate }) }))

const scopes: EffectScope[] = []
const row = (id: string, updatedAt = '2026-09-20T10:00:00Z'): Conversation => ({
  id, title: `对话 ${id}`, createdAt: updatedAt, updatedAt,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve() }
function mount(owner = ref<string | null>('42'), limit = 8) {
  const scope = effectScope(); scopes.push(scope)
  return { scope, owner, navigation: scope.run(() => useChatNavigation({ owner, limit }))! }
}

beforeEach(() => {
  api.list.mockReset().mockResolvedValue({ data: [] })
  api.navigate.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); vi.unstubAllGlobals() })

describe('ordinary chat sidebar navigation', () => {
  it('clears account history immediately and ignores responses from the previous owner', async () => {
    const oldRequest = deferred<{ data: Conversation[] }>()
    const newRequest = deferred<{ data: Conversation[] }>()
    api.list.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
    const { owner, navigation } = mount()
    expect(navigation.loading.value).toBe(true)
    owner.value = '43'
    expect(navigation.conversations.value).toEqual([])
    oldRequest.resolve({ data: [row('private-42')] }); await settle()
    expect(navigation.conversations.value).toEqual([])
    expect(navigation.loading.value).toBe(true)
    newRequest.resolve({ data: [row('private-43')] }); await settle()
    expect(navigation.conversations.value.map(item => item.id)).toEqual(['private-43'])
    owner.value = null
    expect(navigation.conversations.value).toEqual([])
    expect(navigation.loading.value).toBe(false)
  })

  it('sorts by activity, exposes recent rows, and preserves known history during a failed refresh', async () => {
    api.list.mockResolvedValueOnce({ data: [row('old', '2026-09-20T10:00:00Z'), row('new', '2026-09-21T10:00:00Z')] })
    const { navigation } = mount(ref('42'), 1); await settle()
    expect(navigation.conversations.value.map(item => item.id)).toEqual(['new', 'old'])
    expect(navigation.recentConversations.value.map(item => item.id)).toEqual(['new'])
    api.list.mockRejectedValueOnce(new Error('temporarily unavailable'))
    await navigation.refresh()
    expect(navigation.error.value).toContain('重试')
    expect(navigation.conversations.value).toHaveLength(2)
    api.list.mockResolvedValueOnce({ data: [row('new')] })
    await navigation.refresh()
    expect(navigation.error.value).toBe('')
    expect(navigation.conversations.value.map(item => item.id)).toEqual(['new'])
  })

  it('refreshes only for its owner and does not let an older list resurrect a deleted conversation', async () => {
    const { scope, navigation } = mount(); await settle()
    const stale = deferred<{ data: Conversation[] }>()
    api.list.mockReturnValueOnce(stale.promise)
    const oldRefresh = navigation.refresh()
    notifyChatNavigationChanged('other-user')
    expect(api.list).toHaveBeenCalledTimes(2)
    api.list.mockResolvedValueOnce({ data: [row('remaining')] })
    notifyChatNavigationChanged('42'); await settle()
    stale.resolve({ data: [row('deleted'), row('remaining')] }); await oldRefresh
    expect(navigation.conversations.value.map(item => item.id)).toEqual(['remaining'])
    scope.stop()
    notifyChatNavigationChanged('42')
    expect(api.list).toHaveBeenCalledTimes(3)
  })

  it('uses an explicit distinct new-chat route every time and opens history by id', async () => {
    const { navigation } = mount()
    await navigation.startNewChat(); await navigation.startNewChat()
    const [first, second] = api.navigate.mock.calls.map(call => call[0])
    expect(first.name).toBe('chat')
    expect(first.query.newChat).toBeTruthy()
    expect(second.query.newChat).not.toBe(first.query.newChat)
    expect(first.query).not.toHaveProperty('conversationId')
    expect(navigation.conversationLocation('existing')).toEqual({ name: 'chat', query: { conversationId: 'existing' } })
  })
})
