<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { authState } from '@/auth'
import { newChatLocation, notifyChatNavigationChanged } from '@/domain/chat-navigation'
import { memoryReasonLabel, memoryTargetKey, setCandidateTargetKey } from '@/domain/memory-presentation'
import { ArrowDown, ArrowRight, BrainCircuit, ChevronRight, Circle, Database, GitBranch, PanelRightOpen, Sparkles, Wrench } from '@lucide/vue'
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
  listProjects,
  listPendingOperations,
  saveStructuredMemory,
  rejectPendingOperation,
  streamMessage,
  HttpStreamError,
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
import type { AgentReminderItem, AgentTodoItem, AgentTraceItem, CandidateDecisionItem, CandidateGoalItem, CandidateOpenQuestionItem, CandidatePlanItem, CandidateTaskItem, ChatRetrievalScope, ChatSource, ChatUsage, Conversation, KnowledgeBase, MemoryExclusions, MemoryItem, MemorySnapshot, PendingOperationItem, Project, ProjectChatContext, ToolResult, ExecutionSuggestionItem, UsedMemory } from '@/api/types'
import ContextPanel from '@/components/layout/ContextPanel.vue'
import MemoryExplanationPanel from '@/components/memory/MemoryExplanationPanel.vue'
import ExecutionTimeline from '@/components/domain/ExecutionTimeline.vue'
import SuggestionCard from '@/components/domain/SuggestionCard.vue'
import { useWorkspaceStore, type WorkspaceProjectContext } from '@/stores/workspace'
import { isConversationNearBottom } from '@/domain/chat-scroll'
import {
  historyMessage,
  attachmentContextMetadata,
  isActiveTurnPhase,
  resolveLiveChatDebugDataState,
  resolveTerminalChatDebugDataState,
  type ChatDebugDataState
} from '@/domain/chat-history'
import {
  CHAT_KNOWLEDGE_BASE_STORAGE_KEY,
  CHAT_PROJECT_STORAGE_KEY,
  resolveKnowledgeBaseSelection,
  resolveProjectSelection
} from '@/domain/chat-context'
import { NEW_CONVERSATION_STORAGE_VALUE, resolveConversationToRestore } from '@/domain/chat-session'
import { cancelPendingImageItems } from '@/domain/image-batch'
import type { ChatAttachment } from '@/domain/chat-attachment'
import { useChatAttachments } from '@/composables/useChatAttachments'
import { scanDataTransfer, scanFlatFiles, scanPickerFiles } from '@/composables/useDirectoryEntries'
import { useWorkspaceDrop } from '@/composables/useWorkspaceDrop'
import { stageLocalDrop } from '@/domain/local-workspace'
import { useRuntimeFeatures } from '@/composables/useRuntimeFeatures'
import type { DirectorySkip } from '@/domain/directory-entry'
import { formatEstimatedCost, formatTokens, measurementLabel } from '@/domain/usage'
import {
  CHAT_MODEL_OPTIONS,
  CHAT_MODEL_STORAGE_KEY,
  DEFAULT_CHAT_MODEL_ID,
  isChatModelConnectionError,
  resolveChatModelId,
  type ChatModelId
} from '@/domain/chat-model'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import DebugAgentTimeline from '@/components/chat/DebugAgentTimeline.vue'
import DebugLedger from '@/components/chat/DebugLedger.vue'
import AgentProgressTimeline from '@/components/chat/AgentProgressTimeline.vue'
import ChatThinkingProcess from '@/components/chat/ChatThinkingProcess.vue'
import { processTimestamp, type ChatReasoning } from '@/domain/chat-reasoning'
import type { ChatToolCall } from '@/domain/chat-tool-calls'
import type { ProcessTimelineEntry } from '@/domain/chat-process-timeline'
import { applyProcessAgent, applyProcessTool, applyProcessReasoning, applyProcessSnapshot } from '@/domain/chat-process-state'
import { AGENT_STEPS, agentProgressDetail, agentProgressDisplayStatus, type AgentStep, type AgentStepEvent } from '@/domain/chat-progress'
import { reconcileChatTurn, recoveryPollDelay, recoveryStatusText, shouldRecoverChatTurn, type ChatRecoveryState } from '@/domain/chat-recovery'
import { summarizeChatDebug } from '@/domain/chat-debug-summary'
import ChatSources from '@/components/chat/ChatSources.vue'
import { presentAgentTrace } from '@/domain/chat-trace-presentation'
import MessageAttachments from '@/components/chat/MessageAttachments.vue'
import WorkspaceDropOverlay from '@/components/chat/WorkspaceDropOverlay.vue'
import GeneratedImageGrid from '@/components/chat/GeneratedImageGrid.vue'
import MessageFailureActions from '@/components/chat/MessageFailureActions.vue'
import {
  sanitizeAgentTrace,
  sanitizeChatSources,
  sanitizeDebugVersion,
  sanitizeExecutionSuggestions,
  sanitizeKnowledgeBaseIds,
  sanitizeMemoryExclusions,
  sanitizeProjectContext,
  sanitizeRetrievalScope,
  sanitizeReview,
  sanitizeToolResults,
  sanitizeUsedMemories
} from '@/domain/chat-safety'

interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  images?: Array<{
    name: string
    url: string
    previewUrl?: string
  }>
  attachments?: ChatAttachment[]
  attachmentContextInherited?: boolean
  attachmentContextSourceMessageId?: string
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
  agentProgress?: AgentStepEvent[]
  toolCalls?: ChatToolCall[]
  processTimeline?: ProcessTimelineEntry[]
  reasoning?: ChatReasoning
  processStartedAt?: number
  processCompletedAt?: number
  recoveryState?: ChatRecoveryState
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
  usage?: ChatUsage
  usedMemories?: UsedMemory[]
  memoryExclusions?: MemoryExclusions
  memoryExplanationVersion?: string
  debugVersion?: string
  knowledgeBaseIds?: string[]
  retrievalScope?: ChatRetrievalScope
  debugTruncated?: boolean
  debugDataState?: ChatDebugDataState
}

interface DebugMemoryItem {
  kind: 'injected' | 'excluded' | 'summary' | 'short-term' | 'structured' | 'retrieved'
  label: string
  value: string
  meta: string
}

interface DebugExecutionStep {
  id: 'route' | 'memory' | 'rag' | 'tools' | 'writer'
  label: string
  detail: string
  state: 'done' | 'empty' | 'skipped' | 'missing' | 'running' | 'failed' | 'pending' | 'interrupted'
}

interface RetryTurnContext {
  userIndex: number
  assistantIndex: number
  turnId: string
}

const input = ref('')
const chatModelId = ref<ChatModelId>(resolveChatModelId(window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY)))
const route = useRoute()
const router = useRouter()
const navigationOwner = authState.user?.id
const runtimeFeatures = useRuntimeFeatures()
const workspace = useWorkspaceStore()
const handoffProject = ref<WorkspaceProjectContext | null>(null)
const showContextPanel = ref(false)
const showMemoryExplanation = ref(false)
const explainedMemories = ref<UsedMemory[]>([])
const highlightedMessageId = ref('')
const sourceReplayNotice = ref('')
const chatListRef = ref<HTMLElement | null>(null)
const composerRef = ref<{ focus: () => void } | null>(null)
const hasMessagesBelow = ref(false)
const isNearBottom = ref(true)
const loading = ref(false)
const streamController = ref<AbortController | null>(null)
const recoveringTurnId = ref('')
let recoveryPollTimer: number | undefined
let conversationEpoch = 0
let viewDisposed = false
let recoveryFailures = 0
let recoveryRequest = 0
let recoveryInFlight = 0
const cancellingTurnId = ref('')
let sourceHighlightTimer: number | undefined
const initializing = ref(true)
const debugControlsEnabled = computed(() => route.query.debug === '1')
const showDebug = ref(debugControlsEnabled.value)
const error = ref('')
const commercialQuotaError = ref(false)
const conversationId = ref('')
const ACTIVE_CONVERSATION_STORAGE_KEY = 'lyle.chat.active-conversation'

watch(chatModelId, (value) => window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, value))
const editingTitle = ref(false)
const editingConversationId = ref('')
const titleDraft = ref('')
const titleSaving = ref(false)
const conversations = ref<Conversation[]>([])
const knowledgeBases = ref<KnowledgeBase[]>([])
const knowledgeBasesLoading = ref(false)
const knowledgeBasesError = ref('')
const selectedKnowledgeBaseId = ref(readStoredContext(CHAT_KNOWLEDGE_BASE_STORAGE_KEY))
const projects = ref<Project[]>([])
const projectsLoading = ref(false)
const projectsError = ref('')
const selectedProjectId = ref(readStoredContext(CHAT_PROJECT_STORAGE_KEY))
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
const messages = ref<Message[]>([])
const {
  attachments: attachmentDrafts,
  skipped: attachmentSkipped,
  announcement: attachmentAnnouncement,
  isUploading: attachmentsUploading,
  hasFailed: attachmentsFailed,
  addFiles: addAttachmentFiles,
  retry: retryAttachment,
  remove: removeAttachment,
  removeGroup: removeAttachmentGroup,
  commitReady: commitReadyAttachments,
  reset: resetAttachments
} = useChatAttachments({
  upload: async (file, kind, metadata) => (await uploadChatAttachment(file, kind, metadata)).data,
  remove: async (attachmentId) => deleteChatAttachment(attachmentId)
})
const attachmentHintDismissed = ref(window.localStorage.getItem('lyle.chat.attachment-hint-dismissed') === '1')
const showAttachmentHint = computed(() => !attachmentHintDismissed.value && !hasUserMessages.value)
const dropController = useWorkspaceDrop(async (dataTransfer, signal) => {
  if (stageLocalDrop(dataTransfer)) {
    await router.push('/local-project')
    return
  }
  const startedAt = performance.now()
  const result = runtimeFeatures.chatFolderAttachmentsEnabled
    ? await scanDataTransfer(dataTransfer, signal)
    : scanFlatFiles(Array.from(dataTransfer.files || []), 'drop')
  if (signal.aborted) return
  const source = result.files.some((item) => item.sourceType === 'folder_drop') ? 'folder_drop' : 'drop'
  void trackProductEvent({
    eventType: source === 'folder_drop' ? 'chat_folder_scan_total' : 'chat_attachment_added_total',
    page: 'chat',
    actionType: source,
    status: result.skipped.length ? 'partial' : result.files.length ? 'succeeded' : 'failed',
    itemCount: result.files.length,
    durationMs: Math.round(performance.now() - startedAt)
  }).catch(() => undefined)
  trackDirectorySkips(result.skipped)
  await addAttachmentFiles(result.files, result.skipped)
  if (result.files.length) dismissAttachmentHint()
}, (action) => {
  void trackProductEvent({ eventType: 'chat_drag_overlay_total', page: 'chat', actionType: action }).catch(() => undefined)
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
  if (!conversationId.value) return '新对话'
  return conversations.value.find((item) => String(item.id) === conversationId.value)?.title || '当前对话'
})
const activeKnowledgeBaseName = computed(() => {
  if (!selectedKnowledgeBaseId.value) return '未使用知识库'
  return knowledgeBases.value.find((item) => String(item.id) === selectedKnowledgeBaseId.value)?.name || '已选择知识库'
})
const selectedProject = computed(() => (
  projects.value.find((item) => String(item.id) === selectedProjectId.value)
))
const activeProjectId = computed(() => {
  const value = route.params.projectId
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  const selected = Number(selectedProjectId.value)
  if (Number.isInteger(selected) && selected > 0) return selected
  return handoffProject.value?.id
})
const activeProjectName = computed(() => {
  if (!activeProjectId.value) return ''
  if (selectedProject.value?.id === activeProjectId.value) return selectedProject.value.name
  if (handoffProject.value?.id === activeProjectId.value && handoffProject.value.name) return handoffProject.value.name
  return `项目计划 #${activeProjectId.value}`
})
const activeContextSummary = computed(() => {
  const project = activeProjectName.value
  const knowledge = selectedKnowledgeBaseId.value ? activeKnowledgeBaseName.value : ''
  if (project && knowledge) return `${project} / ${knowledge}`
  if (project) return project
  if (knowledge) return knowledge
  return '选择项目计划 / 知识库'
})
const hasUserMessages = computed(() => messages.value.some((message) => message.role === 'user'))
const latestAssistantMessage = computed(() => [...messages.value].reverse().find((message) => message.role === 'assistant'))
const contextSources = computed(() => latestAssistantMessage.value?.sources || [])
const contextProject = computed(() => latestAssistantMessage.value?.projectContext?.resolver)
const contextMemoryCount = computed(() => latestAssistantMessage.value ? injectedMemoryItems(latestAssistantMessage.value).length : 0)
const contextTimeline = computed(() => {
  const message = latestAssistantMessage.value
  const steps: Array<{ id: string; title: string; detail?: string; status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'skipped' | 'unknown' }> = []
  if (message?.agentProgress?.length && message.debugDataState !== 'available') {
    for (const event of message.agentProgress) {
      steps.push({ id: event.step, title: AGENT_STEPS[event.step], detail: agentProgressDetail(message.agentProgress, event.step, message.phase), status: agentProgressDisplayStatus(event, message.phase) === 'interrupted' ? 'failed' : event.status })
    }
  } else if (loading.value && !message?.agentTrace?.length) {
    steps.push({ id: 'waiting', title: '等待执行进度', detail: message?.recoveryState ? recoveryStatusText(message.recoveryState) : '尚未收到步骤状态', status: 'waiting' })
  }
  for (const [index, trace] of (message?.agentTrace || []).entries()) {
    const presentation = presentAgentTrace(trace, { projectContext: message?.projectContext })
    steps.push({
      id: `trace-${index}`,
      title: presentation.name,
      detail: `${presentation.statusLabel} · ${presentation.summary}`,
      status: presentation.tone === 'danger' ? 'failed'
        : trace.skipped ? 'skipped'
        : presentation.tone === 'running' ? 'running'
        : presentation.tone === 'success' ? 'completed' : 'unknown'
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
  const initialEpoch = conversationEpoch
  const handoff = workspace.consumeChatDraft()
  if (handoff) {
    input.value = handoff.draft
    handoffProject.value = handoff.project
    if (handoff.project) {
      selectedProjectId.value = String(handoff.project.id)
      writeStoredContext(CHAT_PROJECT_STORAGE_KEY, selectedProjectId.value)
    }
  }
  // Knowledge bases and the brief are optional context. Load them in the
  // background so a slow auxiliary request never blocks the chat surface.
  void refreshKnowledgeBases()
  void refreshProjects()
  void refreshBrief()
  try {
    await refreshConversations()
    if (viewDisposed || initialEpoch !== conversationEpoch) return
    const requestedConversationId = routeQueryText(route.query.conversationId) || undefined
    const requestedNewChat = routeQueryText(route.query.newChat)
    const initialConversationId = requestedNewChat ? '' : resolveConversationToRestore({
      requestedId: requestedConversationId,
      storedId: window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY),
      conversationIds: conversations.value.map((item) => String(item.id)),
      allowRecent: !handoff && !activeProjectId.value
    })
    if (initialConversationId) {
      await loadConversation(initialConversationId)
    } else if (requestedNewChat) resetNewConversation()
    syncPendingMemoriesToLatestAssistant()
  } catch {
    error.value = '对话列表暂时无法加载，你仍然可以开始新对话。'
  } finally {
    initializing.value = false
    await nextTick()
    if (handoff) composerRef.value?.focus()
    if (requestedSourceMessageId()) await revealSourceMessage(requestedSourceMessageId())
    else if (conversationId.value || hasUserMessages.value) scrollToBottom(false)
    else if (chatListRef.value) chatListRef.value.scrollTop = 0
  }
})

watch(
  [() => route.query.conversationId, () => route.query.messageId, () => route.query.newChat],
  async ([rawConversationId, rawMessageId, rawNewChat], previous) => {
    if (viewDisposed) return
    const requestedNewChat = routeQueryText(rawNewChat)
    if (requestedNewChat && requestedNewChat !== routeQueryText(previous?.[2])) {
      showContextPanel.value = false
      showMemoryExplanation.value = false
      resetNewConversation()
      return
    }
    const requestedConversationId = routeQueryText(rawConversationId)
    const requestedMessageId = routeQueryText(rawMessageId)
    if (!requestedConversationId) return
    if (previous && routeQueryText(previous[0]) === requestedConversationId && routeQueryText(previous[1]) === requestedMessageId) return
    showContextPanel.value = false
    showMemoryExplanation.value = false
    if (conversationId.value !== requestedConversationId) await loadConversation(requestedConversationId)
    if (requestedMessageId && requestedConversationId === conversationId.value) await revealSourceMessage(requestedMessageId)
  }
)

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
  viewDisposed = true
  detachConversation()
  if (sourceHighlightTimer !== undefined) window.clearTimeout(sourceHighlightTimer)
})

async function refreshKnowledgeBases() {
  knowledgeBasesLoading.value = true
  knowledgeBasesError.value = ''
  try {
    const response = await listKnowledgeBases()
    knowledgeBases.value = response.data
    const requestedId = routeQueryText(route.query.knowledgeBaseId)
    const preferredId = requestedId || selectedKnowledgeBaseId.value
    const resolvedId = resolveKnowledgeBaseSelection(preferredId, response.data.map((item) => item.id))
    selectedKnowledgeBaseId.value = resolvedId
    writeStoredContext(CHAT_KNOWLEDGE_BASE_STORAGE_KEY, resolvedId)
    if (requestedId) void clearRouteQuery('knowledgeBaseId')
  } catch {
    knowledgeBasesError.value = '知识库列表暂时无法加载。'
  } finally {
    knowledgeBasesLoading.value = false
  }
}

async function refreshProjects() {
  projectsLoading.value = true
  projectsError.value = ''
  try {
    const response = await listProjects()
    projects.value = response.data.items
    const resolvedId = resolveProjectSelection(
      selectedProjectId.value || handoffProject.value?.id,
      response.data.items.map((item) => item.id)
    )
    selectedProjectId.value = resolvedId ? String(resolvedId) : ''
    handoffProject.value = resolvedId
      ? { id: resolvedId, name: response.data.items.find((item) => item.id === resolvedId)?.name }
      : null
    writeStoredContext(CHAT_PROJECT_STORAGE_KEY, selectedProjectId.value)
  } catch {
    projectsError.value = '项目计划列表暂时无法加载。'
  } finally {
    projectsLoading.value = false
  }
}

function changeKnowledgeContext() {
  const resolvedId = resolveKnowledgeBaseSelection(
    selectedKnowledgeBaseId.value,
    knowledgeBases.value.map((item) => item.id)
  )
  selectedKnowledgeBaseId.value = resolvedId
  writeStoredContext(CHAT_KNOWLEDGE_BASE_STORAGE_KEY, resolvedId)
  if (route.query.knowledgeBaseId !== undefined) void clearRouteQuery('knowledgeBaseId')
}

function changeProjectContext() {
  const resolvedId = resolveProjectSelection(
    selectedProjectId.value,
    projects.value.map((item) => item.id)
  )
  selectedProjectId.value = resolvedId ? String(resolvedId) : ''
  handoffProject.value = resolvedId
    ? { id: resolvedId, name: projects.value.find((item) => item.id === resolvedId)?.name }
    : null
  writeStoredContext(CHAT_PROJECT_STORAGE_KEY, selectedProjectId.value)
}

function readStoredContext(key: string) {
  try {
    return window.localStorage.getItem(key)?.trim() || ''
  } catch {
    return ''
  }
}

function writeStoredContext(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Context persistence is a convenience; the current in-memory selection still works.
  }
}

async function clearRouteQuery(key: string) {
  if (route.query[key] === undefined) return
  const query = { ...route.query }
  delete query[key]
  await router.replace({ query })
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

async function ensureConversationId(firstMessage: string, epoch = conversationEpoch) {
  if (conversationId.value) return conversationId.value

  const title = firstMessage.length > 18 ? `${firstMessage.slice(0, 18)}...` : firstMessage
  const response = await createConversation(title || '新对话')
  if (epoch !== conversationEpoch) return ''
  conversationId.value = String(response.data.id)
  window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversationId.value)
  await syncConversationLocation(conversationId.value)
  await refreshConversations()
  return conversationId.value
}

function detachConversation() {
  conversationEpoch += 1
  recoveryRequest += 1
  recoveryInFlight = 0
  clearRecoveryPolling()
  streamController.value?.abort()
  streamController.value = null
  recoveringTurnId.value = ''
  cancellingTurnId.value = ''
  recoveryFailures = 0
  loading.value = false
}

async function loadConversation(id: string) {
  if (viewDisposed) return
  detachConversation()
  const epoch = conversationEpoch
  messages.value = []
  handoffProject.value = null
  resetAttachments()
  editingTitle.value = false
  editingConversationId.value = ''
  conversationId.value = String(id)
  error.value = ''
  loading.value = true
  try {
    const response = await listChatMessages(String(id))
    if (epoch !== conversationEpoch) return
    messages.value = response.data.map(historyMessage)
    window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, String(id))
    await syncConversationLocation(String(id))
    await refreshBrief()
  } catch {
    if (epoch === conversationEpoch) error.value = '对话加载失败，请稍后重试。'
  } finally {
    if (epoch === conversationEpoch) {
      loading.value = false
      syncRecoveredTurnPolling()
    }
  }
}

function syncRecoveredTurnPolling() {
  if (viewDisposed || streamController.value || cancellingTurnId.value || recoveryInFlight) return
  const active = [...messages.value].reverse().find((message) => (
    message.role === 'assistant' && Boolean(message.turnId)
    && (isActiveTurnPhase(message.phase) || Boolean(message.recoveryState))
  ))
  if (!active) {
    recoveringTurnId.value = ''
    clearRecoveryPolling()
    loading.value = false
    return
  }
  recoveringTurnId.value = active.turnId || ''
  loading.value = true
  if (recoveryPollTimer === undefined) {
    recoveryPollTimer = window.setTimeout(pollRecoveredConversation, recoveryPollDelay(recoveryFailures))
  }
}

async function pollRecoveredConversation() {
  recoveryPollTimer = undefined
  const targetConversationId = conversationId.value
  const turnId = recoveringTurnId.value
  const target = messages.value.find(message => message.role === 'assistant' && message.turnId === turnId)
  if (!targetConversationId || !target || streamController.value || cancellingTurnId.value || recoveryInFlight) return
  const epoch = conversationEpoch
  const request = ++recoveryRequest
  recoveryInFlight = request
  const current = () => epoch === conversationEpoch && request === recoveryRequest && !cancellingTurnId.value
  try {
    const response = await listChatMessages(targetConversationId)
    if (!current()) return
    Object.assign(target, reconcileChatTurn(target, response.data))
    recoveryFailures = target.recoveryState === 'unconfirmed' ? recoveryFailures + 1 : 0
    if (!isActiveTurnPhase(target.phase) && !target.recoveryState) notifyChatNavigationChanged(navigationOwner)
  } catch {
    if (!current()) return
    target.recoveryState = 'unconfirmed'
    recoveryFailures += 1
  } finally {
    if (recoveryInFlight === request) recoveryInFlight = 0
    if (current()) syncRecoveredTurnPolling()
  }
}

function refreshTurnStatus() {
  if (recoveryInFlight) return
  clearRecoveryPolling()
  recoveryRequest += 1
  const target = messages.value.find(message => message.role === 'assistant' && message.turnId === recoveringTurnId.value)
  if (target) target.recoveryState = 'checking'
  void pollRecoveredConversation()
}

async function recoverInterruptedTurn(target: Message) {
  if (!shouldRecoverChatTurn(target)) { settlePendingDebugState(target); return }
  target.recoveryState = 'checking'
  recoveringTurnId.value = target.turnId || ''
  loading.value = true
  clearRecoveryPolling()
  await pollRecoveredConversation()
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

function newConversation() { void router.push(newChatLocation()) }

async function syncConversationLocation(id: string) {
  if (viewDisposed || route.name !== 'chat' || (routeQueryText(route.query.conversationId) === id && !route.query.newChat)) return
  const query: LocationQueryRaw = { ...route.query, conversationId: id }
  delete query.newChat
  await router.replace({ query })
}

function resetNewConversation() {
  detachConversation()
  error.value = ''
  commercialQuotaError.value = false
  handoffProject.value = null
  resetAttachments()
  editingTitle.value = false
  editingConversationId.value = ''
  conversationId.value = ''
  window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, NEW_CONVERSATION_STORAGE_VALUE)
  messages.value = []
  input.value = ''
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
    error.value = getRequestErrorMessage(exception, '对话标题保存失败，请稍后重试。')
  } finally {
    titleSaving.value = false
  }
}

function applyStarterPrompt(draft: string) {
  input.value = draft
  nextTick(() => composerRef.value?.focus())
}

function openContextPanel() {
  showMemoryExplanation.value = false
  if (showContextPanel.value) return
  showContextPanel.value = true
  void trackProductEvent({ eventType: 'context_panel_opened', page: 'chat', projectId: activeProjectId.value }).catch(() => undefined)
}

function toggleContextPanel() {
  if (showContextPanel.value) {
    showContextPanel.value = false
    return
  }
  openContextPanel()
}

function openMemoryExplanation(message: Message) {
  explainedMemories.value = message.usedMemories || []
  showContextPanel.value = false
  showMemoryExplanation.value = true
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

function requestedSourceMessageId() {
  return routeQueryText(route.query.messageId)
}

function routeQueryText(value: unknown) {
  return Array.isArray(value) ? String(value[0] || '').trim() : typeof value === 'string' ? value.trim() : ''
}

async function revealSourceMessage(messageId: string) {
  if (!messageId) return
  await nextTick()
  const target = Array.from(chatListRef.value?.querySelectorAll<HTMLElement>('[data-message-id]') || [])
    .find((element) => element.dataset.messageId === messageId)
  if (!target) {
    highlightedMessageId.value = ''
    sourceReplayNotice.value = '原消息已删除、无权访问或不在当前对话中。'
    return
  }
  showContextPanel.value = false
  showMemoryExplanation.value = false
  highlightedMessageId.value = messageId
  sourceReplayNotice.value = '已定位到这条记忆的原消息。'
  await nextTick()
  target.scrollIntoView({
    block: 'center',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  })
  target.focus({ preventScroll: true })
  if (sourceHighlightTimer !== undefined) window.clearTimeout(sourceHighlightTimer)
  sourceHighlightTimer = window.setTimeout(() => {
    if (highlightedMessageId.value === messageId) highlightedMessageId.value = ''
  }, 5000)
}

async function cancelStreaming() {
  const target = [...messages.value].reverse().find(message => (
    message.role === 'assistant' && message.turnId
    && (isActiveTurnPhase(message.phase) || Boolean(message.recoveryState))
  ))
  if (!target?.turnId || !conversationId.value || cancellingTurnId.value) return
  const epoch = conversationEpoch
  const turnId = target.turnId
  const controller = streamController.value
  cancellingTurnId.value = turnId
  recoveryRequest += 1
  recoveryInFlight = 0
  clearRecoveryPolling()
  try {
    const response = await cancelChatTurn(conversationId.value, turnId)
    if (epoch !== conversationEpoch) return
    Object.assign(target, reconcileChatTurn(target, [response.data]), { recoveryState: undefined })
    if (isActiveTurnPhase(target.phase)) target.recoveryState = 'unconfirmed'
    else settlePendingDebugState(target)
  } catch {
    if (epoch !== conversationEpoch) return
    // A failed cancel request is not confirmation that the backend has stopped.
    target.recoveryState = 'unconfirmed'
  } finally {
    if (epoch === conversationEpoch) {
      controller?.abort()
      if (streamController.value === controller) streamController.value = null
      cancellingTurnId.value = ''
      syncRecoveredTurnPolling()
    }
  }
}

function settlePendingDebugState(message?: Message) {
  if (!message) return
  message.debugDataState = resolveTerminalChatDebugDataState(message.debugDataState)
  if ((message.phase === 'COMPLETED' || message.phase === 'FAILED') && message.processStartedAt && !message.processCompletedAt) {
    message.processCompletedAt = Date.now()
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
    void trackProductEvent({
      eventType: 'chat_turn_submitted_total',
      page: 'chat',
      actionType: attachmentsForDisplay.some((attachment) => attachment.folderGroupId) ? 'with_folder' : 'without_folder',
      status: 'succeeded',
      itemCount: attachmentIds.length
    }).catch(() => undefined)
  }
  loading.value = true
  error.value = ''
  commercialQuotaError.value = false
  const controller = new AbortController()
  streamController.value = controller
  const epoch = conversationEpoch
  let assistantIndex = retryContext?.assistantIndex ?? -1
  let activeConversationId = conversationId.value
  let streamError = ''
  let receivedDone = false
  const targetMessage = () => {
    if (epoch !== conversationEpoch || activeConversationId !== conversationId.value) return undefined
    const target = messages.value[assistantIndex]
    return target?.turnId === turnId ? target : undefined
  }
  const liveTarget = () => cancellingTurnId.value === turnId || controller.signal.aborted ? undefined : targetMessage()

  try {
    activeConversationId = retryContext ? conversationId.value : await ensureConversationId(message, epoch)
    if (epoch !== conversationEpoch) return
    if (!activeConversationId) throw new Error('对话尚未保存，无法重试。')
    const pending: Message = {
      role: 'assistant', content: '', turnId, phase: 'THINKING',
      statusText: '正在等待执行进度…', debugDataState: 'pending', agentProgress: [], toolCalls: [], processTimeline: [], processStartedAt: Date.now()
    }
    if (retryContext) messages.value[assistantIndex] = pending
    else {
      messages.value.push({ role: 'user', content: message, attachments: attachmentsForDisplay.length ? attachmentsForDisplay : undefined })
      messages.value.push(pending)
      assistantIndex = messages.value.length - 1
    }

    await streamMessage({
      conversationId: activeConversationId,
      turnId,
      projectId: requestProjectId,
      message,
      knowledgeBaseIds: selectedKnowledgeBaseId.value ? [selectedKnowledgeBaseId.value] : [],
      attachmentIds,
      retry: Boolean(retryContext),
      modelId: chatModelId.value
    }, {
      onOpen: () => {
        if (!liveTarget()) return
        if (!retryContext) { input.value = ''; commitReadyAttachments() }
      },
      onDelta: (chunk) => {
        const target = liveTarget()
        if (!target) return
        target.content += chunk
        nextTick(() => {
          if (epoch !== conversationEpoch) return
          if (isNearBottom.value) scrollToBottom(false)
          else hasMessagesBelow.value = true
        })
      },
      onMeta: (meta) => {
        const target = liveTarget()
        if (!target) return
        if (typeof meta.attachmentContextInherited === 'boolean') Object.assign(target, attachmentContextMetadata(meta))
        applyProcessSnapshot(target, meta, turnId)
        target.sources = sanitizeChatSources(meta.sources)
        target.agentTrace = sanitizeAgentTrace(meta.agentTrace)
        target.toolResults = sanitizeToolResults(meta.toolResults)
        target.candidateMemories = meta.candidateMemories || []
        target.candidateTasks = meta.candidateTasks || []
        target.candidateGoals = meta.candidateGoals || []
        target.candidateDecisions = meta.candidateDecisions || []
        target.candidateOpenQuestions = meta.candidateOpenQuestions || []
        target.candidatePlans = meta.candidatePlans || []
        target.executionSuggestions = sanitizeExecutionSuggestions(meta.executionSuggestions)
        target.projectContext = sanitizeProjectContext(meta.projectContext)
        target.review = sanitizeReview(meta.review)
        target.usage = meta.usage
        target.usedMemories = sanitizeUsedMemories(meta.usedMemories)
        target.memoryExclusions = sanitizeMemoryExclusions(meta.memoryExclusions)
        target.memoryExplanationVersion = meta.memoryExplanationVersion
        target.debugVersion = sanitizeDebugVersion(meta.debugVersion)
        target.knowledgeBaseIds = sanitizeKnowledgeBaseIds(meta.knowledgeBaseIds)
        target.retrievalScope = sanitizeRetrievalScope(meta.retrievalScope)
        target.debugTruncated = meta.debugTruncated === true
        target.debugDataState = resolveLiveChatDebugDataState(meta.debugVersion)
      },
      onReasoningDelta: (event) => {
        const target = liveTarget()
        if (!target) return
        applyProcessReasoning(target, event, turnId)
        nextTick(() => {
          if (epoch !== conversationEpoch) return
          if (isNearBottom.value) scrollToBottom(false)
          else hasMessagesBelow.value = true
        })
      },
      onAgentStep: (event) => {
        const target = liveTarget()
        if (!target || event.turnId !== turnId) return
        applyProcessAgent(target, event, turnId)
        const running = (target.agentProgress || []).filter(item => item.status === 'running')
        target.statusText = running.length
          ? running.map(item => `${AGENT_STEPS[item.step]}中`).join(' · ')
          : '正在等待下一步进度…'
        nextTick(() => {
          if (epoch !== conversationEpoch) return
          if (isNearBottom.value) scrollToBottom(false)
          else hasMessagesBelow.value = true
        })
      },
      onTurnStatus: (status) => {
        const target = liveTarget()
        if (!target || (status.turnId && status.turnId !== turnId)) return
        target.phase = status.phase
        target.statusText = status.message
        target.processStartedAt = processTimestamp(status.processStartedAt) ?? target.processStartedAt
        target.processCompletedAt = processTimestamp(status.processCompletedAt) ?? target.processCompletedAt
        if (status.phase === 'COMPLETED' || status.phase === 'FAILED') settlePendingDebugState(target)
      },
      onToolCall: (event) => {
        const target = liveTarget()
        if (!target || event.turnId !== turnId) return
        applyProcessTool(target, event, turnId)
        nextTick(() => {
          if (epoch !== conversationEpoch) return
          if (isNearBottom.value) scrollToBottom(false)
          else hasMessagesBelow.value = true
        })
      },
      onImageBatchStarted: (batch) => { const target = liveTarget(); if (target && batch.turnId === turnId) applyImageBatchStarted(target, batch) },
      onImageItem: (item) => { const target = liveTarget(); if (target && item.turnId === turnId) applyImageItem(target, item) },
      onImageBatchCompleted: (batch) => { const target = liveTarget(); if (target && batch.turnId === turnId) applyImageBatchCompleted(target, batch) },
      onError: (errorMessage) => { streamError = errorMessage },
      onDone: () => { receivedDone = true }
    }, { signal: controller.signal })
    const target = targetMessage()
    if (!target || controller.signal.aborted || cancellingTurnId.value === turnId) return
    if (streamController.value === controller) streamController.value = null
    if ((!receivedDone || streamError || isActiveTurnPhase(target.phase)) && shouldRecoverChatTurn(target)) await recoverInterruptedTurn(target)
    else settlePendingDebugState(target)
    if (epoch !== conversationEpoch) return
    if (!streamError && startsProjectConversation && requestProjectId) {
      void trackEffectiveProgressAction({ page: 'chat', actionType: 'project_chat', projectId: requestProjectId }).catch(() => undefined)
    }
    if (!retryContext && !streamError && window.matchMedia('(max-width: 959px)').matches) {
      void trackProductEvent({ eventType: 'mobile_primary_action_used', page: 'chat', actionType: 'start_chat', projectId: requestProjectId }).catch(() => undefined)
    }
    await refreshConversations()
    await refreshBrief()
  } catch (exception) {
    if (epoch !== conversationEpoch || controller.signal.aborted || cancellingTurnId.value === turnId) return
    const target = targetMessage()
    if (target && !shouldRecoverChatTurn(target)) { settlePendingDebugState(target); return }
    if (exception instanceof HttpStreamError && exception.status === 402) {
      commercialQuotaError.value = true
      error.value = ''
      if (!retryContext && target && assistantIndex > 0) messages.value.splice(assistantIndex - 1, 2)
      else if (target) { target.phase = 'FAILED'; target.statusText = exception.message; settlePendingDebugState(target) }
      return
    }
    if (target && (!(exception instanceof HttpStreamError) || exception.status >= 500 || [408, 409].includes(exception.status))) {
      if (streamController.value === controller) streamController.value = null
      await recoverInterruptedTurn(target)
    } else {
      const fallback = (exception instanceof Error ? exception.message : '') || '请求未能发送，请稍后重试。'
      if (target) { target.phase = 'FAILED'; target.statusText = fallback; settlePendingDebugState(target) }
      error.value = fallback
    }
  } finally {
    if (activeConversationId) notifyChatNavigationChanged(navigationOwner)
    if (epoch === conversationEpoch) {
      if (streamController.value === controller) streamController.value = null
      syncRecoveredTurnPolling()
    }
  }
}

function retryFailedMessage(index: number, useQwenFallback = false) {
  if (loading.value) return
  const failed = messages.value[index]
  if (!failed?.turnId) {
    error.value = '该失败消息缺少轮次信息，请刷新后重试。'
    return
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages.value[cursor].role !== 'user') continue
    if (useQwenFallback) chatModelId.value = DEFAULT_CHAT_MODEL_ID
    void submit({ userIndex: cursor, assistantIndex: index, turnId: failed.turnId })
    return
  }
  error.value = '未找到要重试的原消息，请刷新后重试。'
}

function handleAttachmentFiles(files: File[], source: 'picker' | 'paste' | 'folder_picker') {
  if (source === 'folder_picker' && !runtimeFeatures.chatFolderAttachmentsEnabled) return
  const result = scanPickerFiles(files, source)
  void trackProductEvent({
    eventType: source === 'folder_picker' ? 'chat_folder_scan_total' : 'chat_attachment_added_total',
    page: 'chat',
    actionType: source,
    status: result.skipped.length ? 'partial' : result.files.length ? 'succeeded' : 'failed',
    itemCount: result.files.length
  }).catch(() => undefined)
  trackDirectorySkips(result.skipped)
  void addAttachmentFiles(result.files, result.skipped)
  if (result.files.length) dismissAttachmentHint()
}

function trackDirectorySkips(skipped: DirectorySkip[]) {
  const byReason = skipped.reduce<Record<string, number>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] || 0) + Math.max(1, item.count || 1)
    return counts
  }, {})
  for (const [reason, itemCount] of Object.entries(byReason)) {
    void trackProductEvent({
      eventType: 'chat_folder_skip_total', page: 'chat', actionType: reason, status: 'skipped', itemCount
    }).catch(() => undefined)
  }
}

function workspaceDragenter(event: DragEvent) {
  if (runtimeFeatures.chatWorkspaceDropEnabled) dropController.dragenter(event)
}

function workspaceDragleave(event: DragEvent) {
  if (runtimeFeatures.chatWorkspaceDropEnabled) dropController.dragleave(event)
}

function workspaceDragover(event: DragEvent) {
  if (runtimeFeatures.chatWorkspaceDropEnabled) dropController.dragover(event)
}

function workspaceDrop(event: DragEvent) {
  if (runtimeFeatures.chatWorkspaceDropEnabled) void dropController.drop(event)
}

function dismissAttachmentHint() {
  attachmentHintDismissed.value = true
  window.localStorage.setItem('lyle.chat.attachment-hint-dismissed', '1')
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
  const content = message.content.replace(/!\[[^\]]*]\(https?:\/\/[^)\s]+\)/g, '').trim()
  if (message.phase === 'FAILED' && content && content === message.statusText?.trim()) return ''
  return content
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
    && (Boolean(message.recoveryState) || (message.phase !== 'FAILED' && message.phase !== 'COMPLETED' && Boolean(message.statusText)))
}

function failureMessage(message: Message) {
  return message.statusText?.trim() || assistantTextContent(message) || '本次回答未能完成，请稍后重试。'
}

function isConnectionFailure(message: Message) {
  return isChatModelConnectionError(message.statusText || message.content)
}

function failureRetryLabel(message: Message) {
  if (!isConnectionFailure(message)) return '重试'
  return chatModelId.value === DEFAULT_CHAT_MODEL_ID ? '使用 Qwen 重试' : '切换到 Qwen 并重试'
}

async function copyDebugPayload(message: Message, index: number) {
  const payload = {
    debugVersion: message.debugVersion || null,
    debugDataState: message.debugDataState || null,
    debugTruncated: message.debugTruncated === true,
    knowledgeBaseIds: message.knowledgeBaseIds || [],
    retrievalScope: message.retrievalScope || {},
    usedMemories: message.usedMemories || [],
    memoryExclusions: message.memoryExclusions || {},
    agentTrace: message.agentTrace || [],
    agentProgress: message.agentProgress || [],
    toolCalls: message.toolCalls || [],
    processTimeline: message.processTimeline || [],
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

function traceItem(message: Message, agent: string) {
  return (message.agentTrace || []).find((item) => item.agent === agent)
}

function traceDecisionReason(item?: AgentTraceItem) {
  const decision = item?.decision as Record<string, unknown> | undefined
  return String(decision?.reason || '').trim()
}

function debugDataStatusLabel(message: Message) {
  if (message.debugDataState === 'pending') return '采集中'
  if (message.debugDataState === 'unsupported') return '版本不受支持'
  if (message.debugDataState === 'legacy') return '历史明细缺失'
  if (message.debugDataState !== 'available') return '本轮明细不可用'
  if (message.debugTruncated) return '安全截断'
  return '数据完整'
}

function debugDataNotice(message: Message) {
  if (message.recoveryState) return recoveryStatusText(message.recoveryState)
  if (message.debugDataState === 'pending') return message.agentProgress?.length ? '步骤状态正在实时更新，最终证据将在本轮结束后汇总。' : '等待后台步骤状态，尚未收到的步骤不会标为进行中。'
  if (message.debugDataState === 'unsupported') return '本轮使用了当前界面不支持的调试数据版本，不会将其中的空值解释为真实 0。请升级前端或重新提问。'
  if (message.debugDataState === 'legacy') return '这条旧回答没有保存调试明细，无法判断当时是未调用还是数据未记录。请重新提问以生成完整账本。'
  if (message.debugDataState !== 'available') return '本轮没有收到完整调试快照，不能把空栏目解释为真实 0；可重试本轮进行确认。'
  if (message.debugTruncated) return '调试快照超过安全容量，部分文本预览已截断；执行计数和状态仍可用于排查。'
  return ''
}

function debugSectionPlaceholder(message: Message, body = false) {
  if (message.debugDataState === 'pending') return body ? '正在采集…' : '—'
  if (message.debugDataState === 'legacy') return '未记录'
  if (message.debugDataState === 'unsupported') return '版本不支持'
  if (message.debugDataState === 'available') return ''
  return '快照未返回'
}

function debugStepPlaceholder(message: Message, step: AgentStep) {
  if (!message.agentProgress?.some(item => item.step === step)) return '等待该步骤的执行状态。'
  return `${agentProgressDetail(message.agentProgress, step, message.phase)}。详细证据将在本轮结束后汇总。`
}

function debugMemorySummary(message: Message) {
  if (message.debugDataState !== 'available' && message.agentProgress?.length) return agentProgressDetail(message.agentProgress, 'memory_agent', message.phase)
  return debugSectionPlaceholder(message)
    || `注入 ${injectedMemoryItems(message).length} 条 · 候选 ${recalledMemoryItems(message).length} 条 · 排除 ${memoryExclusionCount(message)} 条`
}

function debugRagSummary(message: Message) {
  if (message.debugDataState !== 'available' && message.agentProgress?.length) return agentProgressDetail(message.agentProgress, 'rag_agent', message.phase)
  return debugSectionPlaceholder(message) || `命中 ${ragContextCount(message)} 个片段`
}

function debugToolsSummary(message: Message) {
  if (message.debugDataState !== 'available' && message.agentProgress?.length) return agentProgressDetail(message.agentProgress, 'tool_agent', message.phase)
  return debugSectionPlaceholder(message)
    || (message.toolResults?.length ? `调用 ${message.toolResults.length} 次` : '本轮未调用')
}

function debugAgentSummary(message: Message) {
  if (message.debugDataState !== 'available' && message.agentProgress?.length) return `${message.agentProgress.length} 个步骤已有状态`
  return debugSectionPlaceholder(message) || `${message.agentTrace?.length || 0} 个节点`
}

function debugStepStateLabel(message: Message, state: DebugExecutionStep['state']) {
  if (message.debugDataState === 'pending' || message.agentProgress?.length) {
    return { done: '完成', empty: '0 项', skipped: '跳过', missing: '未记录', running: '进行中', failed: '失败', pending: '待开始', interrupted: '已中断' }[state]
  }
  if (message.debugDataState === 'legacy') return '未记录'
  if (message.debugDataState === 'unsupported') return '不支持'
  if (message.debugDataState !== 'available') return '未返回'
  return ({
    done: '完成',
    empty: '0 项',
    skipped: '跳过',
    missing: '缺数据',
    running: '进行中',
    failed: '失败',
    pending: '待开始',
    interrupted: '已中断'
  } as Record<DebugExecutionStep['state'], string>)[state]
}

function debugExecutionSteps(message: Message): DebugExecutionStep[] {
  if (message.debugDataState !== 'available' && (message.debugDataState === 'pending' || message.agentProgress?.length)) {
    const nodes: Array<{ id: DebugExecutionStep['id']; label: string; step: AgentStep }> = [
      { id: 'route', label: '路由', step: 'supervisor_agent' },
      { id: 'memory', label: '记忆', step: 'memory_agent' },
      { id: 'rag', label: '知识库', step: 'rag_agent' },
      { id: 'tools', label: '工具', step: 'tool_agent' },
      { id: 'writer', label: '生成', step: 'writer_agent' }
    ]
    return nodes.map(({ id, label, step }) => {
      const event = message.agentProgress?.find(item => item.step === step)
      const status = event ? agentProgressDisplayStatus(event, message.phase) : 'pending'
      const state = status === 'completed' ? 'done' : status
      return { id, label, state, detail: agentProgressDetail(message.agentProgress, step, message.phase) }
    })
  }
  if (message.debugDataState === 'legacy') {
    return ['route', 'memory', 'rag', 'tools', 'writer'].map((id, index) => ({
      id: id as DebugExecutionStep['id'],
      label: ['路由', '记忆', '知识库', '工具', '生成'][index],
      detail: '历史未记录',
      state: 'missing'
    }))
  }
  if (message.debugDataState === 'unsupported') {
    return ['route', 'memory', 'rag', 'tools', 'writer'].map((id, index) => ({
      id: id as DebugExecutionStep['id'],
      label: ['路由', '记忆', '知识库', '工具', '生成'][index],
      detail: '版本不支持',
      state: 'missing'
    }))
  }
  if (message.debugDataState !== 'available') {
    return [
      { id: 'route', label: '路由', detail: '快照未返回', state: 'missing' },
      { id: 'memory', label: '记忆', detail: '快照未返回', state: 'missing' },
      { id: 'rag', label: '知识库', detail: '快照未返回', state: 'missing' },
      { id: 'tools', label: '工具', detail: '快照未返回', state: 'missing' },
      { id: 'writer', label: '生成', detail: message.phase === 'FAILED' ? '回答失败' : '快照未返回', state: message.phase === 'FAILED' ? 'failed' : 'missing' }
    ]
  }

  const supervisor = traceItem(message, 'supervisor_agent')
  const memory = traceItem(message, 'memory_agent')
  const rag = traceItem(message, 'rag_agent')
  const tools = traceItem(message, 'tool_agent')
  const writer = traceItem(message, 'writer_agent')
  const memoryCount = injectedMemoryItems(message).length + recalledMemoryItems(message).length
  const ragCount = ragContextCount(message)
  const toolCount = message.toolResults?.length || 0
  const routeStep: DebugExecutionStep = supervisor
    ? { id: 'route', label: '路由', detail: '已确定处理步骤', state: 'done' }
    : { id: 'route', label: '路由', detail: '无路由 Trace', state: 'missing' }
  const memoryStep: DebugExecutionStep = memory?.skipped
    ? { id: 'memory', label: '记忆', detail: traceDecisionReason(memory) || '主动跳过', state: 'skipped' }
    : memory
      ? { id: 'memory', label: '记忆', detail: `${memoryCount} 条可见证据`, state: memoryCount ? 'done' : 'empty' }
      : { id: 'memory', label: '记忆', detail: '未调度或无 Trace', state: 'skipped' }
  const ragStep: DebugExecutionStep = message.retrievalScope?.requested === false
    ? { id: 'rag', label: '知识库', detail: ragReason(message) || '本轮未请求', state: 'skipped' }
    : ragWasSkipped(message)
    ? { id: 'rag', label: '知识库', detail: ragReason(message) || '主动跳过', state: 'skipped' }
    : ragWasExecuted(message)
      ? { id: 'rag', label: '知识库', detail: `命中 ${ragCount} 段`, state: ragCount ? 'done' : 'empty' }
      : message.retrievalScope?.requested === true
        ? { id: 'rag', label: '知识库', detail: ragReason(message) || '已请求但未执行', state: 'missing' }
        : { id: 'rag', label: '知识库', detail: '未请求或无 Trace', state: 'skipped' }
  const toolStep: DebugExecutionStep = tools?.skipped
    ? { id: 'tools', label: '工具', detail: traceDecisionReason(tools) || '主动跳过', state: 'skipped' }
    : tools || toolCount
      ? {
          id: 'tools',
          label: '工具',
          detail: `${toolCount} 次调用`,
          state: message.toolResults?.some((item) => !item.ok) ? 'failed' : toolCount ? 'done' : 'empty'
        }
      : { id: 'tools', label: '工具', detail: '未调用', state: 'empty' }
  const writerStep: DebugExecutionStep = message.phase === 'FAILED'
    ? { id: 'writer', label: '生成', detail: '回答失败', state: 'failed' }
    : writer
      ? { id: 'writer', label: '生成', detail: `${writer.answerChars || message.content.length} 字`, state: 'done' }
      : { id: 'writer', label: '生成', detail: '无生成 Trace', state: 'missing' }
  return [routeStep, memoryStep, ragStep, toolStep, writerStep]
}

function memoryTraceSummaryText(message: Message) {
  const summary = usedMemorySummary(message)
  if (!summary) return '没有记忆召回统计。'
  return [
    `长期摘要 ${summary.summaryChars || 0} 字`,
    `短期 ${summary.shortTermCount || 0} 条`,
    `结构化 ${summary.structuredCount || 0} 条`,
    `Qdrant 候选 ${summary.semanticCount || 0} 条`,
    `Milvus 候选 ${summary.vectorCount || 0} 条`,
    `合并召回 ${summary.retrievedCount || 0} 条`
  ].join(' · ')
}

function memoryExclusionText(message: Message) {
  const exclusions = message.memoryExclusions
  if (!exclusions) return ''
  return `已过滤：冲突 ${exclusions.conflicted} · 敏感 ${exclusions.sensitive} · 已治理 ${exclusions.governed}`
}

function memoryExclusionCount(message: Message) {
  const exclusions = message.memoryExclusions
  if (!exclusions) return 0
  return exclusions.conflicted + exclusions.sensitive + exclusions.governed
}

function writerInputFor(message: Message) {
  return traceItem(message, 'writer_agent')?.writerInput as Record<string, unknown> | undefined
}

function memoryContextWasExcluded(message: Message) {
  const writerInput = writerInputFor(message)
  return Number(writerInput?.excludedMemoryContextChars || 0) > 0
    && Number(writerInput?.memoryContextChars || 0) === 0
}

function memoryWriterInputText(message: Message) {
  const writerInput = writerInputFor(message)
  if (!writerInput) return ''
  const injectedChars = Number(writerInput.memoryContextChars || 0)
  const excludedChars = Number(writerInput.excludedMemoryContextChars || 0)
  const reason = String(writerInput.memoryExclusionReason || '').trim()
  if (excludedChars > 0 && injectedChars === 0) {
    return `生成阶段未注入已召回记忆：排除 ${excludedChars} 字${reason ? ` · ${reason}` : ''}`
  }
  if (injectedChars > 0) return `生成阶段实际注入记忆上下文 ${injectedChars} 字。`
  return ''
}

function ragTrace(message: Message) {
  return traceItem(message, 'rag_agent')
}

function ragWasSkipped(message: Message) {
  if (message.retrievalScope?.skipped === true) return true
  return ragTrace(message)?.skipped === true
}

function ragWasExecuted(message: Message) {
  if (message.retrievalScope?.executed === true) return true
  const trace = ragTrace(message)
  return Boolean(trace && trace.skipped !== true)
}

function ragContextCount(message: Message) {
  const scoped = message.retrievalScope?.contextCount
  if (typeof scoped === 'number') return scoped
  const traced = ragTrace(message)?.contextCount
  if (typeof traced === 'number') return traced
  return message.sources?.length || 0
}

function ragQueryCount(message: Message) {
  const scoped = message.retrievalScope?.queryCount
  if (typeof scoped === 'number') return scoped
  const traced = ragTrace(message)?.queryCount
  return typeof traced === 'number' ? traced : 0
}

function ragQueries(message: Message) {
  const queries = ragTrace(message)?.queries
  return Array.isArray(queries) ? queries : []
}

function ragReason(message: Message) {
  return message.retrievalScope?.reason || traceDecisionReason(ragTrace(message))
}

function ragStatusText(message: Message) {
  if (message.debugDataState === 'legacy') return '历史未记录'
  if (message.retrievalScope?.requested === false) return `本轮未请求知识库检索${ragReason(message) ? `：${ragReason(message)}` : ''}`
  if (ragWasSkipped(message)) return `已跳过${ragReason(message) ? `：${ragReason(message)}` : ''}`
  if (ragWasExecuted(message)) {
    const count = ragContextCount(message)
    return count ? `已执行，命中 ${count} 个片段` : '已执行，但命中 0 个片段'
  }
  if (message.retrievalScope?.requested === true) return `已请求但未执行${ragReason(message) ? `：${ragReason(message)}` : ''}`
  return '本轮未请求知识库检索'
}

function debugKnowledgeBaseLabel(id: string) {
  const match = knowledgeBases.value.find((item) => String(item.id) === id)
  return match ? `${match.name}（${id}）` : id
}

function toolTrace(message: Message) {
  return traceItem(message, 'tool_agent')
}

function selectedToolNames(message: Message) {
  const trace = toolTrace(message)
  const selected = Array.isArray(trace?.selectedTools) ? trace.selectedTools : []
  return Array.from(new Set(selected.length ? selected : (message.toolResults || []).map((item) => item.tool)))
}

function toolStatusText(tool: ToolResult) {
  if (tool.requiresConfirmation) return '等待确认'
  return tool.ok ? '成功' : '失败'
}

function toolRetryLabel(tool: ToolResult) {
  if (tool.retryable === true) return '可重试'
  if (tool.retryable === false) return '不可重试'
  return '未记录重试策略'
}

function toolEmptyText(message: Message) {
  if (message.debugDataState === 'legacy') return '该历史回答没有保存工具调用明细。'
  const trace = toolTrace(message)
  if (trace?.skipped) return traceDecisionReason(trace) || 'Tool Agent 主动跳过了本轮。'
  return traceDecisionReason(trace) || '本轮没有调用任何工具。'
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

function memoryMetricItems(message: Message) {
  const summary = usedMemorySummary(message)
  return [
    { label: '长期画像', value: injectedMemoryItems(message).length },
    { label: '短期记忆', value: Number(summary?.shortTermCount || 0) },
    { label: '结构化记忆', value: Number(summary?.structuredCount || 0) },
    { label: '向量召回', value: Number(summary?.retrievedCount || summary?.vectorCount || 0) }
  ]
}

function memoryUsageRecords(message: Message): DebugMemoryItem[] {
  return (message.usedMemories || []).map((item) => ({
    kind: 'injected',
    label: item.title,
    value: item.valueSummary,
    meta: `${memoryReasonLabel(item.reasonCode)} · ${memoryReliabilityLabel(item.reliability)} · ${item.sourceCount} 个来源`
  }))
}

function injectedMemoryRecords(message: Message): UsedMemory[] {
  return memoryContextWasExcluded(message) ? [] : (message.usedMemories || [])
}

function injectedMemoryItems(message: Message): DebugMemoryItem[] {
  return injectedMemoryRecords(message).map((item) => ({
    kind: 'injected',
    label: item.title,
    value: item.valueSummary,
    meta: `${memoryReasonLabel(item.reasonCode)} · ${memoryReliabilityLabel(item.reliability)} · ${item.sourceCount} 个来源`
  }))
}

function recalledMemoryItems(message: Message): DebugMemoryItem[] {
  const items: DebugMemoryItem[] = memoryContextWasExcluded(message)
    ? memoryUsageRecords(message).map((item) => ({
        ...item,
        kind: 'excluded' as const,
        label: `${item.label}（未注入）`,
        meta: `${item.meta} · 生成阶段已排除`
      }))
    : []
  const summary = usedMemorySummary(message)
  if (!summary) return items
  const summaryPreview = String(summary.summaryPreview || '').trim()
  if (summaryPreview) {
    items.push({ kind: 'summary', label: '长期摘要', value: summaryPreview, meta: '摘要记忆' })
  }
  const shortTerm = Array.isArray(summary.shortTermPreview) ? summary.shortTermPreview : []
  for (const raw of shortTerm) {
    const turn = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}
    const value = String(turn.content || '').trim()
    if (value) {
      items.push({
        kind: 'short-term',
        label: String(turn.role || '').toLowerCase() === 'assistant' ? '短期记忆 · 助手' : '短期记忆 · 用户',
        value,
        meta: '当前对话上下文'
      })
    }
  }
  const structured = Array.isArray(summary.structuredPreview) ? summary.structuredPreview : []
  for (const raw of structured) {
    const parsed = parseMemoryPreview(String(raw || ''))
    if (parsed.value) {
      items.push({
        kind: 'structured',
        label: structuredMemoryLabel(parsed.key),
        value: parsed.value,
        meta: '结构化记忆'
      })
    }
  }
  const retrieved = Array.isArray(summary.retrievedPreview) ? summary.retrievedPreview : []
  for (const raw of retrieved) {
    const value = String(raw || '').trim()
    if (value) {
      items.push({ kind: 'retrieved', label: '向量召回片段', value, meta: '合并并进入记忆上下文' })
    }
  }
  return items.slice(0, 28)
}

function usedMemoryItems(message: Message): DebugMemoryItem[] {
  const items = [...injectedMemoryItems(message), ...recalledMemoryItems(message)]
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.kind}:${item.label}:${item.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function memoryReliabilityLabel(reliability: string) {
  return ({
    RELIABLE: '可靠',
    BASIC: '基础信息',
    REVIEW_REQUIRED: '待核对'
  } as Record<string, string>)[reliability] || reliability
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
  return (match?.[1] || match?.[2] || '').split(';message:', 1)[0]
}

function memorySourceText(item: MemoryItem) {
  const source = item.source || ''
  const match = source.match(/^source_ref:[^\n]+\n?([\s\S]*)$/)
  return (match?.[1] || item.sourceText || '').trim()
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
      await changeStructuredMemoryStatus(item.key, 'disabled')
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
    const next = response.data.result?.operation as PendingOperationItem | undefined
    if (response.data.result?.requiresConfirmation && next?.id) {
      message.toolResults = [...(message.toolResults || []), {
        tool: next.toolName, ok: true, requiresConfirmation: true, operation: next,
      } as ToolResult]
    }
    if (response.data.result?.ok === false) {
      item.error = String(response.data.result.content || '操作未完成，请查看执行记录。')
    }
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
  <section
    class="page"
    @dragenter="workspaceDragenter"
    @dragleave="workspaceDragleave"
    @dragover="workspaceDragover"
    @drop="workspaceDrop"
  >
    <WorkspaceDropOverlay v-if="runtimeFeatures.chatWorkspaceDropEnabled && (dropController.dragging.value || dropController.scanning.value)" :scanning="dropController.scanning.value" />
    <div class="toolbar">
      <div>
        <h1>AI 聊天</h1>
        <form v-if="editingTitle" class="title-editor" @submit.prevent="saveTitle">
          <input v-model="titleDraft" maxlength="120" aria-label="对话标题" />
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
        <button class="secondary" type="button" @click="router.push('/local-project')">打开本地项目</button>
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
        <button class="secondary" type="button" @click="newConversation">新对话</button>
      </div>
    </div>

    <p v-if="error" class="alert danger">{{ error }}</p>
    <p v-if="sourceReplayNotice" class="source-replay-notice" role="status">{{ sourceReplayNotice }}</p>
    <section v-if="commercialQuotaError" class="commercial-quota-card" role="alert">
      <div>
        <strong>当前 AI 额度不足</strong>
        <p>输入和附件草稿已保留。购买完成后请返回并主动重新发送，本任务不会自动执行。</p>
      </div>
      <RouterLink :to="{ path: '/pricing', query: { returnTo: route.fullPath } }">升级套餐或购买额度</RouterLink>
      <button type="button" @click="commercialQuotaError = false">稍后再试</button>
    </section>
    <p v-if="briefError" class="alert danger">{{ briefError }}</p>

    <div
      class="chat-workspace"
      :class="{
        'context-closed': !showContextPanel && !showMemoryExplanation,
        'memory-explanation-open': showMemoryExplanation
      }"
    >
    <div
      ref="chatListRef"
      class="panel chat-list"
      :class="{ 'chat-list--empty': !hasUserMessages, 'chat-list--debug': showDebug && hasUserMessages }"
      :role="hasUserMessages ? 'log' : undefined"
      :aria-label="hasUserMessages ? '对话消息' : undefined"
      :aria-live="hasUserMessages ? 'polite' : undefined"
      @scroll="onChatScroll"
    >
      <section v-if="!hasUserMessages" class="chat-starter" aria-labelledby="chat-starter-title">
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
      <div
        v-for="(message, index) in messages"
        :key="message.turnId ? `${message.role}:${message.turnId}` : (message.id || index)"
        class="message"
        :class="[message.role, { 'debug-message': showDebug && message.role === 'assistant', 'source-message-highlight': highlightedMessageId === message.id }]"
        :data-message-id="message.id || undefined"
        :tabindex="highlightedMessageId === message.id ? -1 : undefined"
      >
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
          <p v-if="message.attachmentContextInherited" class="attachment-context-note">沿用本对话已上传的文件</p>
          <ChatThinkingProcess
            :key="message.turnId || message.id || index"
            :items="message.agentProgress || []"
            :tool-calls="message.toolCalls || []"
            :process-timeline="message.processTimeline"
            :reasoning="message.reasoning"
            :phase="message.phase"
            :active="isActiveTurnPhase(message.phase)"
            :status-text="message.recoveryState ? recoveryStatusText(message.recoveryState) : message.statusText"
            :started-at="message.processStartedAt"
            :completed-at="message.processCompletedAt"
          />
          <div
            v-if="message.recoveryState === 'unconfirmed' || (message.imageBatch && showAssistantStatus(message))"
            class="turn-status"
            :class="`phase-${message.phase?.toLowerCase()}`"
          >
            <span class="turn-status-dot" aria-hidden="true"></span>
            <span>{{ message.recoveryState ? recoveryStatusText(message.recoveryState) : message.statusText }}</span>
            <button v-if="message.recoveryState === 'unconfirmed'" class="secondary" type="button" @click="refreshTurnStatus">重新查询状态</button>
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
          <MessageFailureActions
            v-if="message.phase === 'FAILED' && !loading"
            :message="failureMessage(message)"
            :label="failureRetryLabel(message)"
            :connection-failure="isConnectionFailure(message)"
            @retry="retryFailedMessage(index, isConnectionFailure(message))"
          />
          <details v-if="message.usage?.callCount" class="turn-usage">
            <summary>
              本轮 {{ formatTokens((message.usage.promptTokens || 0) + (message.usage.completionTokens || 0)) }} Token
              · 估算 {{ formatEstimatedCost(message.usage.estimatedCostMicros) }}
              · {{ message.usage.callCount }} 次 AI 调用
            </summary>
            <div>
              <span>输入 {{ formatTokens(message.usage.promptTokens) }}</span>
              <span>输出 {{ formatTokens(message.usage.completionTokens) }}</span>
              <span>{{ measurementLabel(message.usage.measurementSource) }}</span>
            </div>
          </details>
          <button
            v-if="message.usedMemories?.length && !showDebug"
            class="memory-explanation-trigger"
            type="button"
            @click="openMemoryExplanation(message)"
          >
            <span><BrainCircuit :size="17" aria-hidden="true" />使用了 {{ message.usedMemories.length }} 条记忆</span>
            <span>查看 <ChevronRight :size="16" aria-hidden="true" /></span>
          </button>
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
          <RouterLink class="inline-link" :to="`/projects/${projectResolver(message)?.projectId}`">打开项目计划</RouterLink>
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

        <ChatSources v-if="message.role === 'assistant' && message.sources?.length && !showDebug" :sources="message.sources" />

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

        <DebugLedger
          v-if="showDebug && message.role === 'assistant'"
          :key="`${conversationId}-${index}`"
          :state="message.debugDataState"
          :status="debugDataStatusLabel(message)"
          :summary="summarizeChatDebug({
            state: message.debugDataState,
            truncated: message.debugTruncated,
            injectedMemoryCount: injectedMemoryRecords(message).length,
            sourceCount: message.sources?.length || 0,
            toolResultCount: message.toolResults?.length || 0,
            failedToolCount: message.toolResults?.filter(tool => !tool.ok && !tool.requiresConfirmation).length,
            reviewBlocked: message.review?.approved === false || message.review?.ruleBlocked === true,
            answerFailed: message.phase === 'FAILED'
          })"
          :version="message.debugVersion"
          :truncated="message.debugTruncated"
          :copy-state="traceCopyState[index]"
          @copy="copyDebugPayload(message, index)"
        >
          <p v-if="debugDataNotice(message)" class="debug-ledger-notice" data-testid="debug-data-notice" role="status">
            {{ debugDataNotice(message) }}
          </p>

          <div class="debug-execution-strip" aria-label="本轮执行路径">
            <template v-for="(step, stepIndex) in debugExecutionSteps(message)" :key="step.id">
              <div class="debug-execution-step" :class="`is-${step.state}`">
                <span class="debug-step-icon">
                  <GitBranch v-if="step.id === 'route'" :size="21" aria-hidden="true" />
                  <BrainCircuit v-else-if="step.id === 'memory'" :size="21" aria-hidden="true" />
                  <Database v-else-if="step.id === 'rag'" :size="21" aria-hidden="true" />
                  <Wrench v-else-if="step.id === 'tools'" :size="21" aria-hidden="true" />
                  <Sparkles v-else :size="21" aria-hidden="true" />
                </span>
                <span class="debug-step-copy">
                  <strong>{{ step.label }}</strong>
                  <small><Circle :size="7" fill="currentColor" aria-hidden="true" />{{ debugStepStateLabel(message, step.state) }}</small>
                  <span :title="step.detail">{{ step.detail }}</span>
                </span>
              </div>
              <ArrowRight v-if="stepIndex < 4" class="debug-step-arrow" :size="20" aria-hidden="true" />
            </template>
          </div>

          <section class="debug-ledger-section" data-testid="debug-memory-section">
            <div class="debug-ledger-section-head">
              <span><BrainCircuit :size="17" aria-hidden="true" /><strong>记忆</strong></span>
              <p data-testid="debug-memory-summary">{{ debugMemorySummary(message) }}</p>
            </div>
            <div class="debug-ledger-section-body">
              <div v-if="message.debugDataState !== 'available'" class="debug-empty">
                {{ message.debugDataState === 'pending' ? debugStepPlaceholder(message, 'memory_agent') : debugSectionPlaceholder(message, true) }}
              </div>
              <template v-else>
                <div v-if="injectedMemoryRecords(message).length" class="debug-data-table debug-memory-table" role="table" aria-label="实际注入回答的记忆">
                  <div class="debug-table-row debug-table-head" role="row">
                    <span role="columnheader">记忆项</span>
                    <span role="columnheader">值摘要</span>
                    <span role="columnheader">来源数</span>
                    <span role="columnheader">召回原因</span>
                  </div>
                  <div v-for="item in injectedMemoryRecords(message)" :key="`${item.memoryId}-${item.title}`" class="debug-table-row" role="row">
                    <strong role="cell">{{ item.title }}</strong>
                    <span role="cell">{{ item.valueSummary }}</span>
                    <span role="cell">{{ item.sourceCount }} 个</span>
                    <span role="cell">{{ memoryReasonLabel(item.reasonCode) }} · {{ memoryReliabilityLabel(item.reliability) }}</span>
                  </div>
                </div>
                <p v-else class="debug-empty">本轮实际注入 0 条画像记忆。</p>

                <div class="debug-memory-metrics" aria-label="记忆召回统计">
                  <span v-for="metric in memoryMetricItems(message)" :key="metric.label">
                    {{ metric.label }} <strong>{{ metric.value }}</strong>
                  </span>
                </div>

                <details v-if="recalledMemoryItems(message).length" class="debug-disclosure debug-recall-disclosure">
                  <summary>
                    <span>查看召回过程</span>
                    <small>{{ recalledMemoryItems(message).length }} 条预览</small>
                  </summary>
                  <div class="debug-recall-detail">
                    <div class="debug-section-notes">
                      <p class="debug-ledger-summary">{{ memoryTraceSummaryText(message) }}</p>
                      <p v-if="traceDecisionReason(traceItem(message, 'memory_agent'))" class="debug-ledger-reason">
                        召回决策：{{ traceDecisionReason(traceItem(message, 'memory_agent')) }}
                      </p>
                      <p v-if="memoryExclusionText(message)" class="debug-ledger-reason">{{ memoryExclusionText(message) }}</p>
                      <p v-if="memoryWriterInputText(message)" class="debug-ledger-reason">{{ memoryWriterInputText(message) }}</p>
                    </div>
                    <div class="debug-evidence-list">
                      <article
                        v-for="item in recalledMemoryItems(message)"
                        :key="`${item.kind}-${item.label}-${item.value}`"
                        class="debug-evidence-card"
                        :data-kind="item.kind"
                      >
                        <strong>{{ item.label }}</strong>
                        <p>{{ item.value }}</p>
                        <small>{{ item.meta }}</small>
                      </article>
                    </div>
                  </div>
                </details>
                <p v-else-if="traceItem(message, 'memory_agent')?.skipped" class="debug-empty">
                  记忆 Agent 主动跳过：{{ traceDecisionReason(traceItem(message, 'memory_agent')) || '本轮不需要召回记忆。' }}
                </p>
                <p v-else class="debug-empty">本轮没有可展示的摘要、短期、结构化或向量召回预览。</p>
              </template>
            </div>
          </section>

          <section class="debug-ledger-section" data-testid="debug-rag-section">
            <div class="debug-ledger-section-head">
              <span><Database :size="17" aria-hidden="true" /><strong>知识库 RAG</strong></span>
              <p data-testid="debug-rag-summary">{{ debugRagSummary(message) }}</p>
            </div>
            <div class="debug-ledger-section-body">
              <div v-if="message.debugDataState !== 'available'" class="debug-empty">
                {{ message.debugDataState === 'pending' ? debugStepPlaceholder(message, 'rag_agent') : debugSectionPlaceholder(message, true) }}
              </div>
              <template v-else>
                <div class="debug-inline-facts">
                  <span>
                    <strong>选用知识库：</strong>
                    <template v-if="message.knowledgeBaseIds?.length">
                      {{ message.knowledgeBaseIds.map(debugKnowledgeBaseLabel).join('；') }}
                    </template>
                    <template v-else>未选择或未记录</template>
                  </span>
                  <span>
                    <strong>检索 Query：</strong>
                    {{ ragQueries(message).length ? ragQueries(message).join('；') : `未保留文本（${ragQueryCount(message)} 个 Query）` }}
                  </span>
                </div>
                <p class="debug-ledger-summary">{{ ragStatusText(message) }}</p>
                <div v-if="message.sources?.length" class="debug-data-table debug-source-list" role="table" aria-label="RAG 命中片段">
                  <div class="debug-table-row debug-table-head" role="row">
                    <span role="columnheader">文档标题</span>
                    <span role="columnheader">相似度</span>
                    <span role="columnheader">检索方式</span>
                    <span role="columnheader">片段预览</span>
                  </div>
                  <details
                    v-for="(source, sourceIndex) in message.sources"
                    :key="sourceCardKey(source, sourceIndex)"
                    class="debug-source-card"
                  >
                    <summary class="debug-table-row" role="row">
                      <strong role="cell">{{ sourceFileName(source) }}</strong>
                      <span role="cell">{{ source.score || '-' }}</span>
                      <span role="cell">{{ source.hitModes || source.backend || '-' }}</span>
                      <span role="cell">{{ sourceSnippet(source) }}</span>
                    </summary>
                    <div class="debug-table-expanded">
                      <small>{{ sourceSegmentLabel(source) }} · 文档 {{ source.docId || '-' }}<template v-if="sourceRetrievalLabel(source)"> · {{ sourceRetrievalLabel(source) }}</template></small>
                      <pre>{{ source.chunk }}</pre>
                    </div>
                  </details>
                </div>
                <p v-else class="debug-empty">
                  {{ ragWasExecuted(message) ? '检索已执行，但返回 0 个知识片段。' : ragReason(message) || '本轮没有执行知识库检索。' }}
                </p>
              </template>
            </div>
          </section>

          <section class="debug-ledger-section" data-testid="debug-tools-section">
            <div class="debug-ledger-section-head">
              <span><Wrench :size="17" aria-hidden="true" /><strong>工具调用</strong></span>
              <p data-testid="debug-tools-summary">{{ debugToolsSummary(message) }}</p>
            </div>
            <div class="debug-ledger-section-body">
              <div v-if="message.debugDataState !== 'available'" class="debug-empty">
                {{ message.debugDataState === 'pending' ? debugStepPlaceholder(message, 'tool_agent') : debugSectionPlaceholder(message, true) }}
              </div>
              <template v-else>
                <p v-if="selectedToolNames(message).length" class="debug-ledger-summary">
                  <strong>路由选择：</strong>{{ selectedToolNames(message).join('；') }}
                </p>
                <div v-if="message.toolResults?.length" class="debug-data-table debug-tool-list" role="table" aria-label="工具调用结果">
                  <div class="debug-table-row debug-table-head" role="row">
                    <span role="columnheader">工具</span>
                    <span role="columnheader">状态</span>
                    <span role="columnheader">耗时</span>
                    <span role="columnheader">安全摘要</span>
                  </div>
                  <article v-for="(tool, toolIndex) in message.toolResults" :key="`${toolIndex}-${tool.tool}`" class="debug-tool-card debug-table-row" role="row">
                    <strong role="cell">{{ tool.tool }}</strong>
                    <span role="cell" class="debug-status-text" :class="{ danger: !tool.ok, success: tool.ok }">{{ toolStatusText(tool) }}</span>
                    <span role="cell">{{ typeof tool.elapsedMs === 'number' ? `${tool.elapsedMs}ms` : '-' }}</span>
                    <span role="cell">
                      {{ tool.content }}
                      <small><template v-if="tool.operationType">{{ tool.operationType }} · </template><template v-if="tool.riskLevel">{{ tool.riskLevel }} · </template>{{ toolRetryLabel(tool) }}</small>
                    </span>
                  </article>
                </div>
                <div v-else class="debug-tool-empty">
                  <strong>本轮未调用工具</strong>
                  <span>路由原因：{{ toolEmptyText(message) }}</span>
                </div>
              </template>
            </div>
          </section>

          <section class="debug-ledger-section" data-testid="debug-agent-section">
            <div class="debug-ledger-section-head">
              <span><GitBranch :size="17" aria-hidden="true" /><strong>Agent 流程</strong></span>
              <p data-testid="debug-agent-summary">{{ debugAgentSummary(message) }}</p>
            </div>
            <div class="debug-ledger-section-body">
              <AgentProgressTimeline v-if="message.agentProgress?.length && message.debugDataState !== 'available'" :items="message.agentProgress" :phase="message.phase" :active="isActiveTurnPhase(message.phase)" />
              <div v-else-if="message.debugDataState !== 'available'" class="debug-empty">
                {{ debugSectionPlaceholder(message, true) }}
              </div>
              <template v-else>
                <DebugAgentTimeline
                  v-if="message.agentTrace?.length || (message.review && Object.keys(message.review).length)"
                  :items="message.agentTrace || []"
                  :project-context="message.projectContext"
                  :review="message.review"
                  :format-detail="formatTraceDetail"
                />
                <p v-else class="debug-empty">本轮 Agent Trace 为 0 步。</p>
                <details v-if="message.agentProgress?.length" class="debug-disclosure">
                  <summary>查看实时步骤与细分耗时</summary>
                  <AgentProgressTimeline :items="message.agentProgress" :phase="message.phase" />
                </details>
              </template>
            </div>
          </section>
        </DebugLedger>
      </div>
    </div>

    <ContextPanel title="当前上下文" :open="showContextPanel" @close="showContextPanel = false">
      <section class="context-section context-controls">
        <small>切换上下文</small>
        <p class="context-persistence-note">关联的项目计划和知识库会持续用于新消息与新对话，直到你在这里切换为不使用。</p>
        <label>
          <span>切换对话</span>
          <select
            v-model="conversationId"
            data-testid="conversation-select"
            aria-label="选择对话"
            :disabled="titleSaving"
            @change="changeConversation"
          >
            <option value="">新对话</option>
            <option v-for="item in conversations" :key="item.id" :value="String(item.id)">
              {{ item.title }}
            </option>
          </select>
        </label>
        <label>
          <span>关联项目计划</span>
          <select
            v-model="selectedProjectId"
            data-testid="chat-project-select"
            aria-label="选择关联项目计划"
            :disabled="loading || projectsLoading"
            @change="changeProjectContext"
          >
            <option value="">不关联项目计划</option>
            <option v-for="item in projects" :key="item.id" :value="String(item.id)">
              {{ item.name }}
            </option>
          </select>
          <small v-if="projectsLoading" class="context-load-note">项目计划正在后台加载…</small>
          <small v-else-if="projectsError" class="context-load-note danger">{{ projectsError }}</small>
          <small class="context-load-note">使用“任务”中项目计划的目标、任务和资料。</small>
        </label>
        <label>
          <span>知识库</span>
          <select
            v-model="selectedKnowledgeBaseId"
            data-testid="chat-knowledge-select"
            aria-label="选择知识库"
            :disabled="loading || knowledgeBasesLoading"
            @change="changeKnowledgeContext"
          >
            <option value="">不使用知识库</option>
            <option v-for="item in knowledgeBases" :key="item.id" :value="String(item.id)">
              {{ item.name }}
            </option>
          </select>
          <small v-if="knowledgeBasesLoading" class="context-load-note">知识库正在后台加载…</small>
          <small v-else-if="knowledgeBasesError" class="context-load-note danger">{{ knowledgeBasesError }}</small>
        </label>
      </section>
      <section class="context-section">
        <small>关联项目计划</small>
        <strong>{{ activeProjectName || '未关联项目计划' }}</strong>
        <RouterLink v-if="activeProjectId" class="inline-link" :to="`/projects/${activeProjectId}`">打开项目计划</RouterLink>
        <p v-else class="muted">从任务或项目计划发起对话，可自动携带项目计划上下文。</p>
        <span v-if="contextProject?.projectId && contextProject.projectId !== activeProjectId">
          最近回答使用了 {{ contextProject.projectName || `项目计划 #${contextProject.projectId}` }}
        </span>
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

    <MemoryExplanationPanel
      :open="showMemoryExplanation"
      :memories="explainedMemories"
      @close="showMemoryExplanation = false"
    />

    <button v-if="hasMessagesBelow" class="scroll-bottom" type="button" @click="scrollToBottom()">
      <ArrowDown :size="15" aria-hidden="true" /> 新消息
    </button>

    <ChatComposer
      @local-project="router.push('/local-project')"
      ref="composerRef"
      class="chat-input"
      v-model="input"
      :attachments="attachmentDrafts"
      :skipped="attachmentSkipped"
      :loading="loading"
      :disabled="composerDisabled"
      :announcement="attachmentAnnouncement"
      :show-attachment-hint="showAttachmentHint"
      :folder-attachments-enabled="runtimeFeatures.chatFolderAttachmentsEnabled"
      :model-options="CHAT_MODEL_OPTIONS"
      :context-summary="activeContextSummary"
      v-model:chat-model-id="chatModelId"
      @open-context="openContextPanel"
      @submit="submit"
      @stop="cancelStreaming"
      @files="handleAttachmentFiles"
      @remove="removeAttachment"
      @remove-group="removeAttachmentGroup"
      @retry="retryAttachment"
      @dismiss-hint="dismissAttachmentHint"
    />
    </div>
  </section>
</template>

<style scoped>
.attachment-context-note { margin: 0 0 10px; color: var(--muted-foreground); font-size: 11px; line-height: 1.6; }
.page {
  --chat-content-width: 920px;
}

.toolbar {
  width: min(100%, var(--chat-content-width));
  margin-inline: auto;
}

.chat-workspace {
  position: relative;
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
  grid-template-rows: minmax(0, 1fr) auto;
  gap: var(--space-4);
}

.chat-workspace.context-closed { grid-template-columns: minmax(0, 1fr); }
.chat-workspace.memory-explanation-open { grid-template-columns: minmax(0, 1fr) minmax(380px, 420px); }

.chat-list {
  grid-column: 1;
  grid-row: 1;
  min-height: 0;
  max-height: none;
  overflow-y: auto;
  overscroll-behavior: contain;
  width: min(100%, var(--chat-content-width));
  justify-self: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding: var(--space-3) 0 var(--space-5);
}

.chat-list--debug {
  width: min(100%, var(--chat-content-width));
}

.chat-list--debug .message {
  width: min(100%, var(--chat-content-width));
}

.chat-list--debug .message.debug-message {
  --chat-debug-track-inset: max(0px, calc((100% - var(--chat-content-width)) / 2));
  width: 100%;
}

.chat-list--debug .message.debug-message > :not(.debug-panel) {
  min-width: 0;
  max-width: min(100%, var(--chat-content-width));
  margin-inline-start: var(--chat-debug-track-inset);
  margin-inline-end: 0;
}

.message {
  width: 100%;
  max-width: none;
  margin-inline: auto;
}

.message.assistant > .message-bubble {
  width: 100%;
  max-width: 100%;
}

.chat-list--debug .message.debug-message > .message-bubble {
  width: min(100%, var(--chat-content-width));
  max-width: var(--chat-content-width);
  margin-inline: auto;
}

.chat-list::-webkit-scrollbar { display: none; width: 0; height: 0; }

.chat-list--empty { overflow: hidden; }

.source-replay-notice {
  margin: 0;
  border: 1px solid var(--primary-border);
  border-radius: var(--radius-md);
  background: var(--primary-soft);
  color: var(--foreground);
  padding: var(--space-2) var(--space-3);
  font-size: 12px;
  font-weight: 700;
}

.source-message-highlight {
  border-radius: var(--radius-lg);
  outline: 3px solid color-mix(in srgb, var(--primary) 44%, transparent);
  outline-offset: 6px;
  animation: source-message-pulse 1.2s ease-out 2;
}

@keyframes source-message-pulse {
  0% { outline-color: var(--primary); }
  100% { outline-color: color-mix(in srgb, var(--primary) 20%, transparent); }
}

.chat-starter {
  display: grid;
  gap: var(--space-5);
  width: min(780px, 100%);
  align-self: center;
  margin: auto;
  padding: clamp(16px, 4vw, 42px) 0;
}

.chat-starter h2 { margin: 0; font-size: clamp(22px, 3vw, 30px); }
.chat-starter p { margin: 6px 0 0; }
.starter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }

.context-section { display: grid; gap: var(--space-2); }
.context-controls label { display: grid; gap: 6px; color: var(--muted-foreground); font-size: 12px; font-weight: 700; }
.context-section > .context-persistence-note { margin: 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.55; }
.context-controls select { width: 100%; min-width: 0; min-height: 44px; }
.context-load-note { color: var(--muted-foreground); font-size: 11px; font-weight: 500; }
.context-load-note.danger { color: var(--danger); }
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
.memory-explanation-open .scroll-bottom { right: calc(min(420px, 31vw) + var(--space-7)); }

.chat-input {
  position: sticky;
  z-index: 5;
  bottom: calc(var(--space-2) + env(safe-area-inset-bottom));
  display: block;
  grid-template-columns: none;
  gap: 0;
  padding: 0;
  grid-column: 1;
  grid-row: 2;
  width: min(100%, var(--chat-content-width));
  justify-self: center;
}
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
  max-width: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-muted);
  color: var(--muted-foreground);
  padding: 7px 11px;
  font-size: 13px;
  font-weight: 700;
}
.turn-status > span:nth-child(2) { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.turn-status > button { font-size: 12px; min-height: 28px; padding: 4px 8px; }
.debug-execution-step.is-interrupted .debug-step-copy small { color: #92400e; }
.debug-execution-step.is-pending .debug-step-copy small { color: var(--muted-foreground); }
.turn-status-dot {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--primary) 35%, transparent);
  animation: turn-pulse 1.4s ease-out infinite;
}
.turn-usage {
  width: fit-content;
  max-width: min(100%, 620px);
  color: var(--muted-foreground);
  font-size: 11px;
}
.turn-usage summary { cursor: pointer; list-style-position: inside; }
.turn-usage div { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; border-left: 2px solid var(--primary-border); padding-left: 10px; }
.memory-explanation-trigger {
  display: flex;
  width: 100%;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  border: 1px solid var(--primary-border);
  border-radius: var(--radius-md);
  background: var(--primary-soft);
  color: var(--foreground);
  padding: 0 var(--space-3);
  font-size: 12px;
  font-weight: 700;
  text-align: left;
}
.memory-explanation-trigger > span { display: inline-flex; align-items: center; gap: 7px; }
.memory-explanation-trigger > span:first-child svg { color: var(--primary); }
.memory-explanation-trigger > span:last-child { color: var(--primary); white-space: nowrap; }
.memory-explanation-trigger:hover { border-color: var(--primary); background: color-mix(in srgb, var(--primary-soft) 82%, var(--surface)); }
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
.commercial-quota-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-3);
  border: 1px solid var(--danger-border);
  border-radius: var(--radius-lg);
  background: var(--danger-soft);
  padding: var(--space-3) var(--space-4);
}
.commercial-quota-card strong { color: var(--danger-strong); }
.commercial-quota-card p { margin: 3px 0 0; color: var(--muted-foreground); font-size: 11px; }
.commercial-quota-card a,
.commercial-quota-card button {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--primary);
  color: white;
  padding: 0 var(--space-3);
  font-size: 11px;
  font-weight: 750;
  white-space: nowrap;
}
.commercial-quota-card button { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); }

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
  .chat-workspace.memory-explanation-open { grid-template-columns: minmax(0, 1fr); }
  .scroll-bottom { right: var(--space-4); }
}

@media (max-width: 640px) {
  .toolbar {
    display: flex;
    width: 100%;
    align-items: stretch;
    flex-direction: column;
  }
  .commercial-quota-card { grid-template-columns: 1fr 1fr; }
  .commercial-quota-card > div { grid-column: 1 / -1; }
  .chat-list--empty { overflow-y: auto; }
  .chat-starter {
    align-self: start;
    gap: var(--space-3);
    padding: var(--space-2) 0 var(--space-4);
  }
  .starter-grid { grid-template-columns: 1fr; gap: var(--space-2); }
  .starter-grid :deep(.suggestion-card.compact) {
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-2);
    padding: 10px;
  }
  .starter-grid :deep(.suggestion-card.compact .action) { grid-column: auto; }
  .chat-list { min-height: 0; max-height: none; padding: var(--space-3) 0; }
  .message,
  .chat-input { width: 100%; }
  .toolbar-controls {
    display: flex;
    width: 100%;
    gap: var(--space-2);
    flex-wrap: wrap;
    justify-content: flex-start;
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
  .turn-status-dot, .image-skeleton::after, .image-skeleton span, .source-message-highlight { animation: none; }
}
</style>
