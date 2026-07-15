import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type WorkspaceQuickIntentId = 'organize-project' | 'make-plan' | 'research' | 'inspect'

export const WORKSPACE_QUICK_INTENTS: Record<WorkspaceQuickIntentId, { label: string; draft: string }> = {
  'organize-project': {
    label: '整理项目',
    draft: '帮我整理当前项目，归纳目标、进展、风险和下一步。'
  },
  'make-plan': {
    label: '生成计划',
    draft: '帮我把当前目标拆成一份今天可以开始执行的计划。'
  },
  research: {
    label: '查询资料',
    draft: '帮我查询相关资料，整理关键信息并标明来源。'
  },
  inspect: {
    label: '运行巡检',
    draft: '帮我运行一次项目巡检，优先指出风险、阻塞和建议动作。'
  }
}

export interface WorkspaceProjectContext {
  id: number
  name?: string
}

export interface WorkspaceChatHandoff {
  draft: string
  project: WorkspaceProjectContext | null
  source: 'dashboard' | 'project' | 'unknown'
  createdAt: number
}

export interface WorkspaceAutomationHandoff {
  id: string
  intent: string
  projectId: number | null
  createdAt: number
}

interface PersistedQuickIntent {
  version: 1
  intentId: WorkspaceQuickIntentId
  projectId?: number
  source: WorkspaceChatHandoff['source']
  createdAt: number
}

const SESSION_KEY = 'lyle.workspace.quick-intent.v1'
const SESSION_TTL_MS = 30 * 60 * 1000
let automationHandoffSequence = 0

/**
 * One-time handoff between a work surface and chat. Arbitrary user text stays
 * in Pinia memory only. sessionStorage is reserved for a known safe intent id
 * plus an optional numeric project id, and is removed when consumed.
 */
export const useWorkspaceStore = defineStore('workspace', () => {
  const pendingChat = ref<WorkspaceChatHandoff | null>(restoreQuickIntent())
  const pendingAutomation = ref<WorkspaceAutomationHandoff | null>(null)
  const hasPendingChat = computed(() => pendingChat.value !== null)

  function stageChatDraft(
    draft: string,
    project: WorkspaceProjectContext | null = null,
    source: WorkspaceChatHandoff['source'] = 'unknown'
  ) {
    clearPersistedQuickIntent()
    pendingChat.value = {
      draft: draft.trim(),
      project: normalizeProject(project),
      source,
      createdAt: Date.now()
    }
  }

  function stageQuickIntent(
    intentId: WorkspaceQuickIntentId,
    project: WorkspaceProjectContext | null = null,
    source: WorkspaceChatHandoff['source'] = 'dashboard'
  ) {
    const createdAt = Date.now()
    const normalizedProject = normalizeProject(project)
    pendingChat.value = {
      draft: WORKSPACE_QUICK_INTENTS[intentId].draft,
      project: normalizedProject,
      source,
      createdAt
    }
    persistQuickIntent({
      version: 1,
      intentId,
      ...(normalizedProject ? { projectId: normalizedProject.id } : {}),
      source,
      createdAt
    })
  }

  function consumeChatDraft(): WorkspaceChatHandoff | null {
    const handoff = pendingChat.value
    pendingChat.value = null
    clearPersistedQuickIntent()
    return handoff
      ? {
        ...handoff,
        project: handoff.project ? { ...handoff.project } : null
      }
      : null
  }

  function clearChatDraft() {
    pendingChat.value = null
    clearPersistedQuickIntent()
  }

  function stageAutomationIntent(intent: string, projectId?: number | null): string {
    automationHandoffSequence += 1
    const id = `${Date.now().toString(36)}-${automationHandoffSequence.toString(36)}`
    const safeProjectId = Number.isInteger(projectId) && Number(projectId) > 0 ? Number(projectId) : null
    pendingAutomation.value = { id, intent: intent.trim(), projectId: safeProjectId, createdAt: Date.now() }
    return id
  }

  function consumeAutomationIntent(id: string): WorkspaceAutomationHandoff | null {
    const handoff = pendingAutomation.value
    pendingAutomation.value = null
    if (!handoff || handoff.id !== id || Date.now() - handoff.createdAt > SESSION_TTL_MS) return null
    return { ...handoff }
  }

  return {
    pendingChat,
    pendingAutomation,
    hasPendingChat,
    stageChatDraft,
    stageQuickIntent,
    consumeChatDraft,
    clearChatDraft,
    stageAutomationIntent,
    consumeAutomationIntent
  }
})

function normalizeProject(project: WorkspaceProjectContext | null) {
  if (!project || !Number.isInteger(project.id) || project.id <= 0) return null
  return {
    id: project.id,
    ...(project.name?.trim() ? { name: project.name.trim() } : {})
  }
}

function restoreQuickIntent(): WorkspaceChatHandoff | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PersistedQuickIntent>
    if (
      value.version !== 1
      || !isQuickIntentId(value.intentId)
      || typeof value.createdAt !== 'number'
      || Date.now() - value.createdAt > SESSION_TTL_MS
    ) {
      clearPersistedQuickIntent()
      return null
    }
    const projectId = typeof value.projectId === 'number' && Number.isInteger(value.projectId) && value.projectId > 0
      ? value.projectId
      : null
    return {
      draft: WORKSPACE_QUICK_INTENTS[value.intentId].draft,
      project: projectId ? { id: projectId } : null,
      source: value.source === 'project' || value.source === 'unknown' ? value.source : 'dashboard',
      createdAt: value.createdAt
    }
  } catch {
    clearPersistedQuickIntent()
    return null
  }
}

function persistQuickIntent(value: PersistedQuickIntent) {
  if (typeof window === 'undefined') return
  try {
    // Deliberately persist no free-form text or project name.
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; the in-memory handoff remains usable.
  }
}

function clearPersistedQuickIntent() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Treat storage cleanup as best effort.
  }
}

function isQuickIntentId(value: unknown): value is WorkspaceQuickIntentId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WORKSPACE_QUICK_INTENTS, value)
}
