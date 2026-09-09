<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  confirmOperation,
  confirmPendingOperation,
  dismissExecutionResult,
  getConfirmation,
  getExecutionResult,
  listConfirmations,
  listExecutionResults,
  listPendingOperations,
  rejectOperation,
  rejectPendingOperation,
  restoreExecutionResult,
  resumeWorkflowRun as resumeWorkflowRunRequest,
  runAutomation as runAutomationRequest,
  retryWorkflowRun,
  trackEffectiveProgressAction,
  trackProductEvent
} from '@/api/app'
import { listAgentTasks, type AgentTask } from '@/api/agentTasks'
import type { ConfirmationInboxItem, ExecutionResultListParams, ExecutionResultSummary, PendingOperationItem } from '@/api/types'
import AgentTaskCard from '@/components/domain/agent/AgentTaskCard.vue'
import ConfirmationCard from '@/components/domain/ConfirmationCard.vue'
import ResultSummaryCard from '@/components/domain/ResultSummaryCard.vue'
import StatusBadge from '@/components/domain/StatusBadge.vue'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'
import EmptyState from '@/components/feedback/EmptyState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import DetailDrawer from '@/components/layout/DetailDrawer.vue'
import FilterBar from '@/components/layout/FilterBar.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { createQueuedRefresh } from '@/composables/createQueuedRefresh'
import { notifyExecutionAttentionChanged } from '@/composables/useExecutionBadgePolling'
import { formatBeijingTime, humanizeIsoDateTimes } from '@/domain/date-time'

type ViewKey = 'confirmations' | 'attention' | 'results' | 'history'
type AttentionStatus = 'failed' | 'partial' | 'awaiting_confirmation'
type AttentionPageState = Record<AttentionStatus, { nextCursor: string | null; hasMore: boolean }>
type OperationHistoryItem = {
  id: number
  toolName: string
  operationType: string
  riskLevel: string
  summary: string
  status: string
  projectId: number | null
  detail: string
  createdAt: string
}
type ConfirmationDisplayItem = ConfirmationInboxItem & {
  duplicateCount?: number
  duplicateItems?: ConfirmationInboxItem[]
}
type HighRiskTarget =
  | { kind: 'confirmation'; item: ConfirmationDisplayItem }
  | { kind: 'history'; item: OperationHistoryItem }

const RESULT_PAGE_SIZE = 30
const ATTENTION_STATUSES: AttentionStatus[] = ['failed', 'partial', 'awaiting_confirmation']

const route = useRoute()
const router = useRouter()
const view = ref<ViewKey>(normaliseView(route.query.view))
const confirmations = ref<ConfirmationInboxItem[]>([])
const results = ref<ExecutionResultSummary[]>([])
const attention = ref<ExecutionResultSummary[]>([])
const operations = ref<OperationHistoryItem[]>([])
const agentTasks = ref<AgentTask[]>([])
const pageLoading = ref(false)
const loadError = ref('')
const partialError = ref('')
const historyLoading = ref(false)
const historyLoaded = ref(false)
const historyError = ref('')
const resultListLoading = ref(false)
const resultMoreLoading = ref(false)
const resultNextCursor = ref<string | null>(null)
const resultHasMore = ref(false)
const attentionListLoading = ref(false)
const attentionMoreLoading = ref(false)
const attentionPages = ref<AttentionPageState>(emptyAttentionPages())
const feedback = ref('')
const selectedProjectId = ref(queryText(route.query.projectId))
const selectedAutomationId = ref(queryText(route.query.automationId))
const selectedStatus = ref(queryText(route.query.status))
const selectedTime = ref(queryText(route.query.time) || 'all')
const operationStatus = ref(queryText(route.query.operationStatus) || 'all')
const mobileFiltersOpen = ref(false)
const confirmationLoading = ref<Record<number, boolean>>({})
const historyActionLoading = ref<Record<number, boolean>>({})
const resultLoading = ref<Record<number, boolean>>({})
const bulkDismissLoading = ref(false)
const undoLoading = ref(false)
const undoDismissedItems = ref<ExecutionResultSummary[]>([])
const workflowSecondConfirmation = ref<Record<number, boolean>>({})
const copyStates = ref<Record<number, 'idle' | 'copied' | 'failed'>>({})
const highRiskTarget = ref<HighRiskTarget | null>(null)
const resultDetailId = ref<number | null>(null)
const resultDetail = ref<ExecutionResultSummary | null>(null)
const resultDetailLoading = ref(false)
const resultDetailError = ref('')
const confirmationDetail = ref<ConfirmationDisplayItem | null>(null)
const confirmationDetailLoading = ref(false)
const confirmationDetailError = ref('')
let loadGeneration = 0
let resultDetailGeneration = 0
let confirmationDetailGeneration = 0
let resultListGeneration = 0
let attentionListGeneration = 0
let undoDismissTimer: number | undefined
const historyRefresh = createQueuedRefresh(refreshHistory)
let filterQueryWriting = false
let filterQueryRequested = false
let filterQueryPromise: Promise<void> | null = null

const filteredConfirmations = computed(() => confirmations.value.filter((item) => {
  return matchesTime(item.createdAt) && matchesConfirmationProject(item)
}))
const displayConfirmations = computed<ConfirmationDisplayItem[]>(() => {
  const groups = new Map<string, ConfirmationInboxItem[]>()
  for (const item of filteredConfirmations.value) {
    const key = [
      item.actionTitle.trim(),
      item.operationType || '',
      item.reason.trim(),
      [...item.impactResources].sort().join('|')
    ].join('::')
    const group = groups.get(key) || []
    group.push(item)
    groups.set(key, group)
  }
  return [...groups.values()].map((items) => ({
    ...items[0],
    duplicateCount: items.length,
    duplicateItems: items
  }))
})
const filteredResults = computed(() => filterResults(results.value))
const filteredAttention = computed(() => filterResults(attention.value))
const dismissibleAttention = computed(() => filteredAttention.value.filter((item) => (
  !item.dismissedAt && ['failed', 'partial'].includes(item.status)
)))
const workflowConfirmationItems = computed(() => attention.value.filter((item) => (
  isWorkflowConfirmation(item)
  && matchesTime(item.createdAt)
  && (!selectedProjectId.value || String(item.projectId || '') === selectedProjectId.value)
)))
const displayWorkflowConfirmations = computed(() => workflowConfirmationItems.value.map(presentResult))
const visibleResults = computed(() => (
  view.value === 'attention' ? filteredAttention.value : filteredResults.value
).map(presentResult))
const isResultView = computed(() => view.value === 'results' || view.value === 'attention')
const hasResultOnlyFilter = computed(() => (
  isResultView.value && Boolean(selectedAutomationId.value || selectedStatus.value)
))
const visibleAgentTasks = computed(() => agentTasks.value.filter((task) => {
  if (hasResultOnlyFilter.value) return false
  if (!matchesTime(task.updatedAt)) return false
  if (selectedProjectId.value && String(task.projectId || '') !== selectedProjectId.value) return false
  if (view.value === 'confirmations') return ['AWAITING_PLAN_APPROVAL', 'AWAITING_CONFIRMATION', 'AWAITING_INPUT'].includes(task.status)
  if (view.value === 'attention') return ['AWAITING_INPUT', 'PAUSED', 'FAILED', 'PARTIALLY_COMPLETED'].includes(task.status)
  if (view.value === 'results') return ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(task.status)
  return true
}))
const attentionHasMore = computed(() => activeAttentionStatuses().some((status) => attentionPages.value[status].hasMore))
const visibleResultsLoading = computed(() => view.value === 'attention' ? attentionListLoading.value : resultListLoading.value)
const visibleResultsHasMore = computed(() => view.value === 'attention' ? attentionHasMore.value : resultHasMore.value)
const visibleResultsMoreLoading = computed(() => view.value === 'attention' ? attentionMoreLoading.value : resultMoreLoading.value)
const tabs = computed(() => [
  { id: 'confirmations' as const, label: `待我确认 ${filteredConfirmations.value.length + workflowConfirmationItems.value.length}` },
  { id: 'attention' as const, label: `需要处理 ${filteredAttention.value.length}${attentionHasMore.value ? '+' : ''}` },
  { id: 'results' as const, label: '最新结果' },
  { id: 'history' as const, label: '历史记录' }
])
const automationOptions = computed(() => {
  const options = new Map<number, string>()
  for (const item of [...results.value, ...attention.value]) {
    if (item.automationId) options.set(item.automationId, item.automationName || `自动化 #${item.automationId}`)
  }
  const selected = Number(selectedAutomationId.value)
  if (Number.isInteger(selected) && selected > 0 && !options.has(selected)) {
    options.set(selected, `自动化 #${selected}`)
  }
  return [...options.entries()].map(([id, name]) => ({ id, name }))
})
const visibleOperations = computed(() => operations.value.filter((item) => {
  if (operationStatus.value !== 'all' && item.status !== operationStatus.value) return false
  if (!matchesTime(item.createdAt)) return false
  if (selectedProjectId.value) {
    if (String(item.projectId || '') !== selectedProjectId.value) return false
  }
  return true
}))
const highRiskBusy = computed(() => {
  const target = highRiskTarget.value
  if (!target) return false
  return target.kind === 'confirmation'
    ? Boolean(confirmationLoading.value[target.item.pendingOperationId])
    : Boolean(historyActionLoading.value[target.item.id])
})
const highRiskDescription = computed(() => {
  const target = highRiskTarget.value
  if (!target) return ''
  const title = target.kind === 'confirmation' ? target.item.actionTitle : target.item.summary
  return `“${humanizeIsoDateTimes(title)}”属于高风险或不可撤销操作。请再次确认影响范围后再执行。`
})

watch(() => route.query.view, async (value) => {
  view.value = normaliseView(value)
  if (pageLoading.value) return
  if (view.value === 'history') await ensureHistoryLoaded()
  else if (view.value === 'results') await reloadResults()
  else if (view.value === 'attention') await reloadAttention()
})

watch(() => [route.query.projectId, route.query.automationId, route.query.status, route.query.time, route.query.operationStatus], async () => {
  if (filterQueryWriting) return
  applyFiltersFromRoute()
  await reloadCurrentResultView()
})

function applyFiltersFromRoute() {
  selectedProjectId.value = queryText(route.query.projectId)
  selectedAutomationId.value = queryText(route.query.automationId)
  selectedStatus.value = queryText(route.query.status)
  selectedTime.value = queryText(route.query.time) || 'all'
  operationStatus.value = queryText(route.query.operationStatus) || 'all'
}

watch(() => route.query.resultId, async (value) => {
  const id = Number(queryText(value))
  if (Number.isFinite(id) && id > 0) await loadResultDetail(id)
  else closeResultDetail(false)
}, { immediate: true })

async function load() {
  const generation = ++loadGeneration
  pageLoading.value = true
  loadError.value = ''
  partialError.value = ''
  const settled = await Promise.all([
    loadConfirmations(generation),
    reloadResults(false),
    reloadAttention(false),
    loadAgentTasks(generation)
  ])

  if (generation !== loadGeneration) return
  const failureMessages = settled.filter(Boolean)
  const failureCount = failureMessages.length
  if (failureCount === settled.length) {
    loadError.value = Array.from(new Set(failureMessages)).join('；')
      || '执行数据加载失败，请确认 AI 服务可用后重试。'
  } else if (failureCount) {
    partialError.value = '部分执行数据暂时无法加载，已保留其余可用内容。'
  }
  pageLoading.value = false
  if (view.value === 'history') await ensureHistoryLoaded(true)
}

async function loadAgentTasks(generation: number) {
  try {
    const items = (await listAgentTasks({ limit: 100 })).data.items
    if (generation === loadGeneration) agentTasks.value = items
    return ''
  } catch (error: any) {
    if (generation === loadGeneration) agentTasks.value = []
    return requestMessage(error, 'Agent Task 暂时无法加载。')
  }
}

async function loadConfirmations(generation: number) {
  try {
    const items = (await listConfirmations()).data.items
    if (generation === loadGeneration) confirmations.value = items
    return ''
  } catch (error: any) {
    if (generation === loadGeneration) confirmations.value = []
    return requestMessage(error, '待确认操作暂时无法加载。')
  }
}

async function reloadResults(showLoading = true): Promise<string> {
  const generation = ++resultListGeneration
  resultMoreLoading.value = false
  if (showLoading) resultListLoading.value = true
  try {
    const response = await listExecutionResults(resultListParams(selectedStatus.value || undefined))
    if (generation !== resultListGeneration) return ''
    results.value = response.data.items
    resultNextCursor.value = response.data.nextCursor ?? null
    resultHasMore.value = Boolean(response.data.hasMore && response.data.nextCursor)
    return ''
  } catch (error: any) {
    if (generation === resultListGeneration) {
      results.value = []
      resultNextCursor.value = null
      resultHasMore.value = false
      if (showLoading) partialError.value = '最新结果暂时无法加载，请稍后重试。'
    }
    return requestMessage(error, '最新结果暂时无法加载。')
  } finally {
    if (generation === resultListGeneration) resultListLoading.value = false
  }
}

async function loadMoreResults() {
  const cursor = resultNextCursor.value
  if (!cursor || !resultHasMore.value || resultMoreLoading.value) return
  const generation = resultListGeneration
  resultMoreLoading.value = true
  try {
    const response = await listExecutionResults(resultListParams(selectedStatus.value || undefined, cursor))
    if (generation !== resultListGeneration) return
    results.value = mergeUniqueResults(results.value, response.data.items)
    resultNextCursor.value = response.data.nextCursor ?? null
    resultHasMore.value = Boolean(response.data.hasMore && response.data.nextCursor)
  } catch (error: any) {
    if (generation === resultListGeneration) feedback.value = requestMessage(error, '更多结果加载失败，请稍后重试。')
  } finally {
    if (generation === resultListGeneration) resultMoreLoading.value = false
  }
}

async function reloadAttention(showLoading = true): Promise<string> {
  const generation = ++attentionListGeneration
  attentionMoreLoading.value = false
  if (showLoading) attentionListLoading.value = true
  const statuses = attentionFetchStatuses()
  if (!statuses.length) {
    attention.value = []
    attentionPages.value = emptyAttentionPages()
    attentionListLoading.value = false
    return ''
  }

  const settled = await Promise.allSettled(statuses.map(async (status) => ({
    status,
    response: await listExecutionResults(resultListParams(status))
  })))
  if (generation !== attentionListGeneration) return ''

  const pages = emptyAttentionPages()
  const items: ExecutionResultSummary[] = []
  const failureMessages: string[] = []
  for (const result of settled) {
    if (result.status === 'rejected') {
      failureMessages.push(requestMessage(result.reason, '需处理结果暂时无法加载。'))
      continue
    }
    const { status, response } = result.value
    items.push(...response.data.items.filter((item) => item.status === status))
    pages[status] = {
      nextCursor: response.data.nextCursor ?? null,
      hasMore: Boolean(response.data.hasMore && response.data.nextCursor)
    }
  }
  attention.value = mergeUniqueResults([], items)
  attentionPages.value = pages
  if (failureMessages.length && showLoading) partialError.value = '部分需处理结果暂时无法加载，已保留其余可用内容。'
  if (generation === attentionListGeneration) attentionListLoading.value = false
  return failureMessages[0] || ''
}

async function loadMoreAttention() {
  if (!attentionHasMore.value || attentionMoreLoading.value) return
  const generation = attentionListGeneration
  const statuses = activeAttentionStatuses().filter((status) => attentionPages.value[status].hasMore)
  attentionMoreLoading.value = true
  const settled = await Promise.allSettled(statuses.map(async (status) => ({
    status,
    response: await listExecutionResults(resultListParams(status, attentionPages.value[status].nextCursor || undefined))
  })))
  if (generation !== attentionListGeneration) return

  const nextPages = { ...attentionPages.value }
  const items: ExecutionResultSummary[] = []
  let failures = 0
  for (const result of settled) {
    if (result.status === 'rejected') {
      failures += 1
      continue
    }
    const { status, response } = result.value
    items.push(...response.data.items.filter((item) => item.status === status))
    nextPages[status] = {
      nextCursor: response.data.nextCursor ?? null,
      hasMore: Boolean(response.data.hasMore && response.data.nextCursor)
    }
  }
  attention.value = mergeUniqueResults(attention.value, items)
  attentionPages.value = nextPages
  if (failures) feedback.value = '部分需处理结果加载失败，可稍后再次加载。'
  if (generation === attentionListGeneration) attentionMoreLoading.value = false
}

function resultListParams(status?: string, cursor?: string): ExecutionResultListParams {
  const projectId = positiveNumber(selectedProjectId.value)
  const automationId = positiveNumber(selectedAutomationId.value)
  return {
    limit: RESULT_PAGE_SIZE,
    ...(status ? { status } : {}),
    ...(projectId ? { projectId } : {}),
    ...(automationId ? { automationId } : {}),
    ...(view.value === 'attention' ? { attentionOnly: true } : {}),
    ...(cursor ? { cursor } : {})
  }
}

function activeAttentionStatuses(): AttentionStatus[] {
  if (!selectedStatus.value) return ATTENTION_STATUSES
  return ATTENTION_STATUSES.includes(selectedStatus.value as AttentionStatus)
    ? [selectedStatus.value as AttentionStatus]
    : []
}

function attentionFetchStatuses(): AttentionStatus[] {
  return Array.from(new Set([...activeAttentionStatuses(), 'awaiting_confirmation']))
}

function emptyAttentionPages(): AttentionPageState {
  return {
    failed: { nextCursor: null, hasMore: false },
    partial: { nextCursor: null, hasMore: false },
    awaiting_confirmation: { nextCursor: null, hasMore: false }
  }
}

function mergeUniqueResults(current: ExecutionResultSummary[], incoming: ExecutionResultSummary[]) {
  const items = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) items.set(item.id, item)
  return [...items.values()].sort((left, right) => {
    const byTime = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    return Number.isNaN(byTime) || byTime === 0 ? right.id - left.id : byTime
  })
}

async function ensureHistoryLoaded(force = false) {
  if (historyLoaded.value && !force) return
  await historyRefresh.request(force)
}

async function refreshHistory() {
  historyLoading.value = true
  historyError.value = ''
  try {
    operations.value = (await listPendingOperations(100)).data.items.map(toOperationHistoryItem)
    historyLoaded.value = true
  } catch (error: any) {
    historyError.value = requestMessage(error, '操作历史加载失败，请稍后重试。')
  } finally {
    historyLoading.value = false
  }
}

async function setView(next: ViewKey) {
  view.value = next
  const query = { ...route.query, view: next }
  delete (query as Record<string, unknown>).resultId
  await router.replace({ path: '/execution-center', query })
  trackExecutionEvent('execution_filter_applied', `view_${next}`)
}

function setViewFromEvent(event: Event) {
  void setView((event.target as HTMLSelectElement).value as ViewKey)
}

function syncFilters(): Promise<void> {
  selectedProjectId.value = selectedProjectId.value.replace(/\D/g, '')
  selectedAutomationId.value = selectedAutomationId.value.replace(/\D/g, '')
  trackExecutionEvent('execution_filter_applied', 'filter_change')
  filterQueryRequested = true
  if (!filterQueryPromise) {
    const cycle = flushFilterQuery()
    filterQueryPromise = cycle.finally(() => {
      filterQueryPromise = null
      // A filter can change after the flush loop has finished but before this
      // promise settles (for example, clearing two selects quickly). Do not
      // strand that final state in the controls without syncing the URL.
      if (filterQueryRequested) void syncFilters()
    })
  }
  return filterQueryPromise
}

async function flushFilterQuery() {
  filterQueryWriting = true
  try {
    do {
      filterQueryRequested = false
      const query = { ...route.query, view: view.value }
      setOptionalQuery(query, 'projectId', selectedProjectId.value)
      setOptionalQuery(query, 'automationId', selectedAutomationId.value)
      setOptionalQuery(query, 'status', selectedStatus.value)
      setOptionalQuery(query, 'time', selectedTime.value === 'all' ? '' : selectedTime.value)
      setOptionalQuery(query, 'operationStatus', operationStatus.value === 'all' ? '' : operationStatus.value)
      await router.replace({ path: '/execution-center', query })
    } while (filterQueryRequested)
  } finally {
    filterQueryWriting = false
  }
  await reloadCurrentResultView()
}

async function reloadCurrentResultView() {
  if (pageLoading.value) return
  partialError.value = ''
  if (view.value === 'results') await reloadResults()
  else if (view.value === 'attention') await reloadAttention()
}

async function loadMoreVisibleResults() {
  if (view.value === 'attention') await loadMoreAttention()
  else if (view.value === 'results') await loadMoreResults()
}

async function requestConfirmationAction(item: ConfirmationDisplayItem, action: 'confirm' | 'reject') {
  if (confirmationGroupBusy(item)) return
  if (action === 'confirm' && (item.requiresSecondConfirmation || !item.reversible)) {
    highRiskTarget.value = { kind: 'confirmation', item }
    return
  }
  await executeConfirmationAction(item, action)
}

async function executeConfirmationAction(item: ConfirmationDisplayItem, action: 'confirm' | 'reject') {
  const group = item.duplicateItems?.length ? item.duplicateItems : [item]
  const loadingState = { ...confirmationLoading.value }
  for (const groupItem of group) loadingState[groupItem.pendingOperationId] = true
  confirmationLoading.value = loadingState
  feedback.value = ''
  try {
    await Promise.all(group.map((groupItem) => (
      action === 'confirm'
        ? confirmOperation(groupItem.pendingOperationId)
        : rejectOperation(groupItem.pendingOperationId)
    )))
    trackExecutionEvent('confirmation_completed', action, action === 'confirm' ? 'confirmed' : 'rejected')
    if (action === 'confirm') trackEffectiveProgress('confirmation', 'confirmed')
    const prefix = group.length > 1 ? `${group.length} 个重复操作` : '操作'
    feedback.value = action === 'confirm' ? `${prefix}已确认执行。` : `${prefix}已拒绝。`
    highRiskTarget.value = null
    await load()
    if (historyLoaded.value) await ensureHistoryLoaded(true)
  } catch (error: any) {
    feedback.value = requestMessage(error, action === 'confirm' ? '操作确认失败，请稍后重试。' : '操作拒绝失败，请稍后重试。')
  } finally {
    const nextLoadingState = { ...confirmationLoading.value }
    for (const groupItem of group) nextLoadingState[groupItem.pendingOperationId] = false
    confirmationLoading.value = nextLoadingState
  }
}

function confirmationGroupBusy(item: ConfirmationDisplayItem) {
  const group = item.duplicateItems?.length ? item.duplicateItems : [item]
  return group.some((groupItem) => Boolean(confirmationLoading.value[groupItem.pendingOperationId]))
}

async function requestHistoryAction(item: OperationHistoryItem, action: 'confirm' | 'reject') {
  if (historyActionLoading.value[item.id]) return
  if (action === 'confirm' && isHighRiskOperation(item)) {
    highRiskTarget.value = { kind: 'history', item }
    return
  }
  await executeHistoryAction(item, action)
}

async function executeHistoryAction(item: OperationHistoryItem, action: 'confirm' | 'reject') {
  historyActionLoading.value = { ...historyActionLoading.value, [item.id]: true }
  feedback.value = ''
  try {
    let resultMessage = ''
    if (action === 'confirm') {
      const response = await confirmPendingOperation(item.id)
      resultMessage = String(response.data.result?.content || '')
    }
    else await rejectPendingOperation(item.id)
    trackExecutionEvent('confirmation_completed', action, action === 'confirm' ? 'confirmed' : 'rejected')
    if (action === 'confirm') trackEffectiveProgress('confirmation', 'confirmed', item.projectId)
    feedback.value = action === 'confirm' ? resultMessage || '操作已确认。' : '操作已拒绝。'
    highRiskTarget.value = null
    await Promise.all([load(), ensureHistoryLoaded(true)])
  } catch (error: any) {
    feedback.value = requestMessage(error, action === 'confirm' ? '操作确认失败，请稍后重试。' : '操作拒绝失败，请稍后重试。')
  } finally {
    historyActionLoading.value = { ...historyActionLoading.value, [item.id]: false }
  }
}

async function confirmHighRisk() {
  const target = highRiskTarget.value
  if (!target) return
  if (target.kind === 'confirmation') await executeConfirmationAction(target.item, 'confirm')
  else await executeHistoryAction(target.item, 'confirm')
}

async function handleResultAction(item: ExecutionResultSummary, action: { type: string; label: string }) {
  if (action.type === 'view' || action.type === 'view_incomplete') {
    await requestResultDetail(item)
    return
  }
  if (action.type === 'resume_workflow' || action.type === 'resume_workflow_second') {
    await resumeWorkflowConfirmation(item, action.type === 'resume_workflow_second')
    return
  }
  if (action.type === 'dismiss') {
    await dismissAttentionResult(item)
    return
  }
  const canRetryWorkflow = action.type === 'retry' && item.sourceType === 'workflow_run'
  const canRetryAutomation = action.type === 'retry_automation' && Boolean(item.automationId)
  if ((!canRetryWorkflow && !canRetryAutomation) || resultLoading.value[item.id]) return
  resultLoading.value = { ...resultLoading.value, [item.id]: true }
  feedback.value = ''
  try {
    if (canRetryAutomation) await runAutomationRequest(Number(item.automationId))
    else await retryWorkflowRun(Number(item.sourceId))
    trackEffectiveProgress('result_action', 'completed', positiveNumber(item.projectId))
    feedback.value = '已提交重试，最新状态已刷新。'
    await load()
  } catch (error: any) {
    feedback.value = requestMessage(error, '执行重试失败，请稍后再试。')
  } finally {
    resultLoading.value = { ...resultLoading.value, [item.id]: false }
  }
}

async function dismissAttentionResult(item: ExecutionResultSummary) {
  if (!['failed', 'partial'].includes(item.status) || resultLoading.value[item.id]) return
  resultLoading.value = { ...resultLoading.value, [item.id]: true }
  feedback.value = ''
  try {
    const dismissed = (await dismissExecutionResult(item.id)).data
    attention.value = attention.value.filter((candidate) => candidate.id !== item.id)
    results.value = results.value.map((candidate) => candidate.id === item.id ? dismissed : candidate)
    offerDismissUndo([dismissed], '已移出待处理；执行历史仍保留。')
    notifyExecutionAttentionChanged(-1)
  } catch (error: any) {
    feedback.value = requestMessage(error, '暂时无法移出待处理，请稍后重试。')
  } finally {
    resultLoading.value = { ...resultLoading.value, [item.id]: false }
  }
}

async function dismissAllAttention() {
  const items = [...dismissibleAttention.value]
  if (!items.length || bulkDismissLoading.value) return
  bulkDismissLoading.value = true
  clearDismissUndo()
  feedback.value = ''
  resultLoading.value = {
    ...resultLoading.value,
    ...Object.fromEntries(items.map((item) => [item.id, true]))
  }
  try {
    const settled = await Promise.allSettled(items.map((item) => dismissExecutionResult(item.id)))
    const dismissed = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value.data] : [])
    const dismissedIds = new Set(dismissed.map((item) => item.id))
    if (dismissed.length) {
      attention.value = attention.value.filter((item) => !dismissedIds.has(item.id))
      results.value = results.value.map((item) => dismissedIds.has(item.id)
        ? dismissed.find((dismissedItem) => dismissedItem.id === item.id) || item
        : item)
      const failedCount = items.length - dismissed.length
      offerDismissUndo(
        dismissed,
        failedCount
          ? `已移出 ${dismissed.length} 条，另有 ${failedCount} 条暂时失败；执行历史仍保留。`
          : `已移出 ${dismissed.length} 条待处理结果；执行历史仍保留。`
      )
      notifyExecutionAttentionChanged(-dismissed.length)
    } else {
      feedback.value = '暂时无法移出这些结果，请稍后重试。'
    }
  } finally {
    resultLoading.value = {
      ...resultLoading.value,
      ...Object.fromEntries(items.map((item) => [item.id, false]))
    }
    bulkDismissLoading.value = false
  }
}

function offerDismissUndo(items: ExecutionResultSummary[], message: string) {
  clearDismissUndoTimer()
  undoDismissedItems.value = items
  feedback.value = message
  undoDismissTimer = window.setTimeout(() => {
    undoDismissedItems.value = []
    undoDismissTimer = undefined
  }, 10_000)
}

function clearDismissUndoTimer() {
  if (undoDismissTimer !== undefined) window.clearTimeout(undoDismissTimer)
  undoDismissTimer = undefined
}

function clearDismissUndo() {
  clearDismissUndoTimer()
  undoDismissedItems.value = []
}

async function undoDismissedResults() {
  const items = [...undoDismissedItems.value]
  if (!items.length || undoLoading.value) return
  clearDismissUndoTimer()
  undoLoading.value = true
  resultLoading.value = {
    ...resultLoading.value,
    ...Object.fromEntries(items.map((item) => [item.id, true]))
  }
  try {
    const settled = await Promise.allSettled(items.map((item) => restoreExecutionResult(item.id)))
    const restored = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value.data] : [])
    const restoredIds = new Set(restored.map((item) => item.id))
    if (restored.length) {
      attention.value = mergeUniqueResults(attention.value, restored)
      results.value = results.value.map((item) => restoredIds.has(item.id)
        ? restored.find((restoredItem) => restoredItem.id === item.id) || item
        : item)
      notifyExecutionAttentionChanged(restored.length)
    }
    const failedItems = items.filter((item) => !restoredIds.has(item.id))
    if (failedItems.length) {
      offerDismissUndo(
        failedItems,
        `已恢复 ${restored.length} 条，另有 ${failedItems.length} 条暂时失败，可再次撤销。`
      )
    } else {
      undoDismissedItems.value = []
      feedback.value = `已撤销，${restored.length} 条结果已恢复到待处理。`
    }
  } finally {
    resultLoading.value = {
      ...resultLoading.value,
      ...Object.fromEntries(items.map((item) => [item.id, false]))
    }
    undoLoading.value = false
  }
}

async function resumeWorkflowConfirmation(item: ExecutionResultSummary, secondConfirmed: boolean) {
  const runId = positiveNumber(item.sourceId)
  if (!runId || resultLoading.value[item.id]) return
  resultLoading.value = { ...resultLoading.value, [item.id]: true }
  feedback.value = ''
  try {
    const run = (await resumeWorkflowRunRequest(runId, secondConfirmed)).data
    const nextSecondConfirmation = workflowRunNeedsSecondConfirmation(run)
    workflowSecondConfirmation.value = {
      ...workflowSecondConfirmation.value,
      [runId]: nextSecondConfirmation
    }
    trackExecutionEvent('workflow_confirmation_completed', secondConfirmed ? 'second_confirm' : 'confirm', 'confirmed')
    trackEffectiveProgress('confirmation', 'confirmed', positiveNumber(item.projectId))
    feedback.value = nextSecondConfirmation
      ? '当前步骤仍需二次确认，请检查影响范围后再次确认。'
      : run.status === 'paused'
        ? '当前步骤已确认，工作流已继续；下一步仍需确认。'
        : '已确认，工作流已继续执行。'
    await load()
  } catch (error: any) {
    feedback.value = requestMessage(error, '工作流确认失败，请稍后重试。')
  } finally {
    resultLoading.value = { ...resultLoading.value, [item.id]: false }
  }
}

function isWorkflowConfirmation(item: ExecutionResultSummary) {
  return item.status === 'awaiting_confirmation' && item.sourceType === 'workflow_run'
}

function presentResult(item: ExecutionResultSummary): ExecutionResultSummary {
  if (!isWorkflowConfirmation(item)) {
    if (view.value !== 'attention' || item.dismissedAt || !['failed', 'partial'].includes(item.status)) return item
    const actions = item.recommendedActions.filter((action) => !['view', 'dismiss'].includes(action.type))
    const statusActions = item.status === 'partial'
      ? [
          { type: 'view_incomplete', label: '查看未完成步骤' },
          ...actions.filter((action) => !['retry', 'retry_automation'].includes(action.type))
        ]
      : actions.map((action) => (
          ['retry', 'retry_automation'].includes(action.type)
            ? { ...action, label: '修复后重试' }
            : action
        ))
    return {
      ...item,
      recommendedActions: [
        ...statusActions,
        { type: 'dismiss', label: '移出待处理' }
      ]
    }
  }
  const runId = positiveNumber(item.sourceId)
  if (!runId) return { ...item, recommendedActions: [] }
  const secondConfirmation = Boolean(workflowSecondConfirmation.value[runId])
  return {
    ...item,
    recommendedActions: [{
      type: secondConfirmation ? 'resume_workflow_second' : 'resume_workflow',
      label: secondConfirmation ? '二次确认并继续' : '确认并继续'
    }]
  }
}

async function clearResultOnlyFilters() {
  selectedAutomationId.value = ''
  selectedStatus.value = ''
  await syncFilters()
}

function workflowRunNeedsSecondConfirmation(run: Record<string, unknown>) {
  if (run.status !== 'paused' || !Array.isArray(run.steps)) return false
  return run.steps.some((step) => {
    if (!step || typeof step !== 'object') return false
    const item = step as Record<string, unknown>
    if (item.status !== 'awaiting_confirmation' || !item.output || typeof item.output !== 'object') return false
    return Boolean((item.output as Record<string, unknown>).requiresSecondConfirmation)
  })
}

async function requestResultDetail(item: ExecutionResultSummary) {
  const query = { ...route.query, view: view.value, resultId: String(item.id) }
  await router.replace({ path: '/execution-center', query })
}

async function loadResultDetail(id: number) {
  const generation = ++resultDetailGeneration
  resultDetailId.value = id
  resultDetail.value = null
  resultDetailError.value = ''
  resultDetailLoading.value = true
  try {
    const detail = (await getExecutionResult(id)).data
    if (generation === resultDetailGeneration && resultDetailId.value === id) {
      resultDetail.value = detail
    }
  } catch (error: any) {
    if (generation === resultDetailGeneration && resultDetailId.value === id) {
      resultDetailError.value = requestMessage(error, '执行结果详情加载失败。')
    }
  } finally {
    if (generation === resultDetailGeneration) resultDetailLoading.value = false
  }
}

async function closeResultDetail(syncQuery = true) {
  resultDetailGeneration += 1
  resultDetailId.value = null
  resultDetail.value = null
  resultDetailError.value = ''
  if (syncQuery && route.query.resultId) {
    const query = { ...route.query }
    delete query.resultId
    await router.replace({ path: '/execution-center', query })
  }
}

async function openConfirmationDetail(item: ConfirmationDisplayItem) {
  const generation = ++confirmationDetailGeneration
  const operationId = item.pendingOperationId
  confirmationDetail.value = item
  confirmationDetailError.value = ''
  confirmationDetailLoading.value = true
  try {
    const detail = (await getConfirmation(operationId)).data
    if (
      generation === confirmationDetailGeneration
      && confirmationDetail.value?.pendingOperationId === operationId
    ) {
      confirmationDetail.value = {
        ...detail,
        duplicateCount: item.duplicateCount,
        duplicateItems: item.duplicateItems
      }
    }
  } catch (error: any) {
    if (generation === confirmationDetailGeneration) {
      confirmationDetailError.value = requestMessage(error, '待确认操作详情加载失败。')
    }
  } finally {
    if (generation === confirmationDetailGeneration) confirmationDetailLoading.value = false
  }
}

function closeConfirmationDetail() {
  confirmationDetailGeneration += 1
  confirmationDetail.value = null
  confirmationDetailError.value = ''
  confirmationDetailLoading.value = false
}

async function copyResultLink(item: ExecutionResultSummary) {
  const href = router.resolve({ path: '/execution-center', query: { view: 'results', resultId: String(item.id) } }).href
  const value = new URL(href, window.location.origin).toString()
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value)
    else if (!copyTextFallback(value)) throw new Error('Clipboard API unavailable')
    copyStates.value = { ...copyStates.value, [item.id]: 'copied' }
  } catch {
    copyStates.value = { ...copyStates.value, [item.id]: copyTextFallback(value) ? 'copied' : 'failed' }
  }
  window.setTimeout(() => {
    copyStates.value = { ...copyStates.value, [item.id]: 'idle' }
  }, 2200)
}

function trackResultSourceOpen(item: ExecutionResultSummary, source: 'project' | 'automation') {
  trackExecutionEvent('result_source_opened', source, item.status)
  trackEffectiveProgress('result_action', item.status, positiveNumber(item.projectId))
}

function trackExecutionEvent(eventType: string, actionType: string, status?: string) {
  void trackProductEvent({
    eventType,
    page: 'execution-center',
    actionType,
    status
  }).catch(() => undefined)
}

function trackEffectiveProgress(
  actionType: 'confirmation' | 'result_action',
  status?: ExecutionResultSummary['status'] | 'confirmed',
  projectId?: number | null
) {
  void trackEffectiveProgressAction({
    page: 'execution-center',
    actionType,
    status,
    ...(projectId ? { projectId } : {})
  }).catch(() => undefined)
}

function copyTextFallback(value: string) {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } finally {
    textarea.remove()
  }
  return copied
}

function filterResults(items: ExecutionResultSummary[]) {
  return items.filter((item) => {
    if (selectedProjectId.value && String(item.projectId || '') !== selectedProjectId.value) return false
    if (selectedAutomationId.value && String(item.automationId || '') !== selectedAutomationId.value) return false
    if (selectedStatus.value && item.status !== selectedStatus.value) return false
    return matchesTime(item.createdAt)
  })
}

function matchesConfirmationProject(item: ConfirmationInboxItem) {
  if (!selectedProjectId.value) return true
  return item.impactResources.some((resource) => String(resource).includes(selectedProjectId.value))
}

function matchesTime(value?: string | null) {
  if (!value || selectedTime.value === 'all') return true
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return true
  const hours = selectedTime.value === '24h' ? 24 : selectedTime.value === '7d' ? 24 * 7 : 24 * 30
  return timestamp >= Date.now() - hours * 60 * 60 * 1000
}

function operationStatusText(status: string) {
  if (status === 'confirmed') return '已执行'
  if (status === 'rejected') return '已拒绝'
  return '待确认'
}

function operationStatusBadge(status: string) {
  if (status === 'confirmed') return 'completed'
  if (status === 'rejected') return 'failed'
  return 'awaiting_confirmation'
}

function operationTypeText(value: string) {
  if (value === 'todo.create') return '创建待办'
  if (value === 'calendar.create') return '创建日程'
  return value
}

function operationPayloadText(item: OperationHistoryItem) {
  return item.detail || '详细参数已隐藏'
}

function isHighRiskOperation(item: OperationHistoryItem) {
  return ['high', 'high_risk', 'dangerous'].includes(item.riskLevel)
}

function toOperationHistoryItem(item: PendingOperationItem): OperationHistoryItem {
  const payload = item.payload || {}
  const projectId = positiveNumber(payload.projectId)
  const details: string[] = []
  if (projectId) details.push(`项目 #${projectId}`)
  if (item.operationType === 'todo.create' && typeof payload.dueAt === 'string') {
    details.push(`截止时间：${formatTime(payload.dueAt)}`)
  }
  if (item.operationType === 'calendar.create' && typeof payload.startsAt === 'string') {
    details.push(`开始时间：${formatTime(payload.startsAt)}`)
  }
  return {
    id: item.id,
    toolName: item.toolName,
    operationType: item.operationType,
    riskLevel: item.riskLevel,
    summary: item.summary,
    status: item.status,
    projectId,
    detail: details.join(' · '),
    createdAt: item.createdAt
  }
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function formatTime(value?: string | null) {
  return formatBeijingTime(value, '-')
}

function confirmationImpactText(item: ConfirmationInboxItem) {
  if (item.operationType === 'todo.create') return '将在任务列表创建 1 条待办'
  if (item.operationType === 'calendar.create') return '将在日历中创建 1 条日程'
  if (item.operationType === 'project.update') return '将更新 1 个项目的信息'
  if (item.impactResources.length === 1 && item.impactResources[0] === '已授权范围') return '将仅在当前已授权范围内执行'
  return item.impactResources.length ? `将影响：${item.impactResources.join('、')}` : '具体影响将在执行前再次确认'
}

function normaliseView(value: unknown): ViewKey {
  const text = queryText(value)
  return ['confirmations', 'attention', 'results', 'history'].includes(text) ? text as ViewKey : 'confirmations'
}

function queryText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function setOptionalQuery(query: Record<string, unknown>, key: string, value: string) {
  if (value) query[key] = value
  else delete query[key]
}

function requestMessage(error: any, fallback: string) {
  return error?.response?.data?.message || error?.response?.data?.detail || error?.message || fallback
}

onMounted(async () => {
  if (queryText(route.query.view) !== view.value) {
    await router.replace({ path: '/execution-center', query: { ...route.query, view: view.value } })
  }
  await load()
})
onBeforeUnmount(clearDismissUndoTimer)
</script>

<template>
  <div class="execution-page">
    <PageHeader eyebrow="结果、影响、下一步" title="执行中心" description="先看结论，技术详情按需打开。">
      <template #actions><RouterLink class="secondary-link" to="/automations">创建自动化</RouterLink></template>
    </PageHeader>

    <LoadingState v-if="pageLoading" label="正在加载执行数据" :cards="3" />
    <section v-else-if="loadError" class="load-error">
      <h2>执行中心加载失败</h2>
      <ErrorState title="执行中心加载失败" :message="loadError" @retry="load" />
    </section>
    <template v-else>
      <p v-if="partialError" class="partial-warning" role="status">{{ partialError }}</p>
      <div v-if="feedback" class="feedback-row">
        <p class="feedback" role="status" aria-live="polite">{{ feedback }}</p>
        <AppButton
          v-if="undoDismissedItems.length"
          variant="ghost"
          size="sm"
          :loading="undoLoading"
          @click="undoDismissedResults"
        >撤销</AppButton>
      </div>

      <nav class="execution-tabs" aria-label="执行中心分区">
        <button
          v-for="item in tabs"
          :key="item.id"
          type="button"
          :class="{ active: view === item.id }"
          :aria-current="view === item.id ? 'page' : undefined"
          @click="setView(item.id)"
        >{{ item.label }}</button>
      </nav>

      <label class="mobile-view-select">
        <span>查看</span>
        <select :value="view" aria-label="执行中心分区" @change="setViewFromEvent">
          <option v-for="item in tabs" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>

      <button class="mobile-filter-toggle secondary" type="button" :aria-expanded="mobileFiltersOpen" @click="mobileFiltersOpen = !mobileFiltersOpen">
        {{ mobileFiltersOpen ? '收起筛选' : '筛选结果' }}
      </button>
      <FilterBar class="execution-filter-bar" :class="{ open: mobileFiltersOpen }">
        <label>项目
          <input v-model.trim="selectedProjectId" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="全部项目" @change="syncFilters" />
        </label>
        <label v-if="view === 'results' || view === 'attention'">自动化
          <select v-model="selectedAutomationId" @change="syncFilters">
            <option value="">全部自动化</option>
            <option v-for="item in automationOptions" :key="item.id" :value="String(item.id)">{{ item.name }}</option>
          </select>
        </label>
        <label v-if="view === 'results' || view === 'attention'">状态
          <select v-model="selectedStatus" @change="syncFilters">
            <option value="">全部状态</option>
            <option value="completed">已完成</option>
            <option value="partial">部分完成</option>
            <option value="failed">失败</option>
            <option value="awaiting_confirmation">等待确认</option>
          </select>
        </label>
        <label>时间
          <select v-model="selectedTime" @change="syncFilters">
            <option value="all">全部时间</option><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option>
          </select>
        </label>
        <template #actions><AppButton variant="secondary" size="sm" @click="load">刷新</AppButton></template>
      </FilterBar>

      <div v-if="isResultView" class="filter-scope" data-testid="execution-filter-scope" aria-live="polite">
        <p>
          项目和时间同时筛选 Agent Task 与执行结果；自动化和状态仅筛选执行结果。
          <strong v-if="hasResultOnlyFilter">当前已启用结果专属筛选，Agent Task 暂时隐藏。</strong>
        </p>
        <AppButton v-if="hasResultOnlyFilter" variant="ghost" size="sm" @click="clearResultOnlyFilters">清除结果专属筛选</AppButton>
      </div>

      <section v-if="visibleAgentTasks.length" class="agent-task-section" aria-label="Agent Task">
        <header><div><span>Agent Task</span><h2>受控任务运行</h2></div><RouterLink to="/agent-tasks">查看全部</RouterLink></header>
        <div class="agent-task-grid"><AgentTaskCard v-for="task in visibleAgentTasks" :key="task.id" :task="task" /></div>
      </section>

      <section v-if="view === 'confirmations'" class="card-list" aria-label="待我确认">
        <EmptyState v-if="!displayConfirmations.length && !displayWorkflowConfirmations.length && !visibleAgentTasks.length" title="没有等待确认的操作" description="需要你决定的写操作和暂停步骤会集中出现在这里。" />
        <ResultSummaryCard
          v-for="item in displayWorkflowConfirmations"
          :key="`workflow-confirmation-${item.id}`"
          :item="item"
          :loading="Boolean(resultLoading[item.id])"
          :copy-state="copyStates[item.id] || 'idle'"
          @action="handleResultAction"
          @view-details="requestResultDetail"
          @copy-link="copyResultLink"
          @source-open="trackResultSourceOpen"
        />
        <ConfirmationCard
          v-for="item in displayConfirmations"
          :key="item.pendingOperationId"
          :item="item"
          :loading="confirmationGroupBusy(item)"
          @confirm="requestConfirmationAction($event, 'confirm')"
          @reject="requestConfirmationAction($event, 'reject')"
          @view-details="openConfirmationDetail"
        />
      </section>

      <section v-else-if="view === 'results' || view === 'attention'" class="card-list" :aria-label="view === 'attention' ? '需要处理' : '最新结果'">
        <LoadingState v-if="visibleResultsLoading" :label="view === 'attention' ? '正在加载需处理结果' : '正在加载最新结果'" :cards="2" />
        <template v-else>
          <header v-if="view === 'attention' && visibleResults.length" class="attention-heading">
            <div>
              <h2>需要处理 {{ filteredAttention.length }}{{ attentionHasMore ? '+' : '' }}</h2>
              <p>移出只关闭提醒，执行结果仍保留在历史中。</p>
            </div>
            <AppButton
              v-if="dismissibleAttention.length"
              variant="secondary"
              size="sm"
              :loading="bulkDismissLoading"
              :disabled="undoLoading"
              :aria-label="`全部知悉 ${dismissibleAttention.length} 条已结束结果`"
              @click="dismissAllAttention"
            >全部知悉</AppButton>
          </header>
          <EmptyState
            v-if="!visibleResults.length && !visibleAgentTasks.length"
            :title="hasResultOnlyFilter ? '没有符合筛选的执行结果' : view === 'attention' ? '没有需要处理的结果' : '还没有执行结果'"
            :description="hasResultOnlyFilter ? '当前自动化或状态筛选只作用于执行结果，Agent Task 已暂时隐藏。' : '运行首次巡检或自动化后，用户可读结果会出现在这里。'"
          ><RouterLink class="secondary-link" to="/automations">运行首次巡检</RouterLink></EmptyState>
          <ResultSummaryCard
            v-for="item in visibleResults"
            :key="item.id"
            :item="item"
            :loading="Boolean(resultLoading[item.id])"
            :copy-state="copyStates[item.id] || 'idle'"
            @action="handleResultAction"
            @view-details="requestResultDetail"
            @copy-link="copyResultLink"
            @source-open="trackResultSourceOpen"
          />
          <div v-if="visibleResultsHasMore" class="load-more-row">
            <AppButton variant="secondary" :loading="visibleResultsMoreLoading" @click="loadMoreVisibleResults">
              {{ visibleResultsMoreLoading ? '加载中…' : '加载更多' }}
            </AppButton>
          </div>
        </template>
      </section>

      <section v-else class="history-section" aria-label="操作历史">
        <div class="history-heading">
          <div><h2>操作记录</h2><p>保留原“操作”页中的确认、拒绝和执行结果历史。</p></div>
          <div class="history-tabs" aria-label="操作状态">
            <button :class="{ active: operationStatus === 'all' }" type="button" @click="operationStatus = 'all'; syncFilters()">全部</button>
            <button :class="{ active: operationStatus === 'pending' }" type="button" @click="operationStatus = 'pending'; syncFilters()">待确认</button>
            <button :class="{ active: operationStatus === 'confirmed' }" type="button" @click="operationStatus = 'confirmed'; syncFilters()">已执行</button>
            <button :class="{ active: operationStatus === 'rejected' }" type="button" @click="operationStatus = 'rejected'; syncFilters()">已拒绝</button>
          </div>
        </div>
        <LoadingState v-if="historyLoading" label="正在加载操作历史" :cards="2" />
        <ErrorState v-else-if="historyError" title="操作历史加载失败" :message="historyError" @retry="ensureHistoryLoaded(true)" />
        <EmptyState v-else-if="!visibleOperations.length" title="暂无操作记录" description="聊天里触发写操作后，会先等待确认并保留在这里。" />
        <div v-else class="card-list">
          <article v-for="item in visibleOperations" :key="item.id" class="operation-row" :class="{ disabled: item.status !== 'pending' }">
            <header>
              <div><h3>{{ humanizeIsoDateTimes(item.summary) }}</h3><p>{{ operationTypeText(item.operationType) }} · {{ humanizeIsoDateTimes(operationPayloadText(item)) }}</p></div>
              <StatusBadge :status="operationStatusBadge(item.status)" :label="operationStatusText(item.status)" />
            </header>
            <p class="operation-created">创建于 {{ formatTime(item.createdAt) }}</p>
            <p class="operation-detail">{{ humanizeIsoDateTimes(operationPayloadText(item)) }}</p>
            <details class="technical-details">
              <summary>技术详情</summary>
              <dl><div><dt>工具</dt><dd>{{ item.toolName }}</dd></div><div><dt>操作类型</dt><dd>{{ item.operationType }}</dd></div></dl>
            </details>
            <footer v-if="item.status === 'pending'">
              <AppButton data-testid="operation-confirm-button" size="sm" :loading="historyActionLoading[item.id]" @click="requestHistoryAction(item, 'confirm')">确认执行</AppButton>
              <AppButton data-testid="operation-reject-button" variant="secondary" size="sm" :disabled="historyActionLoading[item.id]" @click="requestHistoryAction(item, 'reject')">拒绝</AppButton>
            </footer>
          </article>
        </div>
      </section>
    </template>

    <ConfirmActionDialog
      :open="Boolean(highRiskTarget)"
      title="再次确认高风险操作"
      :description="highRiskDescription"
      confirm-label="确认并执行"
      danger
      :busy="highRiskBusy"
      @update:open="(open) => { if (!open) highRiskTarget = null }"
      @confirm="confirmHighRisk"
    />

    <DetailDrawer
      :open="Boolean(resultDetailId)"
      :title="humanizeIsoDateTimes(resultDetail?.title) || '执行结果详情'"
      description="技术信息按需加载，不在主列表暴露完整 Trace。"
      @update:open="(open) => { if (!open) closeResultDetail() }"
    >
      <LoadingState v-if="resultDetailLoading" label="正在加载执行结果详情" :cards="1" />
      <ErrorState v-else-if="resultDetailError" title="详情加载失败" :message="resultDetailError" @retry="resultDetailId && loadResultDetail(resultDetailId)" />
      <div v-else-if="resultDetail" class="detail-stack">
        <StatusBadge :status="resultDetail.status" />
        <section><strong>结论</strong><p>{{ resultDetail.conclusion }}</p></section>
        <section v-if="resultDetail.completedItems.length"><strong>已完成</strong><ul><li v-for="item in resultDetail.completedItems" :key="item">{{ item }}</li></ul></section>
        <section v-if="resultDetail.risks.length"><strong>风险或阻塞</strong><ul><li v-for="item in resultDetail.risks" :key="item">{{ item }}</li></ul></section>
        <section><strong>数据范围</strong><p>{{ resultDetail.dataScope.length ? resultDetail.dataScope.join('、') : '未返回数据范围' }}</p></section>
        <section class="technical"><strong>技术信息</strong><code>{{ resultDetail.traceRef || '暂无 Trace 引用' }}</code><p>耗时：{{ resultDetail.durationMs ?? '—' }} ms · 来源：{{ resultDetail.sourceType }} / {{ resultDetail.sourceId }}</p></section>
      </div>
      <template #footer><AppButton v-if="resultDetail" variant="secondary" @click="copyResultLink(resultDetail)">复制结果链接</AppButton></template>
    </DetailDrawer>

    <DetailDrawer
      :open="Boolean(confirmationDetail)"
      :title="humanizeIsoDateTimes(confirmationDetail?.actionTitle) || '待确认操作详情'"
      description="确认前检查原因、影响范围和可撤销性。"
      @update:open="(open) => { if (!open) closeConfirmationDetail() }"
    >
      <LoadingState v-if="confirmationDetailLoading" label="正在加载待确认操作详情" :cards="1" />
      <ErrorState v-else-if="confirmationDetailError" title="详情加载失败" :message="confirmationDetailError" />
      <div v-else-if="confirmationDetail" class="detail-stack">
        <StatusBadge status="awaiting_confirmation" />
        <section v-if="(confirmationDetail.duplicateCount || 1) > 1"><strong>重复请求</strong><p>{{ confirmationDetail.duplicateCount }} 个相同请求已归并，可一次处理。</p></section>
        <section><strong>原因</strong><p>{{ confirmationDetail.reason }}</p></section>
        <section><strong>影响范围</strong><p>{{ confirmationImpactText(confirmationDetail) }}</p></section>
        <section><strong>可撤销性</strong><p>{{ confirmationDetail.reversible ? '可撤销' : '可能无法撤销' }}</p></section>
        <section class="technical" v-if="confirmationDetail.toolName || confirmationDetail.operationType || confirmationDetail.source">
          <strong>技术详情</strong>
          <p>来源：{{ confirmationDetail.source }}</p>
          <p>工具与操作：{{ confirmationDetail.toolName || '—' }} · {{ confirmationDetail.operationType || '—' }}</p>
          <p>请求编号：{{ confirmationDetail.pendingOperationId }} · {{ formatTime(confirmationDetail.createdAt) }}</p>
        </section>
      </div>
    </DetailDrawer>
  </div>
</template>

<style scoped>
.execution-page { display: grid; gap: var(--space-5); width: min(100%, 1180px); margin: 0 auto; }
.secondary-link { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); color: var(--foreground); padding: 9px 14px; font-weight: 650; }.secondary-link:hover { background: var(--surface-muted); }
.load-error { display: grid; gap: var(--space-3); }.load-error > h2 { margin: 0; color: var(--danger-strong); font-size: 20px; }
.partial-warning, .feedback { margin: 0; border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); }.partial-warning { border: 1px solid var(--warning-border); background: var(--warning-soft); color: var(--lyle-color-amber-800); }.feedback { border: 1px solid var(--info-border); background: var(--info-soft); color: var(--info-strong); }
.feedback-row { display: flex; align-items: center; gap: var(--space-2); border: 1px solid var(--info-border); border-radius: var(--radius-md); background: var(--info-soft); padding-right: var(--space-2); }.feedback-row .feedback { min-width: 0; flex: 1; border: 0; background: transparent; }
.execution-tabs { display: flex; gap: var(--space-1); overflow-x: auto; border-bottom: 1px solid var(--border); }
.execution-tabs button { flex: 0 0 auto; border: 0; border-bottom: 3px solid transparent; border-radius: 0; background: transparent; color: var(--muted-foreground); padding: 12px 14px; white-space: nowrap; }.execution-tabs button.active { border-bottom-color: var(--primary); color: var(--primary); font-weight: 750; }
.mobile-view-select, .mobile-filter-toggle { display: none; }
:deep(.filter-bar label) { display: grid; gap: 4px; color: var(--muted-foreground); font-size: 12px; font-weight: 650; }
.filter-scope { display: flex; min-height: 42px; align-items: center; justify-content: space-between; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-muted); padding: 8px var(--space-3); color: var(--muted-foreground); font-size: 13px; }.filter-scope p { margin: 0; line-height: 1.5; }.filter-scope strong { color: var(--foreground); }
.card-list { display: grid; gap: var(--space-4); }
.attention-heading { display: flex; align-items: end; justify-content: space-between; gap: var(--space-4); border-bottom: 1px solid var(--border); padding-bottom: var(--space-3); }.attention-heading h2 { margin: 0; font-size: 18px; }.attention-heading p { margin: 5px 0 0; color: var(--muted-foreground); font-size: 13px; }
.agent-task-section { display: grid; gap: var(--space-3); border-bottom: 1px solid var(--border); padding-bottom: var(--space-5); }.agent-task-section > header { display: flex; align-items: end; justify-content: space-between; gap: var(--space-3); }.agent-task-section > header span { color: var(--primary); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }.agent-task-section h2 { margin: 4px 0 0; font-size: 17px; }.agent-task-section a { color: var(--primary); font-size: 13px; font-weight: 700; text-decoration: none; }.agent-task-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-3); }
.load-more-row { display: flex; justify-content: center; padding: var(--space-2) 0; }
.history-section { display: grid; gap: var(--space-4); }.history-heading { display: flex; align-items: end; justify-content: space-between; gap: var(--space-4); }.history-heading h2 { margin: 0; }.history-heading p { margin: 5px 0 0; color: var(--muted-foreground); }
.history-tabs { display: flex; flex-wrap: wrap; gap: var(--space-1); border-radius: var(--radius-md); background: var(--surface-muted); padding: 3px; }.history-tabs button { border: 0; border-radius: calc(var(--radius-md) - 2px); background: transparent; color: var(--muted-foreground); padding: 7px 10px; }.history-tabs button.active { background: var(--surface); color: var(--foreground); box-shadow: var(--shadow-card); }
.operation-row { display: grid; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); padding: var(--space-5); }.operation-row.disabled { opacity: .82; }.operation-row header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }.operation-row h3 { margin: 0 0 5px; font-size: 17px; }.operation-row header p { margin: 0; color: var(--muted-foreground); overflow-wrap: anywhere; }.operation-row dl { display: flex; flex-wrap: wrap; gap: var(--space-4); margin: 0; }.operation-row dl > div { display: flex; gap: 6px; }.operation-row dt { color: var(--muted-foreground); }.operation-row dd { margin: 0; }.operation-detail { margin: 0; border-radius: var(--radius-md); background: var(--surface-muted); padding: var(--space-3); overflow-wrap: anywhere; }.operation-row footer { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.operation-created { margin: 0; color: var(--muted-foreground); font-size: 13px; }.technical-details { border-top: 1px solid var(--border); padding-top: var(--space-3); color: var(--muted-foreground); }.technical-details summary { cursor: pointer; font-size: 13px; font-weight: 700; }.technical-details dl { margin-top: var(--space-3); }
.detail-stack { display: grid; gap: var(--space-4); }.detail-stack section { display: grid; gap: 6px; border-top: 1px solid var(--border); padding-top: var(--space-3); }.detail-stack p, .detail-stack ul { margin: 0; color: var(--muted-foreground); line-height: 1.6; }.detail-stack ul { padding-left: 20px; }.technical { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-muted); padding: var(--space-3) !important; }.technical code { overflow-wrap: anywhere; }
@media (max-width: 680px) {
  .execution-page { gap: var(--space-3); }
  .execution-tabs { display: none; }
  .mobile-view-select { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--space-2); color: var(--muted-foreground); font-size: 13px; font-weight: 700; }
  .mobile-view-select select { min-height: 42px; }
  .mobile-filter-toggle { display: inline-flex; width: 100%; min-height: 40px; align-items: center; justify-content: center; }
  :deep(.execution-filter-bar:not(.open)) { display: none; }
  .filter-scope { align-items: stretch; flex-direction: column; }.filter-scope :deep(button) { width: 100%; }
  .feedback-row, .attention-heading { align-items: stretch; flex-direction: column; }.feedback-row { padding: 0; }.feedback-row :deep(button), .attention-heading :deep(button) { width: 100%; }
  .history-heading, .operation-row header { align-items: stretch; flex-direction: column; }
  .history-tabs { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow: visible; }
  .operation-row footer :deep(button), .secondary-link { width: 100%; }
}
</style>
