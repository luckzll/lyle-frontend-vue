<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, PanelRightOpen } from '@lucide/vue'
import {
  createConversation,
  createAgentTodo,
  createAgentPlan,
  createGoal,
  createProjectDecision,
  createProjectOpenQuestion,
  confirmPendingOperation,
  getCurrentMemory,
  listChatMessages,
  listConversations,
  listAgentReminders,
  listAgentTodos,
  listKnowledgeBases,
  listPendingOperations,
  purgeStructuredMemory,
  saveStructuredMemory,
  rejectPendingOperation,
  streamMessage,
  trackEffectiveProgressAction,
  trackProductEvent,
  changeStructuredMemoryStatus,
  cancelChatTurn,
  updateConversationTitle,
  uploadChatAttachment,
  deleteChatAttachment,
  type ImageBatchItem,
  type ImageBatchStartedEvent,
  type ImageBatchCompletedEvent,
  type ImageItemEvent,
  type TurnStatusEvent
} from '@/api/app'
import type { AgentReminderItem, AgentTodoItem, AgentTraceItem, CandidateDecisionItem, CandidateGoalItem, CandidateOpenQuestionItem, CandidatePlanItem, CandidateTaskItem, ChatSource, Conversation, KnowledgeBase, MemoryItem, MemorySnapshot, PendingOperationItem, ProjectChatContext, ToolResult, ExecutionSuggestionItem } from '@/api/types'
import ContextPanel from '@/components/layout/ContextPanel.vue'
import ExecutionTimeline from '@/components/domain/ExecutionTimeline.vue'
import SuggestionCard from '@/components/domain/SuggestionCard.vue'
import { useWorkspaceStore, type WorkspaceProjectContext } from '@/stores/workspace'
import { isConversationNearBottom } from '@/domain/chat-scroll'
import { historyMessage, isActiveTurnPhase } from '@/domain/chat-history'
import { NEW_CONVERSATION_STORAGE_VALUE, resolveConversationToRestore } from '@/domain/chat-session'
import { cancelPendingImageItems } from '@/domain/image-batch'
import type { ChatAttachment } from '@/domain/chat-attachment'
import { useChatAttachments } from '@/composables/useChatAttachments'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import MessageAttachments from '@/components/chat/MessageAttachments.vue'
import GeneratedImageGrid from '@/components/chat/GeneratedImageGrid.vue'
import MessageFailureActions from '@/components/chat/MessageFailureActions.vue'
import {
  sanitizeAgentTrace,
  sanitizeChatSources,
  sanitizeExecutionSuggestions,
  sanitizeProjectContext,
  sanitizeReview,
  sanitizeToolResults
} from '@/domain/chat-safety'

interface Message {
  role: 'user' | 'assistant'
  content: string
  images?: Array<{
    name: string
    url: string
    previewUrl?: string
  }>
  attachments?: ChatAttachment[]
  turnId?: string
  phase?: TurnStatusEvent['phase']
  statusText?: string
  imageBatch?: {
    batchId: string
    count: number
    mode: 'generate' | 'edit'
    status: 'RUNNING' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' | 'CANCELLED'
    completedCount: number
    failedCount: number
    items: ImageBatchItem[]
  }
  sources?: ChatSource[]
  agentTrace?: AgentTraceItem[]
  toolResults?: ToolResult[]
  candidateMemories?: MemoryItem[]
  candidateTasks?: CandidateTaskItem[]
  candidateGoals?: CandidateGoalItem[]
  candidateDecisions?: CandidateDecisionItem[]
  candidateOpenQuestions?: CandidateOpenQuestionItem[]
  candidatePlans?: CandidatePlanItem[]
  executionSuggestions?: ExecutionSuggestionItem[]
  projectContext?: ProjectChatContext
  review?: Record<string, unknown>
}

interface RetryTurnContext {
  userIndex: number
  assistantIndex: number
  turnId: string
}

const input = ref('')
const route = useRoute()
const router = useRouter()
const workspace = useWorkspaceStore()
const handoffProject = ref<WorkspaceProjectContext | null>(null)
const showContextPanel = ref(false)
const chatListRef = ref<HTMLElement | null>(null)
const composerRef = ref<{ focus: () => void } | null>(null)
const hasMessagesBelow = ref(false)
const isNearBottom = ref(true)
const loading = ref(false)
const streamController = ref<AbortController | null>(null)
const recoveringTurnId = ref('')
let recoveryPollTimer: number | undefined
const initializing = ref(true)
const debugControlsEnabled = computed(() => route.query.debug === '1')
const showDebug = ref(debugControlsEnabled.value)
const error = ref('')
const conversationId = ref('')
const ACTIVE_CONVERSATION_STORAGE_KEY = 'lyle.chat.active-conversation'
const editingTitle = ref(false)
const editingConversationId = ref('')
const titleDraft = ref('')
const titleSaving = ref(false)
const conversations = ref<Conversation[]>([])
const knowledgeBases = ref<KnowledgeBase[]>([])
const selectedKnowledgeBaseId = ref('')
const memoryActionLoading = ref<Record<string, boolean>>({})
const taskActionLoading = ref<Record<string, boolean>>({})
const projectCandidateActionLoading = ref<Record<string, boolean>>({})
const operationActionLoading = ref<Record<string, boolean>>({})
const executionSuggestionActionLoading = ref<Record<string, boolean>>({})
const traceCopyState = ref<Record<number, 'copied' | 'failed'>>({})
const briefTodos = ref<AgentTodoItem[]>([])
const briefReminders = ref<AgentReminderItem[]>([])
const briefMemory = ref<MemorySnapshot | null>(null)
const briefOperations = ref<Array<Pick<PendingOperationItem, 'id' | 'status'>>>([])
const briefError = ref('')
const messages = ref<Message[]>([
  { role: 'assistant', content: '你好，我是 Lyle。你可以先上传文档到知识库，再带着知识库提问。' }
])
const {
  attachments: attachmentDrafts,
  announcement: attachmentAnnouncement,
  isUploading: attachmentsUploading,
  hasFailed: attachmentsFailed,
  addFiles: addAttachmentFiles,
  retry: retryAttachment,
  remove: removeAttachment,
  commitReady: commitReadyAttachments,
  reset: resetAttachments
} = useChatAttachments({
  upload: async (file, kind) => (await uploadChatAttachment(file, kind)).data,
  remove: async (attachmentId) => deleteChatAttachment(attachmentId)
})
const composerDisabled = computed(() => (
  loading.value
  || attachmentsUploading.value
  || attachmentsFailed.value
  || (!input.value.trim() && !attachmentDrafts.value.length)
))
const starterPrompts = [
  { title: '整理项目', description: '归纳目标、进展、风险和下一步', draft: '帮我整理当前项目，归纳目标、进展、风险和下一步。' },
  { title: '生成计划', description: '把目标拆成今天可开始的行动', draft: '帮我把当前目标拆成一份今天可以开始执行的计划。' },
  { title: '查询资料', description: '整理关键信息并标明来源', draft: '帮我查询相关资料，整理关键信息并标明来源。' },
  { title: '运行巡检', description: '优先指出风险、阻塞和建议动作', draft: '帮我运行一次项目巡检，优先指出风险、阻塞和建议动作。' }
]
const activeConversationTitle = computed(() => {
  if (!conversationId.value) return '新会话'
  return conversations.value.find((item) => String(item.id) === conversationId.value)?.title || '当前会话'
})
const activeKnowledgeBaseName = computed(() => {
  if (!selectedKnowledgeBaseId.value) return '未使用知识库'
  return knowledgeBases.value.find((item) => String(item.id) === selectedKnowledgeBaseId.value)?.name || '已选择知识库'
})
const activeProjectId = computed(() => {
  const value = route.params.projectId
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return handoffProject.value?.id
})
const hasUserMessages = computed(() => messages.value.some((message) => message.role === 'user'))
const latestAssistantMessage = computed(() => [...messages.value].reverse().find((message) => message.role === 'assistant'))
const contextSources = computed(() => latestAssistantMessage.value?.sources || [])
const contextProject = computed(() => latestAssistantMessage.value?.projectContext?.resolver)
const contextMemoryCount = computed(() => latestAssistantMessage.value ? usedMemoryItems(latestAssistantMessage.value).length : 0)
const contextTimeline = computed(() => {
  const message = latestAssistantMessage.value
  const steps: Array<{ id: string; title: string; detail?: string; status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' }> = []
  if (loading.value) {
    steps.push({ id: 'stream', title: '生成回答', detail: '正在读取上下文并组织结果', status: 'running' })
  }
  for (const [index, trace] of (message?.agentTrace || []).entries()) {
    steps.push({
      id: `trace-${index}`,
      title: String(trace.agent || '执行步骤'),
      detail: traceSummary(trace) || agentStatus(trace),
      status: trace.approved === false ? 'failed' : trace.action === 'write' ? 'waiting' : 'completed'
    })
  }
  for (const [index, tool] of (message?.toolResults || []).entries()) {
    steps.push({
      id: `tool-${index}`,
      title: tool.tool || '工具执行',
      detail: tool.content || undefined,
      status: tool.requiresConfirmation ? 'waiting' : tool.ok ? 'completed' : 'failed'
    })
  }
  return steps
})
const openBriefTodos = computed(() => briefTodos.value.filter((item) => item.status === 'open'))
const todayBriefTodos = computed(() => openBriefTodos.value.filter((item) => isToday(item.dueAt)))
const overdueBriefTodos = computed(() => openBriefTodos.value.filter((item) => isOverdueTodo(item)))
const pendingBriefMemories = computed(() => {
  const items = briefMemory.value?.structured_all || []
  return items.filter((item) => item.status === 'pending' && memoryBelongsToConversation(item, conversationId.value))
})
const unreadBriefReminders = computed(() => briefReminders.value.filter((item) => item.status !== 'read'))
const pendingBriefOperations = computed(() => briefOperations.value.filter((item) => item.status === 'pending'))
const weeklyCreatedTodos = computed(() => briefTodos.value.filter((item) => isThisWeek(item.createdAt)))
const weeklyCompletedTodos = computed(() => briefTodos.value.filter((item) => item.status === 'done' && isThisWeek(item.updatedAt)))
const focusedProjects = computed(() => {
  const memories = briefMemory.value?.structured_all || []
  const memoryProjects = memories
    .filter((item) => item.status === 'active' && ['current_project', 'goal'].includes(String(item.key || '')))
    .map((item) => String(item.value || item.text || '').trim())
    .filter(Boolean)
  const taskProjects = openBriefTodos.value
    .slice(0, 3)
    .map((item) => item.title)
  return Array.from(new Set([...memoryProjects, ...taskProjects])).slice(0, 3)
})
const weeklyReviewItems = computed(() => [
  `本周新增 ${weeklyCreatedTodos.value.length} 项任务，完成 ${weeklyCompletedTodos.value.length} 项`,
  overdueBriefTodos.value.length > 0 ? `${overdueBriefTodos.value.length} 项任务已逾期` : '暂无逾期任务',
  pendingBriefOperations.value.length > 0 ? `${pendingBriefOperations.value.length} 个操作等你确认` : '暂无待确认操作',
  pendingBriefMemories.value.length > 0 ? `${pendingBriefMemories.value.length} 条记忆待确认` : '记忆队列清爽'
])
const briefFocusItems = computed(() => [
  ...overdueBriefTodos.value.slice(0, 2).map((item) => ({ title: item.title, meta: `逾期 · ${formatBriefTime(item.dueAt)}`, tone: 'danger' })),
  ...todayBriefTodos.value.slice(0, 2).map((item) => ({ title: item.title, meta: `今日到期 · ${formatBriefTime(item.dueAt)}`, tone: 'pending' })),
  ...openBriefTodos.value.filter((item) => !isToday(item.dueAt) && !isOverdueTodo(item)).slice(0, 2).map((item) => ({ title: item.title, meta: item.dueAt ? `待办 · ${formatBriefTime(item.dueAt)}` : '待办 · 未设截止时间', tone: 'normal' }))
].slice(0, 4))

const memoryKeyLabels: Record<string, string> = {
  name: '姓名',
  identity: '身份',
  career: '职业',
  preference: '偏好',
  negative_preference: '负向偏好',
  food_preference: '食物偏好',
  food_negative_preference: '食物负向偏好',
  pet_preference: '宠物偏好',
  pet_negative_preference: '宠物负向偏好',
  sport_preference: '运动偏好',
  sport_negative_preference: '运动负向偏好',
  entertainment_preference: '娱乐偏好',
  entertainment_negative_preference: '娱乐负向偏好',
  current_project: '当前项目',
  travel_interest: '旅行意向',
  technology_stack: '技术栈',
  goal: '目标',
  constraint: '限制条件',
  zodiac: '星座'
}

onMounted(async () => {
  const handoff = workspace.consumeChatDraft()
  if (handoff) {
    input.value = handoff.draft
    handoffProject.value = handoff.project
  }
  try {
    await Promise.all([refreshKnowledgeBases(), refreshConversations(), refreshBrief()])
    const requestedConversationId = typeof route.query.conversationId === 'string'
      ? route.query.conversationId
      : undefined
    const initialConversationId = resolveConversationToRestore({
      requestedId: requestedConversationId,
      storedId: window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY),
      conversationIds: conversations.value.map((item) => String(item.id)),
      allowRecent: !handoff && !activeProjectId.value
    })
    if (initialConversationId) {
      await loadConversation(initialConversationId)
    }
    syncPendingMemoriesToLatestAssistant()
  } catch {
    error.value = '页面初始化失败，请确认后端服务已经启动。'
  } finally {
    initializing.value = false
    await nextTick()
    if (handoff) composerRef.value?.focus()
    if (conversationId.value || hasUserMessages.value) scrollToBottom(false)
    else if (chatListRef.value) chatListRef.value.scrollTop = 0
  }
})

watch(() => messages.value.length, async () => {
  await nextTick()
  if (isNearBottom.value) scrollToBottom(false)
  else hasMessagesBelow.value = true
})

watch(debugControlsEnabled, (enabled) => {
  showDebug.value = enabled
})

onActivated(async () => {
  await refreshBrief()
})

onBeforeUnmount(() => {
  clearRecoveryPolling()
})

async function refreshKnowledgeBases() {
  const response = await listKnowledgeBases()
  knowledgeBases.value = response.data
}

async function exitDebugMode() {
  const query = { ...route.query }
  delete query.debug
  showDebug.value = false
  await router.replace({ query })
}

async function refreshConversations() {
  const response = await listConversations()
  conversations.value = response.data
}

async function refreshBrief() {
  briefError.value = ''
  try {
    const [todoResponse, reminderResponse, memoryResponse, operationResponse] = await Promise.all([
      listAgentTodos(),
      listAgentReminders(),
      getCurrentMemory(conversationId.value),
      listPendingOperations(20)
    ])
    briefTodos.value = todoResponse.data.items
    briefReminders.value = reminderResponse.data.items
    briefMemory.value = memoryResponse.data
    briefOperations.value = operationResponse.data.items.map((item) => ({ id: item.id, status: item.status }))
    syncPendingMemoriesToLatestAssistant(memoryResponse.data)
  } catch {
    briefError.value = '简报暂时无法加载'
  }
}

async function ensureConversationId(firstMessage: string) {
  if (conversationId.value) return conversationId.value

  const title = firstMessage.length > 18 ? `${firstMessage.slice(0, 18)}...` : firstMessage
  const response = await createConversation(title || '新会话')
  conversationId.value = String(response.data.id)
  window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversationId.value)
  await refreshConversations()
  return conversationId.value
}

async function loadConversation(id: string) {
  if (loading.value) return

  clearRecoveryPolling()
  recoveringTurnId.value = ''
  handoffProject.value = null
  resetAttachments()
  editingTitle.value = false
  editingConversationId.value = ''
  conversationId.value = String(id)
  error.value = ''
  loading.value = true
  try {
    const response = await listChatMessages(conversationId.value)
    messages.value = response.data.length
      ? response.data.map(historyMessage)
      : [{ role: 'assistant', content: '这个会话还没有消息。' }]
    window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversationId.value)
    await refreshBrief()
  } catch {
    error.value = '会话加载失败，请稍后重试。'
  } finally {
    loading.value = false
    syncRecoveredTurnPolling()
  }
}

function syncRecoveredTurnPolling() {
  const active = [...messages.value].reverse().find((message) => (
    message.role === 'assistant'
    && Boolean(message.turnId)
    && isActiveTurnPhase(message.phase)
  ))
  if (!active || streamController.value) {
    recoveringTurnId.value = ''
    clearRecoveryPolling()
    if (!streamController.value) loading.value = false
    return
  }
  recoveringTurnId.value = active.turnId || ''
  loading.value = true
  if (recoveryPollTimer === undefined) {
    recoveryPollTimer = window.setTimeout(pollRecoveredConversation, 1000)
  }
}

async function pollRecoveredConversation() {
  recoveryPollTimer = undefined
  const targetConversationId = conversationId.value
  if (!targetConversationId || streamController.value) return
  try {
    const response = await listChatMessages(targetConversationId)
    if (conversationId.value !== targetConversationId) return
    messages.value = response.data.length
      ? response.data.map(historyMessage)
      : [{ role: 'assistant', content: '这个会话还没有消息。' }]
  } catch {
    error.value = '图片任务状态暂时无法更新，正在重试。'
  } finally {
    syncRecoveredTurnPolling()
  }
}

function clearRecoveryPolling() {
  if (recoveryPollTimer !== undefined) {
    window.clearTimeout(recoveryPollTimer)
    recoveryPollTimer = undefined
  }
}

function changeConversation() {
  const id = conversationId.value
  if (id) void loadConversation(id)
  else newConversation()
}

function newConversation() {
  if (loading.value) return

  clearRecoveryPolling()
  recoveringTurnId.value = ''
  handoffProject.value = null
  resetAttachments()
  editingTitle.value = false
  editingConversationId.value = ''
  conversationId.value = ''
  window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, NEW_CONVERSATION_STORAGE_VALUE)
  messages.value = [
    { role: 'assistant', content: '新的会话已经准备好。输入第一句话后，我会自动创建会话并保存历史。' }
  ]
  nextTick(() => composerRef.value?.focus())
}

function startTitleEdit() {
  if (!conversationId.value) return
  editingConversationId.value = conversationId.value
  titleDraft.value = activeConversationTitle.value
  editingTitle.value = true
}

async function saveTitle() {
  const targetId = editingConversationId.value
  if (!targetId || targetId !== conversationId.value || !titleDraft.value.trim() || titleSaving.value) return
  titleSaving.value = true
  try {
    await updateConversationTitle(targetId, titleDraft.value.trim())
    await refreshConversations()
    if (editingConversationId.value === targetId && conversationId.value === targetId) {
      editingTitle.value = false
      editingConversationId.value = ''
    }
  } catch (exception) {
    error.value = getRequestErrorMessage(exception, '会话标题保存失败，请稍后重试。')
  } finally {
    titleSaving.value = false
  }
}

function applyStarterPrompt(draft: string) {
  input.value = draft
  nextTick(() => composerRef.value?.focus())
}

function toggleContextPanel() {
  showContextPanel.value = !showContextPanel.value
  if (showContextPanel.value) {
    void trackProductEvent({ eventType: 'context_panel_opened', page: 'chat', projectId: activeProjectId.value }).catch(() => undefined)
  }
}

function onChatScroll() {
  const element = chatListRef.value
  if (!element) return
  isNearBottom.value = isConversationNearBottom(element)
  if (isNearBottom.value) hasMessagesBelow.value = false
}

function scrollToBottom(smooth = true) {
  const element = chatListRef.value
  if (!element) return
  element.scrollTo({
    top: element.scrollHeight,
    behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'
  })
  isNearBottom.value = true
  hasMessagesBelow.value = false
}

async function cancelStreaming() {
  const controller = streamController.value
  const target = [...messages.value].reverse().find((message) => (
    message.role === 'assistant'
    && Boolean(message.turnId)
    && isActiveTurnPhase(message.phase)
  ))
  const turnId = target?.turnId || recoveringTurnId.value
  if (!turnId || !conversationId.value) {
    controller?.abort()
    return
  }

  try {
    const response = await cancelChatTurn(conversationId.value, turnId)
    if (target) Object.assign(target, historyMessage(response.data))
  } catch {
    if (target) {
      target.content ||= '已停止生成。'
      target.phase = 'FAILED'
      target.statusText = '已停止生成'
      applyImageBatchCancelled(target)
    }
  } finally {
    controller?.abort()
    clearRecoveryPolling()
    recoveringTurnId.value = ''
    loading.value = false
  }
}

async function submit(retryContext?: RetryTurnContext) {
  const retryUser = retryContext ? messages.value[retryContext.userIndex] : undefined
  const text = retryUser?.content ?? input.value.trim()
  if (loading.value || (!retryContext && composerDisabled.value)) return
  if (retryContext && (!retryUser || retryUser.role !== 'user' || !conversationId.value)) {
    error.value = '原消息无法恢复，请刷新后重试。'
    return
  }
  const attachmentIds = retryContext
    ? (retryUser?.attachments || []).map((attachment) => attachment.id)
    : attachmentDrafts.value.flatMap((draft) => draft.attachmentId ? [draft.attachmentId] : [])
  const attachmentsForDisplay = retryContext
    ? (retryUser?.attachments || [])
    : attachmentDrafts.value.flatMap((draft) => draft.attachment ? [draft.attachment] : [])
  const message = text || '请分析这些附件'
  const requestProjectId = activeProjectId.value
  const startsProjectConversation = !retryContext && Boolean(requestProjectId) && !hasUserMessages.value
  const turnId = retryContext?.turnId || crypto.randomUUID()

  if (!retryContext) {
    input.value = ''
    commitReadyAttachments()
  }
  loading.value = true
  error.value = ''
  streamController.value = new AbortController()

  let assistantIndex = retryContext?.assistantIndex ?? -1
  let streamError = ''

  try {
    const activeConversationId = retryContext ? conversationId.value : await ensureConversationId(message)
    if (!activeConversationId) throw new Error('会话尚未保存，无法重试。')
    if (retryContext) {
      messages.value[assistantIndex] = {
        role: 'assistant',
        content: '',
        turnId,
        phase: 'THINKING',
        statusText: '正在理解你的需求…'
      }
    } else {
      messages.value.push({
        role: 'user',
        content: message,
        attachments: attachmentsForDisplay.length ? attachmentsForDisplay : undefined
      })
      messages.value.push({
        role: 'assistant',
        content: '',
        turnId,
        phase: 'THINKING',
        statusText: '正在理解你的需求…'
      })
      assistantIndex = messages.value.length - 1
    }

    await streamMessage({
      conversationId: activeConversationId,
      turnId,
      projectId: requestProjectId,
      message,
      knowledgeBaseIds: selectedKnowledgeBaseId.value ? [selectedKnowledgeBaseId.value] : [],
      attachmentIds,
      retry: Boolean(retryContext)
    }, {
      onDelta: (chunk) => {
        messages.value[assistantIndex].content += chunk
        nextTick(() => {
          if (isNearBottom.value) scrollToBottom(false)
          else hasMessagesBelow.value = true
        })
      },
      onMeta: (meta) => {
        messages.value[assistantIndex].sources = sanitizeChatSources(meta.sources)
        messages.value[assistantIndex].agentTrace = sanitizeAgentTrace(meta.agentTrace)
        messages.value[assistantIndex].toolResults = sanitizeToolResults(meta.toolResults)
        messages.value[assistantIndex].candidateMemories = meta.candidateMemories || []
        messages.value[assistantIndex].candidateTasks = meta.candidateTasks || []
        messages.value[assistantIndex].candidateGoals = meta.candidateGoals || []
        messages.value[assistantIndex].candidateDecisions = meta.candidateDecisions || []
        messages.value[assistantIndex].candidateOpenQuestions = meta.candidateOpenQuestions || []
        messages.value[assistantIndex].candidatePlans = meta.candidatePlans || []
        messages.value[assistantIndex].executionSuggestions = sanitizeExecutionSuggestions(meta.executionSuggestions)
        messages.value[assistantIndex].projectContext = sanitizeProjectContext(meta.projectContext)
        messages.value[assistantIndex].review = sanitizeReview(meta.review)
      },
      onTurnStatus: (status) => {
        const target = messages.value[assistantIndex]
        target.turnId = status.turnId || target.turnId
        target.phase = status.phase
        target.statusText = status.message
      },
      onImageBatchStarted: (batch) => {
        applyImageBatchStarted(messages.value[assistantIndex], batch)
      },
      onImageItem: (item) => {
        applyImageItem(messages.value[assistantIndex], item)
      },
      onImageBatchCompleted: (batch) => {
        applyImageBatchCompleted(messages.value[assistantIndex], batch)
      },
      onError: (errorMessage) => {
        streamError = errorMessage
        messages.value[assistantIndex].content ||= errorMessage
        messages.value[assistantIndex].phase = 'FAILED'
        messages.value[assistantIndex].statusText = errorMessage
      },
      onDone: () => {
        streamController.value = null
      }
    }, {
      signal: streamController.value.signal
    })
    if (!streamError && startsProjectConversation && requestProjectId) {
      void trackEffectiveProgressAction({
        page: 'chat',
        actionType: 'project_chat',
        projectId: requestProjectId
      }).catch(() => undefined)
    }
    if (!retryContext && !streamError && window.matchMedia('(max-width: 959px)').matches) {
      void trackProductEvent({
        eventType: 'mobile_primary_action_used',
        page: 'chat',
        actionType: 'start_chat',
        projectId: requestProjectId
      }).catch(() => undefined)
    }
    await refreshConversations()
    await refreshBrief()
  } catch (exception) {
    if (exception instanceof DOMException && exception.name === 'AbortError') {
      if (assistantIndex >= 0) {
        messages.value[assistantIndex].content ||= '已停止生成。'
        messages.value[assistantIndex].phase = 'FAILED'
        messages.value[assistantIndex].statusText = '已停止生成'
        applyImageBatchCancelled(messages.value[assistantIndex])
        if (!messages.value[assistantIndex].content.includes('已停止生成。')) {
          messages.value[assistantIndex].content += '\n\n已停止生成。'
        }
      }
      return
    }
    const fallback = streamError || (exception instanceof Error ? exception.message : '') || '请求失败，请确认 Java 后端和 Python AI 服务已经启动。'
    if (assistantIndex >= 0) {
      messages.value[assistantIndex].content ||= fallback
      messages.value[assistantIndex].phase = 'FAILED'
      messages.value[assistantIndex].statusText = fallback
    }
    error.value = fallback
  } finally {
    loading.value = false
    streamController.value = null
  }
}

function retryFailedMessage(index: number) {
  if (loading.value) return
  const failed = messages.value[index]
  if (!failed?.turnId) {
    error.value = '该失败消息缺少轮次信息，请刷新后重试。'
    return
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages.value[cursor].role !== 'user') continue
    void submit({ userIndex: cursor, assistantIndex: index, turnId: failed.turnId })
    return
  }
  error.value = '未找到要重试的原消息，请刷新后重试。'
}

function handleAttachmentFiles(files: File[], source: 'picker' | 'drop' | 'paste') {
  void addAttachmentFiles(files, source)
}

function applyImageBatchStarted(message: Message, batch: ImageBatchStartedEvent) {
  message.turnId = batch.turnId || message.turnId
  message.phase = 'GENERATING'
  message.statusText = `正在生成 ${batch.count} 张图片…`
  message.imageBatch = {
    batchId: batch.batchId,
    count: batch.count,
    mode: batch.mode,
    status: 'RUNNING',
    completedCount: 0,
    failedCount: 0,
    items: batch.items.map((item) => ({ ...item }))
  }
}

function applyImageItem(message: Message, item: ImageItemEvent) {
  const batch = message.imageBatch
  if (!batch || batch.batchId !== item.batchId) return
  const existing = batch.items.findIndex((value) => value.index === item.index)
  const next: ImageBatchItem = {
    index: item.index,
    status: item.status,
    imageUrl: item.imageUrl,
    error: item.error
  }
  if (existing >= 0) batch.items.splice(existing, 1, next)
  else batch.items.push(next)
  batch.completedCount = item.completedCount
  batch.failedCount = batch.items.filter((value) => value.status === 'FAILED').length
  message.statusText = `已完成 ${batch.completedCount} / ${batch.count} 张图片`
}

function applyImageBatchCompleted(message: Message, event: ImageBatchCompletedEvent) {
  const batch = message.imageBatch
  if (!batch || batch.batchId !== event.batchId) return
  batch.status = event.status
  batch.completedCount = event.completedCount
  batch.failedCount = event.failedCount
}

function applyImageBatchCancelled(message: Message) {
  const batch = message.imageBatch
  if (!batch) return
  batch.status = 'CANCELLED'
  batch.items = cancelPendingImageItems(batch.items)
}

function syncPendingMemoriesToLatestAssistant(snapshot = briefMemory.value) {
  const pending = (snapshot?.structured_all || snapshot?.structured || [])
    .filter((item) => item.status === 'pending' && memoryBelongsToConversation(item, conversationId.value))
  if (!messages.value.length) return

  const targetByKey = new Map<string, number>()
  for (const item of pending) {
    const assistantIndex = findAssistantIndexForMemory(item)
    if (assistantIndex >= 0) {
      targetByKey.set(candidateKey(item), assistantIndex)
    }
  }

  messages.value.forEach((message, index) => {
    if (message.role !== 'assistant' || !message.candidateMemories?.length) return
    const next = message.candidateMemories.filter((item) => {
      if (item.status === 'active' || item.status === 'disabled') return true
      const targetIndex = targetByKey.get(candidateKey(item))
      return targetIndex === undefined || targetIndex === index
    })
    if (next.length !== message.candidateMemories.length) {
      message.candidateMemories = next
    }
  })

  for (const item of pending) {
    const assistantIndex = targetByKey.get(candidateKey(item))
    if (assistantIndex === undefined) continue

    const message = messages.value[assistantIndex]
    const existing = new Set((message.candidateMemories || []).map((candidate) => candidateKey(candidate)))
    if (!existing.has(candidateKey(item))) {
      message.candidateMemories = [...(message.candidateMemories || []), item]
    }
  }
}

function findAssistantIndexForMemory(item: MemoryItem) {
  const sourceText = normaliseCandidateValue(memorySourceText(item))
  if (!sourceText) return -1

  for (let index = 0; index < messages.value.length - 1; index += 1) {
    const message = messages.value[index]
    if (message.role !== 'user') continue
    const userText = normaliseCandidateValue(message.content)
    if (!userText || (userText !== sourceText && !userText.includes(sourceText) && !sourceText.includes(userText))) {
      continue
    }
    for (let nextIndex = index + 1; nextIndex < messages.value.length; nextIndex += 1) {
      if (messages.value[nextIndex].role === 'assistant') return nextIndex
      if (messages.value[nextIndex].role === 'user') break
    }
  }
  return -1
}

function formatTraceDetail(item: AgentTraceItem) {
  const { agent, ...detail } = item
  return Object.keys(detail).length ? JSON.stringify(detail, null, 2) : ''
}

function formatToolDebug(tool: ToolResult) {
  const lines = [`${tool.tool}：${tool.content || ''}`]
  if (tool.tool === 'image_generate') {
    if (tool.model) lines.push(`模型：${tool.model}`)
    if (tool.storageRequested || tool.storageUsed) {
      lines.push(`存储：${tool.storageRequested || '-'} -> ${tool.storageUsed || '-'}`)
    }
    if (tool.imageUrl) lines.push(`图片：${tool.imageUrl}`)
    if (tool.storageError) lines.push(`存储错误：${tool.storageError}`)
  }
  return lines.join('\n')
}

function userDisplayText(message: Message) {
  return message.content.replace(/\n?图片\d*\s*：https?:\/\/\S+/g, '').trim()
}

function userImages(message: Message) {
  if (message.images?.length) {
    return message.images
  }
  const matches = message.content.matchAll(/图片\d*\s*：(https?:\/\/\S+)/g)
  return Array.from(matches).map((matched, index) => ({
    name: `已上传图片 ${index + 1}`,
    url: matched[1],
    previewUrl: matched[1]
  }))
}

function assistantTextContent(message: Message) {
  return message.content.replace(/!\[[^\]]*]\(https?:\/\/[^)\s]+\)/g, '').trim()
}

function assistantImages(message: Message) {
  if (message.imageBatch) return []
  const matches = message.content.matchAll(/!\[([^\]]*)]\((https?:\/\/[^)\s]+)\)/g)
  return Array.from(matches).map((match) => ({
    alt: match[1] || '图片',
    url: match[2]
  }))
}

function showAssistantStatus(message: Message) {
  return message.role === 'assistant'
    && message.phase !== 'COMPLETED'
    && Boolean(message.statusText)
}

async function copyDebugPayload(message: Message, index: number) {
  const payload = {
    agentTrace: message.agentTrace || [],
    toolResults: message.toolResults || [],
    sources: message.sources || [],
    projectContext: message.projectContext || {},
    review: message.review || {}
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    traceCopyState.value[index] = 'copied'
  } catch {
    traceCopyState.value[index] = 'failed'
  }
  window.setTimeout(() => {
    if (!traceCopyState.value[index]) return
    const nextState = { ...traceCopyState.value }
    delete nextState[index]
    traceCopyState.value = nextState
  }, 1600)
}

function writerInputSummary(item: AgentTraceItem) {
  if (item.agent !== 'writer_agent') return ''
  const writerInput = item.writerInput as Record<string, unknown> | undefined
  if (!writerInput) return ''
  const parts = [
    `记忆 ${writerInput.memoryContextChars || 0} 字`,
    `工具 ${writerInput.toolContextChars || 0} 字`,
    `RAG ${writerInput.ragContextCount || 0} 段`,
    `合计 ${writerInput.combinedContextChars || 0} 字`
  ]
  return parts.join(' · ')
}

function traceSummary(item: AgentTraceItem) {
  if (item.agent === 'writer_agent') {
    const parts = []
    if (typeof item.answerChars === 'number') parts.push(`回答 ${item.answerChars} 字`)
    const writerInput = item.writerInput as Record<string, unknown> | undefined
    if (typeof writerInput?.combinedContextChars === 'number') parts.push(`上下文 ${writerInput.combinedContextChars} 字`)
    if (item.streaming === true) parts.push('流式')
    if (typeof item.rewriteAttempt === 'number') parts.push(`第 ${Number(item.rewriteAttempt) + 1} 次生成`)
    return parts.join(' · ')
  }

  if (item.agent === 'memory_agent') {
    const summary = item.memorySummary as Record<string, unknown> | undefined
    if (!summary) return ''
    const parts = [
      `长期摘要 ${summary.summaryChars || 0} 字`,
      `短期 ${summary.shortTermCount || 0} 条`,
      `结构化 ${summary.structuredCount || 0} 条`,
      `语义 ${summary.semanticCount || 0} 条`,
      `注入 ${summary.retrievedCount || 0} 条`
    ]
    return parts.join(' · ')
  }

  if (item.agent === 'tool_agent') {
    const tools = Array.isArray(item.selectedTools) ? item.selectedTools.join(', ') : ''
    const count = typeof item.toolCount === 'number' ? `${item.toolCount} 个工具` : ''
    return [count, tools].filter(Boolean).join(' · ')
  }

  if (item.agent === 'rag_agent') {
    const contextCount = typeof item.contextCount === 'number' ? `命中 ${item.contextCount} 段` : ''
    const queryCount = typeof item.queryCount === 'number' ? `Query ${item.queryCount} 个` : ''
    return [contextCount, queryCount].filter(Boolean).join(' · ')
  }

  return ''
}

function agentStatus(item: AgentTraceItem) {
  if (item.approved === false) return '未通过'
  if (item.approved === true && item.skipped === true) return '规则通过'
  if (item.skipped === true) return '已跳过'
  if (item.action === 'write') return '写入'
  if (item.approved === true) return '通过'
  return '执行'
}

function agentNodeClass(item: AgentTraceItem) {
  return {
    skipped: item.skipped === true && item.approved !== true,
    approved: item.approved === true,
    rejected: item.approved === false,
    write: item.action === 'write'
  }
}

function agentDecision(item: AgentTraceItem) {
  const decision = item.decision as Record<string, unknown> | undefined
  if (!decision) return ''
  const depth = decision.depth ? ` · ${decision.depth}` : ''
  const reason = decision.reason ? ` · ${decision.reason}` : ''
  const tools = Array.isArray(decision.selected_tools) && decision.selected_tools.length
    ? ` · ${decision.selected_tools.join(', ')}`
    : ''
  return `${agentStatus(item)}${depth}${tools}${reason}`
}

function reviewText(review?: Record<string, unknown>) {
  if (!review || Object.keys(review).length === 0) return ''
  const approved = review.approved === undefined ? '未开启' : review.approved ? '通过' : '未通过'
  const score = review.score === undefined ? '' : ` / 分数 ${review.score}`
  const reason = review.reason ? ` / ${review.reason}` : ''
  return `${approved}${score}${reason}`
}

function reviewStatusText(review?: Record<string, unknown>) {
  if (!review || Object.keys(review).length === 0) return '无结果'
  if (review.approved === false) return '未通过'
  if (review.skipped === true) return '规则通过'
  return '通过'
}

function reviewRuleText(review?: Record<string, unknown>) {
  const rule = String(review?.v3Rule || '')
  const labels: Record<string, string> = {
    connector_failure: '连接器失败检查',
    plan_confirmation: '长任务确认检查',
    project_fact_grounding: '项目事实来源检查',
    project_clarification: '项目归属澄清检查'
  }
  if (rule) return labels[rule] || rule
  if (review?.ruleBlocked) return '基础规则拦截'
  if (review?.skipped) return '规则审核'
  return '模型审核'
}

function reviewReason(review?: Record<string, unknown>) {
  return String(review?.reason || '无原因')
}

function reviewRewriteInstruction(review?: Record<string, unknown>) {
  return String(review?.rewrite_instruction || '')
}

function reviewCardClass(review?: Record<string, unknown>) {
  return {
    rejected: review?.approved === false,
    passed: review?.approved === true
  }
}

function sourceSnippet(source: ChatSource, limit = 220) {
  const chunk = source.chunk.trim()
  return chunk.length > limit ? `${chunk.slice(0, limit)}...` : chunk
}

function sourceFileName(source: ChatSource) {
  return source.title.replace(/\s+#\d+\s*$/, '') || source.title || `文档 ${source.docId}`
}

function sourceSegmentLabel(source: ChatSource) {
  const match = source.title.match(/#(\d+)\s*$/)
  return match ? `片段 ${match[1]}` : '片段'
}

function sourceRetrievalLabel(source: ChatSource) {
  const modes = source.hitModes || source.backend
  if (!modes) return ''
  return `${modes}${source.score ? ` · ${source.score}` : ''}`
}

function sourceCardKey(source: ChatSource, index: number) {
  return `${source.docId}-${source.title}-${index}`
}

function projectResolver(message: Message) {
  return message.projectContext?.resolver
}

function projectContext(message: Message) {
  return message.projectContext?.context
}

function projectConfidenceText(message: Message) {
  const confidence = projectResolver(message)?.confidence
  return typeof confidence === 'number' ? `${Math.round(confidence * 100)}%` : '未评分'
}

function projectSuggestions(message: Message) {
  return projectContext(message)?.nextStepSuggestions || []
}

function usedMemorySummary(message: Message) {
  const trace = (message.agentTrace || []).find((item) => item.agent === 'memory_agent')
  return trace?.memorySummary as Record<string, unknown> | undefined
}

function usedMemoryItems(message: Message) {
  const summary = usedMemorySummary(message)
  if (!summary) return []
  const items: Array<{ label: string; value: string; meta: string }> = []
  const structured = Array.isArray(summary.structuredPreview) ? summary.structuredPreview : []
  for (const raw of structured) {
    const parsed = parseMemoryPreview(String(raw || ''))
    if (parsed.value) {
      items.push({
        label: structuredMemoryLabel(parsed.key),
        value: parsed.value,
        meta: '结构化记忆'
      })
    }
  }
  const summaryPreview = String(summary.summaryPreview || '').trim()
  if (summaryPreview) {
    items.push({ label: '长期摘要', value: summaryPreview, meta: '摘要记忆' })
  }
  const retrieved = Array.isArray(summary.retrievedPreview) ? summary.retrievedPreview : []
  for (const raw of retrieved.slice(0, 3)) {
    const value = String(raw || '').trim()
    if (value) {
      items.push({ label: '相关片段', value, meta: '向量召回' })
    }
  }
  return items.slice(0, 8)
}

function parseMemoryPreview(value: string) {
  const separator = value.indexOf('=')
  if (separator < 0) return { key: '', value }
  return {
    key: value.slice(0, separator).trim(),
    value: value.slice(separator + 1).trim()
  }
}

function structuredMemoryLabel(key: string) {
  if (!key) return '记忆'
  return memoryKeyLabels[key] ? `${memoryKeyLabels[key]} (${key})` : key
}

function pendingCandidateMemories(message: Message) {
  const items = dedupeCandidateMemories(
    (message.candidateMemories || []).filter((item) => item.status !== 'active' && item.status !== 'disabled')
  )
  if (!hasPendingProjectCandidates(message)) return items
  return items.filter((item) => !['goal', 'current_project', 'constraint'].includes(memoryTargetKey(item)))
}

function pendingCandidateTasks(message: Message) {
  return (message.candidateTasks || []).filter((item) => item.status !== 'active' && item.status !== 'disabled')
}

function pendingCandidateGoals(message: Message) {
  return (message.candidateGoals || []).filter((item) => item.status !== 'active' && item.status !== 'disabled')
}

function pendingCandidateDecisions(message: Message) {
  return (message.candidateDecisions || []).filter((item) => item.status !== 'active' && item.status !== 'disabled')
}

function pendingCandidateOpenQuestions(message: Message) {
  return (message.candidateOpenQuestions || []).filter((item) => item.status !== 'active' && item.status !== 'disabled')
}

function pendingCandidatePlans(message: Message) {
  return (message.candidatePlans || []).filter((item) => item.status !== 'active' && item.status !== 'disabled')
}

function pendingOperations(message: Message) {
  return (message.toolResults || [])
    .filter((item) => item.requiresConfirmation && item.operation && item.operation.status === 'pending')
    .map((item) => item.operation as PendingOperationItem)
    .filter((item) => !(hasPendingProjectCandidates(message) && item.operationType === 'todo.create'))
}

function hasPendingProjectCandidates(message: Message) {
  return Boolean(
    pendingCandidateGoals(message).length ||
    pendingCandidateDecisions(message).length ||
    pendingCandidateOpenQuestions(message).length ||
    pendingCandidatePlans(message).length
  )
}

function operationKey(item: PendingOperationItem) {
  return `operation:${item.id}`
}

function operationPayloadText(item: PendingOperationItem) {
  const payload = item.payload || {}
  if (item.operationType === 'todo.create') {
    return [`标题：${payload.title || '-'}`, `截止时间：${formatOperationTime(payload.dueAt)}`].join(' · ')
  }
  if (item.operationType === 'calendar.create') {
    return [`标题：${payload.title || '-'}`, `开始时间：${formatOperationTime(payload.startsAt)}`].join(' · ')
  }
  return Object.keys(payload).length ? JSON.stringify(payload) : '详细参数已隐藏'
}

function formatOperationTime(value: unknown) {
  if (!value) return '未设置'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

function candidateKey(item: MemoryItem) {
  return item.key || `${item.schemaPath || item.targetKey || 'memory'}:${item.value || ''}`
}

function dedupeCandidateMemories(items: MemoryItem[]) {
  const byTarget = new Map<string, MemoryItem>()
  for (const item of items) {
    const target = memoryTargetKey(item) || item.schemaPath || item.key || 'memory'
    const value = normaliseCandidateValue(item.value || item.text || '')
    const existing = byTarget.get(target)
    if (!existing) {
      byTarget.set(target, item)
      continue
    }
    const existingValue = normaliseCandidateValue(existing.value || existing.text || '')
    if (value && existingValue && (value.includes(existingValue) || existingValue.includes(value))) {
      if (value.length < existingValue.length) {
        byTarget.set(target, item)
      }
      continue
    }
    byTarget.set(`${target}:${value}`, item)
  }
  return Array.from(byTarget.values())
}

function normaliseCandidateValue(value: string) {
  return value.replace(/[\s，。,.!！?？：:、"'“”‘’（）()[\]【】]/g, '')
}

function memoryBelongsToConversation(item: MemoryItem, currentConversationId?: string) {
  if (!currentConversationId) return false
  const sourceConversationId = memorySourceConversationId(item)
  return sourceConversationId === currentConversationId
}

function memorySourceConversationId(item: MemoryItem) {
  const source = item.source || item.sourceRef || ''
  const match = source.match(/^source_ref:conversation:([^\n]+)|^conversation:([^\n]+)/)
  return match?.[1] || match?.[2] || ''
}

function memorySourceText(item: MemoryItem) {
  const source = item.source || ''
  const match = source.match(/^source_ref:[^\n]+\n?([\s\S]*)$/)
  return (match?.[1] || item.sourceText || '').trim()
}

function memoryTargetKey(item: MemoryItem) {
  const key = item.schemaPath || item.targetKey || item.key || ''
  if (key.startsWith('pending:')) {
    return key.split(':').slice(2).join(':') || key
  }
  return key
}

function setCandidateTargetKey(item: MemoryItem, value: string) {
  item.targetKey = value.trim()
}

function setCandidateValue(item: MemoryItem, value: string) {
  item.value = value
}

function updateCandidateTargetKey(item: MemoryItem, event: Event) {
  setCandidateTargetKey(item, (event.target as HTMLInputElement).value)
}

function updateCandidateValue(item: MemoryItem, event: Event) {
  setCandidateValue(item, (event.target as HTMLInputElement).value)
}

async function confirmCandidateMemory(message: Message, item: MemoryItem) {
  const targetKey = memoryTargetKey(item).trim()
  const value = (item.value || '').trim()
  if (!targetKey || !value) return

  const actionKey = candidateKey(item)
  memoryActionLoading.value[actionKey] = true
  try {
    await saveStructuredMemory(targetKey, value, item.confidence ?? 0.8, item.source || 'chat_candidate')
    if (item.key && item.key !== targetKey) {
      await purgeStructuredMemory(item.key)
    }
    item.status = 'active'
    item.targetKey = targetKey
    message.candidateMemories = [...(message.candidateMemories || [])]
    await refreshBrief()
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : '记忆确认失败，请稍后重试。'
  } finally {
    memoryActionLoading.value[actionKey] = false
  }
}

async function dismissCandidateMemory(message: Message, item: MemoryItem) {
  const actionKey = candidateKey(item)
  memoryActionLoading.value[actionKey] = true
  try {
    if (item.key) {
      await changeStructuredMemoryStatus(item.key, 'disabled')
    }
    item.status = 'disabled'
    message.candidateMemories = [...(message.candidateMemories || [])]
    await refreshBrief()
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : '记忆忽略失败，请稍后重试。'
  } finally {
    memoryActionLoading.value[actionKey] = false
  }
}

function taskKey(item: CandidateTaskItem) {
  return `${item.type}:${item.title}:${item.dueAt || ''}`
}

function projectCandidateKey(item: CandidateGoalItem | CandidateDecisionItem | CandidateOpenQuestionItem) {
  const content = 'title' in item ? item.title : item.question
  return `${item.type}:${item.projectId}:${content}`
}

function planCandidateKey(item: CandidatePlanItem) {
  return `plan:${item.projectId || 'none'}:${item.title}`
}

function setCandidateTaskTitle(item: CandidateTaskItem, event: Event) {
  item.title = (event.target as HTMLInputElement).value
}

function setCandidateTaskDueAt(item: CandidateTaskItem, event: Event) {
  item.dueAt = (event.target as HTMLInputElement).value || null
}

function taskDueInputValue(item: CandidateTaskItem) {
  if (!item.dueAt) return ''
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(item.dueAt)) return item.dueAt
  const date = new Date(item.dueAt)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function taskDueApiValue(item: CandidateTaskItem) {
  if (!item.dueAt) return null
  const date = new Date(item.dueAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

async function confirmCandidateTask(message: Message, item: CandidateTaskItem) {
  const title = item.title.trim()
  if (!title) return

  const actionKey = taskKey(item)
  taskActionLoading.value[actionKey] = true
  item.error = ''
  try {
    await createAgentTodo(title, taskDueApiValue(item), conversationId.value)
    item.status = 'active'
    message.candidateTasks = [...(message.candidateTasks || [])]
    await refreshBrief()
  } catch (exception) {
    item.error = getRequestErrorMessage(exception, '任务创建失败，请稍后重试。')
    error.value = item.error
  } finally {
    taskActionLoading.value[actionKey] = false
  }
}

function dismissCandidateTask(message: Message, item: CandidateTaskItem) {
  item.status = 'disabled'
  message.candidateTasks = [...(message.candidateTasks || [])]
}

async function confirmCandidateGoal(message: Message, item: CandidateGoalItem) {
  const key = projectCandidateKey(item)
  projectCandidateActionLoading.value[key] = true
  item.error = ''
  try {
    await createGoal({
      projectId: item.projectId,
      title: item.title,
      description: item.description || item.source || '',
      horizon: item.horizon || 'week'
    })
    item.status = 'active'
    message.candidateGoals = [...(message.candidateGoals || [])]
  } catch (exception) {
    item.error = getRequestErrorMessage(exception, '目标确认失败，请稍后重试。')
    error.value = item.error
  } finally {
    projectCandidateActionLoading.value[key] = false
  }
}

async function confirmCandidateDecision(message: Message, item: CandidateDecisionItem) {
  const key = projectCandidateKey(item)
  projectCandidateActionLoading.value[key] = true
  item.error = ''
  try {
    await createProjectDecision(item.projectId, {
      title: item.title,
      content: item.content,
      rationale: item.rationale || '',
      sourceType: 'conversation',
      sourceId: conversationId.value
    })
    item.status = 'active'
    message.candidateDecisions = [...(message.candidateDecisions || [])]
  } catch (exception) {
    item.error = getRequestErrorMessage(exception, '决策确认失败，请稍后重试。')
    error.value = item.error
  } finally {
    projectCandidateActionLoading.value[key] = false
  }
}

async function confirmCandidateOpenQuestion(message: Message, item: CandidateOpenQuestionItem) {
  const key = projectCandidateKey(item)
  projectCandidateActionLoading.value[key] = true
  item.error = ''
  try {
    await createProjectOpenQuestion(item.projectId, {
      question: item.question,
      sourceType: 'conversation',
      sourceId: conversationId.value
    })
    item.status = 'active'
    message.candidateOpenQuestions = [...(message.candidateOpenQuestions || [])]
  } catch (exception) {
    item.error = getRequestErrorMessage(exception, '开放问题确认失败，请稍后重试。')
    error.value = item.error
  } finally {
    projectCandidateActionLoading.value[key] = false
  }
}

function dismissProjectCandidate(
  message: Message,
  item: CandidateGoalItem | CandidateDecisionItem | CandidateOpenQuestionItem
) {
  item.status = 'disabled'
  message.candidateGoals = [...(message.candidateGoals || [])]
  message.candidateDecisions = [...(message.candidateDecisions || [])]
  message.candidateOpenQuestions = [...(message.candidateOpenQuestions || [])]
}

async function confirmCandidatePlan(message: Message, item: CandidatePlanItem) {
  const key = planCandidateKey(item)
  projectCandidateActionLoading.value[key] = true
  item.error = ''
  try {
    const response = await createAgentPlan({
      projectId: item.projectId || undefined,
      conversationId: conversationId.value,
      title: item.title,
      objective: item.objective,
      steps: item.steps
    })
    item.createdPlan = response.data
    item.status = 'active'
    message.candidatePlans = [...(message.candidatePlans || [])]
  } catch (exception) {
    item.error = getRequestErrorMessage(exception, '计划创建失败，请稍后重试。')
    error.value = item.error
  } finally {
    projectCandidateActionLoading.value[key] = false
  }
}

function dismissCandidatePlan(message: Message, item: CandidatePlanItem) {
  item.status = 'disabled'
  message.candidatePlans = [...(message.candidatePlans || [])]
}

function pendingExecutionSuggestions(message: Message) {
  return (message.executionSuggestions || []).filter((item) => item.status === 'pending')
}

function executionSuggestionKey(item: ExecutionSuggestionItem) {
  return `${item.type}:${item.id}`
}

async function acceptExecutionSuggestion(message: Message, item: ExecutionSuggestionItem) {
  const key = executionSuggestionKey(item)
  executionSuggestionActionLoading.value[key] = true
  item.error = ''
  try {
    if (item.action === 'create_workflow') {
      item.status = 'active'
      message.executionSuggestions = [...(message.executionSuggestions || [])]
      const workflow = isRecord(item.payload.workflow) ? item.payload.workflow : {}
      const originalIntent = typeof workflow.description === 'string' && workflow.description.trim()
        ? workflow.description
        : `${item.title}。${item.description}`
      const handoffId = workspace.stageAutomationIntent(originalIntent, activeProjectId.value)
      await router.push({
        path: '/automations',
        query: { handoffId }
      })
      return
    }
    const safeId = item.type === 'cli' ? positiveId(item.payload.workspaceId) : positiveId(item.payload.toolId)
    await router.push({
      path: '/advanced-settings',
      query: {
        tab: item.type === 'cli' ? 'cli' : 'mcp',
        ...(safeId ? { [item.type === 'cli' ? 'workspaceId' : 'toolId']: String(safeId) } : {})
      }
    })
  } catch (exception) {
    item.error = getRequestErrorMessage(exception, '执行建议处理失败，请稍后重试。')
    error.value = item.error
  } finally {
    executionSuggestionActionLoading.value[key] = false
  }
}

function dismissExecutionSuggestion(message: Message, item: ExecutionSuggestionItem) {
  item.status = 'disabled'
  message.executionSuggestions = [...(message.executionSuggestions || [])]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function positiveId(value: unknown): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function executionSuggestionActionLabel(item: ExecutionSuggestionItem) {
  if (item.action === 'create_workflow') return '生成安全预览'
  return item.type === 'cli' ? '检查命令' : '检查工具'
}

async function confirmOperation(message: Message, item: PendingOperationItem) {
  const key = operationKey(item)
  operationActionLoading.value[key] = true
  item.error = ''
  try {
    const response = await confirmPendingOperation(item.id)
    item.status = response.data.operation.status
    message.toolResults = [...(message.toolResults || [])]
    await refreshBrief()
  } catch (exception) {
    item.error = getRequestErrorMessage(exception, '操作确认失败，请稍后重试。')
    error.value = item.error
  } finally {
    operationActionLoading.value[key] = false
  }
}

async function rejectOperation(message: Message, item: PendingOperationItem) {
  const key = operationKey(item)
  operationActionLoading.value[key] = true
  item.error = ''
  try {
    const response = await rejectPendingOperation(item.id)
    item.status = response.data.operation.status
    message.toolResults = [...(message.toolResults || [])]
    await refreshBrief()
  } catch (exception) {
    item.error = getRequestErrorMessage(exception, '操作拒绝失败，请稍后重试。')
    error.value = item.error
  } finally {
    operationActionLoading.value[key] = false
  }
}

function getRequestErrorMessage(exception: unknown, fallback: string) {
  const responseData = (exception as { response?: { data?: unknown } })?.response?.data
  if (typeof responseData === 'string') return responseData
  if (responseData && typeof responseData === 'object') {
    const data = responseData as Record<string, unknown>
    const message = data.message || data.error || data.detail
    if (typeof message === 'string' && message.trim()) return message
  }
  return exception instanceof Error ? exception.message : fallback
}

function isOverdueTodo(item: AgentTodoItem) {
  return item.status === 'open' && Boolean(item.dueAt) && new Date(item.dueAt as string).getTime() < Date.now()
}

function isToday(value?: string | null) {
  if (!value) return false
  const date = new Date(value)
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

function isThisWeek(value?: string | null) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  const now = new Date()
  const start = new Date(now)
  const day = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - day)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return date >= start && date < end
}

function formatBriefTime(value?: string | null) {
  if (!value) return '未设时间'
  return new Date(value).toLocaleString()
}

function renderAssistantContent(content: string) {
  return renderMarkdown(content)
}

function renderMarkdown(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.trim().startsWith('```')) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    if (isMarkdownTable(lines, index)) {
      const tableLines: string[] = []
      tableLines.push(lines[index], lines[index + 1])
      index += 2
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        tableLines.push(lines[index])
        index += 1
      }
      blocks.push(renderTable(tableLines))
      continue
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push('<hr />')
      index += 1
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(`<li>${renderInline(lines[index].replace(/^\s*[-*]\s+/, ''))}</li>`)
        index += 1
      }
      blocks.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(`<li>${renderInline(lines[index].replace(/^\s*\d+\.\s+/, ''))}</li>`)
        index += 1
      }
      blocks.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    const paragraphLines = [line]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trim().startsWith('```') &&
      !isMarkdownTable(lines, index) &&
      !/^---+$/.test(lines[index].trim()) &&
      !/^(#{1,4})\s+/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index])
      index += 1
    }
    blocks.push(`<p>${paragraphLines.map(renderInline).join('<br />')}</p>`)
  }

  return blocks.join('')
}

function isMarkdownTable(lines: string[], index: number) {
  return Boolean(
    lines[index]?.trim().startsWith('|') &&
    lines[index + 1] &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  )
}

function renderTable(lines: string[]) {
  const rows = lines
    .filter((_, index) => index !== 1)
    .map((line) => splitTableRow(line).map((cell) => renderInline(cell.trim())))
  const [head = [], ...body] = rows
  const thead = `<thead><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>`
  return `<div class="markdown-table-wrap"><table>${thead}${tbody}</table></div>`
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
}

function renderInline(text: string) {
  return escapeHtml(text)
    .replace(
      /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a class="generated-image-link" href="$2" target="_blank" rel="noreferrer"><img class="generated-image" src="$2" alt="$1" loading="lazy" onerror="this.closest(\'.generated-image-link\').remove()" /></a>'
    )
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>AI 聊天</h1>
        <form v-if="editingTitle" class="title-editor" @submit.prevent="saveTitle">
          <input v-model="titleDraft" maxlength="120" aria-label="会话标题" />
          <button type="submit" :disabled="titleSaving || !titleDraft.trim()">{{ titleSaving ? '保存中…' : '保存' }}</button>
          <button
            class="secondary"
            type="button"
            :disabled="titleSaving"
            @click="editingTitle = false; editingConversationId = ''"
          >取消</button>
        </form>
        <p v-else class="muted conversation-title-line">
          {{ activeConversationTitle }} · {{ activeKnowledgeBaseName }}
          <button v-if="conversationId" class="inline secondary" type="button" @click="startTitleEdit">编辑标题</button>
        </p>
      </div>
      <div class="row toolbar-controls">
        <div v-if="debugControlsEnabled" class="debug-controls">
          <label class="debug-toggle">
            <input v-model="showDebug" type="checkbox" />
            调试信息
          </label>
          <button class="secondary debug-exit" type="button" @click="exitDebugMode">退出调试</button>
        </div>
        <button class="secondary context-toggle" type="button" aria-label="上下文" :aria-pressed="showContextPanel" @click="toggleContextPanel">
          <PanelRightOpen :size="16" aria-hidden="true" />
          当前上下文
        </button>
        <button class="secondary" type="button" @click="newConversation">新建</button>
      </div>
    </div>

    <p v-if="error" class="alert danger">{{ error }}</p>
    <p v-if="briefError" class="alert danger">{{ briefError }}</p>

    <div class="chat-workspace" :class="{ 'context-closed': !showContextPanel }">
    <div ref="chatListRef" class="panel chat-list" role="log" aria-label="对话消息" aria-live="polite" @scroll="onChatScroll">
      <div v-if="initializing" class="empty-state">
        <strong>正在加载会话和知识库</strong>
        <span>请稍候。</span>
      </div>
      <section v-else-if="!hasUserMessages" class="chat-starter" aria-labelledby="chat-starter-title">
        <div>
          <p class="eyebrow">从一项具体工作开始</p>
          <h2 id="chat-starter-title">今天想推进什么？</h2>
          <p class="muted">选择一个常用入口，或直接在下方描述你想得到的结果。</p>
        </div>
        <div class="starter-grid">
          <SuggestionCard
            v-for="starter in starterPrompts"
            :key="starter.title"
            :title="starter.title"
            :description="starter.description"
            compact
            @select="applyStarterPrompt(starter.draft)"
          />
        </div>
      </section>
      <div v-for="(message, index) in messages" :key="index" class="message" :class="message.role">
        <template v-if="message.role === 'user'">
          <MessageAttachments v-if="message.attachments?.length" :attachments="message.attachments" />
          <div v-else-if="userImages(message).length" class="uploaded-image-grid">
            <a
              v-for="image in userImages(message)"
              :key="image.url"
              class="uploaded-image-card"
              :href="image.url"
              target="_blank"
              rel="noreferrer"
            >
              <img :src="image.previewUrl || image.url" :alt="image.name" />
            </a>
          </div>
          <div v-if="userDisplayText(message)" class="message-bubble message-content">
            {{ userDisplayText(message) }}
          </div>
        </template>

        <template v-else>
          <div
            v-if="showAssistantStatus(message)"
            class="turn-status"
            :class="`phase-${message.phase?.toLowerCase()}`"
          >
            <span class="turn-status-dot" aria-hidden="true"></span>
            <span>{{ message.statusText }}</span>
          </div>
          <GeneratedImageGrid v-if="message.imageBatch" :items="message.imageBatch.items" @retry="retryFailedMessage(index)" />
          <div
            v-if="assistantTextContent(message)"
            class="message-bubble message-content markdown"
            v-html="renderAssistantContent(assistantTextContent(message))"
          ></div>
          <a
            v-for="image in assistantImages(message)"
            :key="image.url"
            class="generated-image-link generated-image-bubble"
            :href="image.url"
            target="_blank"
            rel="noreferrer"
          >
            <img class="generated-image" :src="image.url" :alt="image.alt" loading="lazy" />
          </a>
          <div v-if="!message.content && !message.statusText" class="message-bubble message-content">
            <span class="typing-cursor">正在生成回答</span>
          </div>
          <MessageFailureActions v-if="message.phase === 'FAILED' && !loading" @retry="retryFailedMessage(index)" />
        </template>

        <div
          v-if="message.role === 'assistant' && projectResolver(message)?.projectId"
          class="source-panel project-context-panel"
        >
          <div class="source-panel-head">
            <strong>当前项目：{{ projectResolver(message)?.projectName }}</strong>
            <span class="badge">{{ projectConfidenceText(message) }}</span>
          </div>
          <p class="muted">{{ projectResolver(message)?.reason }}</p>
          <RouterLink class="inline-link" :to="`/projects/${projectResolver(message)?.projectId}`">打开项目页</RouterLink>
          <div v-if="projectContext(message)?.goals?.length" class="memory-used-card">
            <strong>进行中目标</strong>
            <span>{{ projectContext(message)?.goals?.slice(0, 3).map((goal) => goal.title).join('、') }}</span>
            <small>来自项目空间</small>
          </div>
          <div v-if="projectSuggestions(message).length" class="stack">
            <div v-for="suggestion in projectSuggestions(message).slice(0, 3)" :key="suggestion" class="brief-focus-item">
              <strong>{{ suggestion }}</strong>
            </div>
          </div>
        </div>

        <div v-if="message.role === 'assistant' && message.sources?.length" class="source-panel">
          <div class="source-panel-head">
            <strong>资料来源</strong>
            <span class="badge">{{ message.sources.length }} 条</span>
          </div>
          <details
            v-for="(source, sourceIndex) in message.sources"
            :key="sourceCardKey(source, sourceIndex)"
            class="source-card"
          >
            <summary>
              <span class="source-index">{{ sourceIndex + 1 }}</span>
              <span>
                <strong>{{ sourceFileName(source) }}</strong>
                <small>
                  {{ sourceSegmentLabel(source) }} · 文档 {{ source.docId }}
                  <template v-if="sourceRetrievalLabel(source)"> · {{ sourceRetrievalLabel(source) }}</template>
                </small>
              </span>
            </summary>
            <p>{{ sourceSnippet(source) }}</p>
            <pre>{{ source.chunk }}</pre>
          </details>
        </div>

        <div v-if="showDebug && message.role === 'assistant' && usedMemoryItems(message).length" class="source-panel memory-used-panel">
          <div class="source-panel-head">
            <strong>本轮使用记忆</strong>
            <span class="badge">{{ usedMemoryItems(message).length }} 条</span>
          </div>
          <div
            v-for="item in usedMemoryItems(message)"
            :key="`${item.meta}-${item.label}-${item.value}`"
            class="memory-used-card"
          >
            <strong>{{ item.label }}</strong>
            <span>{{ item.value }}</span>
            <small>{{ item.meta }}</small>
          </div>
        </div>

        <div v-if="message.role === 'assistant' && pendingCandidateMemories(message).length" class="candidate-memory-list">
          <div class="candidate-memory-title">
            <span>待确认记忆</span>
            <span class="badge pending">{{ pendingCandidateMemories(message).length }} 条</span>
          </div>
          <article
            v-for="candidate in pendingCandidateMemories(message)"
            :key="candidateKey(candidate)"
            class="candidate-memory-card"
          >
            <div class="candidate-memory-fields">
              <label>
                <span>类型</span>
                <input
                  :value="memoryTargetKey(candidate)"
                  :disabled="memoryActionLoading[candidateKey(candidate)]"
                  @input="updateCandidateTargetKey(candidate, $event)"
                />
              </label>
              <label>
                <span>内容</span>
                <input
                  :value="candidate.value || ''"
                  :disabled="memoryActionLoading[candidateKey(candidate)]"
                  @input="updateCandidateValue(candidate, $event)"
                />
              </label>
            </div>
            <small class="memory-meta">置信度 {{ candidate.confidence ?? 0.8 }} · {{ candidate.source || '本轮对话' }}</small>
            <div class="candidate-memory-actions">
              <button
                type="button"
                :disabled="memoryActionLoading[candidateKey(candidate)] || !memoryTargetKey(candidate).trim() || !String(candidate.value || '').trim()"
                @click="confirmCandidateMemory(message, candidate)"
              >
                确认
              </button>
              <button
                class="secondary"
                type="button"
                :disabled="memoryActionLoading[candidateKey(candidate)]"
                @click="dismissCandidateMemory(message, candidate)"
              >
                忽略
              </button>
            </div>
          </article>
        </div>

        <div v-if="message.role === 'assistant' && pendingCandidateTasks(message).length" class="candidate-memory-list">
          <div class="candidate-memory-title">
            <span>待确认任务</span>
            <span class="badge pending">{{ pendingCandidateTasks(message).length }} 条</span>
          </div>
          <article
            v-for="candidate in pendingCandidateTasks(message)"
            :key="taskKey(candidate)"
            class="candidate-memory-card"
            data-testid="chat-candidate-task"
          >
            <div class="candidate-memory-fields">
              <label>
                <span>标题</span>
                <input
                  :value="candidate.title"
                  :disabled="taskActionLoading[taskKey(candidate)]"
                  @input="setCandidateTaskTitle(candidate, $event)"
                />
              </label>
              <label>
                <span>截止时间</span>
                <input
                  :value="taskDueInputValue(candidate)"
                  :disabled="taskActionLoading[taskKey(candidate)]"
                  type="datetime-local"
                  @input="setCandidateTaskDueAt(candidate, $event)"
                />
              </label>
            </div>
            <small class="memory-meta">置信度 {{ candidate.confidence ?? 0.8 }} · {{ candidate.source || '本轮对话' }}</small>
            <small v-if="candidate.error" class="candidate-error">{{ candidate.error }}</small>
            <div class="candidate-memory-actions">
              <button
                type="button"
                :disabled="taskActionLoading[taskKey(candidate)] || !candidate.title.trim()"
                @click="confirmCandidateTask(message, candidate)"
              >
                确认
              </button>
              <button
                class="secondary"
                type="button"
                :disabled="taskActionLoading[taskKey(candidate)]"
                @click="dismissCandidateTask(message, candidate)"
              >
                忽略
              </button>
            </div>
          </article>
        </div>

        <div v-if="message.role === 'assistant' && pendingCandidateGoals(message).length" class="candidate-memory-list">
          <div class="candidate-memory-title">
            <span>待确认目标</span>
            <span class="badge pending">{{ pendingCandidateGoals(message).length }} 条</span>
          </div>
          <article
            v-for="candidate in pendingCandidateGoals(message)"
            :key="projectCandidateKey(candidate)"
            class="candidate-memory-card"
          >
            <div class="candidate-memory-fields">
              <label>
                <span>标题</span>
                <input v-model="candidate.title" :disabled="projectCandidateActionLoading[projectCandidateKey(candidate)]" />
              </label>
              <label>
                <span>周期</span>
                <select v-model="candidate.horizon" :disabled="projectCandidateActionLoading[projectCandidateKey(candidate)]">
                  <option value="day">今日</option>
                  <option value="week">本周</option>
                  <option value="month">本月</option>
                  <option value="quarter">季度</option>
                  <option value="long_term">长期</option>
                </select>
              </label>
            </div>
            <small class="memory-meta">项目 {{ candidate.projectId }} · 置信度 {{ candidate.confidence ?? 0.7 }}</small>
            <small v-if="candidate.error" class="candidate-error">{{ candidate.error }}</small>
            <div class="candidate-memory-actions">
              <button type="button" :disabled="projectCandidateActionLoading[projectCandidateKey(candidate)] || !candidate.title.trim()" @click="confirmCandidateGoal(message, candidate)">确认</button>
              <button class="secondary" type="button" :disabled="projectCandidateActionLoading[projectCandidateKey(candidate)]" @click="dismissProjectCandidate(message, candidate)">忽略</button>
            </div>
          </article>
        </div>

        <div v-if="message.role === 'assistant' && pendingCandidateDecisions(message).length" class="candidate-memory-list">
          <div class="candidate-memory-title">
            <span>待确认决策</span>
            <span class="badge pending">{{ pendingCandidateDecisions(message).length }} 条</span>
          </div>
          <article
            v-for="candidate in pendingCandidateDecisions(message)"
            :key="projectCandidateKey(candidate)"
            class="candidate-memory-card"
          >
            <div class="candidate-memory-fields">
              <label>
                <span>标题</span>
                <input v-model="candidate.title" :disabled="projectCandidateActionLoading[projectCandidateKey(candidate)]" />
              </label>
              <label>
                <span>内容</span>
                <input v-model="candidate.content" :disabled="projectCandidateActionLoading[projectCandidateKey(candidate)]" />
              </label>
            </div>
            <small class="memory-meta">项目 {{ candidate.projectId }} · 置信度 {{ candidate.confidence ?? 0.7 }}</small>
            <small v-if="candidate.error" class="candidate-error">{{ candidate.error }}</small>
            <div class="candidate-memory-actions">
              <button type="button" :disabled="projectCandidateActionLoading[projectCandidateKey(candidate)] || !candidate.title.trim() || !candidate.content.trim()" @click="confirmCandidateDecision(message, candidate)">确认</button>
              <button class="secondary" type="button" :disabled="projectCandidateActionLoading[projectCandidateKey(candidate)]" @click="dismissProjectCandidate(message, candidate)">忽略</button>
            </div>
          </article>
        </div>

        <div v-if="message.role === 'assistant' && pendingCandidateOpenQuestions(message).length" class="candidate-memory-list">
          <div class="candidate-memory-title">
            <span>待确认开放问题</span>
            <span class="badge pending">{{ pendingCandidateOpenQuestions(message).length }} 条</span>
          </div>
          <article
            v-for="candidate in pendingCandidateOpenQuestions(message)"
            :key="projectCandidateKey(candidate)"
            class="candidate-memory-card"
          >
            <label class="stack">
              <span>问题</span>
              <input v-model="candidate.question" :disabled="projectCandidateActionLoading[projectCandidateKey(candidate)]" />
            </label>
            <small class="memory-meta">项目 {{ candidate.projectId }} · 置信度 {{ candidate.confidence ?? 0.68 }}</small>
            <small v-if="candidate.error" class="candidate-error">{{ candidate.error }}</small>
            <div class="candidate-memory-actions">
              <button type="button" :disabled="projectCandidateActionLoading[projectCandidateKey(candidate)] || !candidate.question.trim()" @click="confirmCandidateOpenQuestion(message, candidate)">确认</button>
              <button class="secondary" type="button" :disabled="projectCandidateActionLoading[projectCandidateKey(candidate)]" @click="dismissProjectCandidate(message, candidate)">忽略</button>
            </div>
          </article>
        </div>

        <div v-if="message.role === 'assistant' && pendingCandidatePlans(message).length" class="candidate-memory-list">
          <div class="candidate-memory-title">
            <span>待确认计划</span>
            <span class="badge pending">{{ pendingCandidatePlans(message).length }} 条</span>
          </div>
          <article
            v-for="candidate in pendingCandidatePlans(message)"
            :key="planCandidateKey(candidate)"
            class="candidate-memory-card"
          >
            <div class="operation-preview-head">
              <strong>{{ candidate.title }}</strong>
              <span class="badge pending">{{ candidate.steps.length }} 步</span>
            </div>
            <p class="operation-preview-text">{{ candidate.objective }}</p>
            <ol class="plan-step-preview">
              <li v-for="step in candidate.steps" :key="step.title">
                <strong>{{ step.title }}</strong>
                <span>{{ step.description }}</span>
              </li>
            </ol>
            <small class="memory-meta">项目 {{ candidate.projectId || '未关联' }} · 创建后等待你确认执行</small>
            <small v-if="candidate.error" class="candidate-error">{{ candidate.error }}</small>
            <div class="candidate-memory-actions">
              <button
                type="button"
                :disabled="projectCandidateActionLoading[planCandidateKey(candidate)] || !candidate.title.trim()"
                @click="confirmCandidatePlan(message, candidate)"
              >
                创建计划
              </button>
              <button
                class="secondary"
                type="button"
                :disabled="projectCandidateActionLoading[planCandidateKey(candidate)]"
                @click="dismissCandidatePlan(message, candidate)"
              >
                忽略
              </button>
            </div>
          </article>
        </div>

        <div v-if="message.role === 'assistant' && pendingExecutionSuggestions(message).length" class="candidate-memory-list">
          <div class="candidate-memory-title">
            <span>执行建议</span>
            <span class="badge pending">{{ pendingExecutionSuggestions(message).length }} 条</span>
          </div>
          <article
            v-for="suggestion in pendingExecutionSuggestions(message)"
            :key="executionSuggestionKey(suggestion)"
            class="candidate-memory-card"
          >
            <div class="operation-preview-head">
              <strong>{{ suggestion.title }}</strong>
              <span class="badge" :class="{ danger: ['write_high', 'dangerous'].includes(suggestion.riskLevel) }">
                {{ suggestion.type.toUpperCase() }} · {{ suggestion.riskLevel }}
              </span>
            </div>
            <p class="operation-preview-text">{{ suggestion.description }}</p>
            <small v-if="suggestion.error" class="candidate-error">{{ suggestion.error }}</small>
            <div class="candidate-memory-actions">
              <button
                type="button"
                :disabled="executionSuggestionActionLoading[executionSuggestionKey(suggestion)]"
                @click="acceptExecutionSuggestion(message, suggestion)"
              >
                {{ executionSuggestionActionLabel(suggestion) }}
              </button>
              <button
                class="secondary"
                type="button"
                :disabled="executionSuggestionActionLoading[executionSuggestionKey(suggestion)]"
                @click="dismissExecutionSuggestion(message, suggestion)"
              >忽略</button>
            </div>
          </article>
        </div>

        <div v-if="message.role === 'assistant' && pendingOperations(message).length" class="candidate-memory-list">
          <div class="candidate-memory-title">
            <span>待确认操作</span>
            <span class="badge pending">{{ pendingOperations(message).length }} 条</span>
          </div>
          <article
            v-for="operation in pendingOperations(message)"
            :key="operationKey(operation)"
            class="candidate-memory-card"
          >
            <div class="operation-preview-head">
              <strong>{{ operation.summary }}</strong>
              <span class="badge danger">{{ operation.riskLevel === 'write' ? '写操作' : operation.riskLevel }}</span>
            </div>
            <small class="memory-meta">{{ operation.toolName }} · {{ operation.operationType }}</small>
            <p class="operation-preview-text">{{ operationPayloadText(operation) }}</p>
            <small v-if="operation.error" class="candidate-error">{{ operation.error }}</small>
            <div class="candidate-memory-actions">
              <button
                type="button"
                data-testid="chat-operation-confirm"
                :disabled="operationActionLoading[operationKey(operation)]"
                @click="confirmOperation(message, operation)"
              >
                确认执行
              </button>
              <button
                class="secondary"
                type="button"
                data-testid="chat-operation-reject"
                :disabled="operationActionLoading[operationKey(operation)]"
                @click="rejectOperation(message, operation)"
              >
                拒绝
              </button>
            </div>
          </article>
        </div>

        <div
          v-if="showDebug && message.role === 'assistant' && (message.agentTrace?.length || message.sources?.length || message.toolResults?.length || reviewText(message.review))"
          class="debug-panel"
        >
          <div class="debug-actions">
            <span>调试信息</span>
            <button class="inline" type="button" @click="copyDebugPayload(message, index)">
              {{ traceCopyState[index] === 'copied' ? '已复制' : traceCopyState[index] === 'failed' ? '复制失败' : '复制 Trace' }}
            </button>
          </div>
          <details v-if="message.agentTrace?.length" class="debug-section">
            <summary class="debug-title">Agent Trace</summary>
            <div class="agent-flow">
              <div
                v-for="(item, traceIndex) in message.agentTrace"
                :key="`${traceIndex}-${item.agent}`"
                class="agent-node"
                :class="agentNodeClass(item)"
              >
                <strong>{{ item.agent }}</strong>
                <span>{{ agentStatus(item) }}</span>
              </div>
            </div>
            <div v-for="(item, traceIndex) in message.agentTrace" :key="traceIndex" class="trace-item">
              <div class="trace-head">
                <span class="trace-agent">{{ item.agent }}</span>
                <span class="badge" :class="{ danger: item.approved === false }">{{ agentStatus(item) }}</span>
              </div>
              <div v-if="agentDecision(item)" class="debug-line">{{ agentDecision(item) }}</div>
              <div v-if="traceSummary(item)" class="trace-summary">{{ traceSummary(item) }}</div>
              <div v-if="writerInputSummary(item)" class="trace-summary">{{ writerInputSummary(item) }}</div>
              <details v-if="formatTraceDetail(item)" class="trace-detail">
                <summary>查看详情</summary>
                <pre>{{ formatTraceDetail(item) }}</pre>
              </details>
            </div>
          </details>

          <details v-if="message.toolResults?.length" class="debug-section">
            <summary class="debug-title">Tools</summary>
            <div v-for="(tool, toolIndex) in message.toolResults" :key="toolIndex" class="debug-line">
              <pre>{{ formatToolDebug(tool) }}</pre>
            </div>
          </details>

          <details v-if="message.sources?.length" class="debug-section">
            <summary class="debug-title">Sources</summary>
            <div v-for="source in message.sources" :key="source.docId + source.title" class="debug-line">
              {{ source.title }} · {{ sourceRetrievalLabel(source) || 'unknown' }}
            </div>
          </details>

          <details v-if="reviewText(message.review)" class="debug-section">
            <summary class="debug-title">Review</summary>
            <div class="review-card" :class="reviewCardClass(message.review)">
              <div class="review-card-head">
                <strong>{{ reviewRuleText(message.review) }}</strong>
                <span class="badge" :class="{ danger: message.review?.approved === false, success: message.review?.approved === true }">
                  {{ reviewStatusText(message.review) }}
                </span>
              </div>
              <div class="debug-line">{{ reviewText(message.review) }}</div>
              <p>{{ reviewReason(message.review) }}</p>
              <small v-if="reviewRewriteInstruction(message.review)" class="memory-meta">
                {{ reviewRewriteInstruction(message.review) }}
              </small>
            </div>
          </details>
        </div>
      </div>
    </div>

    <ContextPanel title="当前上下文" :open="showContextPanel" @close="showContextPanel = false">
      <section class="context-section context-controls">
        <small>切换上下文</small>
        <label>
          <span>会话</span>
          <select
            v-model="conversationId"
            data-testid="conversation-select"
            aria-label="选择会话"
            :disabled="loading || titleSaving"
            @change="changeConversation"
          >
            <option value="">新会话</option>
            <option v-for="item in conversations" :key="item.id" :value="String(item.id)">
              {{ item.title }}
            </option>
          </select>
        </label>
        <label>
          <span>知识库</span>
          <select
            v-model="selectedKnowledgeBaseId"
            data-testid="chat-knowledge-select"
            aria-label="选择知识库"
            :disabled="loading"
          >
            <option value="">不使用知识库</option>
            <option v-for="item in knowledgeBases" :key="item.id" :value="String(item.id)">
              {{ item.name }}
            </option>
          </select>
        </label>
      </section>
      <section class="context-section">
        <small>项目</small>
        <strong>{{ contextProject?.projectName || handoffProject?.name || (activeProjectId ? `项目 #${activeProjectId}` : '未关联项目') }}</strong>
        <RouterLink v-if="activeProjectId" class="inline-link" :to="`/projects/${activeProjectId}`">打开项目</RouterLink>
        <p v-else class="muted">从工作台或项目页发起对话，可自动携带项目上下文。</p>
      </section>
      <section class="context-section">
        <small>知识与记忆</small>
        <strong>{{ activeKnowledgeBaseName }}</strong>
        <span>{{ contextMemoryCount }} 条记忆用于最近回答</span>
      </section>
      <section v-if="contextSources.length" class="context-section">
        <small>资料来源 · {{ contextSources.length }}</small>
        <details v-for="(source, sourceIndex) in contextSources.slice(0, 5)" :key="sourceCardKey(source, sourceIndex)" class="context-source">
          <summary>{{ sourceFileName(source) }}</summary>
          <p>{{ sourceSnippet(source, 120) }}</p>
        </details>
      </section>
      <section v-if="contextTimeline.length" class="context-section">
        <small>执行详情</small>
        <ExecutionTimeline :steps="contextTimeline" />
      </section>
      <section v-if="pendingBriefMemories.length || pendingBriefOperations.length" class="context-section attention">
        <small>等待处理</small>
        <RouterLink v-if="pendingBriefMemories.length" to="/memory">{{ pendingBriefMemories.length }} 条记忆待确认</RouterLink>
        <RouterLink v-if="pendingBriefOperations.length" to="/execution-center?view=confirmations">{{ pendingBriefOperations.length }} 个操作待确认</RouterLink>
      </section>
    </ContextPanel>

    <button v-if="hasMessagesBelow" class="scroll-bottom" type="button" @click="scrollToBottom()">
      <ArrowDown :size="15" aria-hidden="true" /> 新消息
    </button>
    </div>

    <ChatComposer
      ref="composerRef"
      class="chat-input"
      v-model="input"
      :attachments="attachmentDrafts"
      :loading="loading"
      :disabled="composerDisabled"
      :announcement="attachmentAnnouncement"
      @submit="submit"
      @stop="cancelStreaming"
      @files="handleAttachmentFiles"
      @remove="removeAttachment"
      @retry="retryAttachment"
    />
  </section>
</template>

<style scoped>
.chat-workspace {
  position: relative;
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
  gap: var(--space-4);
}

.chat-workspace.context-closed { grid-template-columns: minmax(0, 1fr); }

.chat-list {
  min-height: min(620px, calc(100dvh - 250px));
  max-height: calc(100dvh - 250px);
  border-color: var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  scroll-behavior: smooth;
}

.chat-starter {
  display: grid;
  gap: var(--space-5);
  width: min(760px, 100%);
  align-self: center;
  margin: auto;
  padding: clamp(16px, 4vw, 42px) 0;
}

.chat-starter h2 { margin: 0; font-size: clamp(22px, 3vw, 30px); }
.chat-starter p { margin: 6px 0 0; }
.starter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }

.context-section { display: grid; gap: var(--space-2); }
.context-controls label { display: grid; gap: 6px; color: var(--muted-foreground); font-size: 12px; font-weight: 700; }
.context-controls select { width: 100%; min-width: 0; min-height: 44px; }
.context-section + .context-section { border-top: 1px solid var(--border); padding-top: var(--space-4); }
.context-section > small { color: var(--muted-foreground); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.context-section > span, .context-section > p { margin: 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.5; }
.context-section.attention { border: 1px solid var(--warning-border); border-radius: var(--radius-md); background: var(--warning-soft); padding: var(--space-3); }
.context-section.attention a { color: var(--warning-strong); font-size: 13px; font-weight: 700; }
.context-source { border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-2) var(--space-3); }
.context-source summary { cursor: pointer; font-size: 13px; font-weight: 700; }
.context-source p { margin: var(--space-2) 0 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.5; }

.scroll-bottom {
  position: absolute;
  z-index: 4;
  right: calc(min(320px, 28vw) + var(--space-7));
  bottom: var(--space-4);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--primary-border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--primary);
  padding: 8px 12px;
  box-shadow: var(--shadow-popover);
}
.context-closed .scroll-bottom { right: var(--space-4); }

.chat-input {
  position: sticky;
  z-index: 5;
  bottom: calc(var(--space-2) + env(safe-area-inset-bottom));
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: var(--shadow-popover);
  backdrop-filter: blur(12px);
}
.chat-input textarea { min-height: 60px; resize: vertical; border: 0; background: transparent; box-shadow: none; }
.chat-input textarea:focus { outline: 0; }
.image-attachment-grid,
.uploaded-image-grid,
.image-batch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: var(--space-3);
}
.image-attachment-grid { margin-bottom: var(--space-3); }
.uploaded-image-grid { width: min(100%, 620px); }
.turn-status {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--muted-foreground);
  padding: 7px 11px;
  font-size: 13px;
  font-weight: 700;
}
.turn-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--primary) 35%, transparent);
  animation: turn-pulse 1.4s ease-out infinite;
}
.phase-failed .turn-status-dot { background: var(--danger); animation: none; }
.image-batch-grid {
  width: min(100%, 760px);
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}
.image-batch-card {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.image-batch-card a,
.image-skeleton {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  background: var(--surface-muted);
}
.image-batch-card img { width: 100%; height: 100%; object-fit: cover; }
.image-skeleton {
  position: relative;
  overflow: hidden;
}
.image-skeleton::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 20%, color-mix(in srgb, var(--surface) 70%, transparent) 48%, transparent 76%);
  content: '';
  transform: translateX(-100%);
  animation: image-shimmer 1.35s ease-in-out infinite;
}
.image-skeleton span {
  position: absolute;
  inset: 42%;
  border: 2px solid var(--primary-border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: image-spin .8s linear infinite;
}
.image-batch-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 9px 11px;
  font-size: 12px;
}
.image-batch-card footer span { color: var(--muted-foreground); }
.image-batch-card footer strong { color: var(--primary); }
.image-batch-card.status-failed { border-color: var(--danger-border); }
.image-batch-card.status-failed footer strong,
.image-batch-card > small { color: var(--danger); }
.image-batch-card.status-cancelled footer strong { color: var(--muted-foreground); }
.image-batch-card.status-cancelled .image-skeleton::after,
.image-batch-card.status-cancelled .image-skeleton span { animation: none; opacity: 0.35; }
.image-batch-card > small { display: block; padding: 0 11px 11px; }
@keyframes turn-pulse {
  70% { box-shadow: 0 0 0 7px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes image-shimmer { to { transform: translateX(100%); } }
@keyframes image-spin { to { transform: rotate(360deg); } }
.context-toggle { display: inline-flex; align-items: center; gap: 6px; }
.debug-controls { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-muted); padding: 3px; }
.debug-toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--foreground); padding: 0 6px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.debug-toggle input { width: 16px; height: 16px; margin: 0; }
.debug-exit { min-height: 30px; padding: 4px 8px; font-size: 12px; }
.regenerate-button { display: inline-flex; align-items: center; gap: 6px; }
.conversation-title-line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.title-editor { display: grid; grid-template-columns: minmax(180px, 1fr) auto auto; gap: var(--space-2); margin-top: var(--space-2); }

@media (max-width: 1024px) {
  .toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }
  .toolbar-controls {
    display: flex;
    width: auto;
    align-items: center;
    flex-direction: row;
  }
  .chat-workspace { grid-template-columns: minmax(0, 1fr); }
  .scroll-bottom { right: var(--space-4); }
}

@media (max-width: 640px) {
  .starter-grid { grid-template-columns: 1fr; }
  .chat-list { min-height: calc(100dvh - 300px); max-height: calc(100dvh - 300px); padding: var(--space-3); }
  .toolbar-controls {
    display: flex;
    width: auto;
    gap: var(--space-2);
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .toolbar-controls > button {
    width: auto;
    justify-content: center;
  }
  .chat-compose-actions { display: flex; flex-wrap: wrap; align-items: center; }
  .chat-compose-actions > * { flex: 1; }
  .chat-compose-actions .upload-error { flex-basis: 100%; }
  .title-editor { grid-template-columns: 1fr auto auto; }
}

@media (prefers-reduced-motion: reduce) {
  .chat-list { scroll-behavior: auto; }
  .turn-status-dot, .image-skeleton::after, .image-skeleton span { animation: none; }
}
</style>
