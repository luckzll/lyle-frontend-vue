<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  createConversation,
  createAgentTodo,
  getCurrentMemory,
  listChatMessages,
  listConversations,
  listAgentReminders,
  listAgentTodos,
  listKnowledgeBases,
  saveStructuredMemory,
  streamMessage,
  changeStructuredMemoryStatus,
  uploadChatImage
} from '@/api/app'
import type { AgentReminderItem, AgentTodoItem, AgentTraceItem, CandidateTaskItem, ChatSource, Conversation, KnowledgeBase, MemoryItem, MemorySnapshot, ToolResult } from '@/api/types'

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
  review?: Record<string, unknown>
}

const input = ref('')
const selectedImage = ref<{ name: string; previewUrl: string; url: string } | null>(null)
const uploadingImage = ref(false)
const uploadError = ref('')
const loading = ref(false)
const initializing = ref(true)
const showDebug = ref(false)
const error = ref('')
const conversationId = ref<string>()
const conversations = ref<Conversation[]>([])
const knowledgeBases = ref<KnowledgeBase[]>([])
const selectedKnowledgeBaseId = ref('')
const memoryActionLoading = ref<Record<string, boolean>>({})
const taskActionLoading = ref<Record<string, boolean>>({})
const briefTodos = ref<AgentTodoItem[]>([])
const briefReminders = ref<AgentReminderItem[]>([])
const briefMemory = ref<MemorySnapshot | null>(null)
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
const openBriefTodos = computed(() => briefTodos.value.filter((item) => item.status === 'open'))
const todayBriefTodos = computed(() => openBriefTodos.value.filter((item) => isToday(item.dueAt)))
const overdueBriefTodos = computed(() => openBriefTodos.value.filter((item) => isOverdueTodo(item)))
const pendingBriefMemories = computed(() => {
  const items = briefMemory.value?.structured_all || []
  return items.filter((item) => item.status === 'pending')
})
const unreadBriefReminders = computed(() => briefReminders.value.filter((item) => item.status !== 'read'))
const briefFocusItems = computed(() => [
  ...overdueBriefTodos.value.slice(0, 2).map((item) => ({ title: item.title, meta: `逾期 · ${formatBriefTime(item.dueAt)}`, tone: 'danger' })),
  ...todayBriefTodos.value.slice(0, 2).map((item) => ({ title: item.title, meta: `今日到期 · ${formatBriefTime(item.dueAt)}`, tone: 'pending' })),
  ...openBriefTodos.value.filter((item) => !isToday(item.dueAt) && !isOverdueTodo(item)).slice(0, 2).map((item) => ({ title: item.title, meta: item.dueAt ? `待办 · ${formatBriefTime(item.dueAt)}` : '待办 · 未设截止时间', tone: 'normal' }))
].slice(0, 4))

onMounted(async () => {
  try {
    await Promise.all([refreshKnowledgeBases(), refreshConversations(), refreshBrief()])
  } catch {
    error.value = '页面初始化失败，请确认后端服务已经启动。'
  } finally {
    initializing.value = false
  }
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
    const [todoResponse, reminderResponse, memoryResponse] = await Promise.all([
      listAgentTodos(),
      listAgentReminders(),
      getCurrentMemory()
    ])
    briefTodos.value = todoResponse.data.items
    briefReminders.value = reminderResponse.data.items
    briefMemory.value = memoryResponse.data
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
        messages.value[assistantIndex].review = meta.review || {}
      },
      onError: (errorMessage) => {
        streamError = errorMessage
        messages.value[assistantIndex].content ||= errorMessage
      }
    })
    await refreshConversations()
  } catch (exception) {
    const fallback = streamError || (exception instanceof Error ? exception.message : '') || '请求失败，请确认 Java 后端和 Python AI 服务已经启动。'
    if (assistantIndex >= 0) {
      messages.value[assistantIndex].content ||= fallback
    }
    error.value = fallback
  } finally {
    loading.value = false
  }
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

async function copyDebugPayload(message: Message) {
  const payload = {
    agentTrace: message.agentTrace || [],
    toolResults: message.toolResults || [],
    sources: message.sources || [],
    review: message.review || {}
  }
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
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

function sourceCardKey(source: ChatSource, index: number) {
  return `${source.docId}-${source.title}-${index}`
}

function pendingCandidateMemories(message: Message) {
  return (message.candidateMemories || []).filter((item) => item.status !== 'active' && item.status !== 'disabled')
}

function pendingCandidateTasks(message: Message) {
  return (message.candidateTasks || []).filter((item) => item.status !== 'active' && item.status !== 'disabled')
}

function candidateKey(item: MemoryItem) {
  return item.key || `${item.targetKey || 'memory'}:${item.value || ''}`
}

function memoryTargetKey(item: MemoryItem) {
  const key = item.targetKey || item.key || ''
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
                <small>{{ sourceSegmentLabel(source) }} · 文档 {{ source.docId }}</small>
              </span>
            </summary>
            <p>{{ sourceSnippet(source) }}</p>
            <pre>{{ source.chunk }}</pre>
          </details>
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

        <div
          v-if="showDebug && message.role === 'assistant' && (message.agentTrace?.length || message.sources?.length || message.toolResults?.length || reviewText(message.review))"
          class="debug-panel"
        >
          <div class="debug-actions">
            <span>调试信息</span>
            <button class="inline" type="button" @click="copyDebugPayload(message)">复制 Trace</button>
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
              {{ source.title }}
            </div>
          </details>

          <details v-if="reviewText(message.review)" class="debug-section">
            <summary class="debug-title">Review</summary>
            <div class="debug-line">{{ reviewText(message.review) }}</div>
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
        <button data-testid="chat-submit" type="submit" :disabled="loading || uploadingImage || (!input.trim() && !selectedImage)">{{ loading ? '发送中' : '发送' }}</button>
        <p v-if="uploadError" class="upload-error">{{ uploadError }}</p>
      </div>
    </form>
  </section>
</template>
