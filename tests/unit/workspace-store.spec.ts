import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  useWorkspaceStore,
  WORKSPACE_QUICK_INTENTS
} from '@/stores/workspace'

const SESSION_KEY = 'lyle.workspace.quick-intent.v1'

describe('workspace store chat handoff', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    vi.stubGlobal('window', { sessionStorage: storage })
    vi.stubGlobal('sessionStorage', storage)
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps arbitrary chat text in memory and never writes it to sessionStorage', () => {
    const store = useWorkspaceStore()
    const sensitiveDraft = '内部项目代号与凭据不应落盘'

    store.stageChatDraft(sensitiveDraft, { id: 19, name: '机密项目名' }, 'dashboard')

    expect(store.pendingChat).toEqual(expect.objectContaining({
      draft: sensitiveDraft,
      project: { id: 19, name: '机密项目名' },
      source: 'dashboard'
    }))
    expect(storage.length).toBe(0)
    expect([...storage.values()].join('')).not.toContain(sensitiveDraft)
    expect([...storage.values()].join('')).not.toContain('机密项目名')
  })

  it('restores a preset through only its safe intent id and numeric project id', () => {
    const firstStore = useWorkspaceStore()

    firstStore.stageQuickIntent('inspect', { id: 42, name: '不要持久化的项目名' }, 'dashboard')

    const persisted = storage.getItem(SESSION_KEY)
    expect(persisted).not.toBeNull()
    expect(persisted).toContain('inspect')
    expect(persisted).toContain('42')
    expect(persisted).not.toContain(WORKSPACE_QUICK_INTENTS.inspect.draft)
    expect(persisted).not.toContain('不要持久化的项目名')

    setActivePinia(createPinia())
    const restoredStore = useWorkspaceStore()

    expect(restoredStore.pendingChat).toEqual({
      draft: WORKSPACE_QUICK_INTENTS.inspect.draft,
      project: { id: 42 },
      source: 'dashboard',
      createdAt: expect.any(Number)
    })
  })

  it('only auto-submits an explicit dashboard draft once and never restores that authorization', () => {
    const store = useWorkspaceStore()
    store.stageChatDraft('开始整理本周风险', null, 'dashboard', { autoSubmit: true })
    expect(store.consumeChatDraft()).toEqual(expect.objectContaining({ autoSubmit: true, source: 'dashboard' }))
    expect(store.consumeChatDraft()).toBeNull()
    expect(storage.length).toBe(0)

    store.stageChatDraft('来自项目页的可编辑草稿', null, 'project', { autoSubmit: true })
    expect(store.consumeChatDraft()?.autoSubmit).not.toBe(true)

    store.stageQuickIntent('make-plan')
    expect(store.consumeChatDraft()?.autoSubmit).not.toBe(true)
    store.stageQuickIntent('inspect')
    const safePreset = JSON.parse(storage.getItem(SESSION_KEY)!)
    storage.setItem(SESSION_KEY, JSON.stringify({ ...safePreset, autoSubmit: true }))
    setActivePinia(createPinia())
    expect(useWorkspaceStore().consumeChatDraft()?.autoSubmit).not.toBe(true)
  })

  it('returns a handoff once and clears both Pinia and sessionStorage after consumption', () => {
    const store = useWorkspaceStore()
    store.stageQuickIntent('make-plan', { id: 7, name: 'V4.2' }, 'project')
    expect(storage.getItem(SESSION_KEY)).not.toBeNull()

    const handoff = store.consumeChatDraft()

    expect(handoff).toEqual(expect.objectContaining({
      draft: WORKSPACE_QUICK_INTENTS['make-plan'].draft,
      project: { id: 7, name: 'V4.2' },
      source: 'project'
    }))
    expect(store.pendingChat).toBeNull()
    expect(store.hasPendingChat).toBe(false)
    expect(storage.getItem(SESSION_KEY)).toBeNull()
    expect(store.consumeChatDraft()).toBeNull()
  })

  it('hands automation intent through memory while exposing only an opaque id', () => {
    const store = useWorkspaceStore()
    const sensitiveIntent = '根据内部项目正文创建每周巡检'

    const id = store.stageAutomationIntent(sensitiveIntent, 42)

    expect(id).not.toContain(sensitiveIntent)
    expect(storage.length).toBe(0)
    expect(store.consumeAutomationIntent(id)).toEqual(expect.objectContaining({
      id,
      intent: sensitiveIntent,
      projectId: 42
    }))
    expect(store.pendingAutomation).toBeNull()

    const secondId = store.stageAutomationIntent(sensitiveIntent, -1)
    expect(store.consumeAutomationIntent(secondId)).toEqual(expect.objectContaining({
      id: secondId,
      intent: sensitiveIntent,
      projectId: null
    }))
    expect(store.consumeAutomationIntent(secondId)).toBeNull()

    store.stageAutomationIntent(sensitiveIntent, 42)
    expect(store.consumeAutomationIntent('wrong-id')).toBeNull()
    expect(store.pendingAutomation).toBeNull()
  })
})

class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>()

  get length() {
    return this.entries.size
  }

  clear() {
    this.entries.clear()
  }

  getItem(key: string) {
    return this.entries.get(key) ?? null
  }

  key(index: number) {
    return [...this.entries.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.entries.delete(key)
  }

  setItem(key: string, value: string) {
    this.entries.set(key, String(value))
  }

  values() {
    return this.entries.values()
  }
}
