<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { memoryReasonLabel as reasonLabel, memorySchemaLabel } from '@/domain/memory-presentation'
import type { MemorySchemaStatus } from '@/api/types'
import type { MemoryFact } from '@/api/types'
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  ExternalLink,
  Folder,
  Image,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plane,
  Power,
  RotateCcw,
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
  MemoryReliability,
  MemorySource
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
const detailLoading = ref(false)
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
let schemaPollTimer: number | undefined
let disposed = false

async function refreshSchemaStatus() {
  if (schemaPollTimer) window.clearTimeout(schemaPollTimer)
  try {
    const response = await getMemorySchemaStatus()
    if (disposed) return
    schemaStatus.value = response.data
    schemaError.value = ''
    if (['pending', 'building'].includes(response.data.status)) {
      schemaPollTimer = window.setTimeout(refreshSchemaStatus, 3000)
    }
  } catch {
    if (!disposed) schemaError.value = '暂时无法获取记忆整理状态'
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
const correctionDialog = ref<HTMLDialogElement | null>(null)
const correctionInput = ref<HTMLTextAreaElement | null>(null)
const confirmAction = ref<ConfirmAction>(null)
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
const currentRecord = computed(() => selectedRecord.value || filteredRecords.value[0] || null)
const currentSources = computed(() => currentRecord.value?.sources || [])
const currentFacts = computed(() => facts.value.filter(item => item.schemaPath === currentRecord.value?.schemaPath))

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
const mobileDetailOpen = computed(() => Boolean(route.query.memory || route.query.inbox))

onMounted(async () => {
  await refreshWorkspace()
  const memoryId = typeof route.query.memory === 'string' ? route.query.memory : ''
  const inboxId = typeof route.query.inbox === 'string' ? route.query.inbox : ''
  if (memoryId) {
    await selectRecordById(memoryId, false)
    if (route.query.action === 'correct' && currentRecord.value) openCorrection()
  }
  if (inboxId) selectInboxById(inboxId, false)
})

onBeforeUnmount(() => {
  disposed = true
  if (schemaPollTimer) window.clearTimeout(schemaPollTimer)
  if (purgePollTimer) window.clearTimeout(purgePollTimer)
})

async function refreshWorkspace(preserveSelection = true) {
  void refreshSchemaStatus()
  loading.value = true
  error.value = ''
  try {
    const [recordResponse, inboxResponse, eventResponse, factResponse] = await Promise.all([
      getMemoryRecords({ limit: 300 }),
      getMemoryInbox(),
      getMemoryGovernanceEvents(),
      getMemoryFacts().catch(() => null)
    ])
    facts.value = factResponse?.data.items || []
    migrationConflicts.value = factResponse?.data.migration.conflicts.length || 0
    unmappedMemories.value = factResponse?.data.migration.unmappedKeys?.length || 0
    factError.value = factResponse ? '' : '逐条事实暂不可用，请刷新后重试。'
    records.value = recordResponse.data.items
    inbox.value = inboxResponse.data.items
    events.value = eventResponse.data.items
    if (!preserveSelection || !selectedRecord.value) {
      selectedRecord.value = records.value[0] || null
    } else {
      const latest = records.value.find((item) => item.memoryId === selectedRecord.value?.memoryId)
      if (latest) selectedRecord.value = { ...selectedRecord.value, ...latest }
    }
    if (selectedRecord.value) await loadRecordDetail(selectedRecord.value.memoryId)
  } catch {
    error.value = '记忆暂时无法加载，请稍后重试。'
  } finally {
    loading.value = false
  }
}

async function loadRecordDetail(memoryId: string) {
  detailLoading.value = true
  try {
    const response = await getMemoryRecord(memoryId)
    selectedRecord.value = response.data
  } catch {
    error.value = '已加载记忆，部分来源暂不可用。'
  } finally {
    detailLoading.value = false
  }
}

async function selectRecord(record: MemoryRecord, updateRoute = true) {
  selectedRecord.value = record
  selectedInbox.value = null
  if (updateRoute) {
    await router.replace({ query: { memory: record.memoryId } })
  }
  await loadRecordDetail(record.memoryId)
}

async function selectRecordById(memoryId: string, updateRoute = true) {
  const record = records.value.find((item) => item.memoryId === memoryId)
  if (record) await selectRecord(record, updateRoute)
}

async function selectInboxItem(item: MemoryInboxItem, updateRoute = true) {
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
  await router.replace({ query: {} })
}

async function setTab(tab: WorkspaceTab) {
  activeTab.value = tab
  selectedInbox.value = null
  if (tab === 'inbox' && inbox.value.length) await selectInboxItem(inbox.value[0], false)
  if (tab === 'mine' && records.value.length) selectedRecord.value = records.value[0]
  await router.replace({ query: {} })
}

function openCorrection() {
  if (!currentRecord.value) return
  correctionValue.value = currentRecord.value.rawValue || currentRecord.value.value
  correctionRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  correctionOpen.value = true
  void nextTick(() => {
    const dialog = correctionDialog.value
    if (dialog && !dialog.open) dialog.showModal()
    correctionInput.value?.focus()
  })
}

function closeCorrection() {
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
  const record = currentRecord.value
  const value = correctionValue.value.trim()
  if (!record || !value || busy.value) return
  busy.value = true
  try {
    const response = await correctMemoryRecord(record.memoryId, value)
    selectedRecord.value = response.data.memory
    closeCorrection()
    notice.value = '记忆已纠正，旧内容不会再进入后续回答。'
    await refreshWorkspace()
  } catch {
    error.value = '记忆纠正失败，请稍后重试。'
  } finally {
    busy.value = false
  }
}

async function confirmGovernanceAction() {
  const action = confirmAction.value
  const record = currentRecord.value
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
      selectedRecord.value = response.data.memory
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
  if (purgePollTimer) window.clearTimeout(purgePollTimer)
  purgePollTimer = window.setTimeout(async () => {
    try {
      const response = await getMemoryPurgeJob(jobId)
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
      // The page keeps the last known progress and retries on the next manual refresh.
    }
  }, 1500)
}

async function retryPurge(job: MemoryPurgeJob) {
  busy.value = true
  try {
    const response = await retryMemoryPurgeJob(job.jobId)
    activePurgeJob.value = response.data
    schedulePurgePoll(job.jobId)
  } finally {
    busy.value = false
  }
}

async function submitResolution() {
  const conflict = selectedConflict.value
  if (!conflict || !resolution.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await resolveMemoryConflict(conflict, resolution.value, mergedValue.value.trim())
    notice.value = '已更新记忆，旧内容会保留在治理记录中。'
    await refreshWorkspace(false)
    activeTab.value = 'mine'
    await router.replace({ query: {} })
  } catch (caught: any) {
    if (caught?.response?.status === 409) {
      error.value = '这条记忆已经更新，已为你刷新最新内容。'
      await refreshWorkspace(false)
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
    :class="{ 'mobile-subpage-open': mobileDetailOpen }"
    data-testid="v66-memory-workspace"
  >
    <header class="memory-page-header">
      <div>
        <h1>记忆</h1>
        <p>{{ activeTab === 'inbox' ? '核对有疑问的信息，决定以后如何使用' : '查看 Lyle 记住了什么，以及这些信息来自哪里' }}</p>
      </div>
      <button class="advanced-toggle" type="button" @click="advancedMode = !advancedMode">
        {{ advancedMode ? '退出高级模式' : '高级模式' }}
      </button>
    </header>

    <div v-if="schemaStatus || schemaError" class="workspace-notice" role="status">
      <span>{{ schemaError || (schemaStatus && memorySchemaLabel(schemaStatus)) }}</span>
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

    <nav class="memory-tabs" aria-label="记忆页面">
      <button :class="{ active: activeTab === 'mine' }" type="button" @click="setTab('mine')">我的记忆</button>
      <button :class="{ active: activeTab === 'inbox' }" type="button" @click="setTab('inbox')">
        待我处理 <span v-if="inbox.length" class="tab-count">{{ inbox.length }}</span>
      </button>
      <button :class="{ active: activeTab === 'history' }" type="button" @click="setTab('history')">治理记录</button>
    </nav>

    <p v-if="notice" class="workspace-notice" role="status"><CheckCircle2 :size="17" />{{ notice }}</p>
    <div v-if="error" class="workspace-error" role="alert">
      <span>{{ error }}</span><button type="button" @click="refreshWorkspace()">重试</button>
    </div>

    <template v-if="activeTab === 'mine'">
      <div class="memory-columns" :class="{ 'mobile-detail-open': mobileDetailOpen }">
        <section class="memory-list-pane" aria-label="记忆列表">
          <div class="memory-filter-row">
            <label class="memory-search">
              <Search :size="19" aria-hidden="true" />
              <input v-model="query" type="search" placeholder="搜索记忆" aria-label="搜索记忆" />
            </label>
            <label class="memory-status-filter">
              <SlidersHorizontal :size="18" aria-hidden="true" />
              <select v-model="statusFilter" aria-label="筛选记忆状态">
                <option value="">全部状态</option>
                <option value="ACTIVE">可用</option>
                <option value="CONFLICTED">需核对</option>
                <option value="DISABLED">已停用</option>
                <option value="FORGOTTEN">已遗忘</option>
              </select>
            </label>
          </div>

          <div v-if="loading" class="memory-loading"><LoaderCircle :size="20" />正在加载记忆…</div>
          <div v-else-if="!filteredRecords.length" class="memory-empty">
            <BrainCircuit :size="28" /><strong>{{ records.length ? '没有找到相关记忆' : 'Lyle 还没有保存长期记忆' }}</strong>
            <button v-if="query" type="button" @click="query = ''; statusFilter = ''">清除搜索</button>
            <RouterLink v-else to="/chat">去聊天</RouterLink>
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
              @click="selectRecord(record)"
            >
              <component :is="memoryIcon(record.schemaPath)" :size="23" :stroke-width="1.7" aria-hidden="true" />
              <span class="memory-row-copy">
                <strong>{{ record.title }}</strong>
                <span>{{ record.value }}</span>
                <small>
                  <span class="reliability-dot" :class="record.reliability.toLowerCase()"></span>
                  {{ reliabilityLabel(record.reliability) }}
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
              <button class="primary-action" type="button" @click="openCorrection"><Pencil :size="17" />纠正这条记忆</button>
              <button
                v-if="currentRecord.allowedActions.includes('DISABLE')"
                class="secondary-action"
                type="button"
                @click="confirmAction = 'DISABLE'"
              ><Power :size="17" />停用</button>
              <button
                v-if="currentRecord.allowedActions.includes('RESTORE')"
                class="secondary-action"
                type="button"
                @click="confirmAction = 'RESTORE'"
              ><RotateCcw :size="17" />恢复</button>
              <button class="icon-action" type="button" aria-label="更多治理操作" @click="confirmAction = 'FORGET'">
                <MoreHorizontal :size="19" />
              </button>
            </div>
          </header>

          <div v-if="detailLoading" class="detail-progress"><LoaderCircle :size="18" />正在加载来源…</div>
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
                <RouterLink v-if="source.link" :to="source.link" class="source-link">
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
              <strong>记忆治理</strong>
              <p>停用可恢复；遗忘默认不恢复；永久删除会清理关联存储。</p>
            </div>
            <div>
              <button v-if="currentRecord.allowedActions.includes('FORGET')" type="button" @click="confirmAction = 'FORGET'">遗忘</button>
              <button class="danger-link" type="button" @click="confirmAction = 'PURGE'"><Trash2 :size="16" />永久删除</button>
            </div>
          </section>

          <section v-if="activePurgeJob?.memoryId === currentRecord.memoryId" class="purge-progress" :class="activePurgeJob.status.toLowerCase()">
            <LoaderCircle v-if="['PENDING', 'RUNNING', 'RETRY'].includes(activePurgeJob.status)" :size="19" />
            <AlertTriangle v-else-if="activePurgeJob.status === 'FAILED'" :size="19" />
            <CheckCircle2 v-else :size="19" />
            <div><strong>{{ activePurgeJob.status === 'SUCCEEDED' ? '已永久删除' : activePurgeJob.status === 'FAILED' ? '删除未完成' : '正在清理这条记忆' }}</strong><p>结构化内容、来源、向量与缓存会一致收敛。</p></div>
            <button v-if="activePurgeJob.status === 'FAILED'" type="button" @click="retryPurge(activePurgeJob)">重试</button>
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
            :class="{ selected: selectedInbox?.inboxId === item.inboxId }"
            @click="selectInboxItem(item)"
          >
            <strong>{{ item.title }}</strong>
            <span :class="item.type.toLowerCase()">{{ item.type === 'CONFLICT' ? '信息不一致' : item.type === 'LOW_RELIABILITY' ? '可靠性较低' : item.type === 'PURGE_FAILED' ? '删除未完成' : '待确认' }}</span>
            <small><Clock3 :size="14" />{{ formatDate(item.createdAt) }}</small>
          </button>
        </aside>

        <main v-if="selectedConflict" class="conflict-canvas" data-testid="v66-conflict-canvas">
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
              <input v-model="resolution" type="radio" value="USE_CANDIDATE" />
              <span><strong>使用新的表达</strong><small>采用新的表达，替代旧的记忆。</small></span>
            </label>
            <div v-if="resolution === 'USE_CANDIDATE'" class="resolution-preview">预览将被记住的内容<strong>{{ selectedConflict.candidate?.value }}</strong></div>
            <label :class="{ selected: resolution === 'KEEP_CURRENT' }">
              <input v-model="resolution" type="radio" value="KEEP_CURRENT" />
              <span><strong>保留原来的记忆</strong><small>保持原来的记忆，忽略新的表达。</small></span>
            </label>
            <label :class="{ selected: resolution === 'MERGE' }">
              <input v-model="resolution" type="radio" value="MERGE" />
              <span><strong>合并为新内容</strong><small>结合两条信息，生成更完整的记忆。</small></span>
            </label>
            <div v-if="resolution === 'MERGE'" class="merge-field"><span>预览将被记住的内容</span><textarea v-model="mergedValue" rows="3"></textarea></div>
            <label :class="{ selected: resolution === 'USE_NEITHER' }">
              <input v-model="resolution" type="radio" value="USE_NEITHER" />
              <span><strong>两条都不使用</strong><small>不将这两条信息纳入记忆。</small></span>
            </label>
            <label class="forget-option" :class="{ selected: resolution === 'FORGET' }">
              <input v-model="resolution" type="radio" value="FORGET" />
              <span><strong>遗忘相关内容</strong><small>不再主动使用并保留最小治理记录。</small></span>
            </label>
          </section>

          <footer class="resolution-actions">
            <button class="primary-action" type="button" :disabled="!resolution || busy" @click="submitResolution">
              {{ busy ? '正在更新…' : '确认并更新记忆' }}
            </button>
            <button type="button" @click="closeMobileDetail">以后再处理</button>
            <small><ShieldCheck :size="15" />确认后，旧内容会保留在治理记录中，但不会继续用于回答。</small>
          </footer>
        </main>

        <main v-else-if="selectedInbox" class="inbox-generic-detail">
          <button class="mobile-back" type="button" @click="closeMobileDetail"><ArrowLeft :size="21" />返回</button>
          <h2>{{ selectedInbox.title }}</h2><p>{{ selectedInbox.description }}</p>
          <button v-if="selectedInbox.memory" class="primary-action" type="button" @click="selectRecord(selectedInbox.memory); setTab('mine')">查看并纠正</button>
          <RouterLink v-else-if="selectedInbox.type === 'CANDIDATE'" class="primary-link" to="/chat">回到聊天确认</RouterLink>
          <button v-else-if="selectedInbox.purgeJob" class="primary-action" type="button" @click="retryPurge(selectedInbox.purgeJob)">重试删除</button>
        </main>
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
      @cancel.prevent="closeCorrection"
      @close="correctionOpen = false"
      @keydown="handleCorrectionKeydown"
    >
      <form method="dialog" @submit.prevent="saveCorrection">
        <header><div><h2 id="correction-title">纠正这条记忆</h2><p>保存后，Lyle 会在后续相关问题中使用新的内容。</p></div><button type="button" aria-label="关闭" @click="closeCorrection"><X :size="19" /></button></header>
        <label>以后 Lyle 会使用<textarea ref="correctionInput" v-model="correctionValue" rows="5"></textarea></label>
        <div class="correction-preview"><span>保存前预览</span><strong>{{ correctionValue || '请输入正确内容' }}</strong></div>
        <footer><button type="button" class="secondary-action" @click="closeCorrection">取消</button><button type="submit" class="primary-action" :disabled="!correctionValue.trim() || busy">{{ busy ? '正在保存…' : '保存纠正' }}</button></footer>
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
.memory-workspace { gap: 0; min-height: calc(100dvh - var(--lyle-header-height) - 3rem); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); overflow: hidden; }
.memory-page-header { display: flex; align-items: end; justify-content: space-between; gap: 1rem; padding: 1.4rem 1.65rem 1rem; }
.memory-page-header h1 { margin: 0; font-size: 1.75rem; letter-spacing: -.03em; }
.memory-page-header p { margin: .35rem 0 0; color: var(--muted-foreground); }
.advanced-toggle { background: transparent; color: var(--muted-foreground); padding: .55rem .7rem; font-size: .78rem; }
.memory-tabs { display: flex; gap: 1.8rem; min-height: 3.25rem; border-bottom: 1px solid var(--border); padding: 0 1.65rem; }
.memory-tabs button { position: relative; display: inline-flex; align-items: center; gap: .5rem; border-radius: 0; background: transparent; color: var(--muted-foreground); padding: .8rem .15rem; font-weight: 650; white-space: nowrap; }
.memory-tabs button.active { color: var(--primary); }
.memory-tabs button.active::after { content: ''; position: absolute; right: 0; bottom: -1px; left: 0; height: 3px; border-radius: 3px 3px 0 0; background: var(--primary); }
.tab-count { display: inline-grid; min-width: 1.3rem; height: 1.3rem; place-items: center; border-radius: 999px; background: var(--surface-muted); color: var(--foreground); padding: 0 .3rem; font-size: .7rem; }
.workspace-notice, .workspace-error { display: flex; align-items: center; justify-content: center; gap: .5rem; margin: 0; padding: .75rem 1rem; font-size: .83rem; }
.workspace-notice { background: var(--success-soft); color: var(--success-strong); }
.workspace-error { background: var(--danger-soft); color: var(--danger-strong); }
.workspace-error button { background: transparent; color: inherit; padding: .25rem .5rem; text-decoration: underline; }
.memory-columns { display: grid; min-height: 670px; grid-template-columns: minmax(340px, 410px) minmax(520px, 1fr); }
.memory-list-pane { display: flex; min-width: 0; flex-direction: column; border-right: 1px solid var(--border); padding: 1.2rem 1rem 1rem; }
.memory-filter-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, 145px); gap: .65rem; margin-bottom: 1rem; }
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
.memory-detail-pane { min-width: 0; padding: 1.35rem 1.6rem 1.8rem; }.mobile-back { display: none; align-items: center; gap: .35rem; background: transparent; color: var(--foreground); padding: .45rem 0; }
.memory-detail-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }.memory-detail-title, .memory-detail-actions { display: flex; align-items: center; gap: .6rem; }.memory-detail-title strong { font-size: 1rem; }.memory-detail-actions button, .primary-action, .secondary-action, .icon-action { display: inline-flex; min-height: 42px; align-items: center; justify-content: center; gap: .45rem; }.primary-action { background: var(--primary); color: white; }.secondary-action { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); }.icon-action { width: 42px; border: 1px solid var(--border); background: var(--surface); color: var(--foreground); padding: 0; }
.current-memory-value { margin-top: 1.4rem; border-bottom: 1px solid var(--border); padding: 1rem 0 1.45rem; }.current-memory-value > span, .detail-section h3 { color: var(--muted-foreground); font-size: .8rem; font-weight: 650; }.current-memory-value h2 { max-width: 880px; margin: .65rem 0 .85rem; font-size: clamp(1.6rem, 2.4vw, 2rem); line-height: 1.3; letter-spacing: -.03em; }.memory-badges { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; color: var(--muted-foreground); font-size: .78rem; }.reliability-badge, .status-badge { display: inline-flex; align-items: center; gap: .3rem; border-radius: 999px; background: var(--success-soft); color: var(--success-strong); padding: .28rem .55rem; font-weight: 700; }.reliability-badge.review_required { background: var(--warning-soft); color: var(--warning-strong); }.status-badge { background: var(--surface-muted); color: var(--muted-foreground); }
.detail-section { border-bottom: 1px solid var(--border); padding: 1.25rem 0; }.detail-section h3 { margin: 0 0 .85rem; }.detail-section > p { margin: 0; line-height: 1.7; }
.source-timeline { display: grid; }.source-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1rem; padding: .2rem 0 1.15rem 2.6rem; }.source-row::before { content: ''; position: absolute; top: .7rem; bottom: -.25rem; left: .48rem; width: 1px; background: var(--primary-border); }.source-row:last-child::before { display: none; }.source-node { position: absolute; top: .45rem; left: .12rem; width: .75rem; height: .75rem; border: 2px solid var(--primary); border-radius: 999px; background: var(--surface); }.source-copy { min-width: 0; }.source-meta { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem 1rem; font-size: .78rem; }.source-meta > span:last-child { color: var(--muted-foreground); }.source-relation { border-radius: .35rem; background: var(--primary-soft); color: var(--primary); padding: .25rem .45rem; font-weight: 700; }.source-copy p { margin: .65rem 0 0; color: var(--muted-foreground); font-size: .82rem; line-height: 1.6; }.source-copy .source-unavailable { color: var(--warning-strong); }.source-link { display: inline-flex; align-items: center; gap: .3rem; color: var(--primary); font-size: .78rem; font-weight: 700; }.source-empty { color: var(--muted-foreground); font-size: .82rem; }
.compact-history { display: grid; gap: .65rem; }.compact-history div { display: grid; grid-template-columns: auto 8rem 1fr; align-items: center; gap: .55rem; color: var(--muted-foreground); font-size: .8rem; }.advanced-memory-details { margin: 1rem 0; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); padding: .8rem 1rem; }.advanced-memory-details dl { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: .5rem; font-size: .78rem; }.advanced-memory-details dd { margin: 0; overflow-wrap: anywhere; }
.governance-zone { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-top: 1.25rem; }.governance-zone p { margin: .35rem 0 0; color: var(--muted-foreground); font-size: .78rem; }.governance-zone > div:last-child { display: flex; gap: .6rem; }.governance-zone button { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); }.governance-zone .danger-link { display: inline-flex; align-items: center; gap: .35rem; border-color: var(--danger-border); color: var(--danger-strong); }
.purge-progress { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: .75rem; margin-top: 1rem; border: 1px solid var(--warning-border); border-radius: var(--radius-md); background: var(--warning-soft); padding: .8rem 1rem; color: var(--warning-strong); }.purge-progress p { margin: .2rem 0 0; font-size: .75rem; }.purge-progress.succeeded { border-color: var(--success-border); background: var(--success-soft); color: var(--success-strong); }
.inbox-columns { display: grid; min-height: 670px; grid-template-columns: 320px minmax(0, 1fr); gap: 1rem; background: var(--background); padding: 1rem; }.inbox-queue { overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }.inbox-queue h2 { margin: 0; border-bottom: 1px solid var(--border); padding: 1rem; font-size: .9rem; }.inbox-queue button { display: grid; width: 100%; gap: .55rem; border-bottom: 1px solid var(--border); border-radius: 0; background: var(--surface); color: var(--foreground); padding: 1rem; text-align: left; }.inbox-queue button.selected { border-left: 3px solid var(--primary); background: var(--primary-soft); }.inbox-queue button span { width: max-content; border-radius: 999px; background: var(--warning-soft); color: var(--warning-strong); padding: .25rem .5rem; font-size: .7rem; }.inbox-queue button small { display: flex; align-items: center; gap: .35rem; color: var(--muted-foreground); }
.conflict-canvas, .inbox-generic-detail { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); padding: 1.3rem 1.6rem; }.conflict-canvas > header { display: flex; align-items: start; justify-content: space-between; gap: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }.conflict-canvas h2, .conflict-canvas h3 { margin: 0; }.conflict-canvas header p { margin: .4rem 0 0; color: var(--muted-foreground); }.conflict-canvas header > span { display: inline-flex; align-items: center; gap: .35rem; color: var(--warning-strong); font-size: .8rem; font-weight: 700; white-space: nowrap; }
.conflict-comparison { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; border-bottom: 1px solid var(--border); padding: 1.1rem 0; }.conflict-comparison article:first-child { border-right: 1px solid var(--border); padding-right: 3rem; }.conflict-comparison article > span { color: var(--muted-foreground); font-size: .78rem; }.conflict-comparison h3 { margin: .55rem 0 .75rem; font-size: 1.35rem; }.conflict-comparison blockquote { margin: 0 0 .75rem; border-radius: var(--radius-md); background: var(--surface-muted); padding: .7rem; color: var(--muted-foreground); font-size: .8rem; }.conflict-comparison article > div { display: flex; align-items: center; gap: .35rem; color: var(--muted-foreground); font-size: .75rem; }.comparison-swap { position: absolute; top: 50%; left: 50%; display: grid; width: 2rem; height: 2rem; translate: -50% -50%; place-items: center; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted-foreground); }
.resolution-section { padding: 1rem 0; }.resolution-section > h3 { margin-bottom: .4rem; font-size: 1rem; }.resolution-section > label { display: flex; min-height: 46px; align-items: start; gap: .65rem; border: 1px solid transparent; border-radius: var(--radius-md); padding: .4rem .65rem; cursor: pointer; }.resolution-section > label.selected { border-color: var(--primary-border); background: var(--primary-soft); }.resolution-section input { width: 1rem; margin-top: .2rem; accent-color: var(--primary); }.resolution-section label span { display: grid; gap: .1rem; }.resolution-section label strong { font-size: .86rem; }.resolution-section small { color: var(--muted-foreground); font-size: .75rem; }.resolution-preview, .merge-field { display: grid; gap: .35rem; margin: -.15rem .65rem .25rem 2.3rem; border-radius: var(--radius-md); background: var(--surface-muted); padding: .55rem .7rem; font-size: .75rem; }.merge-field textarea { min-height: 76px; }.forget-option strong { color: var(--danger-strong); }
.resolution-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; border-top: 1px solid var(--border); padding-top: 1rem; }.resolution-actions > button:nth-child(2) { background: transparent; color: var(--primary); }.resolution-actions small { display: flex; flex-basis: 100%; align-items: center; gap: .35rem; color: var(--muted-foreground); }.inbox-generic-detail h2 { margin-top: .5rem; }.inbox-generic-detail p { color: var(--muted-foreground); }.primary-link { display: inline-flex; border-radius: var(--radius-md); background: var(--primary); color: white; padding: .7rem 1rem; }
.governance-history { display: grid; gap: 0; min-height: 560px; padding: 1rem 1.5rem; }.governance-history article { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 1rem; border-bottom: 1px solid var(--border); padding: 1rem 0; }.history-icon { display: grid; width: 2.2rem; height: 2.2rem; place-items: center; border-radius: 999px; background: var(--primary-soft); color: var(--primary); }.governance-history p { margin: .2rem 0 0; color: var(--muted-foreground); font-size: .78rem; }.governance-history time { color: var(--muted-foreground); font-size: .78rem; }.history-result { border-radius: 999px; background: var(--success-soft); color: var(--success-strong); padding: .3rem .55rem; font-size: .72rem; font-weight: 700; }
.correction-dialog { position: fixed; inset: 0; z-index: 100; width: min(92vw, 520px); max-width: none; margin: auto; border: 0; border-radius: var(--radius-xl); background: transparent; padding: 0; color: var(--foreground); }.correction-dialog::backdrop { background: var(--backdrop); }.correction-dialog form { display: grid; gap: 1rem; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); padding: 1.3rem; }.correction-dialog header, .correction-dialog footer { display: flex; align-items: start; justify-content: space-between; gap: 1rem; }.correction-dialog h2 { margin: 0; }.correction-dialog p { margin: .35rem 0 0; color: var(--muted-foreground); }.correction-dialog header button { background: transparent; color: var(--muted-foreground); padding: .35rem; }.correction-dialog label { display: grid; gap: .5rem; font-size: .82rem; font-weight: 700; }.correction-dialog textarea { min-height: 120px; resize: vertical; }.correction-preview { display: grid; gap: .35rem; border-radius: var(--radius-md); background: var(--primary-soft); padding: .8rem; }.correction-preview span { color: var(--muted-foreground); font-size: .75rem; }.correction-dialog footer { justify-content: flex-end; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1179px) {
  .memory-columns { grid-template-columns: minmax(300px, 350px) minmax(450px, 1fr); }
  .memory-detail-actions .secondary-action { display: none; }
}
@media (max-width: 767px) {
  .memory-workspace { min-height: calc(100dvh - var(--lyle-header-height)); border: 0; border-radius: 0; margin: calc(var(--lyle-space-4) * -1); overflow: visible; }
  .memory-workspace.mobile-subpage-open > .memory-page-header,
  .memory-workspace.mobile-subpage-open > .memory-tabs { display: none; }
  .memory-page-header { padding: .7rem 1.2rem .45rem; }.memory-page-header h1 { display: none; }.memory-page-header p { margin: 0; font-size: .78rem; }.advanced-toggle { display: none; }
  .memory-tabs { gap: 0; justify-content: space-between; padding: 0 1.15rem; }.memory-tabs button { min-width: max-content; padding: .8rem .1rem; font-size: .82rem; }
  .memory-columns, .inbox-columns { display: block; min-height: auto; padding: 0; background: var(--surface); }.memory-list-pane { min-height: calc(100dvh - 180px); border-right: 0; padding: 1rem .9rem; }.memory-filter-row { grid-template-columns: minmax(0, 1fr) 132px; }.memory-list { border-radius: var(--radius-md); }.memory-row { min-height: 104px; padding: 1rem .8rem; }.memory-count { padding-bottom: 1rem; }
  .memory-detail-pane, .conflict-canvas, .inbox-generic-detail { display: none; }.memory-columns.mobile-detail-open .memory-list-pane, .inbox-columns.mobile-detail-open .inbox-queue { display: none; }.memory-columns.mobile-detail-open .memory-detail-pane, .inbox-columns.mobile-detail-open .conflict-canvas, .inbox-columns.mobile-detail-open .inbox-generic-detail { display: block; min-height: calc(100dvh - var(--lyle-header-height)); border: 0; border-radius: 0; padding: .65rem 1.2rem 1.5rem; }.mobile-back { display: inline-flex; }
  .memory-detail-header { align-items: start; }.memory-detail-title { margin-top: .7rem; }.memory-detail-actions { position: fixed; z-index: 20; right: 0; bottom: 0; left: 0; border-top: 1px solid var(--border); background: var(--surface); padding: .7rem 1rem calc(.7rem + env(safe-area-inset-bottom)); }.memory-detail-actions .primary-action { width: 100%; }.memory-detail-actions .secondary-action, .memory-detail-actions .icon-action { display: none; }.memory-detail-pane { padding-bottom: 5rem !important; }.current-memory-value h2 { font-size: 1.55rem; }.source-row { grid-template-columns: 1fr; padding-left: 2rem; }.source-link { margin-top: -.4rem; }.governance-zone { align-items: start; flex-direction: column; }.governance-zone > div:last-child { width: 100%; }.governance-zone button { flex: 1; }.compact-history div { grid-template-columns: auto 6rem 1fr; }
  .inbox-queue { min-height: calc(100dvh - 180px); border: 0; border-radius: 0; padding: .9rem; }.inbox-queue h2 { border: 1px solid var(--border); border-radius: var(--radius-md) var(--radius-md) 0 0; }.inbox-queue button { border-right: 1px solid var(--border); border-left: 1px solid var(--border); }.inbox-queue button:last-child { border-radius: 0 0 var(--radius-md) var(--radius-md); }
  .conflict-canvas > header { align-items: start; flex-direction: column; gap: .55rem; padding-bottom: .9rem; }.conflict-canvas header p { margin-top: .3rem; font-size: .82rem; line-height: 1.55; }.conflict-comparison { display: block; padding: .9rem 0; }.conflict-comparison article:first-child { border-right: 0; border-bottom: 1px solid var(--border); padding: 0 0 .9rem; }.conflict-comparison article:last-child { padding-top: .9rem; }.comparison-swap { top: 50%; left: 50%; }.conflict-comparison h3 { margin: .45rem 0 .65rem; font-size: 1.2rem; }.conflict-comparison blockquote { margin-bottom: .65rem; padding: .65rem .75rem; }.resolution-section { padding: 1rem 0 .35rem; }.resolution-section > h3 { margin-bottom: .35rem; }.resolution-section > label { min-height: 52px; border-bottom: 1px solid var(--border); border-radius: 0; padding: .55rem .45rem; }.resolution-section > label.selected { border: 1px solid var(--primary-border); border-radius: var(--radius-md); }.resolution-preview, .merge-field { margin-left: 2.1rem; }.resolution-actions { position: sticky; bottom: 0; z-index: 10; margin: 0 -1.2rem -1.5rem; background: var(--surface); padding: .65rem 1.2rem calc(.7rem + env(safe-area-inset-bottom)); }.resolution-actions .primary-action { width: 100%; }.resolution-actions > button:nth-child(2) { width: 100%; }.resolution-actions small { font-size: .7rem; }
  .governance-history { padding: .6rem 1rem; }.governance-history article { grid-template-columns: auto minmax(0, 1fr); }.governance-history time, .history-result { grid-column: 2; }.correction-dialog footer { flex-direction: column-reverse; }.correction-dialog footer button { width: 100%; }
}
@media (max-width: 639px) {
  .memory-workspace { margin: calc(var(--lyle-space-3) * -1); }
}
@media (prefers-reduced-motion: reduce) { .memory-loading svg, .detail-progress svg, .purge-progress svg { animation: none; } }
</style>
