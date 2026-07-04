<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
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
  saveStructuredMemory,
  rejectPendingOperation,
  streamMessage,
  changeStructuredMemoryStatus,
  uploadChatImage
} from '@/api/app'
import type { AgentReminderItem, AgentTodoItem, AgentTraceItem, CandidateDecisionItem, CandidateGoalItem, CandidateOpenQuestionItem, CandidatePlanItem, CandidateTaskItem, ChatSource, Conversation, KnowledgeBase, MemoryItem, MemorySnapshot, PendingOperationItem, ProjectChatContext, ToolResult } from '@/api/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
  image?: {
    name: string
    url: string
    previewUrl?: string
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
  projectContext?: ProjectChatContext
  review?: Record<string, unknown>
}

const input = ref('')
const route = useRoute()
const selectedImage = ref<{ name: string; previewUrl: string; url: string } | null>(null)
const uploadingImage = ref(false)
const uploadError = ref('')
const loading = ref(false)
const streamController = ref<AbortController | null>(null)
const initializing = ref(true)
const showDebug = ref(false)
const error = ref('')
const conversationId = ref<string>()
const conversations = ref<Conversation[]>([])
const knowledgeBases = ref<KnowledgeBase[]>([])
const selectedKnowledgeBaseId = ref('')
const memoryActionLoading = ref<Record<string, boolean>>({})
const taskActionLoading = ref<Record<string, boolean>>({})
const projectCandidateActionLoading = ref<Record<string, boolean>>({})
const operationActionLoading = ref<Record<string, boolean>>({})
const traceCopyState = ref<Record<number, 'copied' | 'failed'>>({})
const briefTodos = ref<AgentTodoItem[]>([])
const briefReminders = ref<AgentReminderItem[]>([])
const briefMemory = ref<MemorySnapshot | null>(null)
const briefOperations = ref<PendingOperationItem[]>([])
const briefError = ref('')
const messages = ref<Message[]>([
  { role: 'assistant', content: '你好，我是 Lyle。你可以先上传文档到知识库，再带着知识库提问。' }
])
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
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
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
  try {
    await Promise.all([refreshKnowledgeBases(), refreshConversations(), refreshBrief()])
    const initialConversationId = route.query.conversationId
    if (typeof initialConversationId === 'string' && initialConversationId.trim()) {
      await loadConversation(initialConversationId)
    }
    syncPendingMemoriesToLatestAssistant()
  } catch {
    error.value = '页面初始化失败，请确认后端服务已经启动。'
  } finally {
    initializing.value = false
  }
})

onActivated(async () => {
  await refreshBrief()
})

async function refreshKnowledgeBases() {
  const response = await listKnowledgeBases()
  knowledgeBases.value = response.data
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
    briefOperations.value = operationResponse.data.items
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
  await refreshConversations()
  return conversationId.value
}

async function loadConversation(id: string) {
  if (loading.value) return

  conversationId.value = String(id)
  error.value = ''
  loading.value = true
  try {
    const response = await listChatMessages(conversationId.value)
    messages.value = response.data.length
      ? response.data.map((item) => ({ role: item.role, content: item.content }))
      : [{ role: 'assistant', content: '这个会话还没有消息。' }]
    await refreshBrief()
  } catch {
    error.value = '会话加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

function newConversation() {
  if (loading.value) return

  conversationId.value = undefined
  messages.value = [
    { role: 'assistant', content: '新的会话已经准备好。输入第一句话后，我会自动创建会话并保存历史。' }
  ]
}

function cancelStreaming() {
  if (!streamController.value) return
  streamController.value.abort()
}

async function submit() {
  const text = input.value.trim()
  const message = selectedImage.value
    ? `${text || '请识别这张图片'}\n图片：${selectedImage.value.url}`
    : text
  if (!message || loading.value) return

  input.value = ''
  const imageForDisplay = selectedImage.value
  selectedImage.value = null
  uploadError.value = ''
  loading.value = true
  error.value = ''
  streamController.value = new AbortController()

  let assistantIndex = -1
  let streamError = ''

  try {
    const activeConversationId = await ensureConversationId(message)
    messages.value.push({
      role: 'user',
      content: imageForDisplay ? (text || '请识别这张图片') : message,
      image: imageForDisplay
        ? {
            name: imageForDisplay.name,
            url: imageForDisplay.url,
            previewUrl: imageForDisplay.previewUrl
          }
        : undefined
    })
    messages.value.push({ role: 'assistant', content: '' })
    assistantIndex = messages.value.length - 1

    await streamMessage({
      conversationId: activeConversationId,
      projectId: activeProjectId.value,
      message,
      knowledgeBaseIds: selectedKnowledgeBaseId.value ? [selectedKnowledgeBaseId.value] : []
    }, {
      onDelta: (chunk) => {
        messages.value[assistantIndex].content += chunk
      },
      onMeta: (meta) => {
        messages.value[assistantIndex].sources = meta.sources || []
        messages.value[assistantIndex].agentTrace = meta.agentTrace || []
        messages.value[assistantIndex].toolResults = meta.toolResults || []
        messages.value[assistantIndex].candidateMemories = meta.candidateMemories || []
        messages.value[assistantIndex].candidateTasks = meta.candidateTasks || []
        messages.value[assistantIndex].candidateGoals = meta.candidateGoals || []
        messages.value[assistantIndex].candidateDecisions = meta.candidateDecisions || []
        messages.value[assistantIndex].candidateOpenQuestions = meta.candidateOpenQuestions || []
        messages.value[assistantIndex].candidatePlans = meta.candidatePlans || []
        messages.value[assistantIndex].projectContext = meta.projectContext
        messages.value[assistantIndex].review = meta.review || {}
      },
      onError: (errorMessage) => {
        streamError = errorMessage
        messages.value[assistantIndex].content ||= errorMessage
      },
      onDone: () => {
        streamController.value = null
      }
    }, {
      signal: streamController.value.signal
    })
    await refreshConversations()
    await refreshBrief()
  } catch (exception) {
    if (exception instanceof DOMException && exception.name === 'AbortError') {
      if (assistantIndex >= 0) {
        messages.value[assistantIndex].content ||= '已停止生成。'
        if (!messages.value[assistantIndex].content.includes('已停止生成。')) {
          messages.value[assistantIndex].content += '\n\n已停止生成。'
        }
      }
      return
    }
    const fallback = streamError || (exception instanceof Error ? exception.message : '') || '请求失败，请确认 Java 后端和 Python AI 服务已经启动。'
    if (assistantIndex >= 0) {
      messages.value[assistantIndex].content ||= fallback
    }
    error.value = fallback
  } finally {
    loading.value = false
    streamController.value = null
  }
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

async function handleImageSelect(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    uploadError.value = '请选择图片文件。'
    error.value = uploadError.value
    return
  }
  if (file.size > 4 * 1024 * 1024) {
    uploadError.value = '图片不能超过 4MB。'
    error.value = uploadError.value
    return
  }
  uploadingImage.value = true
  uploadError.value = ''
  error.value = ''
  try {
    const previewUrl = await readFileAsDataUrl(file)
    const response = await uploadChatImage(file)
    selectedImage.value = {
      name: response.data.fileName || file.name,
      previewUrl,
      url: response.data.url
    }
    if (!input.value.trim()) {
      input.value = '请识别这张图片'
    }
  } catch (exception) {
    uploadError.value = getUploadErrorMessage(exception)
    error.value = uploadError.value
  } finally {
    uploadingImage.value = false
  }
}

function clearSelectedImage() {
  selectedImage.value = null
  uploadError.value = ''
}

function getUploadErrorMessage(exception: unknown) {
  const fallback = exception instanceof Error ? exception.message : '图片上传失败，请稍后重试。'
  const responseData = (exception as { response?: { data?: unknown } })?.response?.data
  if (!responseData) return fallback
  if (typeof responseData === 'string') return responseData
  if (typeof responseData === 'object') {
    const data = responseData as Record<string, unknown>
    const message = data.message || data.error || data.detail
    if (typeof message === 'string' && message.trim()) {
      return message
    }
  }
  return fallback
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
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
  return message.content.replace(/\n?图片：https?:\/\/\S+/g, '').trim()
}

function userImage(message: Message) {
  if (message.image) {
    return message.image
  }
  const matched = message.content.match(/图片：(https?:\/\/\S+)/)
  if (!matched) return null
  return {
    name: '已上传图片',
    url: matched[1],
    previewUrl: matched[1]
  }
}

function assistantTextContent(message: Message) {
  return message.content.replace(/!\[[^\]]*]\(https?:\/\/[^)\s]+\)/g, '').trim()
}

function assistantImages(message: Message) {
  const matches = message.content.matchAll(/!\[([^\]]*)]\((https?:\/\/[^)\s]+)\)/g)
  return Array.from(matches).map((match) => ({
    alt: match[1] || '图片',
    url: match[2]
  }))
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
  if (item.skipped === true) return '跳过'
  if (item.action === 'write') return '写入'
  return '执行'
}

function agentNodeClass(item: AgentTraceItem) {
  return {
    skipped: item.skipped === true,
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
  return JSON.stringify(payload)
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

async function confirmOperation(message: Message, item: PendingOperationItem) {
  const key = operationKey(item)
  operationActionLoading.value[key] = true
  item.error = ''
  try {
    const response = await confirmPendingOperation(item.id)
    item.status = response.data.operation.status
    item.result = response.data.result
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
        <p class="muted">{{ activeConversationTitle }} · {{ activeKnowledgeBaseName }}</p>
      </div>
      <div class="row toolbar-controls">
        <label class="debug-toggle">
          <input v-model="showDebug" type="checkbox" />
          调试
        </label>
        <select v-model="conversationId" data-testid="conversation-select" @change="conversationId && loadConversation(conversationId)">
          <option value="">新会话</option>
          <option v-for="item in conversations" :key="item.id" :value="String(item.id)">
            {{ item.title }}
          </option>
        </select>
        <select v-model="selectedKnowledgeBaseId" data-testid="chat-knowledge-select">
          <option value="">不使用知识库</option>
          <option v-for="item in knowledgeBases" :key="item.id" :value="String(item.id)">
            {{ item.name }}
          </option>
        </select>
        <button class="secondary" type="button" @click="newConversation">新建</button>
      </div>
    </div>

    <p v-if="error" class="alert danger">{{ error }}</p>
    <p v-if="briefError" class="alert danger">{{ briefError }}</p>

    <section class="home-brief" aria-label="今日简报">
      <div class="brief-metrics">
        <a class="brief-metric" href="/tasks">
          <strong>{{ todayBriefTodos.length }}</strong>
          <span>今日到期</span>
        </a>
        <a class="brief-metric danger" href="/tasks">
          <strong>{{ overdueBriefTodos.length }}</strong>
          <span>已逾期</span>
        </a>
        <a class="brief-metric" href="/tasks">
          <strong>{{ openBriefTodos.length }}</strong>
          <span>进行中</span>
        </a>
        <a class="brief-metric pending" href="/memory">
          <strong>{{ pendingBriefMemories.length }}</strong>
          <span>待确认记忆</span>
        </a>
        <a class="brief-metric" href="/tasks">
          <strong>{{ unreadBriefReminders.length }}</strong>
          <span>未读提醒</span>
        </a>
        <a class="brief-metric pending" href="/operations">
          <strong>{{ pendingBriefOperations.length }}</strong>
          <span>待确认操作</span>
        </a>
      </div>
      <div class="brief-focus">
        <div class="section-title">
          <h2>今日跟进</h2>
          <button class="inline secondary" type="button" @click="refreshBrief">刷新</button>
        </div>
        <p v-if="briefFocusItems.length === 0" class="muted">暂无需要立即跟进的任务。</p>
        <a
          v-for="item in briefFocusItems"
          :key="`${item.title}-${item.meta}`"
          class="brief-focus-item"
          :class="item.tone"
          href="/tasks"
        >
          <strong>{{ item.title }}</strong>
          <span>{{ item.meta }}</span>
        </a>
      </div>
      <div class="brief-focus">
        <div class="section-title">
          <h2>重点项目</h2>
          <a class="inline secondary" href="/memory">查看记忆</a>
        </div>
        <p v-if="focusedProjects.length === 0" class="muted">暂无重点项目。你可以在聊天里说“我这周重点是...”。</p>
        <a
          v-for="project in focusedProjects"
          :key="project"
          class="brief-focus-item"
          href="/tasks"
        >
          <strong>{{ project }}</strong>
          <span>来自当前项目记忆或进行中任务</span>
        </a>
      </div>
      <div class="brief-focus">
        <div class="section-title">
          <h2>周复盘</h2>
          <a class="inline secondary" href="/tasks">查看任务</a>
        </div>
        <a
          v-for="item in weeklyReviewItems"
          :key="item"
          class="brief-focus-item"
          href="/tasks"
        >
          <strong>{{ item }}</strong>
          <span>基于本周任务、记忆和操作状态</span>
        </a>
      </div>
    </section>

    <div class="panel chat-list">
      <div v-if="initializing" class="empty-state">
        <strong>正在加载会话和知识库</strong>
        <span>请稍候。</span>
      </div>
      <div v-for="(message, index) in messages" :key="index" class="message" :class="message.role">
        <template v-if="message.role === 'user'">
          <div v-if="userDisplayText(message)" class="message-bubble message-content">
            {{ userDisplayText(message) }}
          </div>
          <a
            v-if="userImage(message)"
            class="uploaded-image-card"
            :href="userImage(message)?.url"
            target="_blank"
            rel="noreferrer"
          >
            <img :src="userImage(message)?.previewUrl || userImage(message)?.url" :alt="userImage(message)?.name" />
          </a>
        </template>

        <template v-else>
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
          <div v-if="!message.content" class="message-bubble message-content">
            <span class="typing-cursor">正在生成回答</span>
          </div>
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

    <form class="panel chat-input" @submit.prevent="submit">
      <div class="chat-compose-main">
        <div v-if="selectedImage" class="image-attachment-preview">
          <img :src="selectedImage.previewUrl" :alt="selectedImage.name" />
          <span>{{ selectedImage.name }}</span>
          <button class="inline" type="button" @click="clearSelectedImage">移除</button>
        </div>
        <textarea v-model="input" data-testid="chat-input" rows="2" placeholder="输入你的问题" />
      </div>
      <div class="chat-compose-actions">
        <label class="button-link attach-button">
          {{ uploadingImage ? '上传中' : '上传图片' }}
          <input type="file" accept="image/*" :disabled="loading || uploadingImage" @change="handleImageSelect" />
        </label>
        <button
          v-if="!loading"
          data-testid="chat-submit"
          type="submit"
          :disabled="uploadingImage || (!input.trim() && !selectedImage)"
        >
          发送
        </button>
        <button v-else class="secondary" type="button" @click="cancelStreaming">停止</button>
        <p v-if="uploadError" class="upload-error">{{ uploadError }}</p>
      </div>
    </form>
  </section>
</template>
