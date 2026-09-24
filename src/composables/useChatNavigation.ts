import { computed, onScopeDispose, readonly, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useRouter } from 'vue-router'
import { listConversations } from '@/api/app'
import type { Conversation } from '@/api/types'
import { parseServerDateTime } from '@/domain/date-time'
import { CHAT_NAVIGATION_CHANGED_EVENT, conversationLocation, newChatLocation, type ChatNavigationChange, type ChatNavigationOwner } from '@/domain/chat-navigation'

export interface UseChatNavigationOptions {
  owner: MaybeRefOrGetter<ChatNavigationOwner>
  limit?: number
}

export function useChatNavigation(options: UseChatNavigationOptions) {
  const router = useRouter()
  const items = ref<Conversation[]>([])
  const loading = ref(false)
  const error = ref('')
  const owner = computed(() => {
    const value = toValue(options.owner)
    return value == null ? '' : String(value)
  })
  const conversations = computed(() => [...items.value].sort((a, b) =>
    (parseServerDateTime(b.updatedAt || b.createdAt)?.getTime() || 0)
    - (parseServerDateTime(a.updatedAt || a.createdAt)?.getTime() || 0)
  ))
  const recentConversations = computed(() => conversations.value.slice(0, Math.max(0, options.limit ?? 8)))
  let revision = 0
  let disposed = false

  async function refresh() {
    const requestOwner = owner.value
    const requestRevision = ++revision
    if (disposed || !requestOwner) return
    loading.value = true
    error.value = ''
    try {
      const response = await listConversations()
      if (disposed || requestRevision !== revision || owner.value !== requestOwner) return
      items.value = response.data
    } catch {
      if (disposed || requestRevision !== revision || owner.value !== requestOwner) return
      error.value = '聊天记录暂时无法加载，请重试。'
    } finally {
      if (!disposed && requestRevision === revision && owner.value === requestOwner) loading.value = false
    }
  }

  function changed(event: Event) {
    const change = (event as CustomEvent<ChatNavigationChange>).detail
    if (change?.owner === owner.value && owner.value) void refresh()
  }

  watch(owner, () => {
    ++revision
    items.value = []; loading.value = false; error.value = ''
    if (owner.value) void refresh()
  }, { immediate: true, flush: 'sync' })
  if (typeof window !== 'undefined') window.addEventListener(CHAT_NAVIGATION_CHANGED_EVENT, changed)
  onScopeDispose(() => {
    disposed = true; ++revision
    if (typeof window !== 'undefined') window.removeEventListener(CHAT_NAVIGATION_CHANGED_EVENT, changed)
  })

  function startNewChat() { return router.push(newChatLocation()) }

  return { conversations, recentConversations, loading: readonly(loading), error: readonly(error), refresh, startNewChat, conversationLocation }
}
