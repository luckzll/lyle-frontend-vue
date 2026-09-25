<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowUp, Bot, Check, ChevronDown, ChevronRight, Code, Download, FileCode, FolderOpen, FolderPlus, History, LoaderCircle, MessageSquare, Pencil, Plus, Search, ShieldCheck, Sparkles, Square, Trash2, X } from '@lucide/vue'
import { authState } from '@/auth'
import { workspaceStep } from '@/api/local-workspace'
import { CHAT_MODEL_OPTIONS, CHAT_MODEL_STORAGE_KEY, resolveChatModelId, type ChatModelId } from '@/domain/chat-model'
import LocalProjectText from '@/components/chat/LocalProjectText.vue'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'
import { LocalWorkspace, chooseLocalDirectory, takeLocalDrop, stageLocalDrop, type ChangePreview, type WorkspaceMessage, type LocalDirectoryHandle } from '@/domain/local-workspace'
import { createLocalProject, createLocalSessionForProject, loadLocalHistory, saveLocalHistory, getLocalHistoryRecovery, rememberProjectHandle, getProjectHandle, getLocalHandle, forgetLocalHandle, clearLocalHandles, type LocalProject, type LocalSession, type LocalTurn, type LocalActivity } from '@/domain/local-workspace-history'
import { takeDirectorySelection } from '@/domain/local-directory-selection'
import { canonicalLocalProjectQuery, parseLocalProjectRoute } from '@/domain/local-project-route'

type SessionKind = 'chat' | 'agent'
const route = useRoute(); const router = useRouter()
const owner = authState.user?.id
const loaded = owner == null ? { history: { projects: [] as LocalProject[], sessions: [] as LocalSession[], activeId: null, activeProjectId: null }, error: '请登录后使用本地项目' } : loadLocalHistory(owner)
const projects = ref<LocalProject[]>(loaded.history.projects)
const activeProjectId = ref(loaded.history.activeProjectId)
const activeProject = computed(() => projects.value.find(project => project.id === activeProjectId.value))
const sessions = ref<LocalSession[]>(loaded.history.sessions)
const activeId = ref(loaded.history.activeId)
const activeSession = computed(() => sessions.value.find(s => s.id === activeId.value))
const sessionKind = computed<SessionKind>(() => activeSession.value?.kind || 'agent')
const renaming = ref(false); const projectNameDraft = ref('')
const workspace = shallowRef<LocalWorkspace>()
const input = ref(''); const error = ref(''); const storageError = ref(loaded.error || '')
const loading = ref(false); const connecting = ref(false); const dragging = ref(false)
const hasRecovery = ref(owner != null && !!getLocalHistoryRecovery(owner))
const turns = ref<LocalTurn[]>([]); let transcript: WorkspaceMessage[] = []
const mode = ref<'read-only' | 'confirm' | 'auto'>('confirm'); const permissionBusy = ref(false)
const chatModelId = ref<ChatModelId>(resolveChatModelId(window.localStorage?.getItem(CHAT_MODEL_STORAGE_KEY)))
const modeLabels = { 'read-only': '仅查看', confirm: '修改前确认', auto: '允许直接修改' }
const permissionsOpen = ref(false); const permissionTrigger = ref<HTMLButtonElement>()
const railOpen = ref(false)
const projectSessions = (id: string) => sessions.value.filter(s => s.projectId === id).slice().sort((a, b) => b.updatedAt - a.updatedAt)
const tree = ref<{ name: string; kind: string; path: string }[]>([])
const treePath = ref(''); const treeOffset = ref(0); const nextOffset = ref<number | null>(null)
const preview = shallowRef<ChangePreview>(); const applying = ref(false)
const bottom = ref<HTMLElement>(); const scroller = ref<HTMLElement>(); const questionInput = ref<HTMLTextAreaElement>()
const deleteId = ref<string | null>(null)
const deleteProjectId = ref<string | null>(null)
const deleteProjectDescription = computed(() => {
  const project = projects.value.find(p => p.id === deleteProjectId.value)
  return `将从此浏览器移除项目“${project?.name || ''}”及其 ${projectSessions(deleteProjectId.value || '').length} 段对话记录，此操作不可撤销。本地文件夹及文件不会被删除。`
})
let controller: AbortController | null = null
let answerChange: ((accepted: boolean) => void) | null = null
let checkpoint = 0; let mounted = true; let restoring = false; let inactive = false
let browseRevision = 0
let routeReady = false; let applyingRoute = false; let internalRouteTarget: string | null = null
const handledRouteRequests = new Set<string>()
const isActive = () => mounted && !inactive && authState.user?.id === owner
let saveTimer: ReturnType<typeof setTimeout> | undefined
const busy = computed(() => loading.value || connecting.value || permissionBusy.value || applying.value)
const canSend = computed(() => !!activeSession.value && !!input.value.trim() && !busy.value && isActive())
const labels: Record<string, string> = { workspace_list: '查看目录', workspace_read: '读取文件', workspace_search: '搜索项目', workspace_edit: '修改文件', workspace_create: '新建文件' }
const suggestions = computed(() => sessionKind.value === 'chat' ? [
  { icon: MessageSquare, title: '讨论一个想法', detail: '先理清需求与实现思路', prompt: '我想和你讨论这个项目的一个想法：' },
  { icon: Search, title: '读懂这个项目', detail: '了解结构、用途与关键实现', prompt: '查看项目结构，按需读取关键文件，说明项目用途和启动入口。' },
  { icon: Code, title: '评审一段代码', detail: '解释问题，给出修改建议', prompt: '请分析项目代码，先给出改进建议，不修改文件。' }
] : [
  { icon: FolderOpen, title: '了解这个项目', detail: '梳理用途、结构与启动入口', prompt: '查看项目结构，按需读取关键文件，说明项目用途和启动入口。' },
  { icon: Search, title: '帮我排查问题', detail: '定位原因，给出修改建议', prompt: '请帮我排查这个项目的问题：' },
  { icon: Code, title: '一起改个功能', detail: '描述需求，查看实际修改', prompt: '我想修改一个功能：' }
])

function persist() {
  if (saveTimer) clearTimeout(saveTimer)
  if (owner == null || restoring || !isActive()) return false
  const session = activeSession.value
  if (session) {
    session.draft = input.value
    session.turns = JSON.parse(JSON.stringify(turns.value)) as LocalTurn[]
    session.transcript = JSON.parse(JSON.stringify(loading.value ? transcript.slice(0, checkpoint) : transcript)) as WorkspaceMessage[]
    if (turns.value[0]) session.title = turns.value[0].question.slice(0, 42)
  }
  const result = saveLocalHistory(owner, { projects: projects.value, sessions: sessions.value, activeId: activeId.value, activeProjectId: activeProjectId.value })
  storageError.value = result.error || ''
  if (result.ok) hasRecovery.value = !!getLocalHistoryRecovery(owner)
  return result.ok
}
function scheduleSave() {
  if (!isActive() || restoring) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persist, 350)
}
watch(input, () => { if (restoring || !isActive()) return; if (activeSession.value) activeSession.value.updatedAt = Date.now(); scheduleSave() }, { flush: 'sync' })
watch(turns, scheduleSave, { deep: true, flush: 'sync' })
watch(chatModelId, value => window.localStorage?.setItem(CHAT_MODEL_STORAGE_KEY, value))

async function scrollToBottom(force = false) {
  const el = scroller.value
  if (force || (el && el.scrollHeight - el.scrollTop - el.clientHeight < 180)) {
    await nextTick()
    bottom.value?.scrollIntoView({ block: 'end' })
  }
}
function resetConnection() {
  browseRevision++
  workspace.value = undefined; mode.value = 'confirm'; permissionsOpen.value = false
  tree.value = []; treePath.value = ''; treeOffset.value = 0; nextOffset.value = null
}
async function restoreSession(session: LocalSession) {
  restoring = true
  activeId.value = session.id
  activeProjectId.value = session.projectId
  renaming.value = false
  turns.value = JSON.parse(JSON.stringify(session.turns)) as LocalTurn[]
  transcript = JSON.parse(JSON.stringify(session.transcript)) as WorkspaceMessage[]
  input.value = session.draft; error.value = ''; resetConnection()
  restoring = false
  const handle = owner == null ? undefined : (session.projectId && getProjectHandle(owner, session.projectId)) || getLocalHandle(owner, session.id)
  if (handle) {
    try {
      if (await handle.queryPermission({ mode: 'read' }) === 'granted') {
        if (!isActive() || activeId.value !== session.id) return
        if (owner != null && session.projectId) rememberProjectHandle(owner, session.projectId, handle)
        workspace.value = new LocalWorkspace(handle)
        mode.value = workspace.value.permissions.mode
        await browse('')
      }
    } catch { /* The history remains readable even when the directory is unavailable. */ }
  }
  if (turns.value.length) await scrollToBottom(true)
  else { await nextTick(); if (scroller.value) scroller.value.scrollTop = 0 }
}
async function selectSession(session: LocalSession) {
  if (busy.value || session.id === activeId.value) return
  persist(); connecting.value = true; railOpen.value = false
  try { await restoreSession(session); persist() } finally { connecting.value = false }
  await syncActiveRoute()
}
async function selectProject(project: LocalProject) {
  if (busy.value) return
  const current = activeSession.value?.projectId === project.id ? activeSession.value : projectSessions(project.id)[0]
  if (current) { await selectSession(current); return }
  persist()
  restoring = true; activeProjectId.value = project.id; activeId.value = null
  turns.value = []; transcript = []; input.value = ''; resetConnection(); restoring = false
  persist(); railOpen.value = false
  await syncActiveRoute()
}
async function newSession(project = activeProject.value, force = false) {
  if (busy.value || !project) return
  if (!force && activeSession.value && !turns.value.length && !input.value && activeSession.value.projectId === project.id) {
    activeSession.value.kind = 'agent'
    if (workspace.value) await workspace.value.permissions.select('confirm')
    mode.value = 'confirm'; permissionsOpen.value = false; persist()
    railOpen.value = false; await syncActiveRoute(); await nextTick(); questionInput.value?.focus(); return
  }
  persist()
  const session = createLocalSessionForProject(project)
  sessions.value.unshift(session)
  project.updatedAt = Date.now()
  connecting.value = true
  try { await restoreSession(session); persist() } finally { connecting.value = false }
  railOpen.value = false
  await syncActiveRoute()
  await nextTick(); questionInput.value?.focus()
}
async function connect(reconnect = false, supplied?: LocalDirectoryHandle | null) {
  if (busy.value) return
  const reconnectProject = reconnect ? activeProject.value : undefined
  connecting.value = true
  try {
    error.value = ''
    const root = supplied || await chooseLocalDirectory()
    if (!isActive()) return
    if (reconnectProject && root.name !== reconnectProject.directoryName) {
      throw new Error('请选择原目录“' + reconnectProject.directoryName + '”。其他目录请通过“添加项目”单独打开。')
    }
    const knownHandle = reconnectProject && owner != null ? getProjectHandle(owner, reconnectProject.id) : undefined
    if (knownHandle?.isSameEntry && !await knownHandle.isSameEntry(root)) throw new Error('这不是当前项目连接的目录，请选择原目录，或添加为独立项目。')
    if (await root.queryPermission({ mode: 'read' }) !== 'granted' && await root.requestPermission({ mode: 'read' }) !== 'granted') throw new Error('没有获得目录读取权限')
    if (!isActive()) return
    persist()
    let project = reconnectProject
    if (!project && owner != null) {
      for (const candidate of projects.value) {
        const handle = getProjectHandle(owner, candidate.id)
        if (handle && (handle === root || await handle.isSameEntry?.(root))) { project = candidate; break }
      }
    }
    if (!isActive()) return
    if (!project) { project = createLocalProject(root.name); projects.value.unshift(project) }
    if (owner != null) rememberProjectHandle(owner, project.id, root)
    const session = activeSession.value?.projectId === project.id ? activeSession.value : projectSessions(project.id)[0] || createLocalSessionForProject(project)
    if (!sessions.value.some(s => s.id === session.id)) sessions.value.unshift(session)
    await restoreSession(session)
    if (!isActive()) return
    project.updatedAt = Date.now(); railOpen.value = false
    persist()
    await nextTick(); questionInput.value?.focus()
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) error.value = e instanceof Error ? e.message : '目录连接失败，请重新选择'
  } finally { connecting.value = false }
  await syncActiveRoute()
}

async function syncActiveRoute() {
  if (!routeReady || applyingRoute || !isActive()) return
  const target = router.resolve({ name: 'local-project', query: canonicalLocalProjectQuery(activeProjectId.value, activeId.value), hash: route.hash })
  if (target.fullPath === route.fullPath) return
  internalRouteTarget = target.fullPath
  try { await router.replace(target.fullPath) }
  finally { if (internalRouteTarget === target.fullPath) internalRouteTarget = null }
}

async function applyRouteQuery(query: Record<string, unknown>) {
  if (!routeReady || applyingRoute || busy.value || !isActive()) return
  applyingRoute = true
  try {
    const requested = parseLocalProjectRoute(query)
    if (requested.error) { error.value = requested.error; return }
    const project = requested.projectId ? projects.value.find(item => item.id === requested.projectId) : undefined
    if (requested.projectId && !project) { error.value = '此项目已不在当前记录中；如在其他页面更新过，请先导出当前对话再刷新'; return }
    if (requested.action) {
      const actionKey = requested.action + ':' + requested.request
      if (handledRouteRequests.has(actionKey)) return
      handledRouteRequests.add(actionKey)
      if (requested.action === 'add-project') await connect(false, takeDirectorySelection(requested.request!, String(owner)))
      else if (requested.action === 'delete-project' && project) deleteProjectId.value = project.id
      else if (requested.action === 'delete-session') {
        const session = sessions.value.find(item => item.id === requested.sessionId)
        if (!session || (project && session.projectId !== project.id)) { error.value = '此对话已被移除或不属于该项目'; return }
        deleteId.value = session.id
      }
      else if (project) await newSession(project, true)
      return
    }
    if (requested.sessionId) {
      const session = sessions.value.find(item => item.id === requested.sessionId)
      if (!session || (project && session.projectId !== project.id)) {
        error.value = '此对话与项目不匹配或已被移除；如在其他页面更新过，请先导出当前对话再刷新'
        return
      }
      await selectSession(session)
    } else if (project) {
      const latest = projectSessions(project.id)[0]
      if (latest) await selectSession(latest)
      else await selectProject(project)
    }
  } finally { applyingRoute = false; await syncActiveRoute() }
}

onBeforeRouteUpdate(to => {
  if (to.fullPath !== internalRouteTarget && (busy.value || applyingRoute)) {
    error.value = '请先停止当前任务或完成目录授权，再切换项目对话'
    return false
  }
})
watch(() => route.fullPath, () => {
  if (routeReady && route.fullPath !== internalRouteTarget) void applyRouteQuery(route.query)
})

function beginRename() {
  if (!activeProject.value || busy.value) return
  projectNameDraft.value = activeProject.value.name; renaming.value = true
}
function renameProject() {
  if (!activeProject.value || !projectNameDraft.value.trim() || busy.value) return
  activeProject.value.name = projectNameDraft.value.trim().slice(0, 80)
  activeProject.value.updatedAt = Date.now(); renaming.value = false; persist()
}
function showFiles() { railOpen.value = true }
async function browse(path: string, offset = 0) {
  const revision = ++browseRevision
  const activeWorkspace = workspace.value
  const sessionId = activeId.value
  try {
    const result = await activeWorkspace?.list(path, offset)
    if (!result || !isActive() || workspace.value !== activeWorkspace || activeId.value !== sessionId || revision !== browseRevision) return
    treePath.value = path; treeOffset.value = offset; tree.value = result.entries; nextOffset.value = result.nextOffset
    if (result.scanCapped) error.value = '该目录条目较多，仅列出前 3000 项；可进入具体子目录读取。'
  } catch { if (isActive() && workspace.value === activeWorkspace && revision === browseRevision) error.value = '目录不可用，请重新连接项目' }
}
async function selectMode(next: 'read-only' | 'confirm' | 'auto') {
  if (sessionKind.value !== 'agent' || !workspace.value || loading.value || permissionBusy.value) return
  const activeWorkspace = workspace.value
  permissionBusy.value = true; error.value = ''
  try {
    await activeWorkspace.permissions.select(next)
    if (!isActive() || workspace.value !== activeWorkspace) return
    mode.value = activeWorkspace.permissions.mode
    permissionsOpen.value = false; permissionTrigger.value?.focus()
  } catch (e) { if (isActive() && workspace.value === activeWorkspace) error.value = e instanceof Error ? e.message : '授权失败，权限未改变' }
  finally { permissionBusy.value = false }
}
function stop() {
  controller?.abort(); answerChange?.(false); answerChange = null; preview.value = undefined
}
async function applyPreview() {
  if (!preview.value || !workspace.value || applying.value) return
  const activeWorkspace = workspace.value
  const change = preview.value
  const resolveChange = answerChange
  const signal = controller?.signal
  applying.value = true; error.value = ''
  try {
    await activeWorkspace.permissions.authorizeConfirmedWrite()
    if (!isActive() || signal?.aborted || workspace.value !== activeWorkspace || preview.value !== change || answerChange !== resolveChange) return
    resolveChange?.(true)
  } catch (e) { if (isActive() && preview.value === change) error.value = e instanceof Error ? e.message : '无法获得写入权限' }
  finally { applying.value = false }
}
function rejectPreview() { answerChange?.(false) }
async function useSuggestion(prompt: string) { if (!activeSession.value) await newSession(); input.value = prompt; railOpen.value = false; await nextTick(); questionInput.value?.focus() }
function composerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void send()
}
async function send() {
  if (!canSend.value) return
  const activeWorkspace = workspace.value
  const executionKind = sessionKind.value
  const question = input.value.trim(); input.value = ''; error.value = ''; checkpoint = transcript.length; loading.value = true
  controller = new AbortController(); const signal = controller.signal
  const turn: LocalTurn = { question, answer: '', activities: [], open: true, completed: false }
  turns.value.push(turn); const current = turns.value[turns.value.length - 1]!
  activeSession.value!.updatedAt = Date.now()
  if (activeProject.value) activeProject.value.updatedAt = Date.now()
  const rejectedPaths = new Set<string>()
  transcript.push({ role: 'user', content: question }); persist(); await scrollToBottom(true)
  try {
    for (let step = 0; step < 16; step++) {
      signal.throwIfAborted()
      if (JSON.stringify(transcript).length > 200_000) throw new Error('本地上下文已满，请新建对话；当前记录和文件会保留')
      let commentary = ''
      const modelActivity: LocalActivity = { label: '分析下一步', status: 'running' }
      current.activities.push(modelActivity)
      const activity = current.activities[current.activities.length - 1]!
      const result = await workspaceStep(transcript, signal, text => { commentary += text; activity.detail = commentary; void scrollToBottom() }, { mode: executionKind, workspaceConnected: !!activeWorkspace, modelId: chatModelId.value })
      signal.throwIfAborted()
      activity.status = 'done'; transcript.push(result)
      if (!result.tool_calls?.length) {
        current.answer = result.content; current.activities.pop(); current.completed = true; current.open = false
        break
      }
      const seen = new Set<string>()
      for (const call of result.tool_calls) {
        signal.throwIfAborted()
        if (!call.id || seen.has(call.id) || !labels[call.name] || !call.args || typeof call.args !== 'object') throw new Error('模型返回了无效的工具请求，已停止')
        seen.add(call.id)
        current.activities.push({ label: labels[call.name]!, path: String(call.args.path || '/'), status: 'running' })
        const row = current.activities[current.activities.length - 1]!
        let outcome: unknown
        try {
          if (!activeWorkspace) throw new Error('目录未连接，请先基于已有对话回答；需要读取文件时请提示用户重新连接目录。')
          if (call.name === 'workspace_edit' || call.name === 'workspace_create') {
            if (executionKind !== 'agent') throw new Error('聊天模式不会修改文件。请只提供分析和建议，执行修改需要用户新建智能体对话。')
            if (mode.value === 'read-only') throw new Error('当前为仅查看权限，文件未修改。请提供分析或建议，不要继续请求写入。')
            if (rejectedPaths.has(String(call.args.path))) throw new Error('用户已拒绝此文件的修改，本轮不再申请')
            const change = await activeWorkspace.preview(call)
            signal.throwIfAborted()
            if (mode.value === 'auto') {
              outcome = await activeWorkspace.apply(change, signal); row.detail = '已按授权直接写入，并复核文件内容'
            } else {
              preview.value = change; row.status = 'waiting'; await scrollToBottom(true)
              const accepted = await new Promise<boolean>(resolve => { answerChange = resolve })
              answerChange = null; preview.value = undefined; signal.throwIfAborted()
              if (accepted) { row.status = 'running'; outcome = await activeWorkspace.apply(change, signal, { confirmed: true }); row.detail = '已确认写入，并复核文件内容' }
              else { rejectedPaths.add(change.path); outcome = { status: 'rejected', message: '用户拒绝此修改，文件未写入。不得重试这项修改。' }; row.detail = '已拒绝，文件未修改' }
            }
          } else outcome = await activeWorkspace.executeRead(call, signal)
          row.status = 'done'
        } catch (e) {
          if (signal.aborted) throw e
          const message = e instanceof Error ? e.message : '文件操作失败'
          outcome = { status: 'error', message }; row.status = 'error'; row.detail = message
        }
        transcript.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome) })
        void scrollToBottom()
      }
      if (step === 15) throw new Error('已达到本轮 16 步上限；已完成的文件修改保留，请检查后继续')
    }
  } catch (e) {
    const message = signal.aborted ? executionKind === 'chat' ? '对话已停止。' : '任务已停止，已完成的文件修改保留。' : e instanceof Error ? e.message : '任务失败'
    error.value = message
    current.activities.push({ label: message, status: 'error' })
    transcript.splice(checkpoint)
    for (const activity of current.activities) if (activity.status === 'running' || activity.status === 'waiting') activity.status = 'error'
  } finally {
    loading.value = false; controller = null; answerChange = null; preview.value = undefined
    if (isActive()) { persist(); await scrollToBottom(); await browse(treePath.value, treeOffset.value) }
  }
}
async function drop(event: DragEvent) {
  dragging.value = false
  if (loading.value || connecting.value || !event.dataTransfer) return
  if (!stageLocalDrop(event.dataTransfer)) { error.value = '请拖入一个项目文件夹，或点击“连接目录”'; return }
  try {
    const handle = await takeLocalDrop()
    if (!handle) { error.value = '当前拖拽无法获得目录权限，请点击“连接目录”选择目录'; return }
    await connect(false, handle)
  } catch { error.value = '目录连接失败，请点击按钮重新选择' }
}
function exportConversation() {
  const session = activeSession.value
  if (!session) return
  const text = '# ' + session.title + '\n\n项目：' + (activeProject.value?.name || session.projectName || '未归类') + '\n\n模式：' + (session.kind === 'chat' ? '聊天' : '智能体') + '\n\n' + turns.value.map(turn =>
    '## 我\n\n' + turn.question + '\n\n## Lyle AI\n\n' + (turn.answer || '（本轮未完成）') + '\n\n' +
    (turn.activities.length ? '### 执行记录\n\n' + turn.activities.map(a => '- ' + a.label + (a.path ? ' · ' + a.path : '') + (a.detail ? '\n  ' + a.detail : '')).join('\n') : '')
  ).join('\n\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url
  anchor.download = (session.projectName || '本地项目').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '-对话.md'
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function exportRecovery() {
  if (owner == null) return
  const raw = getLocalHistoryRecovery(owner)
  if (!raw) return
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = '本地对话-原始恢复记录.json'
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function removeLocalRecords(projectId: string | null, sessionId: string | null) {
  if (busy.value || owner == null || !isActive() || !persist()) return false
  const remainingProjects = projects.value.filter(p => p.id !== projectId)
  const remainingSessions = sessions.value.filter(s => projectId ? s.projectId !== projectId : s.id !== sessionId)
  const removedActive = !remainingSessions.some(s => s.id === activeId.value)
  const nextProjectId = activeProjectId.value === projectId ? remainingProjects[0]?.id || null : activeProjectId.value
  const next = removedActive ? remainingSessions.filter(s => s.projectId === nextProjectId).sort((a,b) => b.updatedAt-a.updatedAt)[0] : activeSession.value
  const result = saveLocalHistory(owner, { projects: remainingProjects, sessions: remainingSessions, activeProjectId: nextProjectId, activeId: next?.id || null })
  if (!result.ok) { storageError.value = result.error || '删除未保存，请重试'; return false }
  projects.value = remainingProjects; sessions.value = remainingSessions
  if (removedActive) {
    connecting.value = true
    try {
      if (next) await restoreSession(next)
      else {
        restoring = true; activeId.value = null; activeProjectId.value = nextProjectId
        turns.value = []; transcript = []; input.value = ''; resetConnection(); restoring = false
      }
    } finally { connecting.value = false }
  }
  storageError.value = ''; await syncActiveRoute(); return true
}
async function deleteConversation() {
  if (deleteId.value && await removeLocalRecords(null, deleteId.value)) deleteId.value = null
}
async function deleteProject() {
  if (deleteProjectId.value && await removeLocalRecords(deleteProjectId.value, null)) deleteProjectId.value = null
}
function leave() {
  stop()
  void workspace.value?.permissions.select('confirm')
  mode.value = 'confirm'; permissionsOpen.value = false
  for (const turn of turns.value) for (const activity of turn.activities) {
    if (activity.status === 'running' || activity.status === 'waiting') activity.status = 'error'
  }
  persist()
}
function onPageHide() { leave() }
watch(() => authState.user?.id, value => {
  if (value !== owner) {
    inactive = true; stop(); if (saveTimer) clearTimeout(saveTimer)
    if (owner != null) clearLocalHandles(owner)
    resetConnection(); projects.value = []; activeProjectId.value = null; sessions.value = []; turns.value = []; input.value = ''; transcript = []; activeId.value = null
  }
}, { flush: 'sync' })
onMounted(async () => {
  window.addEventListener('pagehide', onPageHide)
  connecting.value = true
  try {
    const project = activeProject.value || projects.value[0]
    const previous = activeSession.value
    let session = previous && (previous.projectId || previous.turns.length || previous.draft)
      ? previous
      : (project ? projectSessions(project.id)[0] : sessions.value.find(s => s.turns.length || s.draft))
    if (session) await restoreSession(session)
    else { activeId.value = null; activeProjectId.value = project?.id || null }
    if (!loaded.error) persist()
  } finally { connecting.value = false }
  const handle = await takeLocalDrop().catch(() => null)
  if (handle) await connect(false, handle)
  routeReady = true
  await applyRouteQuery(route.query)
})
onBeforeRouteLeave(() => { leave(); inactive = true })
onBeforeUnmount(() => { leave(); mounted = false; if (saveTimer) clearTimeout(saveTimer); window.removeEventListener('pagehide', onPageHide) })
</script>

<template>
  <section class="local-project page" :class="{ dragging }" aria-label="本地项目工作区" @dragover.prevent="dragging = true" @dragleave.self="dragging = false" @drop.prevent="drop">
    <button v-if="railOpen" class="rail-scrim" aria-label="关闭项目文件" @click="railOpen = false" />
    <aside class="project-rail" :class="{ 'is-open': railOpen }" aria-label="当前项目文件" @keydown.esc="railOpen = false">
      <div class="rail-heading"><span>项目文件</span><button class="icon-button" aria-label="关闭项目文件" @click="railOpen = false"><X :size="18" /></button></div>
      <div class="project-tree">
        <template v-if="workspace">
          <div class="tree-location"><button class="icon-button" :disabled="!treePath" aria-label="返回上一级目录" @click="browse(treePath.split('/').slice(0, -1).join('/'))"><ArrowLeft :size="15" /></button><span :title="treePath">{{ treePath || workspace.root.name }}</span></div>
          <button v-for="item in tree" :key="item.path" class="tree-file" :disabled="loading" :title="item.kind === 'directory' ? '打开目录' : '在对话中询问此文件'" @click="item.kind === 'directory' ? browse(item.path) : useSuggestion('请分析文件 ' + item.path + ' 的用途和实现。')"><FolderOpen v-if="item.kind === 'directory'" :size="15" /><FileCode v-else :size="15" /><span :title="item.name">{{ item.name }}</span><ChevronRight v-if="item.kind === 'directory'" :size="14" /></button>
          <p v-if="!tree.length" class="rail-empty">这个目录没有可展示的源码文件</p>
          <div class="tree-pagination"><button v-if="treeOffset" @click="browse(treePath, Math.max(0, treeOffset - 100))">上一页</button><button v-if="nextOffset !== null" @click="browse(treePath, nextOffset)">下一页</button></div>
          <p class="file-help">文件按需读取；依赖、构建产物和隐藏凭据会跳过。</p>
        </template>
        <div v-else class="rail-empty"><FolderOpen :size="24" /><p>{{ activeProject?.directoryName || '选择项目后查看文件' }}</p><button v-if="activeProject" class="text-button" :disabled="busy" @click="connect(true)">重新连接目录</button></div>
      </div>
    </aside>

    <div class="project-main">
      <header class="workspace-toolbar">
        <span class="folder-icon"><FolderOpen :size="22" /></span>
        <div class="project-identity">
          <form v-if="renaming" class="project-name-form" @submit.prevent="renameProject"><input v-model="projectNameDraft" aria-label="项目名称" maxlength="80" autofocus @keydown.esc="renaming = false" /><button class="icon-button" type="submit" aria-label="保存项目名称" :disabled="!projectNameDraft.trim()"><Check :size="16" /></button><button class="icon-button" type="button" aria-label="取消重命名" @click="renaming = false"><X :size="16" /></button></form>
          <div v-else class="project-title-row"><h1>{{ activeProject?.name || (activeSession ? '历史对话' : '项目工作区') }}</h1><button v-if="activeProject" class="icon-button rename-project" :disabled="busy" aria-label="重命名项目" @click="beginRename"><Pencil :size="13" /></button></div>
          <p><span class="connection-dot" :class="{ connected: workspace }" />{{ activeProject ? activeProject.directoryName + (workspace ? ' · 已连接' : ' · 未连接') : '每个文件夹一个项目，每段对话单独保留' }}</p>
        </div>
        <button v-if="activeProject" class="secondary directory-button" :disabled="busy" @click="workspace ? showFiles() : connect(true)"><FolderOpen :size="14" />{{ connecting ? '连接中…' : workspace ? '项目文件' : '连接目录' }}</button>
        <div v-if="activeProject && sessionKind === 'agent'" class="permission-control" @keydown.esc="permissionsOpen = false; permissionTrigger?.focus()">
          <button ref="permissionTrigger" class="permission-trigger" :class="{ automatic: mode === 'auto' }" :aria-expanded="permissionsOpen" aria-controls="local-permissions" @click="permissionsOpen = !permissionsOpen"><ShieldCheck :size="16" /><span>{{ modeLabels[mode] }}</span><ChevronDown :size="14" /></button>
          <div v-if="permissionsOpen" id="local-permissions" class="permission-popover">
            <div class="popover-heading"><strong>文件访问权限</strong><button class="icon-button" aria-label="关闭权限设置" @click="permissionsOpen = false; permissionTrigger?.focus()"><X :size="16" /></button></div>
            <p class="permission-scope">{{ workspace ? '仅作用于 ' + workspace.root.name : '请先连接项目目录' }}</p>
            <button v-for="choice in (['read-only', 'confirm', 'auto'] as const)" :key="choice" class="permission-option" :class="{ selected: mode === choice }" :aria-pressed="mode === choice" :disabled="!workspace || loading || permissionBusy" @click="selectMode(choice)">
              <span><strong>{{ modeLabels[choice] }}</strong><small>{{ choice === 'read-only' ? '分析和读取文件，不写入' : choice === 'confirm' ? '先预览变更，由你逐项确认' : '授权后，AI 可直接修改和新建源码文件' }}</small></span><Check v-if="mode === choice" :size="17" />
            </button>
            <p class="permission-help">权限仅用于当前连接。切换对话、返回或刷新后恢复为“修改前确认”。不支持删除文件或运行命令。</p>
            <p v-if="loading" class="permission-help">任务进行中，请先停止任务再更改权限。</p>
          </div>
        </div>
        <button v-if="activeProject" class="secondary toolbar-new-chat" :disabled="busy" @click="newSession()"><Plus :size="15" />新对话</button>
      </header>

      <div v-if="!workspace && activeProject" class="reconnect-note"><FolderOpen :size="17" /><p><strong>项目目录未连接。</strong> 可以先讨论任务；读取或修改文件前，请重新连接“{{ activeProject.directoryName }}”。</p></div>
      <div v-if="mode === 'auto'" class="auto-note"><ShieldCheck :size="16" /><span>已允许 AI 直接修改当前目录；每次写入仍会检查文件冲突。</span></div>
      <div v-if="activeSession" class="conversation-bar"><span><span class="session-kind-badge"><Bot v-if="sessionKind === 'agent'" :size="13" /><MessageSquare v-else :size="13" />{{ sessionKind === 'agent' ? '智能体' : '聊天' }}</span>{{ activeSession.title || '新对话' }}</span><div class="conversation-actions"><button class="text-button" :disabled="!turns.length" @click="exportConversation"><Download :size="14" />导出对话</button><button class="icon-button" :disabled="busy" aria-label="删除当前项目对话" title="删除当前对话" @click="deleteId = activeSession.id"><Trash2 :size="14" /></button></div></div>

      <div ref="scroller" class="conversation-scroll">
        <div class="conversation-content">
          <section v-if="!turns.length" class="project-empty" :class="{ 'without-project': !activeProject }">
            <span class="welcome-icon"><FolderOpen :size="30" /></span>
            <p class="eyebrow-label">{{ activeProject ? activeProject.name : '从一个项目开始，把工作接着做' }}</p>
            <h2>{{ !activeProject ? '每个项目，都有自己的工作空间' : sessionKind === 'chat' ? '先聊想法，再决定怎么做' : '把任务交给智能体' }}</h2>
            <p>{{ !activeProject ? '添加本地文件夹，在项目里讨论方案、执行修改，随时找回每段对话。' : sessionKind === 'chat' ? '讨论需求、理解代码、比较方案。聊天模式只分析和读取文件。' : '描述需要完成的改动，逐步查看执行过程和文件变更。' }}</p>
            <button v-if="!activeProject" class="connect-button" :disabled="busy" @click="connect()"><FolderPlus :size="17" />添加本地项目</button>
            <div v-if="activeProject" class="starter-grid"><button v-for="item in suggestions" :key="item.title" :disabled="busy" @click="useSuggestion(item.prompt)"><component :is="item.icon" :size="19" /><strong>{{ item.title }}</strong><small>{{ item.detail }}</small><ArrowUp :size="15" class="starter-arrow" /></button></div>
            <div v-else class="workspace-intro"><div><MessageSquare :size="22" /><strong>聊天</strong><span>围绕项目讨论和分析</span></div><div><Bot :size="22" /><strong>智能体</strong><span>按权限完成文件修改</span></div><div><History :size="22" /><strong>项目历史</strong><span>不同对话分别保存</span></div></div>
            <p class="empty-hint">{{ !activeProject ? '也可以拖入文件夹 · 文件访问需桌面版 Chrome / Edge' : sessionKind === 'chat' ? '需要执行修改时，在下方切换到智能体对话。' : '当前支持源码读取、新建和修改；命令执行暂未接入。' }}</p>
          </section>
          <article v-for="(turn, index) in turns" :key="index" class="project-turn">
            <p class="user-message">{{ turn.question }}</p>
            <div class="assistant-label"><span class="assistant-mark"><Bot v-if="sessionKind === 'agent'" :size="15" /><span v-else>L</span></span><strong>{{ sessionKind === 'agent' ? 'Lyle 智能体' : 'Lyle AI' }}</strong><span v-if="loading && index === turns.length - 1" role="status">{{ preview ? '等待你确认修改' : '正在处理' }}</span></div>
            <details v-if="turn.activities.length" :open="turn.open" class="process"><summary @click.prevent="turn.open = !turn.open"><ChevronRight :size="14" :class="{ expanded: turn.open }" /><LoaderCircle v-if="loading && index === turns.length - 1" :size="14" class="spin" /><span>执行过程 · {{ turn.completed ? '已完成' : loading && index === turns.length - 1 ? preview ? '待确认' : '进行中' : '已停止' }}</span><small>{{ turn.activities.length }} 项</small></summary>
              <div v-for="(activity, activityIndex) in turn.activities" :key="activityIndex" class="activity" :class="{ 'activity-error': activity.status === 'error' }"><LoaderCircle v-if="activity.status === 'running'" :size="15" class="spin" /><X v-else-if="activity.status === 'error'" :size="15" /><Check v-else-if="activity.status === 'done'" :size="15" /><Square v-else :size="15" /><div><span>{{ activity.label }}</span><code v-if="activity.path">{{ activity.path }}</code><small v-if="activity.status === 'waiting'">等待你确认修改</small><p v-if="activity.detail">{{ activity.detail }}</p></div></div>
            </details>
            <LocalProjectText v-if="turn.answer" class="final-answer" :text="turn.answer" />
            <p v-else-if="!loading || index !== turns.length - 1" class="stopped-note">本轮未完成，可以继续提问。{{ sessionKind === 'agent' ? '已写入的文件修改保留。' : '' }}</p>
          </article>
          <section v-if="preview" class="change-card" aria-label="本地修改预览"><h2>{{ preview.hash === null ? '新建文件' : '确认修改' }} <code>{{ preview.path }}</code></h2><p>确认后写入当前目录；若文件已变化，将停止写入。</p><div class="diff-grid"><div v-if="preview.hash !== null"><small>原内容</small><pre>{{ preview.oldText }}</pre></div><div><small>{{ preview.hash === null ? '文件内容' : '替换为' }}</small><pre>{{ preview.newText }}</pre></div></div><footer><button class="secondary" :disabled="applying" @click="rejectPreview">不修改</button><button class="connect-button" :disabled="applying" @click="applyPreview">{{ applying ? '正在授权…' : '应用到本地文件' }}</button></footer></section>
          <div ref="bottom" />
        </div>
      </div>
      <div class="composer-dock">
        <button v-if="hasRecovery" class="text-button recovery-export" @click="exportRecovery"><Download :size="13" />导出此前未能读取的原始记录</button>
        <p v-if="storageError" class="error-note" role="alert"><strong>记录尚未保存：</strong>{{ storageError }} <button class="text-button" :disabled="!turns.length" @click="exportConversation">导出备份</button><button class="text-button" @click="persist">重试保存</button></p>
        <p v-if="error" class="error-note" role="alert">{{ error }}<button class="icon-button" aria-label="关闭提示" @click="error = ''"><X :size="15" /></button></p>
        <form v-if="activeSession" class="local-composer" @submit.prevent="send">
          <div class="composer-settings">
            <span class="workspace-agent-label"><Bot :size="15" />智能体</span>
            <label class="workspace-model-picker">
              <Sparkles :size="15" aria-hidden="true" />
              <span class="sr-only">项目对话模型</span>
              <select v-model="chatModelId" aria-label="项目对话模型" :disabled="busy">
                <option v-for="option in CHAT_MODEL_OPTIONS" :key="option.id" :value="option.id">{{ option.name }}</option>
              </select>
              <ChevronDown :size="14" aria-hidden="true" />
            </label>
            <span class="composer-mode-hint">{{ workspace ? modeLabels[mode] : '未连接目录 · 可先讨论' }}</span>
          </div>
          <label class="sr-only" for="local-question">项目任务</label>
          <textarea id="local-question" ref="questionInput" v-model="input" :disabled="loading || connecting" :placeholder="workspace ? '描述任务或提问，智能体会按需读取和修改…' : '描述任务或先提问；需要文件时再连接目录…'" rows="2" @keydown="composerKeydown" />
          <footer><span class="composer-mode"><FolderOpen :size="14" />{{ activeProject?.name || '历史对话' }}<span class="mode-label">{{ workspace ? modeLabels[mode] : '未连接目录' }}</span></span><span class="keyboard-hint">Enter 发送 · Shift + Enter 换行</span><button v-if="!workspace && !loading" class="composer-connect-button" type="button" :disabled="busy" @click="connect(!!activeProject)"><FolderOpen :size="15" />连接目录</button><button v-if="loading" class="send-button" type="button" aria-label="停止任务" @click="stop"><Square :size="16" /></button><button v-else class="send-button" type="submit" :disabled="!canSend" aria-label="发送任务"><ArrowUp :size="19" /></button></footer>
        </form>
        <p class="privacy-note"><ShieldCheck :size="12" />{{ storageError ? '本机保存不可用，请及时导出。' : '项目与对话保存在此浏览器。' }}所需代码片段会发送给模型。</p>
      </div>
    </div>
    <ConfirmActionDialog :open="!!deleteId" title="删除这段本地对话？" :description="`将删除“${sessions.find(s => s.id === deleteId)?.title || '新对话'}”及其消息，此操作不可撤销。项目目录和本地文件不会改变。`" confirm-label="删除对话" danger :busy="busy" @update:open="value => { if (!value) deleteId = null }" @confirm="deleteConversation"><template v-if="storageError" #default><p role="alert">{{ storageError }}</p></template></ConfirmActionDialog>
    <ConfirmActionDialog :open="!!deleteProjectId" title="删除这个项目？" :description="deleteProjectDescription" confirm-label="删除项目及对话" danger :busy="busy" @update:open="value => { if (!value) deleteProjectId = null }" @confirm="deleteProject"><template v-if="storageError" #default><p role="alert">{{ storageError }}</p></template></ConfirmActionDialog>
  </section>
</template>

<style scoped>
.local-project.page{gap:0}
.history-search input{padding:0}
.rail-tabs button{border-radius:0}
.change-card .diff-grid pre{max-height:clamp(90px,18dvh,200px)}
.local-project{display:grid;grid-template-columns:244px minmax(0,1fr);flex:1;min-height:0;min-width:0;height:100%;overflow:hidden;color:var(--foreground);background:var(--surface);position:relative;container-type:inline-size}
.local-project.dragging{outline:2px dashed var(--primary);outline-offset:-5px}
button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.48}button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--primary);outline-offset:3px}button{transition:background .15s,color .15s}button svg,a svg{flex-shrink:0}.icon-button{display:inline-grid;place-items:center;width:32px;height:32px;border:0;border-radius:7px;background:transparent;color:var(--muted-foreground);padding:0}.icon-button:hover{background:var(--surface-muted);color:var(--foreground)}.text-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;background:none;color:var(--primary);padding:5px;font-size:12px}.secondary,.connect-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--surface);color:var(--foreground);font-size:13px;white-space:nowrap}.secondary:hover{background:var(--surface-muted)}.connect-button{background:var(--primary);border-color:var(--primary);color:var(--primary-foreground)}.connect-button:hover{background:var(--primary-hover)}
.project-rail{display:flex;flex-direction:column;min-height:0;padding:24px 14px 16px;background:var(--background);border-right:1px solid var(--border)}.rail-heading{display:flex;align-items:center;justify-content:space-between;padding:0 8px 16px;font-size:13px;font-weight:650;color:var(--muted-foreground)}.new-conversation{display:flex;align-items:center;justify-content:center;gap:9px;border:1px solid var(--primary-border);border-radius:9px;padding:10px;background:var(--primary-soft);color:var(--accent-foreground);font-size:13px;font-weight:650}.new-conversation:hover{background:var(--primary-border)}.rail-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-top:22px}.rail-tabs button{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-bottom:2px solid transparent;background:none;padding:10px 0;font-size:12px;color:var(--muted-foreground)}.rail-tabs button.active{border-bottom-color:var(--primary);color:var(--primary);font-weight:650}.history-search{display:flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:7px;background:var(--surface);padding:7px 9px;margin:14px 0 12px;color:var(--muted-foreground)}.history-search input{min-width:0;width:100%;border:0;background:none;font-size:12px;color:var(--foreground);outline-offset:5px}.history-list{flex:1;min-height:0;overflow-y:auto}.history-item{position:relative;border:1px solid transparent;border-radius:9px;margin-bottom:5px}.history-item.selected{background:var(--surface);border-color:var(--primary-border);box-shadow:0 1px 3px rgb(15 23 42 / .03)}.history-select{display:block;width:100%;text-align:left;border:0;background:none;padding:12px 30px 12px 11px;color:var(--foreground);border-radius:9px}.history-select:hover{background:var(--surface-muted)}.history-title{display:flex;gap:7px;align-items:center}.history-title svg{color:var(--muted-foreground)}.history-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:550}.history-item.selected .history-title strong,.history-item.selected .history-title svg{color:var(--accent-foreground)}.history-project,.history-select time{display:block;padding-left:22px;font-size:11px;color:var(--muted-foreground);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-select time{margin-top:5px;font-size:10px}.delete-conversation{position:absolute;right:3px;top:6px;width:28px;height:28px}.rail-empty{text-align:center;font-size:12px;line-height:1.8;color:var(--muted-foreground);padding:24px 8px}.rail-empty>svg{margin:auto}.rail-footer{display:flex;gap:8px;border-top:1px solid var(--border);padding:16px 6px 12px;color:var(--muted-foreground)}.rail-footer>svg{flex-shrink:0;margin-top:2px}.rail-footer p{margin:0;font-size:11px;line-height:1.7}.rail-footer strong{display:block;font-weight:550;color:var(--foreground)}.rail-footer span{display:block;margin-top:3px}.back-link{display:flex;align-items:center;gap:8px;padding:9px 6px;color:var(--muted-foreground);font-size:12px;text-decoration:none}.back-link:hover{color:var(--primary)}.project-tree{flex:1;min-height:0;overflow:auto;padding-top:12px}.tree-location{display:flex;gap:6px;align-items:center;margin-bottom:10px;font-size:12px;color:var(--muted-foreground)}.tree-location span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.tree-file{display:flex;align-items:center;width:100%;gap:8px;padding:9px 7px;border:0;border-radius:6px;background:none;color:var(--foreground);font-size:12px;text-align:left}.tree-file span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tree-file svg{color:var(--muted-foreground)}.tree-file:disabled{opacity:1}.tree-file:not(:disabled):hover{background:var(--surface-muted)}.tree-pagination{display:flex;gap:10px;margin-top:10px}.tree-pagination button{border:0;background:none;color:var(--primary);font-size:12px;padding:6px}.file-help{margin:16px 6px;font-size:11px;line-height:1.8;color:var(--muted-foreground)}
.project-main{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--surface)}.workspace-toolbar{display:flex;align-items:center;gap:12px;min-height:86px;padding:18px 28px;border-bottom:1px solid var(--border);flex-shrink:0}.folder-icon{display:grid;place-items:center;flex-shrink:0;width:42px;height:42px;border:1px solid var(--primary-border);border-radius:11px;background:var(--primary-soft);color:var(--primary)}.project-identity{flex:1;min-width:0}.project-identity h1{font-size:16px;font-weight:650;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.project-identity p{display:flex;align-items:center;gap:5px;margin:5px 0 0;font-size:11px;color:var(--muted-foreground)}.connection-dot{width:5px;height:5px;border-radius:50%;background:var(--muted-foreground)}.connection-dot.connected{background:var(--success)}.permission-control{position:relative;flex-shrink:0}.permission-trigger{display:flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--foreground);font-size:12px;min-height:36px;padding:8px 10px}.permission-trigger:hover{background:var(--surface-muted)}.permission-trigger.automatic{background:var(--primary-soft);border-color:var(--primary-border);color:var(--accent-foreground)}.permission-popover{position:absolute;right:0;top:calc(100% + 8px);z-index:45;width:310px;max-width:calc(100vw - 32px);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-dialog);border-radius:12px;padding:14px}.popover-heading{display:flex;justify-content:space-between;align-items:center;font-size:14px}.permission-scope{font-size:12px;color:var(--muted-foreground);margin:2px 0 12px;overflow-wrap:anywhere}.permission-option{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:11px 10px;border:1px solid transparent;border-radius:8px;background:none;color:var(--foreground);text-align:left}.permission-option.selected{background:var(--primary-soft);border-color:var(--primary-border);color:var(--accent-foreground)}.permission-option:hover{background:var(--background)}.permission-option strong{font-size:13px;display:block}.permission-option small{font-size:11px;line-height:1.7;color:var(--muted-foreground);display:block;margin-top:3px}.permission-help{font-size:11px;line-height:1.7;color:var(--muted-foreground);border-top:1px solid var(--border);padding-top:10px;margin:12px 0 0}.reconnect-note,.auto-note{display:flex;align-items:center;gap:9px;padding:10px 28px;background:var(--primary-soft);border-bottom:1px solid var(--primary-border);color:var(--accent-foreground);font-size:12px;line-height:1.65;flex-shrink:0}.reconnect-note>svg,.auto-note>svg{flex-shrink:0}.reconnect-note p{margin:0}.auto-note{background:var(--background);color:var(--muted-foreground);border-color:var(--border)}.conversation-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 28px;color:var(--muted-foreground);font-size:12px;flex-shrink:0}.conversation-bar>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.conversation-bar button{color:var(--muted-foreground);white-space:nowrap}.conversation-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}.conversation-content{width:100%;max-width:1000px;margin:0 auto;padding:12px 40px 26px}.project-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:clamp(24px,6vh,68px) 0 24px}.welcome-icon{display:grid;place-items:center;width:64px;height:64px;border:1px solid var(--primary-border);border-radius:18px;color:var(--primary);background:var(--primary-soft);margin-bottom:22px}.eyebrow-label{margin:0 0 9px!important;font-size:12px!important;color:var(--primary)!important;font-weight:550}.project-empty h2{font-size:clamp(22px,2vw,29px);font-weight:650;letter-spacing:-.5px;margin:0 0 12px}.project-empty>p{font-size:13px;line-height:1.8;color:var(--muted-foreground);margin:0}.project-empty>.connect-button{margin-top:22px;padding:10px 17px}.starter-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;width:100%;margin:32px 0 18px}.starter-grid button{position:relative;text-align:left;border:1px solid var(--border);border-radius:11px;background:var(--surface);padding:19px 16px;color:var(--foreground)}.starter-grid button:hover:not(:disabled){border-color:var(--primary-border);background:var(--primary-soft)}.starter-grid button:disabled{opacity:.65}.starter-grid svg{color:var(--primary);margin-bottom:14px}.starter-grid strong{display:block;font-size:13px;font-weight:600;margin-bottom:7px}.starter-grid small{display:block;font-size:11px;line-height:1.7;color:var(--muted-foreground)}.starter-grid .starter-arrow{position:absolute;top:18px;right:13px;color:var(--muted-foreground);transform:rotate(45deg);margin:0}.empty-hint{font-size:11px!important}.project-turn{padding:12px 0 24px}.user-message{margin:0 0 30px auto;width:fit-content;max-width:88%;padding:11px 16px;border:1px solid var(--primary-border);border-radius:13px 13px 3px 13px;background:var(--primary-soft);font-size:14px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.assistant-label{display:flex;align-items:center;gap:9px;margin-bottom:12px;font-size:13px}.assistant-mark{display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:var(--primary);color:var(--primary-foreground);font-size:12px;font-weight:700}.assistant-label strong{font-weight:600}.assistant-label>span:last-child:not(.assistant-mark){color:var(--muted-foreground);font-size:11px}.process{border:1px solid var(--border);border-radius:9px;background:var(--background);font-size:12px;color:var(--muted-foreground);margin-left:33px;overflow:hidden}.process summary{display:flex;gap:7px;align-items:center;list-style:none;cursor:pointer;padding:11px 13px}.process summary::-webkit-details-marker{display:none}.process summary small{margin-left:auto;font-size:10px}.expanded{transform:rotate(90deg)}.activity{display:flex;gap:9px;padding:9px 14px;border-top:1px solid var(--border)}.activity>svg{flex-shrink:0;margin-top:2px}.activity div{min-width:0}.activity code{display:inline-block;margin-left:8px;font-size:11px;overflow-wrap:anywhere}.activity small{display:block;margin-top:6px}.activity p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;margin:6px 0 0;font-size:12px}.activity-error{color:var(--danger)}.final-answer{font-size:14px;line-height:1.85;overflow-wrap:anywhere;padding:14px 0 0 33px}.stopped-note{margin:14px 0 0 33px;font-size:12px;line-height:1.8;color:var(--muted-foreground)}.change-card{border:1px solid var(--primary-border);border-radius:12px;padding:18px;margin:16px 0;background:var(--surface)}.change-card h2{font-size:14px;margin:0}.change-card h2 code{font-size:12px;overflow-wrap:anywhere}.change-card p{font-size:12px;color:var(--muted-foreground);line-height:1.7}.diff-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.diff-grid>div{min-width:0}.diff-grid small{font-size:11px;color:var(--muted-foreground)}.diff-grid pre{overflow:auto;max-height:230px;background:var(--background);padding:12px;border:1px solid var(--border);border-radius:8px;font-size:12px;white-space:pre}.change-card footer{display:flex;justify-content:flex-end;gap:9px;margin-top:14px}
.composer-dock{flex-shrink:0;width:100%;max-width:1000px;margin:0 auto;padding:8px 40px 16px;background:var(--surface)}.local-composer{border:1px solid var(--input);border-radius:13px;background:var(--surface);padding:14px 15px 10px;box-shadow:0 3px 15px rgb(15 23 42 / .035)}.local-composer:focus-within{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft)}.local-composer textarea{display:block;width:100%;resize:none;border:0;outline:none!important;background:none;color:var(--foreground);font-size:14px;line-height:1.75;height:60px;min-height:60px;max-height:160px;padding:0}.local-composer textarea::placeholder{color:var(--muted-foreground)}.local-composer footer{display:flex;align-items:center;gap:10px;margin-top:6px}.composer-mode{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted-foreground);min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.mode-label{border-left:1px solid var(--border);padding-left:7px;margin-left:2px}.keyboard-hint{font-size:10px;color:var(--muted-foreground);margin-left:auto;white-space:nowrap}.send-button{flex-shrink:0;display:grid;place-items:center;border:0;background:var(--primary);color:var(--primary-foreground);width:34px;height:34px;border-radius:9px;margin-left:auto}.keyboard-hint+.send-button{margin-left:0}.privacy-note{display:flex;align-items:center;justify-content:center;gap:5px;font-size:10px;line-height:1.6;color:var(--muted-foreground);margin:9px 0 0}.privacy-note svg{flex-shrink:0}.error-note{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:9px 12px;border:1px solid var(--danger-border);border-radius:8px;background:var(--danger-soft);color:var(--danger);font-size:12px;line-height:1.7;margin:0 0 8px;max-height:100px;overflow:auto}.error-note>.icon-button{margin-left:auto;flex-shrink:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.spin{animation:spin 1s linear infinite}.rail-toggle,.mobile-close,.rail-scrim{display:none}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spin{animation:none}}
@container(max-width:1000px){.workspace-toolbar{padding:16px 20px;gap:9px}.conversation-content{padding-left:26px;padding-right:26px}.composer-dock{padding-left:26px;padding-right:26px}.keyboard-hint{display:none}.send-button{margin-left:auto!important}.starter-grid{gap:8px}.starter-grid button{padding:15px 11px}.starter-grid small{font-size:10px}}
@media(max-width:1199px){.local-project{grid-template-columns:216px minmax(0,1fr)}.project-rail{padding-left:10px;padding-right:10px}}
@media(max-width:959px){.local-project{grid-template-columns:minmax(0,1fr)}.project-rail{display:none}.project-rail.is-open{display:flex;position:absolute;left:0;top:0;bottom:0;width:min(290px,85%);z-index:55;box-shadow:var(--shadow-dialog)}.rail-toggle,.mobile-close{display:inline-grid}.rail-scrim{display:block;position:absolute;inset:0;background:var(--backdrop);border:0;z-index:50}.workspace-toolbar{min-height:76px}.project-empty{padding-top:32px}.conversation-content,.composer-dock{max-width:850px}}
@media(max-width:639px){.workspace-toolbar{padding:12px;gap:8px;flex-wrap:wrap}.folder-icon{width:34px;height:34px;border-radius:9px}.project-identity h1{font-size:14px}.project-identity{min-width:100px}.directory-button{font-size:11px;padding:7px 9px}.permission-control{margin-left:auto}.permission-trigger{font-size:11px;min-height:32px;padding:6px 9px}.permission-popover{width:290px}.workspace-toolbar .rail-toggle{width:28px}.conversation-bar{padding:7px 14px}.conversation-content{padding:12px 16px 20px}.composer-dock{padding:8px 12px max(10px,env(safe-area-inset-bottom))}.local-composer{padding:12px}.composer-mode{font-size:10px}.mode-label{display:none}.privacy-note{font-size:9px;text-align:center;align-items:flex-start;margin-top:7px}.project-empty{padding:20px 0}.welcome-icon{width:50px;height:50px;border-radius:14px;margin-bottom:18px}.project-empty h2{font-size:22px}.project-empty>p{font-size:12px}.starter-grid{grid-template-columns:1fr;margin-top:22px;gap:8px}.starter-grid button{display:grid;grid-template-columns:25px 1fr;gap:3px 8px;padding:12px 14px}.starter-grid svg{grid-row:1/3;align-self:center;margin:0}.starter-grid strong{margin:0;font-size:12px}.starter-grid small{font-size:11px}.starter-grid .starter-arrow{display:none}.reconnect-note,.auto-note{padding:9px 14px;font-size:11px}.user-message{font-size:13px;margin-bottom:22px}.final-answer{font-size:13px;padding-left:0}.process{margin-left:0}.diff-grid{grid-template-columns:1fr}.change-card{padding:12px}.change-card footer button{font-size:12px}.assistant-label{font-size:12px}}
@media(min-width:960px) and (max-height:950px){
  .project-empty{padding:16px 0 12px}
  .project-empty .welcome-icon{width:44px;height:44px;border-radius:12px;margin-bottom:12px}
  .project-empty .welcome-icon svg{width:24px;height:24px}
  .project-empty .eyebrow-label{display:none}
  .project-empty h2{font-size:24px}
  .project-empty>.connect-button{margin-top:16px}
  .project-empty .starter-grid{margin:20px 0 12px}
}
.local-project{grid-template-columns:276px minmax(0,1fr)}
.rail-heading{color:var(--foreground)}
.rail-heading small{margin-left:6px;color:var(--muted-foreground);font-size:11px;font-weight:400}
.rail-tabs button{font-size:11px}
.local-project-group{margin:2px 0 13px}
.local-project-row{display:flex;align-items:center;gap:2px}
.project-expand{width:22px;height:30px;flex-shrink:0}
.project-select{display:flex;align-items:center;gap:7px;min-width:0;flex:1;padding:9px 6px;border:0;border-radius:7px;background:transparent;text-align:left;color:var(--foreground)}
.project-select:hover{background:var(--surface-muted)}
.project-select>svg{color:var(--muted-foreground)}
.active-project .project-select>svg{color:var(--primary)}
.project-select strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
.project-select small{font-size:10px;color:var(--muted-foreground)}
.project-conversations{border-left:1px solid var(--border);margin:3px 0 0 11px;padding-left:10px}
.project-new-chat{display:flex;align-items:center;gap:7px;width:100%;padding:9px 10px;border:0;border-radius:7px;background:none;color:var(--primary);font-size:12px;text-align:left}
.project-new-chat:hover{background:var(--primary-soft)}
.project-conversations .history-select{padding:10px 27px 10px 9px}
.project-conversations .history-title strong{font-size:12px}
.project-conversations .history-project{font-size:10px}
.orphan-conversations h3{font-size:11px;font-weight:500;color:var(--muted-foreground);padding:6px}
.project-title-row{display:flex;align-items:center;gap:5px;min-width:0}
.rename-project{width:25px;height:25px;flex-shrink:0}
.project-name-form{display:flex;align-items:center;gap:3px}
.project-name-form input{width:100%;min-width:0;padding:5px 8px;border:1px solid var(--primary-border);border-radius:6px;font-size:14px;background:var(--surface);color:var(--foreground)}
.project-identity p{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;display:block}
.project-identity .connection-dot{display:inline-block;margin-right:5px;vertical-align:middle}
.conversation-bar>span{display:flex;align-items:center;gap:9px}
.session-kind-badge{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);border-radius:5px;padding:3px 6px;white-space:nowrap;font-size:10px;color:var(--muted-foreground)}
.composer-settings{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.session-kind-switch{display:inline-flex;padding:3px;gap:3px;background:var(--background);border:1px solid var(--border);border-radius:8px}
.session-kind-switch button{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;min-height:30px;border:0;border-radius:5px;font-size:12px;color:var(--muted-foreground);background:transparent}
.session-kind-switch button.selected{background:var(--surface);color:var(--primary);box-shadow:0 1px 4px rgb(15 23 42 / .08);font-weight:600}
.composer-mode-hint{font-size:11px;color:var(--muted-foreground)}
.workspace-intro{display:grid;grid-template-columns:repeat(3,1fr);width:min(100%,660px);gap:28px;text-align:left;margin:44px 0 32px}
.workspace-intro>div{display:grid;grid-template-columns:28px 1fr;gap:5px 9px}
.workspace-intro svg{grid-row:1/3;color:var(--primary);margin-top:2px}
.workspace-intro strong{font-size:13px;font-weight:600}
.workspace-intro span{font-size:11px;color:var(--muted-foreground);line-height:1.7}
.project-empty.without-project{padding-top:clamp(40px,13vh,120px)}
@media(max-width:1199px){.local-project{grid-template-columns:244px minmax(0,1fr)}.workspace-toolbar{gap:8px;padding:14px 18px}.toolbar-new-chat{font-size:11px;padding:7px 8px}.composer-mode-hint{font-size:10px}}
@media(max-width:959px){.local-project{grid-template-columns:minmax(0,1fr)}}
@media(max-width:639px){.workspace-toolbar{padding:12px}.toolbar-new-chat{margin-left:auto}.workspace-toolbar .permission-control{margin-left:0}.composer-settings{gap:8px;flex-wrap:wrap;margin-bottom:12px}.session-kind-switch button{padding:5px 9px}.composer-mode-hint{font-size:10px}.workspace-intro{grid-template-columns:1fr;gap:22px;width:220px;margin:30px auto}.project-empty.without-project{padding-top:35px}.project-empty.without-project h2{font-size:22px;max-width:280px}.project-empty.without-project>p{max-width:290px}}
/* Conversations live in the shared navigation; this drawer only browses files. */
.local-project{grid-template-columns:minmax(0,1fr)}
.local-project .project-rail{display:none}
.local-project .project-rail.is-open{display:flex;position:absolute;right:0;left:auto;top:0;bottom:0;width:min(320px,88%);z-index:55;border-left:1px solid var(--border);box-shadow:var(--shadow-dialog)}
.local-project .rail-scrim{display:block;position:absolute;inset:0;background:var(--backdrop);border:0;z-index:50}
.local-project .project-tree{flex:1;min-height:0;overflow:auto}
.conversation-actions{display:flex;align-items:center;gap:12px;flex-shrink:0}
.composer-dock{max-width:940px;padding-top:10px;padding-bottom:14px}
.local-composer{border-radius:17px;padding:13px 15px 11px;box-shadow:0 6px 24px rgb(15 23 42 / .045)}
.composer-settings{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:12px}
.session-kind-switch{border-radius:10px;padding:3px;gap:2px}
.session-kind-switch button{min-height:34px;padding:7px 12px;border-radius:7px;font-weight:550;transition:background-color .15s,color .15s,box-shadow .15s}
.session-kind-switch button:hover:not(:disabled):not(.selected){background:var(--surface-muted);color:var(--foreground)}
.session-kind-switch button.selected{background:var(--surface);box-shadow:0 1px 5px rgb(15 23 42 / .1)}
.workspace-model-picker{display:inline-flex;align-items:center;gap:7px;min-height:40px;padding:0 10px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--primary);cursor:pointer}
.workspace-model-picker:hover{border-color:var(--primary-border);background:var(--primary-soft)}
.workspace-model-picker:focus-within{outline:2px solid var(--primary);outline-offset:2px}
.workspace-model-picker select{max-width:170px;min-width:0;border:0;outline:0;background:transparent;color:var(--foreground);font:inherit;font-size:12px;font-weight:550;cursor:pointer;appearance:none}
.workspace-model-picker select:disabled{cursor:not-allowed;opacity:.6}
.workspace-model-picker>svg:last-child{color:var(--muted-foreground);pointer-events:none}
.composer-mode-hint{margin-left:auto;line-height:1.5}
.local-composer textarea{height:52px;min-height:52px}
.local-composer footer{min-height:40px;padding-top:7px;border-top:1px solid var(--border);margin-top:7px}
.composer-mode{gap:7px;font-size:11px}
.mode-label{color:var(--muted-foreground)}
.send-button{width:38px;height:38px;border-radius:11px;transition:transform .15s,box-shadow .15s,background-color .15s}
.send-button:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 12px rgb(79 70 229 / .22)}
.send-button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.send-button:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
.workspace-agent-label{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:0 11px;border:1px solid var(--primary-border);border-radius:10px;background:var(--primary-soft);color:var(--accent-foreground);font-size:12px;font-weight:600;white-space:nowrap}
.composer-connect-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:0 12px;border:1px solid var(--primary-border);border-radius:10px;background:var(--primary-soft);color:var(--accent-foreground);font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer}
.composer-connect-button:hover:not(:disabled){background:var(--surface-muted);border-color:var(--primary)}
.composer-connect-button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.composer-connect-button:disabled{opacity:.55;cursor:not-allowed}
@container(max-width:1000px){.composer-connect-button{margin-left:auto}}
@media(max-width:639px){.composer-dock{padding-left:12px;padding-right:12px}.local-composer{padding:11px 12px}.composer-settings{gap:7px}.session-kind-switch button{padding:6px 9px}.workspace-model-picker{min-height:36px;padding:0 8px}.workspace-model-picker select{max-width:130px;font-size:11px}.composer-mode-hint{width:100%;margin-left:2px}.local-composer textarea{height:48px;min-height:48px}.mode-label{display:none}}
.recovery-export{margin-bottom:8px}
</style>
