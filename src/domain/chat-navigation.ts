import type { RouteLocationRaw } from 'vue-router'

export const CHAT_NAVIGATION_CHANGED_EVENT = 'lyle:chat-navigation-changed'
export type ChatNavigationOwner = string | number | null | undefined
export interface ChatNavigationChange { owner: string }

export function notifyChatNavigationChanged(owner: ChatNavigationOwner) {
  if (owner == null || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ChatNavigationChange>(CHAT_NAVIGATION_CHANGED_EVENT, { detail: { owner: String(owner) } }))
}

export function conversationLocation(id: string | number): RouteLocationRaw {
  return { name: 'chat', query: { conversationId: String(id) } }
}

let newChatSequence = 0
export function newChatLocation(): RouteLocationRaw {
  return { name: 'chat', query: { newChat: `${Date.now()}-${++newChatSequence}` } }
}
