<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { memorySchemaLabel } from '@/domain/memory-presentation'
import type { MemorySchemaStatus } from '@/api/types'
import type { MemoryFact } from '@/api/types'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  ExternalLink,
  Folder,
  Image,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plane,
  Power,
  RotateCcw,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X
} from '@lucide/vue'
import {
  correctMemoryRecord,
  getMemoryGovernanceEvents,
  getMemoryInbox,
  getMemoryPurgeJob,
  getMemoryRecord,
  getMemoryRecords,
  getMemoryFacts,
  reviseMemoryFact,
  getMemorySchemaStatus,
  rebuildMemorySchema,
  governMemoryRecord,
  purgeMemoryRecord,
  resolveMemoryConflict,
  retryMemoryPurgeJob
} from '@/api/app'
import type {
  MemoryConflict,
  MemoryGovernanceEvent,
  MemoryInboxItem,
  MemoryPurgeJob,
  MemoryRecord,
  MemoryRecordStatus,
  MemoryReliability
} from '@/api/types'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'

type WorkspaceTab = 'mine' | 'inbox' | 'history'
type Resolution = 'KEEP_CURRENT' | 'USE_CANDIDATE' | 'MERGE' | 'USE_NEITHER' | 'FORGET'
type ConfirmAction = 'DISABLE' | 'RESTORE' | 'FORGET' | 'PURGE' | null

const route = useRoute()
const router = useRouter()
const records = ref<MemoryRecord[]>([])
const inbox = ref<MemoryInboxItem[]>([])
const events = ref<MemoryGovernanceEvent[]>([])
const activeTab = ref<WorkspaceTab>('mine')
const selectedRecord = ref<MemoryRecord | null>(null)
const selectedInbox = ref<MemoryInboxItem | null>(null)
const query = ref('')
const statusFilter = ref('')
const loading = ref(true)
const workspaceLoaded = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')
const facts = ref<MemoryFact[]>([])
const factError = ref('')
const migrationConflicts = ref(0)
const unmappedMemories = ref(0)
const schemaStatus = ref<MemorySchemaStatus | null>(null)
const schemaError = ref('')
const schemaBusy = ref(false)
let workspaceGeneration = 0
let detailGeneration = 0
let selectionGeneration = 0
let schemaGeneration = 0
let schemaPollTimer: number | undefined
let disposed = false

async function refreshSchemaStatus() {
  const generation = ++schemaGeneration
  if (schemaPollTimer) window.clearTimeout(schemaPollTimer)
  try {
    const response = await getMemorySchemaStatus()
    if (disposed || generation !== schemaGeneration) return
    schemaStatus.value = response.data
    schemaError.value = ''
    if (['pending', 'building'].includes(response.data.status)) {
      schemaPollTimer = window.setTimeout(refreshSchemaStatus, 3000)
    }
  } catch {
    if (!disposed && generation === schemaGeneration) schemaError.value = '暂时无法获取记忆整理状态'
  }
}

async function retrySchemaBuild() {
  if (schemaBusy.value) return
  schemaBusy.value = true
  try {
    await rebuildMemorySchema()
    await refreshSchemaStatus()
  } catch {
    schemaError.value = '无法开始整理，请稍后重试'
  } finally {
    schemaBusy.value = false
  }
}
const correctionOpen = ref(false)
const correctionValue = ref('')
const correctionError = ref('')
const correctionRecordId = ref('')
const correctionDialog = ref<HTMLDialogElement | null>(null)
const correctionInput = ref<HTMLTextAreaElement | null>(null)
const confirmAction = ref<ConfirmAction>(null)
const confirmRecord = ref<MemoryRecord | null>(null)
const advancedMode = ref(false)
const resolution = ref<Resolution | ''>('')
const mergedValue = ref('')
const activePurgeJob = ref<MemoryPurgeJob | null>(null)
let purgePollTimer: number | undefined
let correctionRestoreFocus: HTMLElement | null = null

const filteredRecords = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return records.value.filter((item) => {
    const matchesQuery = !needle || `${item.title} ${item.value}`.toLowerCase().includes(needle)
    const matchesStatus = !statusFilter.value || item.status === statusFilter.value
    return matchesQuery && matchesStatus
  })
})

const selectedConflict = computed(() => selectedInbox.value?.conflict || null)
const currentRecord = computed(() => activeTab.value === 'mine'
  ? (filteredRecords.value.some(item => item.memoryId === selectedRecord.value?.memoryId)
    ? selectedRecord.value : filteredRecords.value[0]) || null
  : selectedRecord.value)
const currentSources = computed(() => currentRecord.value?.sources || [])
const currentFacts = computed(() => facts.value.filter(item => item.schemaPath === currentRecord.value?.schemaPath))
const isEmptyWorkspace = computed(() => workspaceLoaded.value && !error.value && !records.value.length && !inbox.value.length && !events.value.length)
const showInitialLoading = computed(() => loading.value && !workspaceLoaded.value)
const showInitialError = computed(() => Boolean(error.value) && !workspaceLoaded.value && !loading.value)
const showSchemaNotice = computed(() => Boolean(schemaError.value || (schemaStatus.value && (
  advancedMode.value || ['failed', 'pending', 'building'].includes(schemaStatus.value.status)
))))
const schemaNoticeText = computed(() => {
  if (schemaError.value) return schemaError.value
  const schema = schemaStatus.value
  if (!schema) return ''
  if (advancedMode.value) return memorySchemaLabel(schema)
  if (schema.status === 'failed') return '记忆暂时未能整理完成。已有内容会保留，你可以重新整理。'
  return '正在整理记忆，完成后会自动更新。'
})

async function toggleFact(fact: MemoryFact) {
  if (busy.value) return
  busy.value = true
  try {
    await reviseMemoryFact(fact, fact.status === 'active' ? 'disabled' : 'active')
    notice.value = '已更新这一条事实，其他条目不受影响。'
    await refreshWorkspace()
  } catch {
    await refreshWorkspace()
    error.value = '这条事实可能已更新或暂时不可用，请核对最新内容后重试。'
  } finally {
    busy.value = false
  }
}
const mobileDetailOpen = computed(() => Boolean(
  (activeTab.value === 'mine' && route.query.memory && currentRecord.value)
  || (activeTab.value === 'inbox' && route.query.inbox && selectedInbox.value)
))

onMounted(async () => {
  await refreshWorkspace()
  const memoryId = typeof route.query.memory === 'string' ? route.query.memory : ''
  const inboxId = typeof route.query.inbox === 'string' ? route.query.inbox : ''
  if (memoryId) {
    await selectRecordById(memoryId, false)
    if (route.query.action === 'correct' && currentRecord.value?.memoryId === memoryId) openCorrection()
  }
  if (inboxId) {
    activeTab.value = 'inbox'
    selectInboxById(inboxId, false)
  }
})

watch(() => route.query, () => {
  if (!workspaceLoaded.value || busy.value) return
  const memoryId = typeof route.query.memory === 'string' ? route.query.memory : ''
  const inboxId = typeof route.query.inbox === 'string' ? route.query.inbox : ''
  if (memoryId && (activeTab.value !== 'mine' || selectedRecord.value?.memoryId !== memoryId)) {
    activeTab.value = 'mine'
    void selectRecordById(memoryId, false)
  } else if (inboxId && (activeTab.value !== 'inbox' || selectedInbox.value?.inboxId !== inboxId)) {
    activeTab.value = 'inbox'
    selectInboxById(inboxId, false)
  }
})

watch([query, statusFilter], () => {
  if (activeTab.value !== 'mine') return
  if (!filteredRecords.value.some(item => item.memoryId === selectedRecord.value?.memoryId)) {
    const first = filteredRecords.value[0]
    selectedRecord.value = first || null
    detailGeneration += 1
    detailError.value = ''
    detailLoading.value = false
    if (first) void loadRecordDetail(first.memoryId)
  }
})

onBeforeUnmount(() => {
  disposed = true
  workspaceGeneration += 1
  detailGeneration += 1
  schemaGeneration += 1
  if (schemaPollTimer) window.clearTimeout(schemaPollTimer)
  if (purgePollTimer) window.clearTimeout(purgePollTimer)
})

async function refreshWorkspace(preserveSelection = true) {
  if (disposed) return
  const generation = ++workspaceGeneration
  const selection = selectionGeneration
  void refreshSchemaStatus()
  if (activePurgeJob.value && ['PENDING', 'RUNNING', 'RETRY'].includes(activePurgeJob.value.status)) schedulePurgePoll(activePurgeJob.value.jobId)
  loading.value = true
  error.value = ''
  try {
    const [recordResponse, inboxResponse, eventResponse, factResponse] = await Promise.all([
      getMemoryRecords({ limit: 300 }),
      getMemoryInbox(),
      getMemoryGovernanceEvents(),
      getMemoryFacts().catch(() => null)
    ])
    if (disposed || generation !== workspaceGeneration) return
    facts.value = factResponse?.data.items || []
    migrationConflicts.value = factResponse?.data.migration.conflicts.length || 0
    unmappedMemories.value = factResponse?.data.migration.unmappedKeys?.length || 0
    factError.value = factResponse ? '' : '逐条事实暂不可用，请刷新后重试。'
    records.value = recordResponse.data.items
    inbox.value = inboxResponse.data.items
    events.value = eventResponse.data.items
    workspaceLoaded.value = true
    if (selection !== selectionGeneration) return
    if (!preserveSelection || !selectedRecord.value) {
      selectedRecord.value = records.value[0] || null
    } else {
      const latest = records.value.find((item) => item.memoryId === selectedRecord.value?.memoryId)
      selectedRecord.value = latest || records.value[0] || null
    }
    if (activeTab.value === 'inbox') {
      const latest = inbox.value.find(item => item.inboxId === selectedInbox.value?.inboxId) || inbox.value[0]
      if (latest) await selectInboxItem(latest, false)
      else selectedInbox.value = null
    } else if (selectedRecord.value) await loadRecordDetail(selectedRecord.value.memoryId)
  } catch {
    if (!disposed && generation === workspaceGeneration) error.value = '记忆暂时无法加载，请稍后重试。'
  } finally {
    if (generation === workspaceGeneration) loading.value = false
  }
}

async function loadRecordDetail(memoryId: string) {
  const generation = ++detailGeneration
  detailLoading.value = true
  detailError.value = ''
  try {
    const response = await getMemoryRecord(memoryId)
    if (!disposed && generation === detailGeneration && selectedRecord.value?.memoryId === memoryId) {
      if (response.data.memoryId !== memoryId) throw new Error('Unexpected memory record')
      selectedRecord.value = response.data
    }
  } catch {
    if (!disposed && generation === detailGeneration) detailError.value = '来源暂时无法加载，请重试。'
  } finally {
    if (generation === detailGeneration) detailLoading.value = false
  }
}

async function selectRecord(record: MemoryRecord, updateRoute = true) {
  if (busy.value) return
  const selection = ++selectionGeneration
  activeTab.value = 'mine'
  selectedRecord.value = record
  selectedInbox.value = null
  if (updateRoute) {
    await router.replace({ query: { memory: record.memoryId } })
  }
  if (disposed || selection !== selectionGeneration) return
  await loadRecordDetail(record.memoryId)
}

async function selectRecordById(memoryId: string, updateRoute = true) {
  const record = records.value.find((item) => item.memoryId === memoryId)
  if (record) await selectRecord(record, updateRoute)
}

async function selectInboxItem(item: MemoryInboxItem, updateRoute = true) {
  if (busy.value && updateRoute) return
  selectionGeneration += 1
  detailGeneration += 1
  detailLoading.value = false
  detailError.value = ''
  activeTab.value = 'inbox'
  selectedInbox.value = item
  selectedRecord.value = item.memory || item.conflict?.currentMemory || null
  resolution.value = item.conflict ? defaultResolution(item.conflict) : ''
  mergedValue.value = item.conflict?.candidate?.value || ''
  if (updateRoute) await router.replace({ query: { inbox: item.inboxId } })
}

function selectInboxById(inboxId: string, updateRoute = true) {
  const item = inbox.value.find((candidate) => candidate.inboxId === inboxId)
  if (item) void selectInboxItem(item, updateRoute)
}

async function closeMobileDetail() {
  if (busy.value) return
  await router.replace({ query: {} })
  await nextTick()
  const selected = document.querySelector<HTMLElement>('.memory-row.selected, .inbox-queue button.selected')
  selected?.focus()
}

async function openInboxRecord(record: MemoryRecord) {
  query.value = ''
  statusFilter.value = ''
  if (!records.value.some(item => item.memoryId === record.memoryId)) records.value.push(record)
  await selectRecord(record)
}

async function setTab(tab: WorkspaceTab) {
  if (busy.value) return
  selectionGeneration += 1
  detailGeneration += 1
  detailLoading.value = false
  detailError.value = ''
  activeTab.value = tab
  selectedInbox.value = null
  if (tab === 'inbox' && inbox.value.length) await selectInboxItem(inbox.value[0], false)
  if (tab === 'mine' && filteredRecords.value.length) {
    selectedRecord.value = filteredRecords.value[0]
    void loadRecordDetail(selectedRecord.value.memoryId)
  }
  await router.replace({ query: {} })
}

function openCorrection() {
  if (!currentRecord.value || busy.value || !currentRecord.value.allowedActions.includes('CORRECT')) return
  correctionError.value = ''
  correctionRecordId.value = currentRecord.value.memoryId
  correctionValue.value = currentRecord.value.rawValue || currentRecord.value.value
  correctionRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  correctionOpen.value = true
  void nextTick(() => {
    const dialog = correctionDialog.value
    if (dialog && !dialog.open) dialog.showModal()
    correctionInput.value?.focus()
  })
}

function closeCorrection(force = false) {
  if (busy.value && !force) return
  const dialog = correctionDialog.value
  if (dialog?.open) dialog.close()
  correctionOpen.value = false
  const restoreTarget = correctionRestoreFocus
  correctionRestoreFocus = null
  if (restoreTarget?.isConnected) void nextTick(() => restoreTarget.focus())
}

function handleCorrectionKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !correctionDialog.value) return
  const focusable = Array.from(correctionDialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hasAttribute('hidden'))
  if (!focusable.length) {
    event.preventDefault()
    correctionDialog.value.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !correctionDialog.value.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !correctionDialog.value.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

async function saveCorrection() {
  const memoryId = correctionRecordId.value
  const value = correctionValue.value.trim()
  if (!memoryId || !value || busy.value) return
  busy.value = true
  correctionError.value = ''
  try {
    const response = await correctMemoryRecord(memoryId, value)
    if (disposed) return
    if (selectedRecord.value?.memoryId === memoryId) selectedRecord.value = response.data.memory
    closeCorrection(true)
    notice.value = '记忆已纠正，旧内容不会再进入后续回答。'
    await refreshWorkspace()
  } catch {
    correctionError.value = '记忆纠正失败，请稍后重试。'
  } finally {
    busy.value = false
  }
}

function beginGovernance(action: Exclude<ConfirmAction, null>) {
  if (busy.value || !currentRecord.value?.allowedActions.includes(action)) return
  confirmRecord.value = currentRecord.value
  confirmAction.value = action
}

async function confirmGovernanceAction() {
  const action = confirmAction.value
  const record = confirmRecord.value
  if (!action || !record || busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (action === 'PURGE') {
      const response = await purgeMemoryRecord(record.memoryId)
      activePurgeJob.value = response.data
      notice.value = '正在清理这条记忆，完成前 Lyle 不会继续使用它。'
      schedulePurgePoll(response.data.jobId)
    } else {
      const response = await governMemoryRecord(record.memoryId, action.toLowerCase() as 'disable' | 'restore' | 'forget')
      if (selectedRecord.value?.memoryId === record.memoryId) selectedRecord.value = response.data.memory
      notice.value = action === 'DISABLE'
        ? '记忆已停用，你之后仍可恢复。'
        : action === 'RESTORE'
          ? '记忆已恢复使用。'
          : '记忆已遗忘，不会再主动使用。'
    }
    confirmAction.value = null
    await refreshWorkspace()
  } catch {
    error.value = '记忆治理操作失败，请稍后重试。'
  } finally {
    busy.value = false
  }
}

function schedulePurgePoll(jobId: number) {
  if (disposed) return
  if (purgePollTimer) window.clearTimeout(purgePollTimer)
  purgePollTimer = window.setTimeout(async () => {
    try {
      const response = await getMemoryPurgeJob(jobId)
      if (disposed) return
      activePurgeJob.value = response.data
      if (['PENDING', 'RUNNING', 'RETRY'].includes(response.data.status)) {
        schedulePurgePoll(jobId)
      } else {
        notice.value = response.data.status === 'SUCCEEDED'
          ? '记忆及关联索引已永久删除。'
          : '删除尚未完成，Lyle 不会继续使用它。'
        await refreshWorkspace(false)
      }
    } catch {
      if (!disposed) error.value = '删除进度暂时无法更新，请稍后刷新查看。'
    }
  }, 1500)
}

async function retryPurge(job: MemoryPurgeJob) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const response = await retryMemoryPurgeJob(job.jobId)
    activePurgeJob.value = response.data
    schedulePurgePoll(job.jobId)
  } catch {
    error.value = '暂时无法重试删除，请稍后再试。'
  } finally {
    busy.value = false
  }
}

async function submitResolution() {
  const conflict = selectedConflict.value
  if (!conflict || !resolution.value || busy.value || (resolution.value === 'MERGE' && !mergedValue.value.trim())) return
  busy.value = true
  error.value = ''
  try {
    await resolveMemoryConflict(conflict, resolution.value, mergedValue.value.trim())
    if (disposed) return
    notice.value = '已更新记忆，旧内容会保留在治理记录中。'
    await refreshWorkspace(false)
    activeTab.value = 'mine'
    await router.replace({ query: {} })
  } catch (caught: any) {
    if (caught?.response?.status === 409) {
      await refreshWorkspace(false)
      error.value = '这条记忆已经更新，已为你刷新最新内容，请重新核对。'
    } else {
      error.value = '冲突处理失败，请稍后重试。'
    }
  } finally {
    busy.value = false
  }
}

function defaultResolution(conflict: MemoryConflict): Resolution | '' {
  const excerpt = conflict.candidate?.source?.excerpt || ''
  return /(不是|改成|先不|取消|不再)/.test(excerpt) ? 'USE_CANDIDATE' : ''
}

function reliabilityLabel(reliability: MemoryReliability) {
  return { RELIABLE: '可靠', BASIC: '基本可靠', REVIEW_REQUIRED: '待确认' }[reliability]
}

function statusLabel(status: MemoryRecordStatus) {
  return {
    ACTIVE: '可用', PENDING: '待确认', CONFLICTED: '信息不一致', DISABLED: '已停用',
    FORGOTTEN: '已遗忘', PURGING: '删除中', PURGE_FAILED: '删除未完成', REVIEW_REQUIRED: '待确认'
  }[status] || status
}

function relationLabel(relation: string) {
  return {
    SUPPORT: '来源支持', SUPPLEMENT: '再次提及', CORRECTION: '用户纠正', CONTRADICT: '信息不一致',
    DUPLICATE: '重复来源', MANUAL: '用户确认'
  }[relation] || '来源'
}

function eventLabel(event: MemoryGovernanceEvent) {
  const labels: Record<string, string> = {
    CORRECT: '已纠正记忆', DISABLE: '已停用记忆', RESTORE: '已恢复记忆', FORGET: '已遗忘记忆',
    PURGE_REQUESTED: '已请求永久删除', CONFLICT_RESOLVED: '已处理信息不一致'
  }
  return labels[event.action] || event.action
}

function formatDate(value?: string | null) {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

function memoryIcon(schemaPath: string) {
  if (schemaPath.includes('visual')) return Image
  if (schemaPath.includes('project')) return Folder
  if (schemaPath.includes('technology') || schemaPath.includes('work.background')) return Code2
  if (schemaPath.includes('communication') || schemaPath.includes('output')) return MessageSquare
  if (schemaPath.includes('travel')) return Plane
  return BrainCircuit
}

function confirmTitle() {
  if (confirmAction.value === 'DISABLE') return '停用这条记忆？'
  if (confirmAction.value === 'RESTORE') return '恢复使用这条记忆？'
  if (confirmAction.value === 'FORGET') return '确认遗忘这条记忆？'
  return '永久删除这条记忆？'
}

function confirmDescription() {
  if (confirmAction.value === 'DISABLE') return '停用后，Lyle 不会主动使用这条记忆，你之后可以恢复。'
  if (confirmAction.value === 'RESTORE') return '恢复后，Lyle 会在与你的问题相关时继续使用它。'
  if (confirmAction.value === 'FORGET') return '遗忘后，Lyle 不会再主动使用此内容，治理记录仍会保留最小状态信息。'
  return '永久删除会异步清理记忆、来源关联、搜索索引与缓存，完成后无法恢复。'
}
</script>

<template>
  <div
    class="memory-workspace page"
    :class="{ 'mobile-subpage-open': mobileDetailOpen, 'memory-workspace--empty': isEmptyWorkspace }"
    data-testid="v66-memory-workspace"
  >
    <header class="memory-page-header">
      <div :class="{ 'memory-sr-only': isEmptyWorkspace }">
        <h1>记忆</h1>
        <p>{{ activeTab === 'inbox' ? '核对有疑问的信息，决定以后如何使用' : '查看 Lyle 记住了什么，以及这些信息来自哪里' }}</p>
      </div>
      <div class="memory-header-actions">
        <button class="refresh-action" type="button" :disabled="loading || busy" @click="refreshWorkspace()"><RefreshCw :size="16" aria-hidden="true" />{{ loading ? '刷新中…' : '刷新' }}</button>
        <button class="advanced-toggle" type="button" :aria-expanded="advancedMode" @click="advancedMode = !advancedMode">管理选项</button>
        <RouterLink v-if="!isEmptyWorkspace" class="primary-action" to="/"><MessageSquare :size="16" aria-hidden="true" />和 Lyle 聊聊</RouterLink>
      </div>
    </header>

    <div v-if="showSchemaNotice" class="schema-notice" role="status">
      <BrainCircuit :size="17" aria-hidden="true" /><span>{{ schemaNoticeText }}</span>
      <button v-if="schemaError" type="button" @click="refreshSchemaStatus">刷新状态</button>
      <button v-else-if="schemaStatus?.enabled !== false && ['missing', 'failed'].includes(schemaStatus?.status || '')"
        type="button" :disabled="schemaBusy" @click="retrySchemaBuild">
        {{ schemaBusy ? '正在提交…' : schemaStatus?.status === 'failed' ? '重新整理' : '开始整理' }}
      </button>
    </div>

    <p v-if="migrationConflicts" class="workspace-error" role="alert">
      {{ migrationConflicts }} 类旧记忆存在不同的确认值，已暂停使用，请在对应记忆中核对并纠正。
    </p>
    <p v-if="unmappedMemories" class="workspace-error" role="alert">
      {{ unmappedMemories }} 类旧记忆尚未匹配到现有字段，原记录已保留，暂不参与召回。
    </p>

    <nav v-if="workspaceLoaded && !isEmptyWorkspace" class="memory-tabs" aria-label="记忆页面">
      <button :class="{ active: activeTab === 'mine' }" :aria-pressed="activeTab === 'mine'" :disabled="busy" type="button" @click="setTab('mine')">我的记忆 <span v-if="records.length" class="tab-count">{{ records.length }}</span></button>
      <button :class="{ active: activeTab === 'inbox' }" :aria-pressed="activeTab === 'inbox'" :disabled="busy" type="button" @click="setTab('inbox')">
        待我处理 <span v-if="inbox.length" class="tab-count">{{ inbox.length }}</span>
      </button>
      <button :class="{ active: activeTab === 'history' }" :aria-pressed="activeTab === 'history'" :disabled="busy" type="button" @click="setTab('history')">治理记录</button>
    </nav>

    <p v-if="notice" class="workspace-notice" role="status"><CheckCircle2 :size="17" />{{ notice }}</p>
    <div v-if="error && !showInitialError" class="workspace-error" role="alert">
      <span>{{ error }}</span><button type="button" :disabled="loading || busy" @click="refreshWorkspace()">重试</button>
    </div>

    <div v-if="showInitialLoading" class="memory-loading" role="status"><LoaderCircle :size="23" aria-hidden="true" /><strong>正在加载记忆…</strong></div>
    <div v-else-if="showInitialError" class="memory-empty memory-load-error" role="alert"><AlertTriangle :size="30" aria-hidden="true" /><h2>记忆暂时无法加载</h2><p>{{ error }}</p><button type="button" class="secondary-action" @click="refreshWorkspace()">重新加载</button></div>
    <template v-else-if="isEmptyWorkspace">
      <section class="memory-welcome" aria-labelledby="memory-welcome-title">
        <span class="memory-welcome-icon"><BrainCircuit :size="39" :stroke-width="1.6" aria-hidden="true" /></span>
        <h2 id="memory-welcome-title">让 Lyle，慢慢了解你</h2>
        <p>记住你的偏好与重要背景，<br class="desktop-break" />让每次对话都能接着往下聊。</p>
        <span class="welcome-hint">Lyle 还没有保存长期记忆。可以从一次对话开始。</span>
        <RouterLink class="primary-action" to="/"><MessageSquare :size="18" aria-hidden="true" />和 Lyle 聊聊<ArrowRight :size="17" aria-hidden="true" /></RouterLink>
      </section>
      <div class="memory-capabilities" aria-label="你可以怎样管理记忆">
        <article><span><BrainCircuit :size="21" aria-hidden="true" /></span><div><h3>记住重要的事</h3><p>在对话中告诉 Lyle 你的偏好和背景。</p></div></article>
        <article><span><MessageSquare :size="21" aria-hidden="true" /></span><div><h3>知道信息从哪来</h3><p>查看记忆依据，回到可用的原始对话。</p></div></article>
        <article><span><ShieldCheck :size="21" aria-hidden="true" /></span><div><h3>由你决定如何使用</h3><p>核对、纠正，也可以随时停用或遗忘。</p></div></article>
      </div>
    </template>
    <template v-else-if="activeTab === 'mine'">
      <div class="memory-columns" :class="{ 'mobile-detail-open': mobileDetailOpen, 'memory-columns--single': !currentRecord }">
        <section class="memory-list-pane" aria-label="记忆列表">
          <header class="memory-list-heading"><div><h2>已保存的记忆</h2><p>选择一条，查看内容和来源。</p></div><span>{{ records.length }} 条</span></header>
          <div class="memory-filter-row">
            <label class="memory-search">
              <Search :size="19" aria-hidden="true" />
              <input v-model="query" :disabled="busy" type="search" placeholder="搜索记忆" aria-label="搜索记忆" />
            </label>
            <label class="memory-status-filter">
              <SlidersHorizontal :size="18" aria-hidden="true" />
              <select v-model="statusFilter" :disabled="busy" aria-label="筛选记忆状态">
                <option value="">全部状态</option>
                <option value="ACTIVE">可用</option>
                <option value="CONFLICTED">需核对</option>
                <option value="PENDING">待确认</option>
                <option value="REVIEW_REQUIRED">待核实</option>
                <option value="DISABLED">已停用</option>
                <option value="FORGOTTEN">已遗忘</option>
                <option value="PURGING">删除中</option>
                <option value="PURGE_FAILED">删除未完成</option>
              </select>
            </label>
          </div>

          <div v-if="loading && !workspaceLoaded" class="memory-loading"><LoaderCircle :size="20" />正在加载记忆…</div>
          <div v-else-if="!filteredRecords.length" class="memory-empty">
            <BrainCircuit :size="28" /><strong>{{ records.length ? '没有找到相关记忆' : 'Lyle 还没有保存长期记忆' }}</strong>
            <p>{{ records.length ? '试试其他关键词，或调整记忆状态。' : inbox.length ? '先核对待处理内容，决定以后要记住什么。' : '在对话中告诉 Lyle 你想让它记住的事。' }}</p>
            <button v-if="query || statusFilter" type="button" @click="query = ''; statusFilter = ''">清除筛选</button>
            <button v-else-if="inbox.length" type="button" @click="setTab('inbox')">查看待我处理</button>
            <RouterLink v-else to="/">和 Lyle 聊聊</RouterLink>
          </div>
          <div v-else class="memory-list" role="listbox" aria-label="我的记忆">
            <button
              v-for="record in filteredRecords"
              :key="record.memoryId"
              class="memory-row"
              :class="{ selected: currentRecord?.memoryId === record.memoryId }"
              type="button"
              role="option"
              :aria-selected="currentRecord?.memoryId === record.memoryId"
              :disabled="busy"
              @click="selectRecord(record)"
            >
              <component :is="memoryIcon(record.schemaPath)" :size="23" :stroke-width="1.7" aria-hidden="true" />
              <span class="memory-row-copy">
                <strong>{{ record.title }}</strong>
                <span>{{ record.value }}</span>
                <small>
                  <span class="reliability-dot" :class="record.reliability.toLowerCase()"></span>
                  {{ reliabilityLabel(record.reliability) }}
                  <span v-if="record.status !== 'ACTIVE'" class="row-status">{{ statusLabel(record.status) }}</span>
                  <span>{{ record.sourceCount }} 个来源</span>
                  <span>{{ formatDate(record.updatedAt) }}</span>
                </small>
              </span>
              <ChevronRight :size="19" aria-hidden="true" />
            </button>
          </div>
          <p v-if="filteredRecords.length" class="memory-count">共 {{ filteredRecords.length }} 条记忆</p>
        </section>

        <section v-if="currentRecord" class="memory-detail-pane" aria-label="记忆详情">
          <button class="mobile-back" type="button" aria-label="返回记忆列表" @click="closeMobileDetail">
            <ArrowLeft :size="21" /> 返回
          </button>
          <header class="memory-detail-header">
            <div class="memory-detail-title">
              <component :is="memoryIcon(currentRecord.schemaPath)" :size="23" aria-hidden="true" />
              <strong>{{ currentRecord.title }}</strong>
            </div>
            <div class="memory-detail-actions">
              <button v-if="currentRecord.allowedActions.includes('CORRECT')" class="primary-action" type="button" :disabled="busy || detailLoading" @click="openCorrection"><Pencil :size="17" />纠正这条记忆</button>
              <button
                v-if="currentRecord.allowedActions.includes('DISABLE')"
                class="secondary-action"
                type="button"
                :disabled="busy"
                @click="beginGovernance('DISABLE')"
              ><Power :size="17" />停用</button>
              <button
                v-if="currentRecord.allowedActions.includes('RESTORE')"
                class="secondary-action"
                type="button"
                :disabled="busy"
                @click="beginGovernance('RESTORE')"
              ><RotateCcw :size="17" />恢复</button>
            </div>
          </header>

          <div v-if="detailLoading" class="detail-progress"><LoaderCircle :size="18" />正在加载来源…</div>
          <div v-if="detailError" class="detail-error" role="alert"><span>{{ detailError }}</span><button type="button" :disabled="detailLoading || busy" @click="loadRecordDetail(currentRecord.memoryId)">重试来源</button></div>
          <section class="current-memory-value">
            <span>当前内容</span>
            <h2>{{ currentRecord.value }}</h2>
            <div class="memory-badges">
              <span class="reliability-badge" :class="currentRecord.reliability.toLowerCase()">
                <ShieldCheck :size="15" />{{ reliabilityLabel(currentRecord.reliability) }}
              </span>
              <span>基于 {{ currentRecord.sourceCount }} 个来源</span>
              <span v-if="currentRecord.status !== 'ACTIVE'" class="status-badge">{{ statusLabel(currentRecord.status) }}</span>
            </div>
          </section>

          <section class="detail-section">
            <h3>使用方式</h3>
            <p>{{ currentRecord.usageDescription }}</p>
          </section>

          <section v-if="advancedMode && schemaStatus?.factsEnabled" class="detail-section">
            <h3>独立事实</h3>
            <p>画像由以下事实汇总。可单独停用某一项，不影响其他内容。</p>
            <p v-if="factError" role="alert">{{ factError }}</p>
            <div v-for="fact in currentFacts" :key="fact.factId" class="source-row">
              <span>{{ fact.value }} · {{ fact.status === 'active' ? '使用中' : fact.status === 'disabled' ? '已停用' : '暂不使用' }}</span>
              <button v-if="['active', 'disabled'].includes(fact.status)" class="secondary-action"
                type="button" :disabled="busy" @click="toggleFact(fact)">
                {{ fact.status === 'active' ? '停用这一项' : '恢复这一项' }}
              </button>
            </div>
          </section>

          <section class="detail-section sources-section">
            <h3>来源与理由</h3>
            <div v-if="currentSources.length" class="source-timeline">
              <article v-for="source in currentSources" :key="source.sourceId" class="source-row">
                <span class="source-node"></span>
                <div class="source-copy">
                  <div class="source-meta">
                    <span class="source-relation">{{ relationLabel(source.relation) }}</span>
                    <strong>{{ source.label }}</strong>
                    <span>{{ formatDate(source.occurredAt) }}</span>
                  </div>
                  <p v-if="source.availability === 'AVAILABLE'">“{{ source.excerpt }}”</p>
                  <p v-else class="source-unavailable">{{ source.unavailableReason || '当前无法查看此来源' }}</p>
                </div>
                <RouterLink v-if="source.availability === 'AVAILABLE' && source.link" :to="source.link" class="source-link">
                  查看原内容 <ExternalLink :size="14" />
                </RouterLink>
              </article>
            </div>
            <p v-else class="source-empty">这条历史记忆尚未保存精确来源。</p>
          </section>

          <section class="detail-section history-section">
            <h3>历史记录</h3>
            <div v-if="currentRecord.history?.length" class="compact-history">
              <div v-for="item in currentRecord.history.slice(0, 4)" :key="item.eventId">
                <Clock3 :size="16" /><span>{{ formatDate(item.createdAt) }}</span><span>{{ eventLabel(item) }}</span>
              </div>
            </div>
            <p v-else>最近没有治理变更。</p>
          </section>

          <details v-if="advancedMode" class="advanced-memory-details">
            <summary>技术详情</summary>
            <dl>
              <dt>Memory ID</dt><dd>{{ currentRecord.memoryId }}</dd>
              <dt>Schema Path</dt><dd>{{ currentRecord.schemaPath }}</dd>
              <dt>证据分值</dt><dd>{{ currentRecord.reliability }}（内部 {{ Math.round((currentRecord as any).confidence * 100) / 100 }}）</dd>
            </dl>
          </details>

          <section class="governance-zone">
            <div>
              <strong>决定如何使用</strong>
              <p>停用后可以恢复；遗忘后不再主动使用。</p>
            </div>
            <div>
              <button v-if="currentRecord.allowedActions.includes('FORGET')" type="button" :disabled="busy" @click="beginGovernance('FORGET')">遗忘</button>
              <button v-if="currentRecord.allowedActions.includes('PURGE')" class="danger-link" type="button" :disabled="busy" @click="beginGovernance('PURGE')"><Trash2 :size="16" />永久删除</button>
            </div>
          </section>

          <section v-if="activePurgeJob?.memoryId === currentRecord.memoryId" class="purge-progress" :class="activePurgeJob.status.toLowerCase()">
            <LoaderCircle v-if="['PENDING', 'RUNNING', 'RETRY'].includes(activePurgeJob.status)" :size="19" />
            <AlertTriangle v-else-if="activePurgeJob.status === 'FAILED'" :size="19" />
            <CheckCircle2 v-else :size="19" />
            <div><strong>{{ activePurgeJob.status === 'SUCCEEDED' ? '已永久删除' : activePurgeJob.status === 'FAILED' ? '删除未完成' : '正在清理这条记忆' }}</strong><p>这条记忆及关联来源会一并清理，完成前不再用于回答。</p></div>
            <button v-if="activePurgeJob.status === 'FAILED'" type="button" :disabled="busy" @click="retryPurge(activePurgeJob)">重试</button>
          </section>
        </section>
      </div>
    </template>

    <template v-else-if="activeTab === 'inbox'">
      <div v-if="!inbox.length" class="memory-empty inbox-empty">
        <CheckCircle2 :size="30" /><strong>暂无需要你核对的记忆</strong><button type="button" @click="setTab('mine')">返回我的记忆</button>
      </div>
      <div v-else class="inbox-columns" :class="{ 'mobile-detail-open': mobileDetailOpen }">
        <aside class="inbox-queue">
          <h2>待我处理（{{ inbox.length }}）</h2>
          <button
            v-for="item in inbox"
            :key="item.inboxId"
            type="button"
            :disabled="busy"
            :aria-pressed="selectedInbox?.inboxId === item.inboxId"
            :class="{ selected: selectedInbox?.inboxId === item.inboxId }"
            @click="selectInboxItem(item)"
          >
            <strong>{{ item.title }}</strong>
            <span :class="item.type.toLowerCase()">{{ item.type === 'CONFLICT' ? '信息不一致' : item.type === 'LOW_RELIABILITY' ? '可靠性较低' : item.type === 'PURGE_FAILED' ? '删除未完成' : '待确认' }}</span>
            <small><Clock3 :size="14" />{{ formatDate(item.createdAt) }}</small>
          </button>
        </aside>

        <section v-if="selectedConflict" class="conflict-canvas" aria-label="核对记忆" data-testid="v66-conflict-canvas">
          <button class="mobile-back" type="button" @click="closeMobileDetail"><ArrowLeft :size="21" />返回</button>
          <header>
            <div><h2>{{ selectedConflict.title }}</h2><p>Lyle 发现两次表达可能不一致，处理前不会主动使用这条信息。</p></div>
            <span><AlertTriangle :size="17" />需要你确认</span>
          </header>

          <div class="conflict-comparison">
            <article>
              <span>原来的记忆</span>
              <h3>{{ selectedConflict.currentMemory?.value }}</h3>
              <blockquote>“{{ selectedConflict.currentMemory?.sources?.[0]?.excerpt || selectedConflict.currentMemory?.value }}”</blockquote>
              <div><Clock3 :size="15" />{{ formatDate(selectedConflict.currentMemory?.updatedAt) }}</div>
            </article>
            <span class="comparison-swap"><RotateCcw :size="16" /></span>
            <article>
              <span>新的表达</span>
              <h3>{{ selectedConflict.candidate?.value }}</h3>
              <blockquote>“{{ selectedConflict.candidate?.source.excerpt }}”</blockquote>
              <div><Clock3 :size="15" />{{ formatDate(selectedConflict.candidate?.source.occurredAt) }}</div>
            </article>
          </div>

          <section class="resolution-section">
            <h3>以后应该记住什么？</h3>
            <label :class="{ selected: resolution === 'USE_CANDIDATE' }">
              <input v-model="resolution" :disabled="busy" type="radio" value="USE_CANDIDATE" />
              <span><strong>使用新的表达</strong><small>采用新的表达，替代旧的记忆。</small></span>
            </label>
            <div v-if="resolution === 'USE_CANDIDATE'" class="resolution-preview">预览将被记住的内容<strong>{{ selectedConflict.candidate?.value }}</strong></div>
            <label :class="{ selected: resolution === 'KEEP_CURRENT' }">
              <input v-model="resolution" :disabled="busy" type="radio" value="KEEP_CURRENT" />
              <span><strong>保留原来的记忆</strong><small>保持原来的记忆，忽略新的表达。</small></span>
            </label>
            <label :class="{ selected: resolution === 'MERGE' }">
              <input v-model="resolution" :disabled="busy" type="radio" value="MERGE" />
              <span><strong>合并为新内容</strong><small>结合两条信息，生成更完整的记忆。</small></span>
            </label>
            <label v-if="resolution === 'MERGE'" class="merge-field"><span>合并后的记忆内容</span><textarea v-model="mergedValue" :disabled="busy" rows="3"></textarea></label>
            <label :class="{ selected: resolution === 'USE_NEITHER' }">
              <input v-model="resolution" :disabled="busy" type="radio" value="USE_NEITHER" />
              <span><strong>两条都不使用</strong><small>不将这两条信息纳入记忆。</small></span>
            </label>
            <label class="forget-option" :class="{ selected: resolution === 'FORGET' }">
              <input v-model="resolution" :disabled="busy" type="radio" value="FORGET" />
              <span><strong>遗忘相关内容</strong><small>不再主动使用并保留最小治理记录。</small></span>
            </label>
          </section>

          <footer class="resolution-actions">
            <button class="primary-action" type="button" :disabled="!resolution || busy || (resolution === 'MERGE' && !mergedValue.trim())" @click="submitResolution">
              {{ busy ? '正在更新…' : '确认并更新记忆' }}
            </button>
            <button type="button" :disabled="busy" @click="setTab('mine')">以后再处理</button>
            <small><ShieldCheck :size="15" />确认后，旧内容会保留在治理记录中，但不会继续用于回答。</small>
          </footer>
        </section>

        <section v-else-if="selectedInbox" class="inbox-generic-detail" aria-label="待处理记忆详情">
          <button class="mobile-back" type="button" @click="closeMobileDetail"><ArrowLeft :size="21" />返回</button>
          <h2>{{ selectedInbox.title }}</h2><p>{{ selectedInbox.description }}</p>
          <button v-if="selectedInbox.memory" class="primary-action" type="button" :disabled="busy" @click="openInboxRecord(selectedInbox.memory)">查看并纠正</button>
          <RouterLink v-else-if="selectedInbox.type === 'CANDIDATE'" class="primary-link" to="/">回到聊天确认</RouterLink>
          <button v-else-if="selectedInbox.purgeJob" class="primary-action" type="button" :disabled="busy" @click="retryPurge(selectedInbox.purgeJob)">重试删除</button>
        </section>
      </div>
    </template>

    <section v-else class="governance-history" aria-label="治理记录">
      <div v-if="!events.length" class="memory-empty"><Clock3 :size="28" /><strong>还没有记忆治理记录</strong></div>
      <article v-for="event in events" :key="event.eventId">
        <span class="history-icon"><Clock3 :size="17" /></span>
        <div><strong>{{ eventLabel(event) }}</strong><p>{{ event.subjectType === 'CONFLICT' ? '已决定以后如何使用这条信息' : '记忆状态已更新' }}</p></div>
        <time>{{ formatDate(event.createdAt) }}</time>
        <span class="history-result">已完成</span>
      </article>
    </section>

    <dialog
      v-if="correctionOpen"
      ref="correctionDialog"
      class="correction-dialog"
      aria-labelledby="correction-title"
      aria-modal="true"
      @cancel.prevent="closeCorrection()"
      @close="correctionOpen = false"
      @keydown="handleCorrectionKeydown"
    >
      <form method="dialog" @submit.prevent="saveCorrection">
        <header><div><h2 id="correction-title">纠正这条记忆</h2><p>保存后，Lyle 会在后续相关问题中使用新的内容。</p></div><button type="button" aria-label="关闭" :disabled="busy" @click="closeCorrection()"><X :size="19" /></button></header>
        <p v-if="correctionError" class="correction-error" role="alert">{{ correctionError }}</p>
        <label>以后 Lyle 会使用<textarea ref="correctionInput" v-model="correctionValue" :disabled="busy" rows="5"></textarea></label>
        <div class="correction-preview"><span>保存前预览</span><strong>{{ correctionValue || '请输入正确内容' }}</strong></div>
        <footer><button type="button" class="secondary-action" :disabled="busy" @click="closeCorrection()">取消</button><button type="submit" class="primary-action" :disabled="!correctionValue.trim() || busy">{{ busy ? '正在保存…' : '保存纠正' }}</button></footer>
      </form>
    </dialog>

    <ConfirmActionDialog
      :open="Boolean(confirmAction)"
      :title="confirmTitle()"
      :description="confirmDescription()"
      :confirm-label="confirmAction === 'PURGE' ? '永久删除' : confirmAction === 'FORGET' ? '确认遗忘' : confirmAction === 'RESTORE' ? '恢复使用' : '停用记忆'"
      :danger="confirmAction === 'PURGE' || confirmAction === 'FORGET'"
      :busy="busy"
      @update:open="!$event && (confirmAction = null)"
      @confirm="confirmGovernanceAction"
    />
  </div>
</template>

<style scoped>
.memory-workspace { width: 100%; max-width: 1180px; min-width: 0; gap: 18px; margin: 0 auto; border: 0; background: transparent; }
.memory-page-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 2px 0 8px; }
.memory-page-header h1 { margin: 0; color: var(--foreground); font-size: 28px; font-weight: 650; letter-spacing: -.025em; }
.memory-page-header p { margin: 7px 0 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.6; }
.memory-header-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.memory-header-actions button, .memory-header-actions a { white-space: nowrap; font-size: 13px; }
.memory-header-actions .primary-action { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; gap: 8px; border-radius: 8px; padding: 9px 14px; font-size: 14px; }
.refresh-action, .advanced-toggle { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; background: transparent; color: var(--muted-foreground); padding: 8px 10px; }
.advanced-toggle[aria-expanded='true'] { background: var(--primary-soft); color: var(--primary); }
.memory-tabs { display: flex; align-items: center; gap: 26px; min-height: 48px; border-bottom: 1px solid var(--border); padding: 0 2px; }
.memory-tabs button { position: relative; display: inline-flex; align-items: center; gap: 7px; min-height: 48px; border-radius: 0; background: transparent; color: var(--muted-foreground); padding: 10px 2px; font-size: 14px; font-weight: 600; white-space: nowrap; }
.memory-tabs button.active { color: var(--primary); border-bottom: 2px solid var(--primary); }
.tab-count { display: inline-grid; min-width: 1.3rem; height: 1.3rem; place-items: center; border-radius: 999px; background: var(--surface-muted); color: var(--foreground); padding: 0 .3rem; font-size: .7rem; }
.workspace-notice, .workspace-error { display: flex; align-items: center; justify-content: center; gap: .5rem; margin: 0; padding: .75rem 1rem; font-size: .83rem; }
.workspace-notice { background: var(--success-soft); color: var(--success-strong); }
.workspace-error { background: var(--danger-soft); color: var(--danger-strong); }
.workspace-error button { background: transparent; color: inherit; padding: .25rem .5rem; text-decoration: underline; }
.memory-columns { display: grid; align-items: start; min-width: 0; min-height: 480px; grid-template-columns: minmax(260px, .82fr) minmax(0, 1.45fr); border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.memory-list-pane { display: flex; min-width: 0; flex-direction: column; padding: 22px 16px; border-right: 1px solid var(--border); }
.memory-filter-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; margin-bottom: 16px; }
.memory-search, .memory-status-filter { display: flex; min-width: 0; align-items: center; gap: .45rem; border: 1px solid var(--input); border-radius: var(--radius-md); background: var(--surface); padding: 0 .7rem; color: var(--muted-foreground); }
.memory-search input, .memory-status-filter select { min-width: 0; border: 0; background: transparent; padding: .7rem .2rem; outline: none; }
.memory-status-filter select { cursor: pointer; }
.memory-list { overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-md); }
.memory-row { position: relative; display: grid; width: 100%; min-height: 90px; grid-template-columns: 2rem minmax(0, 1fr) auto; align-items: start; gap: .7rem; border-bottom: 1px solid var(--border); border-radius: 0; background: var(--surface); color: var(--muted-foreground); padding: 1rem .8rem; text-align: left; }
.memory-row:last-child { border-bottom: 0; }.memory-row:hover { background: var(--surface-muted); }.memory-row.selected { background: var(--primary-soft); }.memory-row.selected::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--primary); }
.memory-row-copy { display: grid; min-width: 0; gap: .25rem; }.memory-row-copy strong { overflow: hidden; color: var(--foreground); font-size: .9rem; text-overflow: ellipsis; white-space: nowrap; }.memory-row-copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; }.memory-row-copy small { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .8rem; margin-top: .25rem; color: var(--muted-foreground); font-size: .7rem; }
.reliability-dot { width: .45rem; height: .45rem; border-radius: 999px; background: var(--success); }.reliability-dot.review_required { background: var(--warning); }
.memory-count { margin: auto 0 0; padding: 1.2rem .3rem 0; color: var(--muted-foreground); font-size: .75rem; }
.memory-loading, .memory-empty { display: grid; min-height: 260px; place-content: center; justify-items: center; gap: .65rem; color: var(--muted-foreground); text-align: center; }.memory-loading svg, .detail-progress svg, .purge-progress.pending svg, .purge-progress.running svg, .purge-progress.retry svg { animation: spin 1s linear infinite; }.memory-empty strong { color: var(--foreground); }.memory-empty button, .memory-empty a { background: transparent; color: var(--primary); padding: .3rem; font-weight: 650; }
.memory-detail-pane { min-width: 0; padding: 24px 26px 28px; }.mobile-back { display: none; align-items: center; gap: .35rem; background: transparent; color: var(--foreground); padding: .45rem 0; }
.memory-detail-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; }.memory-detail-title, .memory-detail-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }.memory-detail-title strong { font-size: 1rem; }.memory-detail-actions button, .primary-action, .secondary-action, .icon-action { display: inline-flex; min-height: 42px; align-items: center; justify-content: center; gap: .45rem; }.primary-action { background: var(--primary); color: white; }.secondary-action { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); }.icon-action { width: 42px; border: 1px solid var(--border); background: var(--surface); color: var(--foreground); padding: 0; }
.current-memory-value { margin-top: 20px; border-bottom: 1px solid var(--border); padding: 8px 0 24px; }.current-memory-value > span, .detail-section h3 { color: var(--muted-foreground); font-size: .8rem; font-weight: 650; }.current-memory-value h2 { max-width: 880px; margin: 10px 0 14px; font-size: 25px; font-weight: 600; line-height: 1.5; letter-spacing: -.02em; overflow-wrap: anywhere; }.memory-badges { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; color: var(--muted-foreground); font-size: .78rem; }.reliability-badge, .status-badge { display: inline-flex; align-items: center; gap: .3rem; border-radius: 999px; background: var(--success-soft); color: var(--success-strong); padding: .28rem .55rem; font-weight: 700; }.reliability-badge.review_required { background: var(--warning-soft); color: var(--warning-strong); }.status-badge { background: var(--surface-muted); color: var(--muted-foreground); }
.detail-section { border-bottom: 1px solid var(--border); padding: 1.25rem 0; }.detail-section h3 { margin: 0 0 .85rem; }.detail-section > p { margin: 0; line-height: 1.7; }
.source-timeline { display: grid; }.source-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1rem; padding: .2rem 0 1.15rem 2.6rem; }.source-row::before { content: ''; position: absolute; top: .7rem; bottom: -.25rem; left: .48rem; width: 1px; background: var(--primary-border); }.source-row:last-child::before { display: none; }.source-node { position: absolute; top: .45rem; left: .12rem; width: .75rem; height: .75rem; border: 2px solid var(--primary); border-radius: 999px; background: var(--surface); }.source-copy { min-width: 0; }.source-meta { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem 1rem; font-size: .78rem; }.source-meta > span:last-child { color: var(--muted-foreground); }.source-relation { border-radius: .35rem; background: var(--primary-soft); color: var(--primary); padding: .25rem .45rem; font-weight: 700; }.source-copy p { margin: .65rem 0 0; color: var(--muted-foreground); font-size: .82rem; line-height: 1.6; }.source-copy .source-unavailable { color: var(--warning-strong); }.source-link { display: inline-flex; align-items: center; gap: .3rem; color: var(--primary); font-size: .78rem; font-weight: 700; }.source-empty { color: var(--muted-foreground); font-size: .82rem; }
.compact-history { display: grid; gap: .65rem; }.compact-history div { display: grid; grid-template-columns: auto 8rem 1fr; align-items: center; gap: .55rem; color: var(--muted-foreground); font-size: .8rem; }.advanced-memory-details { margin: 1rem 0; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); padding: .8rem 1rem; }.advanced-memory-details dl { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: .5rem; font-size: .78rem; }.advanced-memory-details dd { margin: 0; overflow-wrap: anywhere; }
.governance-zone { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding-top: 22px; }.governance-zone p { margin: .35rem 0 0; color: var(--muted-foreground); font-size: .78rem; }.governance-zone > div:last-child { display: flex; gap: .6rem; }.governance-zone button { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); }.governance-zone .danger-link { display: inline-flex; align-items: center; gap: .35rem; border-color: var(--danger-border); color: var(--danger-strong); }
.purge-progress { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: .75rem; margin-top: 1rem; border: 1px solid var(--warning-border); border-radius: var(--radius-md); background: var(--warning-soft); padding: .8rem 1rem; color: var(--warning-strong); }.purge-progress p { margin: .2rem 0 0; font-size: .75rem; }.purge-progress.succeeded { border-color: var(--success-border); background: var(--success-soft); color: var(--success-strong); }
.inbox-columns { display: grid; align-items: start; min-width: 0; grid-template-columns: minmax(240px, .72fr) minmax(0, 1.45fr); gap: 18px; }.inbox-queue { overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }.inbox-queue h2 { margin: 0; border-bottom: 1px solid var(--border); padding: 1rem; font-size: .9rem; }.inbox-queue button { display: grid; width: 100%; gap: .55rem; border-bottom: 1px solid var(--border); border-radius: 0; background: var(--surface); color: var(--foreground); padding: 1rem; text-align: left; }.inbox-queue button.selected { border-left: 3px solid var(--primary); background: var(--primary-soft); }.inbox-queue button span { width: max-content; border-radius: 999px; background: var(--warning-soft); color: var(--warning-strong); padding: .25rem .5rem; font-size: .7rem; }.inbox-queue button small { display: flex; align-items: center; gap: .35rem; color: var(--muted-foreground); }
.conflict-canvas, .inbox-generic-detail { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); padding: 1.3rem 1.6rem; }.conflict-canvas > header { display: flex; align-items: start; justify-content: space-between; gap: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }.conflict-canvas h2, .conflict-canvas h3 { margin: 0; }.conflict-canvas header p { margin: .4rem 0 0; color: var(--muted-foreground); }.conflict-canvas header > span { display: inline-flex; align-items: center; gap: .35rem; color: var(--warning-strong); font-size: .8rem; font-weight: 700; white-space: nowrap; }
.conflict-comparison { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; border-bottom: 1px solid var(--border); padding: 22px 0; }.conflict-comparison article:first-child { border-right: 1px solid var(--border); padding-right: 24px; }.conflict-comparison article > span { color: var(--muted-foreground); font-size: .78rem; }.conflict-comparison h3 { margin: .55rem 0 .75rem; font-size: 1.35rem; }.conflict-comparison blockquote { margin: 0 0 .75rem; border-radius: var(--radius-md); background: var(--surface-muted); padding: .7rem; color: var(--muted-foreground); font-size: .8rem; }.conflict-comparison article > div { display: flex; align-items: center; gap: .35rem; color: var(--muted-foreground); font-size: .75rem; }.comparison-swap { position: absolute; top: 50%; left: 50%; display: grid; width: 2rem; height: 2rem; translate: -50% -50%; place-items: center; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted-foreground); }
.resolution-section { padding: 1rem 0; }.resolution-section > h3 { margin-bottom: .4rem; font-size: 1rem; }.resolution-section > label { display: flex; min-height: 46px; align-items: start; gap: .65rem; border: 1px solid transparent; border-radius: var(--radius-md); padding: .4rem .65rem; cursor: pointer; }.resolution-section > label.selected { border-color: var(--primary-border); background: var(--primary-soft); }.resolution-section input { width: 1rem; margin-top: .2rem; accent-color: var(--primary); }.resolution-section label span { display: grid; gap: .1rem; }.resolution-section label strong { font-size: .86rem; }.resolution-section small { color: var(--muted-foreground); font-size: .75rem; }.resolution-preview, .merge-field { display: grid; gap: .35rem; margin: -.15rem .65rem .25rem 2.3rem; border-radius: var(--radius-md); background: var(--surface-muted); padding: .55rem .7rem; font-size: .75rem; }.merge-field textarea { min-height: 76px; }.forget-option strong { color: var(--danger-strong); }
.resolution-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; border-top: 1px solid var(--border); padding-top: 1rem; }.resolution-actions > button:nth-child(2) { background: transparent; color: var(--primary); }.resolution-actions small { display: flex; flex-basis: 100%; align-items: center; gap: .35rem; color: var(--muted-foreground); }.inbox-generic-detail h2 { margin-top: .5rem; }.inbox-generic-detail p { color: var(--muted-foreground); }.primary-link { display: inline-flex; border-radius: var(--radius-md); background: var(--primary); color: white; padding: .7rem 1rem; }
.governance-history { display: grid; align-content: start; gap: 0; padding: 6px 24px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }.governance-history article { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 1rem; border-bottom: 1px solid var(--border); padding: 1rem 0; }.history-icon { display: grid; width: 2.2rem; height: 2.2rem; place-items: center; border-radius: 999px; background: var(--primary-soft); color: var(--primary); }.governance-history p { margin: .2rem 0 0; color: var(--muted-foreground); font-size: .78rem; }.governance-history time { color: var(--muted-foreground); font-size: .78rem; }.history-result { border-radius: 999px; background: var(--success-soft); color: var(--success-strong); padding: .3rem .55rem; font-size: .72rem; font-weight: 700; }
.correction-dialog { position: fixed; inset: 0; z-index: 100; width: min(92vw, 520px); max-width: none; margin: auto; border: 0; border-radius: var(--radius-xl); background: transparent; padding: 0; color: var(--foreground); }.correction-dialog::backdrop { background: var(--backdrop); }.correction-dialog form { display: grid; gap: 1rem; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); padding: 1.3rem; }.correction-dialog header, .correction-dialog footer { display: flex; align-items: start; justify-content: space-between; gap: 1rem; }.correction-dialog h2 { margin: 0; }.correction-dialog p { margin: .35rem 0 0; color: var(--muted-foreground); }.correction-dialog header button { background: transparent; color: var(--muted-foreground); padding: .35rem; }.correction-dialog label { display: grid; gap: .5rem; font-size: .82rem; font-weight: 700; }.correction-dialog textarea { min-height: 120px; resize: vertical; }.correction-preview { display: grid; gap: .35rem; border-radius: var(--radius-md); background: var(--primary-soft); padding: .8rem; }.correction-preview span { color: var(--muted-foreground); font-size: .75rem; }.correction-dialog footer { justify-content: flex-end; }
@keyframes spin { to { transform: rotate(360deg); } }


.memory-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.memory-workspace--empty .memory-page-header { justify-content: flex-end; padding-bottom: 0; }
.memory-welcome { display: flex; flex-direction: column; align-items: center; padding: clamp(38px, 6vh, 76px) 20px 48px; text-align: center; }
.memory-welcome-icon { display: grid; width: 80px; height: 80px; place-items: center; border-radius: 20px; background: var(--primary-soft); color: var(--primary); }
.memory-welcome h2 { margin: 28px 0 14px; color: var(--foreground); font-size: 34px; font-weight: 650; letter-spacing: -.035em; line-height: 1.35; }
.memory-welcome > p { margin: 0; color: var(--muted-foreground); font-size: 18px; line-height: 1.75; }
.welcome-hint { margin: 18px 0 26px; color: var(--muted-foreground); font-size: 13px; line-height: 1.7; }
.memory-welcome > .primary-action { padding: 12px 20px; min-height: 46px; font-size: 14px; }
.memory-workspace a.primary-action { border-radius: 8px; text-decoration: none; }
.memory-capabilities { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 30px; border-top: 1px solid var(--border); padding: 30px 14px; }
.memory-capabilities article { display: flex; align-items: flex-start; gap: 13px; min-width: 0; }
.memory-capabilities article > span { display: grid; flex: 0 0 38px; height: 38px; place-items: center; border-radius: 10px; background: var(--primary-soft); color: var(--primary); }
.memory-capabilities h3 { margin: 1px 0 6px; color: var(--foreground); font-size: 14px; font-weight: 600; }
.memory-capabilities p { margin: 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.7; }
.schema-notice { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; background: var(--surface); color: var(--muted-foreground); font-size: 13px; line-height: 1.6; }
.schema-notice > span { flex: 1; min-width: 180px; }
.schema-notice button { background: transparent; color: var(--primary); padding: 4px 7px; font-size: 13px; }
.workspace-notice, .workspace-error { justify-content: flex-start; flex-wrap: wrap; border-radius: 10px; text-align: left; line-height: 1.6; }
.workspace-error button { flex-shrink: 0; }
.memory-columns--single { grid-template-columns: minmax(0, 1fr); min-height: 360px; }
.memory-columns--single .memory-list-pane { border-right: 0; }
.memory-columns--single .memory-filter-row { grid-template-columns: minmax(0, 1fr) minmax(130px, 180px); }
.memory-list-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 20px; }
.memory-list-heading h2 { margin: 0; color: var(--foreground); font-size: 16px; font-weight: 600; }
.memory-list-heading p { margin: 6px 0 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.6; }
.memory-list-heading > span { color: var(--muted-foreground); font-size: 12px; white-space: nowrap; }
.memory-list { border: 0; border-radius: 0; }
.memory-row { gap: 10px; border-bottom: 1px solid var(--border); padding: 16px 10px; }
.memory-row > svg:first-child { margin-top: 2px; color: var(--primary); }
.memory-row-copy strong { font-weight: 600; }
.memory-row-copy > span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; white-space: normal; line-height: 1.6; overflow-wrap: anywhere; }
.memory-row-copy small { line-height: 1.7; gap: 2px 7px; }
.row-status { color: var(--foreground); }
.memory-loading, .memory-load-error { min-height: 380px; }
.memory-empty { padding: 30px 20px; }
.memory-empty h2 { margin: 0; font-size: 21px; }
.memory-empty p { margin: 0; max-width: 420px; font-size: 14px; line-height: 1.7; }
.memory-workspace button:focus-visible, .memory-workspace a:focus-visible, .memory-workspace select:focus-visible, .memory-workspace textarea:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
.memory-search:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }
.memory-search input, .memory-status-filter select { width: 100%; }
.memory-detail-actions button { font-size: 13px; padding: 9px 12px; }
.detail-progress { display: flex; align-items: center; gap: 7px; margin-top: 16px; color: var(--muted-foreground); font-size: 12px; }
.detail-error { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 14px; border-radius: 8px; background: var(--danger-soft); color: var(--danger-strong); padding: 10px 12px; font-size: 13px; }
.detail-error button { background: transparent; color: inherit; padding: 3px; text-decoration: underline; }
.detail-section { padding: 22px 0; }
.detail-section > p, .source-copy p, .conflict-comparison h3, .conflict-comparison blockquote { overflow-wrap: anywhere; }
.source-row { gap: 12px; }
.source-link { align-self: start; }
.governance-zone > div:last-child { flex-wrap: wrap; }
.conflict-canvas > header { flex-wrap: wrap; }
.conflict-canvas header p { font-size: 14px; line-height: 1.7; }
.conflict-comparison h3 { font-size: 21px; line-height: 1.5; }
.resolution-section > .merge-field { display: grid; cursor: default; }
.merge-field textarea { width: 100%; }
.inbox-queue button strong { font-size: 14px; font-weight: 600; line-height: 1.6; overflow-wrap: anywhere; }
.inbox-queue button small { font-size: 12px; }
.inbox-generic-detail { min-height: 220px; }
.inbox-generic-detail > p { line-height: 1.7; }
.correction-dialog { max-height: 90dvh; overflow-y: auto; }
.correction-dialog .correction-error { color: var(--danger-strong); background: var(--danger-soft); border-radius: 8px; padding: 10px 12px; }
@media (max-width: 1179px) {
  .memory-columns { grid-template-columns: minmax(230px, .82fr) minmax(0, 1.35fr); }
  .memory-columns--single { grid-template-columns: minmax(0, 1fr); }
  .memory-detail-pane { padding: 22px 20px; }
  .source-row { grid-template-columns: minmax(0, 1fr); }
  .source-link { margin-top: -6px; }
  .memory-header-actions { gap: 4px; }
  .memory-page-header { align-items: flex-start; }
}
@media (max-width: 900px) {
  .memory-columns, .inbox-columns { display: block; min-height: 0; background: var(--surface); }
  .memory-list-pane { border-right: 0; padding: 22px 18px; }
  .memory-filter-row, .memory-columns--single .memory-filter-row { grid-template-columns: minmax(0, 1fr) 145px; }
  .memory-detail-pane, .conflict-canvas, .inbox-generic-detail { display: none; }
  .memory-columns.mobile-detail-open .memory-list-pane, .inbox-columns.mobile-detail-open .inbox-queue { display: none; }
  .memory-columns.mobile-detail-open .memory-detail-pane, .inbox-columns.mobile-detail-open .conflict-canvas, .inbox-columns.mobile-detail-open .inbox-generic-detail { display: block; padding: 18px; }
  .mobile-back { display: inline-flex; min-height: 42px; margin-bottom: 12px; }
  .memory-detail-header { align-items: flex-start; flex-direction: column; }
  .memory-detail-actions { width: 100%; }
  .memory-detail-actions .primary-action { flex: 1; }
  .inbox-queue { border: 0; border-radius: 12px; }
  .memory-capabilities { gap: 20px; padding: 26px 0; }
}
@media (max-width: 639px) {
  .memory-workspace { gap: 16px; }
  .memory-page-header { flex-direction: column; gap: 14px; }
  .memory-page-header h1 { font-size: 25px; }
  .memory-page-header p { font-size: 13px; }
  .memory-header-actions { width: 100%; justify-content: flex-start; gap: 4px; }
  .memory-header-actions .primary-action { margin-left: auto; }
  .memory-workspace--empty .memory-header-actions { justify-content: flex-end; }
  .memory-welcome { padding: 24px 8px 30px; }
  .memory-welcome-icon { width: 66px; height: 66px; border-radius: 17px; }
  .memory-welcome h2 { margin-top: 24px; font-size: 29px; }
  .memory-welcome > p { font-size: 16px; }
  .welcome-hint { max-width: 280px; font-size: 12px; }
  .memory-capabilities { grid-template-columns: 1fr; gap: 23px; padding: 25px 6px; }
  .memory-tabs { justify-content: space-between; gap: 8px; }
  .memory-tabs button { gap: 5px; font-size: 13px; }
  .memory-list-pane { padding: 18px 12px; }
  .memory-filter-row, .memory-columns--single .memory-filter-row { grid-template-columns: minmax(0, 1fr); }
  .memory-list-heading { margin-bottom: 16px; }
  .memory-row { grid-template-columns: 22px minmax(0, 1fr) 17px; padding: 15px 8px; }
  .memory-row-copy strong { white-space: normal; line-height: 1.5; }
  .memory-detail-actions { gap: 7px; }
  .memory-detail-actions .primary-action { min-width: 180px; }
  .current-memory-value h2 { font-size: 23px; }
  .compact-history div { grid-template-columns: auto minmax(0, 1fr); }
  .compact-history div > span:last-child { grid-column: 2; }
  .governance-zone { align-items: flex-start; flex-direction: column; }
  .governance-zone > div:last-child { width: 100%; }
  .governance-zone button { flex: 1; }
  .conflict-comparison { display: block; }
  .conflict-comparison article:first-child { border-right: 0; border-bottom: 1px solid var(--border); padding: 0 0 20px; }
  .conflict-comparison article:last-child { padding-top: 20px; }
  .comparison-swap { display: none; }
  .resolution-section > label { padding: 10px 7px; }
  .resolution-actions { gap: 10px; }
  .resolution-actions > button { width: 100%; }
  .governance-history { padding: 4px 16px; }
  .governance-history article { grid-template-columns: auto minmax(0, 1fr); gap: 10px; }
  .governance-history time, .history-result { grid-column: 2; }
  .history-result { width: fit-content; }
  .purge-progress { grid-template-columns: auto minmax(0, 1fr); }
  .purge-progress button { grid-column: 2; }
  .correction-dialog footer { flex-direction: column-reverse; }
  .correction-dialog footer button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .memory-loading svg, .detail-progress svg, .purge-progress svg { animation: none; } }
</style>
