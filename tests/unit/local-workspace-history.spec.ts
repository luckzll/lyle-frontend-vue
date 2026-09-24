import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalDirectoryHandle, WorkspaceMessage } from '@/domain/local-workspace'
import {
  clearLocalHandles, createLocalProject, createLocalSession, createLocalSessionForProject, forgetLocalHandle, forgetProjectHandle, getLocalHandle, getLocalHistoryRecovery, getProjectHandle,
  loadLocalHistory, LOCAL_HISTORY_LIMITS, LOCAL_HISTORY_CHANGED_EVENT, readLocalHistoryMetadata, recoverLocalTranscript, rememberLocalHandle, rememberProjectHandle, saveLocalHistory,
  type LocalHistory, type LocalSession,
} from '@/domain/local-workspace-history'

const owner = 'account/one'
const key = (id = owner) => `lyle:local-workspace-history:v1:${encodeURIComponent(id)}`
let disk: Map<string, string>
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> }
const completed: WorkspaceMessage[] = [
  { role: 'user', content: '解释入口文件' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'read-1', name: 'workspace_read', args: { path: 'src/main.ts' } }] },
  { role: 'tool', tool_call_id: 'read-1', content: '{"content":"main()"}' },
  { role: 'assistant', content: '入口在 src/main.ts。' },
]
function sample(): LocalSession {
  return {
    ...createLocalSession('my-project'), title: '解释入口文件', draft: '接下来添加一个按钮',
    turns: [{ question: completed[0]!.content, answer: completed[3]!.content,
      activities: [{ label: '读取文件', path: 'src/main.ts', status: 'done' }], open: false, completed: true }],
    transcript: structuredClone(completed),
  }
}
const history = (...sessions: LocalSession[]): LocalHistory => ({ projects: [], sessions, activeProjectId: null, activeId: sessions[0]?.id || null })

beforeEach(() => {
  disk = new Map()
  storage = {
    getItem: vi.fn((key: string) => disk.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { disk.set(key, value) }),
    removeItem: vi.fn((key: string) => { disk.delete(key) }),
  }
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => { clearLocalHandles(owner); clearLocalHandles('other'); vi.unstubAllGlobals() })

describe('local project conversation history', () => {
  it('round-trips conversation text, project, tools, draft and active session without cloud calls', () => {
    const item = sample()
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect(saveLocalHistory(owner, history(item))).toEqual({ ok: true, error: null })
    expect(loadLocalHistory(owner)).toEqual({ history: history(item), error: null })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('isolates accounts and rejects a snapshot copied from a different account', () => {
    saveLocalHistory(owner, history(sample()))
    expect(loadLocalHistory('other')).toEqual({ history: history(), error: null })
    disk.set(key('other'), disk.get(key())!)
    expect(loadLocalHistory('other').error).toContain('账号不匹配')
    expect(loadLocalHistory('other').history.sessions).toEqual([])
  })

  it('returns an empty state without inventing a saved conversation', () => {
    expect(loadLocalHistory(owner)).toEqual({ history: history(), error: null })
    const item = createLocalSession()
    expect(item).toMatchObject({ title: '新对话', projectName: '', draft: '', transcript: [], turns: [] })
    expect(item.id).toBeTruthy()
    expect(createLocalSession().id).not.toBe(item.id)
  })

  it.each(['{broken', 'null', '[]', '{"version":9,"owner":"account/one","sessions":[]}'])('does not overwrite malformed or unsupported storage: %s', raw => {
    disk.set(key(), raw)
    expect(loadLocalHistory(owner).error).toBeTruthy()
    expect(loadLocalHistory(owner).history.sessions).toEqual([])
    expect(disk.get(key())).toBe(raw)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('recovers valid sessions while reporting invalid records and fixes a missing active ID', () => {
    const first = sample(); first.updatedAt = 10
    const latest = sample(); latest.updatedAt = 20
    disk.set(key(), JSON.stringify({ version: 2, owner, projects: [], activeProjectId: null, activeId: 'missing', sessions: [null, first, latest, { ...first, draft: 4 }] }))
    const loaded = loadLocalHistory(owner)
    expect(loaded.error).toContain('部分本地对话或项目无法读取')
    expect(loaded.history).toEqual(history(latest, first))
  })

  it.each(['{broken', '{"version":99,"owner":"account/one","sessions":[]}'])('backs up the exact failed input before allowing a new save: %s', raw => {
    disk.set(key(), raw)
    expect(loadLocalHistory(owner).error).toBeTruthy()
    const item = sample()
    expect(saveLocalHistory(owner, history(item)).ok).toBe(true)
    expect(loadLocalHistory(owner).history).toEqual(history(item))
    expect(getLocalHistoryRecovery(owner)).toBe(raw)
    expect(getLocalHistoryRecovery('other')).toBeNull()
    item.draft = 'another change'; saveLocalHistory(owner, history(item))
    expect(getLocalHistoryRecovery(owner)).toBe(raw)
  })

  it('also retains partially recovered or deleted corrupt snapshots', () => {
    const item = sample()
    const raw = JSON.stringify({ version: 2, owner, projects: [], activeProjectId: null, activeId: item.id, sessions: [item, null] })
    disk.set(key(), raw)
    expect(loadLocalHistory(owner).history.sessions).toHaveLength(1)
    expect(saveLocalHistory(owner, history()).ok).toBe(true)
    expect(disk.has(key())).toBe(false)
    expect(getLocalHistoryRecovery(owner)).toBe(raw)
  })

  it('does not overwrite corrupt data if writing its recovery backup fails', () => {
    const raw = '{unreadable'
    disk.set(key(), raw); loadLocalHistory(owner)
    storage.setItem.mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    expect(saveLocalHistory(owner, history(sample())).ok).toBe(false)
    expect(disk.get(key())).toBe(raw)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledWith(key() + ':recovery', raw)
  })

  it('retains both original and recovery backup if the replacement write fails', () => {
    const raw = '{unreadable'
    disk.set(key(), raw); loadLocalHistory(owner)
    storage.setItem.mockImplementation((target: string, value: string) => {
      if (target === key()) throw new DOMException('quota', 'QuotaExceededError')
      disk.set(target, value)
    })
    expect(saveLocalHistory(owner, history(sample())).ok).toBe(false)
    expect(disk.get(key())).toBe(raw)
    expect(getLocalHistoryRecovery(owner)).toBe(raw)
  })

  it('protects another tab update or deletion until the caller reloads its baseline', () => {
    const item = sample()
    saveLocalHistory(owner, history(item)); loadLocalHistory(owner)
    const otherTabRaw = disk.get(key())! + ' '
    disk.set(key(), otherTabRaw)
    item.draft = 'unsaved in this tab'
    expect(saveLocalHistory(owner, history(item))).toMatchObject({ ok: false, error: expect.stringContaining('其他页面更新') })
    expect(disk.get(key())).toBe(otherTabRaw)
    expect(saveLocalHistory(owner, history()).ok).toBe(false)
    expect(saveLocalHistory('other', history(sample())).ok).toBe(true)
    loadLocalHistory(owner)
    expect(saveLocalHistory(owner, history(item)).ok).toBe(true)
    disk.delete(key())
    expect(saveLocalHistory(owner, history(item)).ok).toBe(false)
    expect(disk.has(key())).toBe(false)
  })

  it('detects an external first save after this tab loaded an empty history', () => {
    loadLocalHistory(owner)
    const external = JSON.stringify({ version: 2, owner, ...history(sample()) })
    disk.set(key(), external)
    expect(saveLocalHistory(owner, history(sample())).ok).toBe(false)
    expect(disk.get(key())).toBe(external)
  })

  it('rejects corrupt timestamps that would crash date formatting', () => {
    const item = sample(); item.updatedAt = Number.MAX_SAFE_INTEGER
    disk.set(key(), JSON.stringify({ version: 2, owner, ...history(item) }))
    expect(loadLocalHistory(owner).history.sessions).toHaveLength(0)
    expect(loadLocalHistory(owner).error).toBeTruthy()
  })

  it('turns interrupted activities into stopped display state while preserving previous answers', () => {
    const item = sample()
    item.turns.push({ question: '修改入口', answer: '', open: true, completed: false,
      activities: [{ label: '分析下一步', status: 'running', detail: '检查文件中' }, { label: '修改文件', status: 'waiting' }] })
    item.transcript.push({ role: 'user', content: '修改入口' }, { role: 'assistant', content: '',
      tool_calls: [{ id: 'edit', name: 'workspace_edit', args: { path: 'src/main.ts' } }] })
    expect(saveLocalHistory(owner, history(item)).ok).toBe(true)
    const restored = loadLocalHistory(owner).history.sessions[0]!
    expect(restored.transcript).toEqual(completed)
    expect(restored.turns[1]).toMatchObject({ question: '修改入口', completed: false,
      activities: [{ status: 'error', detail: '检查文件中' }, { status: 'error' }] })
    expect(restored.turns[0]).toEqual(item.turns[0])
    expect(item.turns[1]!.activities[0]!.status).toBe('running')
  })

  it('rejects orphan, duplicate, missing and mismatched tool responses by rolling back the whole unfinished round', () => {
    const user: WorkspaceMessage = { role: 'user', content: 'read files' }
    const call: WorkspaceMessage = { role: 'assistant', content: '', tool_calls: [
      { id: 'a', name: 'workspace_read', args: { path: 'a.ts' } }, { id: 'b', name: 'workspace_read', args: { path: 'b.ts' } },
    ] }
    const result = (id: string): WorkspaceMessage => ({ role: 'tool', tool_call_id: id, content: '{}' })
    const final: WorkspaceMessage = { role: 'assistant', content: 'done' }
    for (const tail of [
      [result('a')], [user], [user, call], [user, call, result('a'), final],
      [user, call, result('a'), result('a'), result('b'), final], [user, call, result('wrong'), final],
      [user, { ...call, tool_calls: [call.tool_calls![0]!, call.tool_calls![0]!] }, result('a'), final],
    ]) expect(recoverLocalTranscript([...completed, ...tail])).toEqual(completed)
    const valid = [...completed, user, call, result('b'), result('a'), final]
    expect(recoverLocalTranscript(valid)).toEqual(valid)
  })

  it('reports quota and unavailable storage failures while retaining the last successful save', () => {
    const item = sample(); saveLocalHistory(owner, history(item))
    const previous = disk.get(key())
    storage.setItem.mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    item.draft = 'unsaved text'
    expect(saveLocalHistory(owner, history(item))).toMatchObject({ ok: false, error: expect.stringContaining('尚未保存') })
    expect(disk.get(key())).toBe(previous)
    storage.getItem.mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    expect(loadLocalHistory(owner).error).toBeTruthy()
    expect(disk.get(key())).toBe(previous)
  })

  it('enforces limits without silently pruning history', () => {
    const item = sample(); saveLocalHistory(owner, history(item))
    const previous = disk.get(key())
    expect(saveLocalHistory(owner, { ...history(item), projects: Array.from({ length: LOCAL_HISTORY_LIMITS.projects + 1 }, () => createLocalProject('same-name')) }).ok).toBe(false)
    expect(saveLocalHistory(owner, history(...Array.from({ length: LOCAL_HISTORY_LIMITS.sessions + 1 }, sample))).ok).toBe(false)
    item.draft = 'x'.repeat(LOCAL_HISTORY_LIMITS.draftChars + 1)
    expect(saveLocalHistory(owner, history(item)).ok).toBe(false)
    item.draft = ''
    item.turns = Array.from({ length: 6 }, () => ({ question: 'x'.repeat(200_000), answer: 'x'.repeat(200_000), activities: [], open: false, completed: true }))
    expect(saveLocalHistory(owner, history(item))).toMatchObject({ ok: false, error: expect.stringContaining('空间已满') })
    expect(disk.get(key())).toBe(previous)
  })

  it('persists deletion, removes an empty snapshot and forgets removed directory handles', () => {
    const first = sample(); const second = sample()
    rememberLocalHandle(owner, first.id, { kind: 'directory', name: 'project' } as LocalDirectoryHandle)
    saveLocalHistory(owner, history(first, second))
    expect(saveLocalHistory(owner, { ...history(second), activeId: first.id }).ok).toBe(true)
    expect(loadLocalHistory(owner).history).toEqual(history(second))
    expect(getLocalHandle(owner, first.id)).toBeUndefined()
    expect(saveLocalHistory(owner, history()).ok).toBe(true)
    expect(disk.has(key())).toBe(false)
    expect(loadLocalHistory(owner).history).toEqual(history())
  })

  it('keeps handles account-scoped and memory-only, excluding approval and runtime fields from snapshots', () => {
    const item = sample()
    const handle = { kind: 'directory', name: 'project' } as LocalDirectoryHandle
    Object.assign(item, { handle, writePermission: 'granted', permissionMode: 'auto', root: handle })
    rememberLocalHandle(owner, item.id, handle)
    saveLocalHistory(owner, history(item))
    expect(getLocalHandle(owner, item.id)).toBe(handle)
    expect(getLocalHandle('other', item.id)).toBeUndefined()
    expect(disk.get(key())).not.toMatch(/writePermission|permissionMode|"handle"|"root"/)
    forgetLocalHandle(owner, item.id)
    expect(getLocalHandle(owner, item.id)).toBeUndefined()
    rememberLocalHandle(owner, item.id, handle); clearLocalHandles(owner)
    expect(getLocalHandle(owner, item.id)).toBeUndefined()
    expect(loadLocalHistory(owner).history.sessions).toHaveLength(1)
  })
})

describe('project-first local history', () => {
  function legacyRow(item: LocalSession) {
    const { projectId: _projectId, kind: _kind, ...row } = item
    return row
  }

  it('stores independent chat and agent conversations inside one stable project', () => {
    const project = createLocalProject('source-code', '我的网站')
    const chat = createLocalSessionForProject(project)
    const agent = createLocalSessionForProject(project, 'agent')
    chat.title = '设计讨论'; chat.draft = '讨论布局'; chat.turns = sample().turns
    agent.title = '修改导航'; agent.transcript = structuredClone(completed)
    const saved: LocalHistory = { projects: [project], sessions: [chat, agent], activeProjectId: project.id, activeId: agent.id }
    expect(saveLocalHistory(owner, saved).ok).toBe(true)
    const loaded = loadLocalHistory(owner)
    expect(loaded.error).toBeNull()
    expect(loaded.history.projects).toEqual([project])
    expect(loaded.history.activeProjectId).toBe(project.id)
    expect(loaded.history.activeId).toBe(agent.id)
    expect(loaded.history.sessions.find(item => item.id === chat.id)).toEqual(chat)
    expect(loaded.history.sessions.find(item => item.id === agent.id)).toEqual(agent)
    expect(agent.turns).toEqual([])
    expect(chat.transcript).toEqual([])
    expect(chat.kind).toBe('chat')
    expect(agent.kind).toBe('agent')
    expect(JSON.parse(disk.get(key())!).version).toBe(2)
  })

  it('preserves the project and shared directory handle when its last conversation is deleted', () => {
    const project = createLocalProject('source-code')
    const first = createLocalSessionForProject(project)
    const second = createLocalSessionForProject(project, 'agent')
    const handle = { kind: 'directory', name: project.directoryName } as LocalDirectoryHandle
    rememberProjectHandle(owner, project.id, handle)
    rememberLocalHandle(owner, first.id, handle)
    const saved: LocalHistory = { projects: [project], sessions: [first, second], activeProjectId: project.id, activeId: first.id }
    saveLocalHistory(owner, saved)
    saved.sessions = [second]; saved.activeId = second.id
    expect(saveLocalHistory(owner, saved).ok).toBe(true)
    expect(getLocalHandle(owner, first.id)).toBeUndefined()
    expect(getProjectHandle(owner, project.id)).toBe(handle)
    saved.sessions = []; saved.activeId = null
    expect(saveLocalHistory(owner, saved).ok).toBe(true)
    expect(loadLocalHistory(owner).history).toEqual(saved)
    expect(disk.has(key())).toBe(true)
    expect(getProjectHandle(owner, project.id)).toBe(handle)
    expect(saveLocalHistory(owner, history()).ok).toBe(true)
    expect(getProjectHandle(owner, project.id)).toBeUndefined()
    expect(disk.has(key())).toBe(false)
  })

  it('keeps same-named directories separate and project handles isolated by account', () => {
    const first = createLocalProject('app')
    const second = createLocalProject('app')
    expect(first.id).not.toBe(second.id)
    const handle = { kind: 'directory', name: 'app' } as LocalDirectoryHandle
    rememberProjectHandle(owner, first.id, handle)
    expect(getProjectHandle(owner, second.id)).toBeUndefined()
    expect(getProjectHandle('other', first.id)).toBeUndefined()
    expect(saveLocalHistory(owner, { ...history(), projects: [first, second], activeProjectId: first.id }).ok).toBe(true)
    expect(loadLocalHistory(owner).history.projects).toHaveLength(2)
    expect(loadLocalHistory('other').history.projects).toEqual([])
    forgetProjectHandle(owner, first.id)
    expect(getProjectHandle(owner, first.id)).toBeUndefined()
    rememberProjectHandle(owner, first.id, handle); clearLocalHandles(owner)
    expect(getProjectHandle(owner, first.id)).toBeUndefined()
    expect(loadLocalHistory(owner).history.projects).toHaveLength(2)
  })

  it('excludes runtime project handles and permission approval from persistent project data', () => {
    const project = createLocalProject('app')
    const handle = { kind: 'directory', name: 'app' } as LocalDirectoryHandle
    Object.assign(project, { handle, permissionMode: 'auto', writePermission: 'granted' })
    rememberProjectHandle(owner, project.id, handle)
    expect(saveLocalHistory(owner, { ...history(), projects: [project], activeProjectId: project.id }).ok).toBe(true)
    expect(disk.get(key())).not.toMatch(/writePermission|permissionMode|"handle"/)
  })

  it('migrates legacy sessions without merging identical directory labels or losing unassigned drafts', () => {
    const first = sample(); first.id = 'old-a'
    const second = sample(); second.id = 'old-b'
    const draft = createLocalSession(); draft.id = 'old-draft'; draft.draft = '稍后选择目录'
    const raw = JSON.stringify({ version: 1, owner, sessions: [first, second, draft].map(legacyRow), activeId: second.id })
    disk.set(key(), raw)
    const loaded = loadLocalHistory(owner)
    expect(loaded.error).toBeNull()
    expect(loaded.history.projects).toHaveLength(2)
    const migratedFirst = loaded.history.sessions.find(item => item.id === first.id)!
    const migratedSecond = loaded.history.sessions.find(item => item.id === second.id)!
    expect(migratedFirst.projectId).toBeTruthy()
    expect(migratedFirst.projectId).not.toBe(migratedSecond.projectId)
    expect(loaded.history.projects.every(item => item.directoryName === 'my-project')).toBe(true)
    expect(migratedFirst).toEqual({ ...first, projectId: migratedFirst.projectId, kind: 'agent' })
    expect(migratedSecond).toEqual({ ...second, projectId: migratedSecond.projectId, kind: 'agent' })
    expect(loaded.history.sessions.find(item => item.id === draft.id)).toMatchObject({ projectId: null, draft: draft.draft })
    expect(loaded.history.activeId).toBe(second.id)
    expect(loaded.history.activeProjectId).toBe(migratedSecond.projectId)
    expect(loadLocalHistory(owner).history).toEqual(loaded.history)
    expect(disk.get(key())).toBe(raw)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('retains the exact legacy snapshot until a version-two save succeeds', () => {
    const original = sample()
    const raw = JSON.stringify({ version: 1, owner, sessions: [legacyRow(original)], activeId: original.id })
    disk.set(key(), raw)
    const migrated = loadLocalHistory(owner).history
    storage.setItem.mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    expect(saveLocalHistory(owner, migrated).ok).toBe(false)
    expect(disk.get(key())).toBe(raw)
    storage.setItem.mockImplementation((target: string, value: string) => { disk.set(target, value) })
    expect(saveLocalHistory(owner, migrated).ok).toBe(true)
    expect(JSON.parse(disk.get(key())!).version).toBe(2)
    expect(loadLocalHistory(owner).history).toEqual(migrated)
  })

  it('does not overwrite an external update while a legacy migration is pending', () => {
    const item = sample()
    const raw = JSON.stringify({ version: 1, owner, sessions: [legacyRow(item)], activeId: item.id })
    disk.set(key(), raw)
    const migrated = loadLocalHistory(owner).history
    disk.set(key(), raw + ' ')
    expect(saveLocalHistory(owner, migrated)).toMatchObject({ ok: false, error: expect.stringContaining('其他页面更新') })
    expect(disk.get(key())).toBe(raw + ' ')
  })

  it('keeps conversations from malformed or missing projects in drafts with a recoverable warning', () => {
    const project = createLocalProject('app')
    const item = createLocalSessionForProject(project, 'agent'); item.draft = '保留这个草稿'; item.turns = sample().turns
    const raw = JSON.stringify({ version: 2, owner, projects: [{ ...project, name: null }], sessions: [item], activeProjectId: project.id, activeId: item.id })
    disk.set(key(), raw)
    const loaded = loadLocalHistory(owner)
    expect(loaded.error).toContain('已恢复其他记录')
    expect(loaded.history).toEqual({ ...history({ ...item, projectId: null }), activeId: item.id })
    expect(disk.get(key())).toBe(raw)
    expect(saveLocalHistory(owner, loaded.history).ok).toBe(true)
    expect(getLocalHistoryRecovery(owner)).toBe(raw)
  })

  it('rejects dangling project references on save instead of silently deleting or reassigning sessions', () => {
    const project = createLocalProject('app')
    const item = createLocalSessionForProject(project)
    const saved: LocalHistory = { projects: [project], sessions: [item], activeProjectId: project.id, activeId: item.id }
    saveLocalHistory(owner, saved)
    const previous = disk.get(key())
    expect(saveLocalHistory(owner, { ...saved, projects: [] })).toMatchObject({ ok: false, error: expect.stringContaining('关联的项目不存在') })
    expect(disk.get(key())).toBe(previous)
    expect(saveLocalHistory(owner, { ...saved, projects: [project, project] }).ok).toBe(false)
    expect(disk.get(key())).toBe(previous)
  })

  it('resolves the active conversation within the selected project and preserves a draft-only selection', () => {
    const first = createLocalProject('first'); const second = createLocalProject('second')
    const chat = createLocalSessionForProject(first); const agent = createLocalSessionForProject(second, 'agent'); const draft = createLocalSession()
    const saved: LocalHistory = { projects: [first, second], sessions: [chat, agent, draft], activeProjectId: first.id, activeId: agent.id }
    expect(saveLocalHistory(owner, saved).ok).toBe(true)
    expect(loadLocalHistory(owner).history).toMatchObject({ activeProjectId: first.id, activeId: chat.id })
    saved.activeProjectId = null; saved.activeId = draft.id
    expect(saveLocalHistory(owner, saved).ok).toBe(true)
    expect(loadLocalHistory(owner).history).toMatchObject({ activeProjectId: null, activeId: draft.id })
    saved.activeProjectId = second.id; saved.activeId = null
    expect(saveLocalHistory(owner, saved).ok).toBe(true)
    expect(loadLocalHistory(owner).history).toMatchObject({ activeProjectId: second.id, activeId: null })
  })

  it('exposes navigation metadata without conversation contents or empty orphan drafts', () => {
    const project = createLocalProject('app')
    const item = createLocalSessionForProject(project); item.draft = 'private draft'; item.turns = sample().turns; item.transcript = structuredClone(completed)
    const empty = createLocalSession(); const orphan = createLocalSession(); orphan.draft = 'unfinished'
    saveLocalHistory(owner, { projects: [project], sessions: [item, empty, orphan], activeId: item.id, activeProjectId: project.id })
    const metadata = readLocalHistoryMetadata(owner)
    expect(metadata.projects).toEqual([project])
    expect(metadata.sessions.map(row => row.id)).toEqual(expect.arrayContaining([item.id, orphan.id]))
    expect(metadata.sessions.some(row => row.id === empty.id)).toBe(false)
    expect(metadata.sessions[0]).not.toHaveProperty('turns')
    expect(metadata.sessions[0]).not.toHaveProperty('transcript')
    expect(metadata.sessions[0]).not.toHaveProperty('draft')
  })

  it('does not rebase optimistic editor saves when navigation reads newer storage', () => {
    const item = sample(); saveLocalHistory(owner, history(item)); loadLocalHistory(owner)
    const external = JSON.parse(disk.get(key())!); external.sessions[0].title = '其他标签页更新'
    const externalRaw = JSON.stringify(external); disk.set(key(), externalRaw)
    expect(readLocalHistoryMetadata(owner).sessions[0]!.title).toBe('其他标签页更新')
    expect(saveLocalHistory(owner, history(item))).toMatchObject({ ok: false, error: expect.stringContaining('其他页面更新') })
    expect(disk.get(key())).toBe(externalRaw)
  })

  it('keeps recovery protection established by an editor when navigation reads malformed storage', () => {
    const raw = '{broken'; disk.set(key(), raw); loadLocalHistory(owner)
    expect(readLocalHistoryMetadata(owner).error).toBeTruthy()
    expect(saveLocalHistory(owner, history(sample())).ok).toBe(true)
    expect(getLocalHistoryRecovery(owner)).toBe(raw)
  })

  it('notifies same-tab navigation after successful writes and deletions only', () => {
    const target = new EventTarget(); const changed = vi.fn(); target.addEventListener(LOCAL_HISTORY_CHANGED_EVENT, changed)
    vi.stubGlobal('window', target)
    expect(saveLocalHistory(owner, history(sample())).ok).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed.mock.calls[0]![0].detail).toEqual({ owner })
    storage.setItem.mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError') })
    expect(saveLocalHistory(owner, history(sample())).ok).toBe(false)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(saveLocalHistory(owner, history()).ok).toBe(true)
    expect(changed).toHaveBeenCalledTimes(2)
  })
})
