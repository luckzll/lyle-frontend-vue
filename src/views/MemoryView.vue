<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  changeFragmentStatus,
  changeProfileStatus,
  changeStructuredMemoryStatus,
  deleteStructuredMemory,
  getCurrentMemory,
  getProfileEvidence,
  getStructuredMemoryHistory,
  getStructuredMemoryMergeSuggestions,
  listConversations,
  purgeStructuredMemory,
  saveStructuredMemory
} from '@/api/app'
import type {
  Conversation,
  MemoryItem,
  MemorySnapshot,
  StructuredMemoryHistoryItem,
  StructuredMemoryMergeSuggestion
} from '@/api/types'
import ConfirmActionDialog from '@/components/feedback/ConfirmActionDialog.vue'

type PendingForget =
  | { kind: 'profile'; schemaPath: string; label: string }
  | { kind: 'fragment'; id: number; label: string }

const conversations = ref<Conversation[]>([])
const conversationId = ref('')
const loading = ref(false)
const error = ref('')
const notice = ref('')
const activeTab = ref<'profiles' | 'fragments' | 'evidence' | 'governance'>('profiles')
const memoryKey = ref('')
const memoryValue = ref('')
const memoryConfidence = ref(1)
const memorySource = ref('manual')
const selectedStructuredKey = ref('')
const selectedProfileId = ref<number | null>(null)
const structuredHistory = ref<StructuredMemoryHistoryItem[]>([])
const mergeSuggestions = ref<StructuredMemoryMergeSuggestion[]>([])
const profileEvidence = ref<MemoryItem[]>([])
const advancedMode = ref(false)
const pendingPurgeKey = ref('')
const pendingForget = ref<PendingForget | null>(null)
const memory = ref<MemorySnapshot>({
  summary: '',
  short_term: [],
  profiles: [],
  fragments: [],
  structured: [],
  semantic: [],
  vector: [],
  retrieved: []
})

const selectedConversationTitle = computed(() => {
  if (!conversationId.value) return '默认记忆'
  return conversationTitle(conversationId.value)
})

const structuredAll = computed(() => {
  const items = memory.value.structured_all?.length ? memory.value.structured_all : memory.value.structured
  return items.filter((item) => !(isPendingInternalKey(item.key) && item.status === 'disabled'))
})

const profileAll = computed(() => memory.value.profiles || [])

const fragmentAll = computed(() => memory.value.fragments || [])

const selectedProfile = computed(() => {
  return profileAll.value.find((item) => item.id === selectedProfileId.value) || profileAll.value[0]
})

const selectedStructured = computed(() => {
  return structuredAll.value.find((item) => item.key === selectedStructuredKey.value) || structuredAll.value[0]
})

const conflictItems = computed(() => {
  return [
    ...structuredAll.value.filter((item) => item.status !== 'active' || (item.confidence ?? 1) < 0.75),
    ...profileAll.value.filter((item) => item.status !== 'active' || (item.confidence ?? 1) < 0.75)
  ]
})

const forgottenItems = computed(() => {
  return dedupeGovernanceItems([
    ...structuredAll.value.filter((item) => item.status === 'forgotten'),
    ...profileAll.value.filter((item) => item.status === 'forgotten'),
    ...fragmentAll.value.filter((item) => item.status === 'forgotten')
  ])
})

const sensitiveItems = computed(() => {
  return dedupeGovernanceItems([
    ...profileAll.value.filter((item) => item.schemaPath === 'memory_control.sensitive_info'),
    ...structuredAll.value.filter((item) => structuredDisplayKey(item.key) === 'sensitive_info'),
    ...fragmentAll.value.filter((item) => item.category === 'memory_control.sensitive_info')
  ])
})

const lowConfidenceItems = computed(() => {
  return [
    ...structuredAll.value.filter((item) => item.status === 'active' && (item.confidence ?? 1) < 0.75),
    ...profileAll.value.filter((item) => item.status === 'active' && (item.confidence ?? 1) < 0.75)
  ]
})

const activeStructuredCount = computed(() => {
  return structuredAll.value.filter((item) => !item.status || item.status === 'active').length
})

const summarySourceLabel = computed(() => {
  const meta = memory.value.summary_meta
  if (!memory.value.summary || !meta) return ''
  if (meta.fallback) {
    return `当前会话暂无长期摘要，正在显示用户最新摘要：${conversationTitle(meta.sourceConversationId)}`
  }
  return '当前会话长期摘要'
})

const structuredKeyLabels: Record<string, string> = {
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
  loading.value = true
  try {
    const response = await listConversations()
    conversations.value = response.data
    if (response.data.length > 0) {
      conversationId.value = String(response.data[0].id)
    }
    await refresh()
  } catch {
    error.value = '记忆页面加载失败，请确认后端服务已经启动。'
  } finally {
    loading.value = false
  }
})

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await getCurrentMemory(conversationId.value || undefined)
    memory.value = response.data
    await refreshOptionalMemoryDetails()
    if (selectedStructuredKey.value) {
      await refreshOptionalStructuredHistory(selectedStructuredKey.value)
    }
    if (selectedProfile.value?.id) {
      await refreshOptionalProfileEvidence(selectedProfile.value.id)
    }
  } catch {
    error.value = '记忆加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

async function handleConversationChange() {
  selectedStructuredKey.value = ''
  selectedProfileId.value = null
  structuredHistory.value = []
  profileEvidence.value = []
  await refresh()
}

async function saveMemory() {
  if (!memoryKey.value.trim() || !memoryValue.value.trim()) return
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    await saveStructuredMemory(
      memoryKey.value.trim(),
      memoryValue.value.trim(),
      memoryConfidence.value,
      memorySource.value.trim() || 'manual'
    )
    notice.value = '结构化记忆已保存。'
    memoryKey.value = ''
    memoryValue.value = ''
    memoryConfidence.value = 1
    memorySource.value = 'manual'
    await refresh()
    activeTab.value = 'governance'
  } catch {
    error.value = '结构化记忆保存失败。'
  } finally {
    loading.value = false
  }
}

async function removeStructured(key: string) {
  await updateMemoryAction(() => deleteStructuredMemory(key), '记忆已禁用。', '记忆禁用失败。')
}

async function changeStatus(key: string, status: string) {
  await updateMemoryAction(() => changeStructuredMemoryStatus(key, status), '记忆状态已更新。', '记忆状态更新失败。')
}

async function adoptStructuredSuggestion(item: MemoryItem) {
  const key = structuredDisplayKey(item.key)
  const value = (item.value || '').trim()
  if (!key || !value) return

  await updateMemoryAction(async () => {
    await saveStructuredMemory(key, value, item.confidence ?? 0.8, item.source || 'merge_suggestion')
    if (item.key && item.key !== key) {
      await changeStructuredMemoryStatus(item.key, 'disabled')
    }
}, '记忆建议已采用。', '记忆建议采用失败。')
}

async function keepMergeSuggestion(suggestion: StructuredMemoryMergeSuggestion, selected: MemoryItem) {
  await updateMemoryAction(async () => {
    const key = structuredDisplayKey(selected.key)
    const value = (selected.value || '').trim()
    if (key && value) {
      await saveStructuredMemory(key, value, Math.max(selected.confidence ?? 0.8, 0.85), selected.source || 'merge_suggestion')
    }
    await Promise.all(
      suggestion.items
        .filter((item) => item.key && item.key !== selected.key)
        .map((item) => changeStructuredMemoryStatus(String(item.key), 'disabled'))
    )
    if (selected.key && isPendingInternalKey(selected.key)) {
      await changeStructuredMemoryStatus(selected.key, 'disabled')
    }
  }, '已保留所选记忆，并禁用其它冲突项。', '记忆保留失败。')
}

async function purgeStructured(key: string) {
  await updateMemoryAction(() => purgeStructuredMemory(key), '记忆已永久删除。', '记忆永久删除失败。')
  selectedStructuredKey.value = ''
  pendingPurgeKey.value = ''
}

async function updateMemoryAction(action: () => Promise<unknown>, success: string, failure: string) {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
    notice.value = success
    await refresh()
  } catch {
    error.value = failure
  } finally {
    loading.value = false
  }
}

function editStructured(item: MemoryItem) {
  memoryKey.value = structuredDisplayKey(item.key)
  memoryValue.value = item.value || ''
  memoryConfidence.value = item.confidence ?? 1
  memorySource.value = item.source || 'manual'
  selectStructured(item)
  activeTab.value = 'governance'
}

function selectStructured(item: MemoryItem) {
  selectedStructuredKey.value = item.key || ''
  if (selectedStructuredKey.value) {
    refreshOptionalStructuredHistory(selectedStructuredKey.value)
  }
}

function selectProfile(item: MemoryItem) {
  selectedProfileId.value = item.id || null
  if (selectedProfileId.value) {
    refreshOptionalProfileEvidence(selectedProfileId.value)
  }
}

async function refreshProfileEvidence(profileId: number) {
  const response = await getProfileEvidence(profileId)
  profileEvidence.value = response.data.items
}

async function refreshOptionalProfileEvidence(profileId: number) {
  try {
    await refreshProfileEvidence(profileId)
  } catch {
    profileEvidence.value = []
  }
}

async function updateProfileStatus(schemaPath: string, status: string) {
  await updateMemoryAction(() => changeProfileStatus(schemaPath, status), '画像状态已更新。', '画像状态更新失败。')
}

async function updateFragmentStatus(fragmentId: number, status: string) {
  await updateMemoryAction(() => changeFragmentStatus(fragmentId, status), '片段状态已更新。', '片段状态更新失败。')
}

async function confirmForget() {
  const target = pendingForget.value
  if (!target || loading.value) return
  if (target.kind === 'profile') {
    await updateProfileStatus(target.schemaPath, 'forgotten')
  } else {
    await updateFragmentStatus(target.id, 'forgotten')
  }
  pendingForget.value = null
}

async function refreshStructuredHistory(key: string) {
  const response = await getStructuredMemoryHistory(key)
  structuredHistory.value = response.data.items
}

async function refreshOptionalStructuredHistory(key: string) {
  try {
    await refreshStructuredHistory(key)
  } catch {
    structuredHistory.value = []
  }
}

async function refreshMergeSuggestions() {
  const response = await getStructuredMemoryMergeSuggestions()
  mergeSuggestions.value = response.data.items
    .map((suggestion) => ({
      ...suggestion,
      items: suggestion.items.filter((item) => !(isPendingInternalKey(item.key) && item.status === 'disabled'))
    }))
    .filter((suggestion) => suggestion.items.length > 0)
}

async function refreshOptionalMemoryDetails() {
  try {
    await refreshMergeSuggestions()
  } catch {
    mergeSuggestions.value = []
  }
}

function statusLabel(status?: string) {
  if (status === 'pending') return '待确认'
  if (status === 'disabled') return '已禁用'
  if (status === 'forgotten') return '已遗忘'
  if (status === 'conflicted') return '有冲突'
  if (status === 'expired') return '已过期'
  return '启用中'
}

function statusClass(status?: string) {
  return {
    danger: status === 'disabled' || status === 'expired',
    pending: status === 'pending',
    success: !status || status === 'active'
  }
}

function formattedUpdatedAt(value?: number) {
  if (!value) return ''
  return new Date(value * 1000).toLocaleString()
}

function formattedMemoryTime(value?: number) {
  if (!value) return ''
  return new Date(value * 1000).toLocaleString()
}

function profileTitle(item?: MemoryItem) {
  if (!item) return '未知画像'
  if (item.label) return item.label
  const finalPath = item.schemaPath?.split('.').pop() || ''
  return structuredKeyLabels[finalPath] || '个人信息'
}

function userMemoryTitle(item: MemoryItem) {
  if (item.label || item.schemaPath) return profileTitle(item)
  if (item.key) return structuredKeyLabel(item.key)
  return '记忆'
}

function structuredKeyLabel(key?: string) {
  const displayKey = structuredDisplayKey(key)
  if (!displayKey) return '未知字段'
  const label = structuredKeyLabels[displayKey]
  return label || '自定义记忆'
}

function reliabilityLabel(item?: MemoryItem) {
  const confidence = item?.confidence
  if (confidence === undefined) return '可靠性待确认'
  if (confidence < 0.75) return '需要核对'
  if (confidence >= 0.85) return '可靠'
  return '基本可靠'
}

function speakerLabel(role?: string) {
  if (role === 'user') return '你'
  if (role === 'assistant') return 'Lyle'
  return '对话'
}

function plainMemoryText(value?: string) {
  if (!value) return ''
  return value
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?/g, '').replace(/```/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, '• ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

function toggleAdvancedMode() {
  advancedMode.value = !advancedMode.value
  if (!advancedMode.value && (activeTab.value === 'evidence' || activeTab.value === 'fragments')) {
    activeTab.value = 'profiles'
  }
}

function governanceItemTitle(item: MemoryItem) {
  if (item.label) return item.label
  if (item.key) return structuredKeyLabel(item.key)
  if (item.schemaPath === 'memory_control.sensitive_info' || item.category === 'memory_control.sensitive_info') return '敏感信息'
  if (item.schemaPath === 'memory_control.forget_requests' || item.category === 'memory_control.forget_requests') return '遗忘请求'
  if (item.schemaPath) return item.schemaPath
  if (item.category) return item.category
  return '记忆'
}

function governanceItemValue(item: MemoryItem) {
  return String(item.value || item.normalizedText || item.sourceText || item.text || '').trim()
}

function dedupeGovernanceItems(items: MemoryItem[]) {
  const result: MemoryItem[] = []
  for (const item of items) {
    const index = result.findIndex((existing) => isSameGovernanceItem(existing, item))
    if (index < 0) {
      result.push(item)
    } else if (governanceItemRank(item) > governanceItemRank(result[index])) {
      result[index] = item
    }
  }
  return result
}

function isSameGovernanceItem(left: MemoryItem, right: MemoryItem) {
  if (governanceItemGroup(left) !== governanceItemGroup(right)) return false
  const leftValue = normaliseGovernanceValue(governanceItemValue(left))
  const rightValue = normaliseGovernanceValue(governanceItemValue(right))
  if (!leftValue || !rightValue) return false
  return leftValue === rightValue || leftValue.includes(rightValue) || rightValue.includes(leftValue)
}

function governanceItemGroup(item: MemoryItem) {
  if (isSensitiveGovernanceItem(item)) return 'sensitive'
  if (isForgetGovernanceItem(item)) return 'forget'
  return governanceItemTitle(item)
}

function isSensitiveGovernanceItem(item: MemoryItem) {
  return structuredDisplayKey(item.key) === 'sensitive_info'
    || item.schemaPath === 'memory_control.sensitive_info'
    || item.category === 'memory_control.sensitive_info'
}

function isForgetGovernanceItem(item: MemoryItem) {
  return structuredDisplayKey(item.key) === 'forget_request'
    || item.schemaPath === 'memory_control.forget_requests'
    || item.category === 'memory_control.forget_requests'
}

function governanceItemRank(item: MemoryItem) {
  if (item.key) return 3
  if (item.schemaPath) return 2
  return 1
}

function normaliseGovernanceValue(value: string) {
  return value.replace(/[\s，。,.!！?？：:、"'“”‘’（）()[\]【】]/g, '')
}

function structuredDisplayKey(key?: string) {
  if (!key) return ''
  if (!isPendingInternalKey(key)) return key
  return key.split(':').slice(2).join(':') || key
}

function isPendingInternalKey(key?: string) {
  return Boolean(key?.startsWith('pending:'))
}

function sourceInfo(source?: string) {
  const value = source || ''
  const match = value.match(/^source_ref:([^\n]+)\n?([\s\S]*)$/)
  if (!match) {
    return { text: value || '暂无来源。手动维护的记忆会显示 manual。', label: '', href: '' }
  }
  const ref = match[1]
  const text = match[2] || ''
  if (ref.startsWith('conversation:')) {
    const id = ref.replace(/^conversation:/, '')
    return { text, label: '回到来源会话', href: `/?conversationId=${encodeURIComponent(id)}` }
  }
  if (ref.startsWith('knowledge:')) {
    return { text, label: '查看知识库', href: '/knowledge-bases' }
  }
  return { text, label: '', href: '' }
}

function conversationTitle(id?: string | null) {
  if (!id || id === 'default') return '默认记忆'
  return conversations.value.find((item) => String(item.id) === String(id))?.title || `会话 ${id}`
}
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>记忆</h1>
        <p class="muted">{{ selectedConversationTitle }} · Lyle 已整理 {{ profileAll.length + activeStructuredCount }} 条可用信息</p>
      </div>
      <div class="row toolbar-controls">
        <select
          v-model="conversationId"
          aria-label="选择要查看的会话记忆"
          data-testid="memory-conversation-select"
          @change="handleConversationChange"
        >
          <option value="">默认记忆</option>
          <option v-for="item in conversations" :key="item.id" :value="String(item.id)">
            {{ item.title }}
          </option>
        </select>
        <button :disabled="loading" type="button" @click="refresh">刷新</button>
        <button class="secondary" type="button" :aria-pressed="advancedMode" @click="toggleAdvancedMode">
          {{ advancedMode ? '退出高级模式' : '高级模式' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="alert danger">{{ error }}</p>
    <p v-if="notice" class="alert success">{{ notice }}</p>

    <div class="segmented memory-tabs">
      <button type="button" :class="{ active: activeTab === 'profiles' }" @click="activeTab = 'profiles'">我的记忆</button>
      <button data-testid="memory-governance-tab" type="button" :class="{ active: activeTab === 'governance' }" @click="activeTab = 'governance'">管理记忆</button>
      <button v-if="advancedMode" type="button" :class="{ active: activeTab === 'evidence' }" @click="activeTab = 'evidence'">证据来源</button>
      <button v-if="advancedMode" type="button" :class="{ active: activeTab === 'fragments' }" @click="activeTab = 'fragments'">技术详情</button>
    </div>

    <div v-if="loading" class="empty-state compact">
      <strong>正在读取记忆</strong>
      <span>请稍候。</span>
    </div>

    <section v-if="activeTab === 'profiles'" class="grid memory-grid">
      <article class="item">
        <h2>用户画像</h2>
        <p v-if="profileAll.length === 0" class="muted">暂无用户画像。确认候选记忆后会自动沉淀。</p>
        <button
          v-for="item in profileAll"
          :key="item.schemaPath"
          class="memory-list-item"
          :class="{ active: item.id === selectedProfile?.id, disabled: item.status !== 'active' }"
          type="button"
          @click="selectProfile(item)"
        >
          <strong>{{ profileTitle(item) }}</strong>
          <span>{{ item.summary || item.value }}</span>
          <small>{{ item.group || '未分组' }} · {{ statusLabel(item.status) }} · 证据 {{ item.evidenceCount || 0 }}</small>
        </button>
      </article>

      <article class="item stack">
        <h2>画像详情</h2>
        <div v-if="!selectedProfile" class="empty-state compact">
          <strong>未选择画像</strong>
          <span>确认记忆后可查看画像字段和证据数量。</span>
        </div>
        <template v-else>
          <div class="source-box">
            <strong>{{ profileTitle(selectedProfile) }}</strong>
            <span>{{ selectedProfile.value }}</span>
            <small class="memory-meta">{{ reliabilityLabel(selectedProfile) }} · {{ statusLabel(selectedProfile.status) }}</small>
            <small v-if="selectedProfile.updatedAt" class="memory-meta">更新时间：{{ formattedMemoryTime(selectedProfile.updatedAt) }}</small>
            <details v-if="advancedMode" class="memory-technical"><summary>技术字段</summary><code>{{ selectedProfile.schemaPath }}</code><span>置信度 {{ selectedProfile.confidence ?? 1 }}</span></details>
          </div>
          <div class="row">
            <button
              v-if="selectedProfile.schemaPath && selectedProfile.status !== 'disabled'"
              class="secondary danger"
              type="button"
              @click="updateProfileStatus(selectedProfile.schemaPath, 'disabled')"
            >
              禁用
            </button>
            <button
              v-if="selectedProfile.schemaPath && selectedProfile.status === 'disabled'"
              type="button"
              @click="updateProfileStatus(selectedProfile.schemaPath, 'active')"
            >
              恢复
            </button>
            <button
              v-if="selectedProfile.schemaPath"
              class="danger"
              type="button"
              @click="pendingForget = { kind: 'profile', schemaPath: selectedProfile.schemaPath, label: profileTitle(selectedProfile) }"
            >
              遗忘
            </button>
          </div>
        </template>
      </article>

      <article class="item">
        <h2>长期摘要</h2>
        <small v-if="summarySourceLabel" class="memory-meta">{{ summarySourceLabel }}</small>
        <p class="memory-text">{{ plainMemoryText(memory.summary) || '暂无长期摘要。多轮对话后会自动整理。' }}</p>
      </article>

      <article class="item">
        <h2>记忆状态</h2>
        <div class="status-grid">
          <div>
            <strong>已记住</strong>
            <span>{{ profileAll.length + activeStructuredCount }}</span>
          </div>
          <div>
            <strong>当前对话</strong>
            <span>{{ memory.short_term.length }}</span>
          </div>
          <div>
            <strong>需要核对</strong>
            <span>{{ conflictItems.length }}</span>
          </div>
        </div>
      </article>

      <article class="item">
        <h2>短期记忆</h2>
        <div v-if="memory.short_term.length === 0" class="empty-state compact">
          <strong>暂无短期记忆</strong>
          <span>完成一轮聊天后会出现在这里。</span>
        </div>
        <div
          v-for="(item, index) in memory.short_term"
          :key="index"
          class="memory-row stacked"
          data-testid="short-term-memory-row"
        >
          <strong>{{ speakerLabel(item.role) }}</strong>
          <span>{{ plainMemoryText(item.content) }}</span>
        </div>
      </article>

      <article class="item">
        <h2>待处理记忆</h2>
        <p v-if="conflictItems.length === 0" class="muted">暂无需要核对、已禁用或过期的记忆。</p>
        <div v-for="item in conflictItems" :key="`conflict-${item.key}`" class="memory-row stacked">
          <strong>{{ item.label || structuredKeyLabel(item.key) }} · {{ statusLabel(item.status) }}</strong>
          <span>{{ item.value }}</span>
          <small class="memory-meta">{{ reliabilityLabel(item) }} · 建议确认来源后再使用</small>
        </div>
      </article>
    </section>

    <section v-if="activeTab === 'governance'" class="memory-layout">
      <article v-if="advancedMode" class="item stack">
        <h2>手动维护 · 高级</h2>
        <input v-model="memoryKey" data-testid="memory-key-input" placeholder="记忆键，例如 preference" />
        <input v-model="memoryValue" data-testid="memory-value-input" placeholder="记忆值，例如 喜欢西瓜" />
        <input v-model.number="memoryConfidence" min="0" max="1" step="0.01" type="number" placeholder="置信度 0-1" />
        <input v-model="memorySource" placeholder="来源，例如 manual 或对话摘要" />
        <button data-testid="memory-save-button" type="button" :disabled="loading || !memoryKey.trim() || !memoryValue.trim()" @click="saveMemory">
          保存结构化记忆
        </button>
      </article>

      <article class="item stack">
        <div class="section-title">
          <h2>遗忘</h2>
          <span class="badge">{{ forgottenItems.length }} 条</span>
        </div>
        <p v-if="forgottenItems.length === 0" class="muted">暂无已遗忘记忆。</p>
        <div v-for="item in forgottenItems" :key="`forgotten-${item.id || item.key || item.schemaPath}-${item.value || item.normalizedText}`" class="memory-row stacked">
          <strong>{{ governanceItemTitle(item) }}</strong>
          <span>{{ governanceItemValue(item) }}</span>
          <small class="memory-meta">{{ statusLabel(item.status) }} · 后续不会主动召回</small>
        </div>
      </article>

      <article class="item stack">
        <div class="section-title">
          <h2>敏感</h2>
          <span class="badge">{{ sensitiveItems.length }} 条</span>
        </div>
        <p v-if="sensitiveItems.length === 0" class="muted">暂无敏感信息标记。</p>
        <div v-for="item in sensitiveItems" :key="`sensitive-${item.id || item.key || item.schemaPath}-${item.value || item.normalizedText}`" class="memory-row stacked">
          <strong>{{ governanceItemTitle(item) }}</strong>
          <span>{{ governanceItemValue(item) }}</span>
          <small class="memory-meta">{{ statusLabel(item.status) }} · 默认不进入回答上下文</small>
        </div>
      </article>

      <article class="item stack" data-testid="low-confidence-memory-section">
        <div class="section-title">
          <h2>需要核对</h2>
          <span class="badge">{{ lowConfidenceItems.length }} 条</span>
        </div>
        <p v-if="lowConfidenceItems.length === 0" class="muted">暂无需要核对的记忆。</p>
        <div v-for="item in lowConfidenceItems" :key="`low-${item.key || item.schemaPath}-${item.value}`" class="memory-row stacked">
          <strong>{{ userMemoryTitle(item) }}</strong>
          <span>{{ item.summary || item.value }}</span>
          <small class="memory-meta">{{ reliabilityLabel(item) }} · 回答时会谨慎使用</small>
        </div>
      </article>

      <article class="item stack">
        <div class="section-title">
          <h2>结构化记忆</h2>
          <span class="badge">{{ structuredAll.length }} 条</span>
        </div>
        <div v-if="structuredAll.length === 0" class="empty-state compact">
          <strong>暂无结构化记忆</strong>
          <span>可以手动添加，或等待对话自动抽取。</span>
        </div>
        <button
          v-for="item in structuredAll"
          :key="`${item.key}-${item.value}`"
          class="memory-list-item"
          :class="{ active: item.key === selectedStructuredKey, disabled: item.status === 'disabled' || item.status === 'expired' }"
          type="button"
          data-testid="structured-memory-row"
          @click="selectStructured(item)"
        >
          <strong>{{ structuredKeyLabel(item.key) }}</strong>
          <span>{{ item.value }}</span>
          <small>
            {{ statusLabel(item.status) }}
            <template v-if="item.confidence !== undefined"> · {{ reliabilityLabel(item) }}</template>
          </small>
        </button>
      </article>

      <article class="item stack">
        <h2>详情</h2>
        <div v-if="!selectedStructured" class="empty-state compact">
          <strong>未选择记忆</strong>
          <span>选择一条结构化记忆查看来源和操作。</span>
        </div>
        <template v-else>
          <div class="source-box">
            <strong>{{ structuredKeyLabel(selectedStructured.key) }}：{{ selectedStructured.value }}</strong>
            <span class="badge" :class="statusClass(selectedStructured.status)">{{ statusLabel(selectedStructured.status) }}</span>
            <span>{{ reliabilityLabel(selectedStructured) }}</span>
            <span v-if="selectedStructured.updated_at">更新时间：{{ formattedUpdatedAt(selectedStructured.updated_at) }}</span>
            <span v-if="reliabilityLabel(selectedStructured) === '需要核对'" class="memory-meta">回答时仅作参考，建议核对来源后再采用。</span>
          </div>
          <details v-if="advancedMode" class="memory-technical">
            <summary>来源与技术字段</summary>
            <code>{{ selectedStructured.key }}</code>
            <span v-if="selectedStructured.confidence !== undefined">置信度：{{ selectedStructured.confidence }}</span>
            <strong>来源文本</strong>
            <p class="memory-text">{{ sourceInfo(selectedStructured.source).text }}</p>
            <a
              v-if="sourceInfo(selectedStructured.source).href"
              class="inline"
              :href="sourceInfo(selectedStructured.source).href"
            >
              {{ sourceInfo(selectedStructured.source).label }}
            </a>
          </details>
          <div class="row">
            <button class="secondary" type="button" @click="editStructured(selectedStructured)">编辑</button>
            <button
              v-if="selectedStructured.key && selectedStructured.status !== 'disabled'"
              class="secondary danger"
              type="button"
              @click="changeStatus(selectedStructured.key, 'disabled')"
            >
              禁用
            </button>
            <button
              v-if="selectedStructured.key && selectedStructured.status === 'disabled'"
              type="button"
              @click="changeStatus(selectedStructured.key, 'active')"
            >
              恢复
            </button>
            <button
              v-if="selectedStructured.key"
              class="danger"
              type="button"
              @click="pendingPurgeKey = selectedStructured.key"
            >
              永久删除
            </button>
          </div>
        </template>
      </article>
    </section>

    <section v-if="advancedMode && activeTab === 'evidence'" class="grid memory-grid">
      <article class="item">
        <h2>画像证据</h2>
        <p v-if="!selectedProfile" class="muted">先在用户画像中选择一条画像。</p>
        <p v-else-if="profileEvidence.length === 0" class="muted">暂无证据；确认后的新记忆会逐步关联。</p>
        <div v-for="item in profileEvidence" :key="item.id" class="memory-row stacked">
          <strong>{{ item.relation || 'support' }} · {{ item.confidence ?? 1 }}</strong>
          <span>{{ item.fragment?.normalizedText || item.fragment?.sourceText || '-' }}</span>
          <small class="memory-meta">{{ item.fragment?.sourceRef || 'manual' }}</small>
        </div>
      </article>

      <article class="item">
        <h2>版本历史</h2>
        <p v-if="!selectedStructured" class="muted">选择一条结构化记忆查看历史。</p>
        <p v-else-if="structuredHistory.length === 0" class="muted">暂无历史记录；新增、替换、禁用、恢复都会记录。</p>
        <div v-for="item in structuredHistory" :key="item.id" class="memory-row stacked">
          <strong>{{ item.action }} · {{ structuredKeyLabel(item.key) }}</strong>
          <span v-if="item.oldValue">旧值：{{ item.oldValue }}</span>
          <span v-if="item.newValue">新值：{{ item.newValue }}</span>
          <small class="memory-meta">{{ item.createdAt }} · 置信度 {{ item.confidence }} · {{ item.status }}</small>
          <small class="memory-meta">{{ item.source }}</small>
        </div>
      </article>

      <article class="item">
        <h2>合并建议</h2>
        <p v-if="mergeSuggestions.length === 0" class="muted">暂无需要合并的同类记忆。</p>
        <div v-for="suggestion in mergeSuggestions" :key="suggestion.group" class="memory-row stacked">
          <strong>{{ suggestion.group }}</strong>
          <span>{{ suggestion.reason }}</span>
          <div v-for="item in suggestion.items" :key="`${suggestion.group}-${item.key}-${item.value}`" class="source-box">
            <strong>{{ structuredKeyLabel(item.key) }} = {{ item.value }}</strong>
            <small class="memory-meta">{{ statusLabel(item.status) }} · 置信度 {{ item.confidence ?? 1 }}</small>
            <span class="row">
              <button v-if="item.key" class="inline" type="button" @click="keepMergeSuggestion(suggestion, item)">保留这条</button>
              <button v-if="item.key" class="inline" type="button" @click="adoptStructuredSuggestion(item)">采用</button>
              <button v-if="item.key" class="inline danger" type="button" @click="changeStatus(item.key, 'disabled')">禁用</button>
              <button v-if="item.key" class="inline danger" type="button" @click="pendingPurgeKey = item.key">永久删除</button>
            </span>
          </div>
        </div>
      </article>
    </section>

    <section v-if="advancedMode && activeTab === 'fragments'" class="grid memory-grid">
      <article class="item">
        <h2>记忆片段</h2>
        <p v-if="fragmentAll.length === 0" class="muted">暂无记忆片段。</p>
        <div v-for="item in fragmentAll" :key="item.id" class="memory-row stacked">
          <strong>{{ item.category }} · {{ statusLabel(item.status) }}</strong>
          <span>{{ item.normalizedText || item.sourceText }}</span>
          <small class="memory-meta">
            {{ item.sourceType || 'manual' }} · 置信度 {{ item.confidence ?? 1 }}
            <template v-if="item.createdAt"> · {{ formattedMemoryTime(item.createdAt) }}</template>
          </small>
          <span class="row">
            <button
              v-if="item.id && item.status !== 'disabled'"
              class="inline danger"
              type="button"
              @click="updateFragmentStatus(item.id, 'disabled')"
            >
              禁用
            </button>
            <button
              v-if="item.id && item.status === 'disabled'"
              class="inline"
              type="button"
              @click="updateFragmentStatus(item.id, 'active')"
            >
              恢复
            </button>
            <button
              v-if="item.id"
              class="inline danger"
              type="button"
              @click="pendingForget = { kind: 'fragment', id: item.id, label: plainMemoryText(item.normalizedText || item.sourceText).slice(0, 28) || '这条记忆' }"
            >
              遗忘
            </button>
          </span>
        </div>
      </article>

      <article class="item">
        <h2>合并向量召回</h2>
        <p v-if="(memory.retrieved || []).length === 0" class="muted">暂无</p>
        <div v-for="(item, index) in memory.retrieved || []" :key="index" class="memory-row stacked">
          <strong>{{ item.backend }} · {{ item.score }}</strong>
          <span>{{ item.text }}</span>
        </div>
      </article>

      <article class="item">
        <h2>语义记忆</h2>
        <p v-if="memory.semantic.length === 0" class="muted">暂无</p>
        <div v-for="(item, index) in memory.semantic" :key="index" class="memory-row stacked">
          <strong>Qdrant · {{ item.score }}</strong>
          <span>{{ item.text }}</span>
        </div>
      </article>

      <article class="item">
        <h2>向量记忆</h2>
        <p v-if="memory.vector.length === 0" class="muted">暂无</p>
        <div v-for="(item, index) in memory.vector" :key="index" class="memory-row stacked">
          <strong>Milvus · {{ item.score }}</strong>
          <span>{{ item.text }}</span>
        </div>
      </article>
    </section>

    <ConfirmActionDialog
      :open="Boolean(pendingPurgeKey)"
      title="永久删除记忆"
      :description="`将永久删除“${structuredKeyLabel(pendingPurgeKey)}”。删除后无法恢复，Lyle 也不会再主动使用这条信息。`"
      confirm-label="永久删除"
      danger
      :busy="loading"
      @update:open="(open) => { if (!open) pendingPurgeKey = '' }"
      @confirm="pendingPurgeKey && purgeStructured(pendingPurgeKey)"
    />
    <ConfirmActionDialog
      :open="Boolean(pendingForget)"
      title="遗忘这条记忆？"
      :description="`遗忘“${pendingForget?.label || '这条记忆'}”后，Lyle 将不再主动使用它；你之后仍可在治理记录中查看状态。`"
      confirm-label="确认遗忘"
      danger
      :busy="loading"
      @update:open="(open) => { if (!open) pendingForget = null }"
      @confirm="confirmForget"
    />
  </section>
</template>

<style scoped>
.memory-technical { display: grid; gap: var(--space-2); border-top: 1px solid var(--border); padding-top: var(--space-3); color: var(--muted-foreground); font-size: 13px; }
.memory-technical summary { cursor: pointer; color: var(--foreground); font-weight: 700; }.memory-technical code { overflow-wrap: anywhere; }.memory-technical p { margin: 0; }
@media (max-width: 680px) { .memory-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }.memory-tabs button { min-width: 0; } }
</style>
