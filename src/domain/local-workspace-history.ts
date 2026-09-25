import type { LocalDirectoryHandle, WorkspaceCall, WorkspaceMessage } from './local-workspace'

export type LocalActivity = {
  label: string
  path?: string
  status: 'running' | 'done' | 'error' | 'waiting'
  detail?: string
}
export type LocalTurn = { question: string; answer: string; activities: LocalActivity[]; open: boolean; completed: boolean }
export type LocalProject = {
  id: string
  name: string
  directoryName: string
  createdAt: number
  updatedAt: number
}
export type LocalSessionKind = 'chat' | 'agent'
export type LocalSession = {
  id: string
  title: string
  projectId: string | null
  kind: LocalSessionKind
  /** Kept for legacy exports; project identity is always projectId, never this directory label. */
  projectName: string
  createdAt: number
  updatedAt: number
  turns: LocalTurn[]
  transcript: WorkspaceMessage[]
  draft: string
}
export type LocalHistory = { projects: LocalProject[]; sessions: LocalSession[]; activeProjectId: string | null; activeId: string | null }
export type LocalSessionMetadata = Pick<LocalSession, 'id' | 'title' | 'kind' | 'projectId' | 'updatedAt'>
export type LocalHistoryMetadata = Omit<LocalHistory, 'sessions'> & { sessions: LocalSessionMetadata[]; error: string | null }
type Owner = string | number

export const LOCAL_HISTORY_CHANGED_EVENT = 'lyle:local-history-changed'
export const LOCAL_HISTORY_LIMITS = { projects: 40, sessions: 40, turns: 200, serializedChars: 2_000_000, draftChars: 20_000 } as const
const VERSION = 2
// Keep the original key so migration remains a single atomic storage write.
const STORAGE_PREFIX = 'lyle:local-workspace-history:v1:'
const handles = new Map<string, Map<string, LocalDirectoryHandle>>()
const projectHandles = new Map<string, Map<string, LocalDirectoryHandle>>()
type Snapshot = { raw: string | null; recovery: boolean }
const snapshots = new WeakMap<Storage, Map<string, Snapshot>>()
const emptyHistory = (): LocalHistory => ({ projects: [], sessions: [], activeProjectId: null, activeId: null })

function storageSnapshots(storage: Storage) {
  let entries = snapshots.get(storage)
  if (!entries) { entries = new Map(); snapshots.set(storage, entries) }
  return entries
}
function storageKey(owner: string) { return STORAGE_PREFIX + encodeURIComponent(owner) }

function ownerId(owner: Owner) {
  const value = String(owner).trim()
  if (!value || value.length > 128 || (typeof owner !== 'string' && !Number.isSafeInteger(owner))) throw new Error('请登录后保存本地对话')
  return value
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本地对话数据格式无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 200_000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('本地对话内容过长或格式无效')
  return value
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('本地对话记录过多或格式无效')
  return value
}
function timestamp(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw new Error('本地对话时间格式无效')
  return value
}
function identifier(value: unknown) {
  const id = text(value, 128)
  if (!id.trim()) throw new Error('本地对话标识无效')
  return id
}
function activity(value: unknown, restore: boolean): LocalActivity {
  const row = record(value)
  if (!['running', 'done', 'error', 'waiting'].includes(String(row.status))) throw new Error('本地对话步骤格式无效')
  const interrupted = restore && (row.status === 'running' || row.status === 'waiting')
  return {
    label: text(row.label, 200),
    status: interrupted ? 'error' : row.status as LocalActivity['status'],
    ...(row.path === undefined ? {} : { path: text(row.path, 512) }),
    ...(row.detail === undefined ? {} : { detail: text(row.detail) }),
  }
}
function turn(value: unknown, restore: boolean): LocalTurn {
  const row = record(value)
  if (typeof row.open !== 'boolean' || typeof row.completed !== 'boolean') throw new Error('本地对话状态格式无效')
  const activities = list(row.activities, 512).map(item => activity(item, restore))
  return { question: text(row.question), answer: text(row.answer), activities, open: row.open, completed: row.completed }
}
function call(value: unknown): WorkspaceCall {
  const row = record(value)
  // Clone JSON data only; file handles, callbacks and arbitrary extra fields never enter storage.
  const args = JSON.stringify(record(row.args))
  if (args.length > 200_000) throw new Error('本地对话工具参数过长')
  return { id: identifier(row.id), name: text(row.name, 100), args: JSON.parse(args) as Record<string, unknown> }
}
function message(value: unknown): WorkspaceMessage {
  const row = record(value)
  if (!['user', 'assistant', 'tool'].includes(String(row.role))) throw new Error('本地对话消息格式无效')
  return {
    role: row.role as WorkspaceMessage['role'], content: text(row.content),
    ...(row.tool_calls === undefined ? {} : { tool_calls: list(row.tool_calls, 64).map(call) }),
    ...(row.tool_call_id === undefined ? {} : { tool_call_id: identifier(row.tool_call_id) }),
  }
}

/** Keep complete user rounds only. Never replay an interrupted tool call after navigation/reload. */
export function recoverLocalTranscript(messages: WorkspaceMessage[]): WorkspaceMessage[] {
  let checkpoint = 0
  let inRound = false
  let pending = new Set<string>()
  for (let index = 0; index < messages.length; index++) {
    const item = messages[index]!
    if (item.role === 'user') {
      if (inRound || pending.size || item.tool_calls?.length || item.tool_call_id) break
      inRound = true
    } else if (item.role === 'assistant') {
      if (!inRound || pending.size || item.tool_call_id) break
      if (item.tool_calls?.length) {
        pending = new Set(item.tool_calls.map(tool => tool.id))
        if (pending.size !== item.tool_calls.length) break
      } else {
        inRound = false
        checkpoint = index + 1
      }
    } else {
      if (!inRound || item.tool_calls?.length || !item.tool_call_id || !pending.delete(item.tool_call_id)) break
    }
  }
  return messages.slice(0, checkpoint)
}
function project(value: unknown): LocalProject {
  const row = record(value)
  const name = text(row.name, 255)
  const directoryName = text(row.directoryName, 255)
  if (!name.trim() || !directoryName.trim()) throw new Error('本地项目名称或目录名称无效')
  return { id: identifier(row.id), name, directoryName, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) }
}
function session(value: unknown, restore: boolean, legacy = false): LocalSession {
  const row = record(value)
  const transcript = list(row.transcript, 2_000).map(message)
  if (!legacy && row.kind !== 'chat' && row.kind !== 'agent') throw new Error('本地对话类型无效')
  return {
    id: identifier(row.id), title: text(row.title, 120), projectName: text(row.projectName, 255),
    projectId: legacy || row.projectId === null ? null : identifier(row.projectId),
    // Existing project chat records remain intact and continue in the unified agent mode.
    kind: 'agent',
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
    turns: list(row.turns, LOCAL_HISTORY_LIMITS.turns).map(item => turn(item, restore)),
    transcript: recoverLocalTranscript(transcript), draft: text(row.draft, LOCAL_HISTORY_LIMITS.draftChars),
  }
}

function newId() { return globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}` }

export function createLocalProject(directoryName: string, name = directoryName): LocalProject {
  const now = Date.now()
  return project({ id: newId(), name, directoryName, createdAt: now, updatedAt: now })
}

export function createLocalSession(projectName = '', options: { projectId?: string | null; kind?: LocalSessionKind } = {}): LocalSession {
  const now = Date.now()
  return {
    id: newId(), projectId: options.projectId ?? null, kind: options.kind || 'agent',
    title: '新对话', projectName, createdAt: now, updatedAt: now, turns: [], transcript: [], draft: '',
  }
}

export function createLocalSessionForProject(project: LocalProject, kind: LocalSessionKind = 'agent'): LocalSession {
  return createLocalSession(project.directoryName, { projectId: project.id, kind })
}

function selection(projects: LocalProject[], sessions: LocalSession[], requestedProjectId: unknown, requestedId: unknown) {
  const selected = sessions.find(item => item.id === requestedId)
  const activeProjectId = requestedProjectId === null ? null
    : projects.some(item => item.id === requestedProjectId) ? requestedProjectId as string
      : selected ? selected.projectId : projects[0]?.id || null
  const activeId = requestedId === null ? null
    : selected?.projectId === activeProjectId ? selected.id
      : sessions.find(item => item.projectId === activeProjectId)?.id || null
  return { activeProjectId, activeId }
}

function readHistory(owner: Owner, trackSnapshot: boolean): { history: LocalHistory; error: string | null } {
  let snapshot: Snapshot | undefined
  try {
    const ownerKey = ownerId(owner)
    const storage = globalThis.localStorage
    const raw = storage.getItem(storageKey(ownerKey))
    snapshot = { raw, recovery: false }
    if (trackSnapshot) storageSnapshots(storage).set(ownerKey, snapshot)
    if (!raw) return { history: emptyHistory(), error: null }
    if (raw.length > LOCAL_HISTORY_LIMITS.serializedChars) throw new Error('本地对话存储超出大小限制，原始记录仍保留在此浏览器')
    const saved = record(JSON.parse(raw))
    if ((saved.version !== VERSION && saved.version !== 1) || saved.owner !== ownerKey) throw new Error('本地对话版本或账号不匹配，原始记录仍保留在此浏览器')
    const legacy = saved.version === 1
    const rows = list(saved.sessions, LOCAL_HISTORY_LIMITS.sessions)
    const projects: LocalProject[] = []
    const sessions: LocalSession[] = []
    const projectIds = new Set<string>()
    const ids = new Set<string>()
    let skipped = false
    if (!legacy) {
      for (const row of list(saved.projects, LOCAL_HISTORY_LIMITS.projects)) {
        try {
          const item = project(row)
          if (projectIds.has(item.id)) { skipped = true; continue }
          projectIds.add(item.id); projects.push(item)
        } catch { skipped = true }
      }
    }
    for (const [index, row] of rows.entries()) {
      try {
        const item = session(row, true, legacy)
        if (ids.has(item.id)) { skipped = true; continue }
        if (legacy && item.projectName.trim()) {
          // A directory name does not identify a filesystem location. Keep legacy sessions
          // separate even if their labels match, with stable IDs until migration is saved.
          const id = `legacy-${index}-${item.id.slice(0, 100)}`
          projects.push({ id, name: item.projectName, directoryName: item.projectName, createdAt: item.createdAt, updatedAt: item.updatedAt })
          projectIds.add(id); item.projectId = id
        } else if (item.projectId !== null && !projectIds.has(item.projectId)) {
          // Keep the conversation in unassigned drafts rather than discarding its contents.
          item.projectId = null; skipped = true
        }
        ids.add(item.id); sessions.push(item)
      } catch { skipped = true }
    }
    projects.sort((left, right) => right.updatedAt - left.updatedAt)
    sessions.sort((left, right) => right.updatedAt - left.updatedAt)
    const active = selection(projects, sessions, legacy ? undefined : saved.activeProjectId, saved.activeId)
    snapshot.recovery = skipped
    return { history: { projects, sessions, ...active }, error: skipped ? '部分本地对话或项目无法读取，已恢复其他记录；原始记录仍保留在此浏览器' : null }
  } catch (error) {
    if (snapshot?.raw != null) snapshot.recovery = true
    const storageError = error instanceof DOMException || error instanceof TypeError
    return { history: emptyHistory(), error: error instanceof SyntaxError ? '本地对话数据损坏，原始记录仍保留在此浏览器' : storageError ? '无法读取本地对话，请检查浏览器存储设置；原始记录不会被自动清除' : error instanceof Error ? error.message : '无法读取本地对话，请检查浏览器存储设置' }
  }
}

export function loadLocalHistory(owner: Owner): { history: LocalHistory; error: string | null } {
  return readHistory(owner, true)
}

/** Navigation must never rebase an editor's optimistic save snapshot. */
export function readLocalHistoryMetadata(owner: Owner): LocalHistoryMetadata {
  const { history, error } = readHistory(owner, false)
  return {
    projects: history.projects,
    sessions: history.sessions.filter(item => item.projectId !== null || item.turns.length > 0 || item.draft.length > 0)
      .map(({ id, title, kind, projectId, updatedAt }) => ({ id, title, kind, projectId, updatedAt })),
    activeId: history.activeId, activeProjectId: history.activeProjectId, error,
  }
}

export function isLocalHistoryStorageKey(key: string | null, owner: Owner): boolean {
  try { return key === null || key === storageKey(ownerId(owner)) }
  catch { return false }
}

export function saveLocalHistory(owner: Owner, history: LocalHistory): { ok: boolean; error: string | null } {
  try {
    const ownerKey = ownerId(owner)
    const projects = list(history.projects, LOCAL_HISTORY_LIMITS.projects).map(project)
    const sessions = list(history.sessions, LOCAL_HISTORY_LIMITS.sessions).map(item => session(item, false))
    const projectIds = new Set(projects.map(item => item.id))
    const ids = new Set(sessions.map(item => item.id))
    if (projectIds.size !== projects.length) throw new Error('本地项目标识重复，尚未保存')
    if (ids.size !== sessions.length) throw new Error('本地对话标识重复，尚未保存')
    if (sessions.some(item => item.projectId !== null && !projectIds.has(item.projectId))) throw new Error('本地对话关联的项目不存在，尚未保存；请先将对话移到其他项目或草稿')
    const active = selection(projects, sessions, history.activeProjectId, history.activeId)
    const serialized = JSON.stringify({ version: VERSION, owner: ownerKey, projects, sessions, ...active })
    if (serialized.length > LOCAL_HISTORY_LIMITS.serializedChars) throw new Error('本地对话空间已满，请删除不需要的记录后重试；本次更改尚未保存')
    const storage = globalThis.localStorage
    const key = storageKey(ownerKey)
    const currentRaw = storage.getItem(key)
    const observed = storageSnapshots(storage)
    const snapshot = observed.get(ownerKey)
    if (snapshot && snapshot.raw !== currentRaw) throw new Error('本地对话已在其他页面更新，本次更改尚未保存。请先导出当前对话，再刷新读取最新记录')
    // Preserve the exact failed input before replacing it with a new usable snapshot.
    // If the backup exceeds quota, leave the original untouched rather than losing it.
    if (snapshot?.recovery && currentRaw !== null) storage.setItem(key + ':recovery', currentRaw)
    // setItem is atomic: a quota/permission error leaves the previous successful snapshot intact.
    const hasData = projects.length > 0 || sessions.length > 0
    if (hasData) storage.setItem(key, serialized)
    else storage.removeItem(key)
    observed.set(ownerKey, { raw: hasData ? serialized : null, recovery: false })
    for (const id of handles.get(ownerKey)?.keys() || []) if (!ids.has(id)) handles.get(ownerKey)?.delete(id)
    for (const id of projectHandles.get(ownerKey)?.keys() || []) if (!projectIds.has(id)) projectHandles.get(ownerKey)?.delete(id)
    // Browser storage events only reach other tabs; notify the current navigation separately.
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LOCAL_HISTORY_CHANGED_EVENT, { detail: { owner: ownerKey } }))
    return { ok: true, error: null }
  } catch (error) {
    const storageError = error instanceof DOMException || error instanceof TypeError
    return { ok: false, error: storageError ? '浏览器未能保存本地对话，请检查存储权限或释放空间；本次更改尚未保存' : error instanceof Error ? error.message : '本地对话保存失败，本次更改尚未保存' }
  }
}

/** Raw backup from the latest failed parse, retained separately from normal conversation saves. */
export function getLocalHistoryRecovery(owner: Owner): string | null {
  try { return globalThis.localStorage.getItem(storageKey(ownerId(owner)) + ':recovery') }
  catch { return null }
}

// Handles live only until this app is refreshed. A saved session never restores write approval.
export function rememberLocalHandle(owner: Owner, sessionId: string, handle: LocalDirectoryHandle) {
  const key = ownerId(owner)
  if (!handles.has(key)) handles.set(key, new Map())
  handles.get(key)!.set(sessionId, handle)
}
export function getLocalHandle(owner: Owner, sessionId: string) { return handles.get(ownerId(owner))?.get(sessionId) }
export function forgetLocalHandle(owner: Owner, sessionId: string) { handles.get(ownerId(owner))?.delete(sessionId) }
export function rememberProjectHandle(owner: Owner, projectId: string, handle: LocalDirectoryHandle) {
  const key = ownerId(owner)
  if (!projectHandles.has(key)) projectHandles.set(key, new Map())
  projectHandles.get(key)!.set(projectId, handle)
}
export function getProjectHandle(owner: Owner, projectId: string) { return projectHandles.get(ownerId(owner))?.get(projectId) }
export function forgetProjectHandle(owner: Owner, projectId: string) { projectHandles.get(ownerId(owner))?.delete(projectId) }
export function clearLocalHandles(owner: Owner) { const key = ownerId(owner); handles.delete(key); projectHandles.delete(key) }
