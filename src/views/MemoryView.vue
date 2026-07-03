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
    ...structuredAll.value.filter((item) => item.status !== 'active' || (item.confidence ?? 1) < 0.8),
    ...profileAll.value.filter((item) => item.status !== 'active' || (item.confidence ?? 1) < 0.8)
  ]
})

const activeStructuredCount = computed(() => {
  return structuredAll.value.filter((item) => !item.status || item.status === 'active').length
})

const vectorCount = computed(() => {
  return (memory.value.retrieved || []).length + memory.value.semantic.length + memory.value.vector.length
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
  if (!window.confirm(`永久删除记忆「${key}」？`)) return
  await updateMemoryAction(() => purgeStructuredMemory(key), '记忆已永久删除。', '记忆永久删除失败。')
  selectedStructuredKey.value = ''
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
  return `${item.label || item.schemaPath || '画像'}`
}

function structuredKeyLabel(key?: string) {
  const displayKey = structuredDisplayKey(key)
  if (!displayKey) return '未知字段'
  const label = structuredKeyLabels[displayKey]
  return label ? `${label} (${displayKey})` : displayKey
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

function confidenceHint(item?: MemoryItem) {
  const confidence = item?.confidence
  if (confidence === undefined) return ''
  if (confidence < 0.75) return '低置信度：回答时仅作参考，建议核对来源后再采用。'
  if (confidence >= 0.95) return '高置信度：多次确认或长期稳定使用。'
  return ''
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
        <p class="muted">{{ selectedConversationTitle }} · {{ activeStructuredCount }} 条结构化记忆</p>
      </div>
      <div class="row toolbar-controls">
        <select v-model="conversationId" data-testid="memory-conversation-select" @change="handleConversationChange">
          <option value="">默认记忆</option>
          <option v-for="item in conversations" :key="item.id" :value="String(item.id)">
            {{ item.title }}
          </option>
        </select>
        <button :disabled="loading" type="button" @click="refresh">刷新</button>
      </div>
    </div>

    <p v-if="error" class="alert danger">{{ error }}</p>
    <p v-if="notice" class="alert success">{{ notice }}</p>

    <div class="segmented memory-tabs">
      <button type="button" :class="{ active: activeTab === 'profiles' }" @click="activeTab = 'profiles'">用户画像</button>
      <button type="button" :class="{ active: activeTab === 'fragments' }" @click="activeTab = 'fragments'">记忆片段</button>
      <button type="button" :class="{ active: activeTab === 'evidence' }" @click="activeTab = 'evidence'">证据来源</button>
      <button type="button" :class="{ active: activeTab === 'governance' }" @click="activeTab = 'governance'">治理中心</button>
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
            <small class="memory-meta">
              {{ selectedProfile.schemaPath }} · 置信度 {{ selectedProfile.confidence ?? 1 }} · {{ statusLabel(selectedProfile.status) }}
            </small>
            <small v-if="selectedProfile.updatedAt" class="memory-meta">更新时间：{{ formattedMemoryTime(selectedProfile.updatedAt) }}</small>
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
              @click="updateProfileStatus(selectedProfile.schemaPath, 'forgotten')"
            >
              遗忘
            </button>
          </div>
        </template>
      </article>

      <article class="item">
        <h2>长期摘要</h2>
        <small v-if="summarySourceLabel" class="memory-meta">{{ summarySourceLabel }}</small>
        <p class="memory-text">{{ memory.summary || '暂无长期摘要。多轮对话后会自动压缩沉淀。' }}</p>
      </article>

      <article class="item">
        <h2>记忆状态</h2>
        <div class="status-grid">
          <div>
            <strong>结构化</strong>
            <span>{{ structuredAll.length }}</span>
          </div>
          <div>
            <strong>画像</strong>
            <span>{{ profileAll.length }}</span>
          </div>
          <div>
            <strong>片段</strong>
            <span>{{ fragmentAll.length }}</span>
          </div>
          <div>
            <strong>短期轮次</strong>
            <span>{{ memory.short_term.length }}</span>
          </div>
          <div>
            <strong>向量召回</strong>
            <span>{{ vectorCount }}</span>
          </div>
          <div>
            <strong>待处理</strong>
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
          <strong>{{ item.role }}</strong>
          <span>{{ item.content }}</span>
        </div>
      </article>

      <article class="item">
        <h2>待处理记忆</h2>
        <p v-if="conflictItems.length === 0" class="muted">暂无低置信度、禁用或过期记忆。</p>
        <div v-for="item in conflictItems" :key="`conflict-${item.key}`" class="memory-row stacked">
          <strong>{{ structuredKeyLabel(item.key) }} · {{ statusLabel(item.status) }}</strong>
          <span>{{ item.value }}</span>
          <small class="memory-meta">置信度 {{ item.confidence ?? 1 }} · {{ item.source || '无来源' }}</small>
        </div>
      </article>
    </section>

    <section v-if="activeTab === 'governance'" class="memory-layout">
      <article class="item stack">
        <h2>手动维护</h2>
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
            <template v-if="item.confidence !== undefined"> · 置信度 {{ item.confidence }}</template>
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
            <strong>{{ structuredKeyLabel(selectedStructured.key) }} = {{ selectedStructured.value }}</strong>
            <span class="badge" :class="statusClass(selectedStructured.status)">{{ statusLabel(selectedStructured.status) }}</span>
            <span v-if="selectedStructured.confidence !== undefined">置信度：{{ selectedStructured.confidence }}</span>
            <span v-if="selectedStructured.updated_at">更新时间：{{ formattedUpdatedAt(selectedStructured.updated_at) }}</span>
            <span v-if="confidenceHint(selectedStructured)" class="memory-meta">{{ confidenceHint(selectedStructured) }}</span>
          </div>
          <div>
            <strong>来源文本</strong>
            <p class="memory-text">{{ sourceInfo(selectedStructured.source).text }}</p>
            <a
              v-if="sourceInfo(selectedStructured.source).href"
              class="inline"
              :href="sourceInfo(selectedStructured.source).href"
            >
              {{ sourceInfo(selectedStructured.source).label }}
            </a>
          </div>
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
              @click="purgeStructured(selectedStructured.key)"
            >
              永久删除
            </button>
          </div>
        </template>
      </article>
    </section>

    <section v-if="activeTab === 'evidence'" class="grid memory-grid">
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
              <button v-if="item.key" class="inline danger" type="button" @click="purgeStructured(item.key)">永久删除</button>
            </span>
          </div>
        </div>
      </article>
    </section>

    <section v-if="activeTab === 'fragments'" class="grid memory-grid">
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
              @click="updateFragmentStatus(item.id, 'forgotten')"
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
  </section>
</template>
