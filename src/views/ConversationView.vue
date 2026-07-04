<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { createConversation, deleteConversation, listConversations } from '@/api/app'
import type { Conversation } from '@/api/types'

const title = ref('默认会话')
const conversations = ref<Conversation[]>([])
const loading = ref(false)
const notice = ref('')
const removingId = ref('')

const sortedConversations = computed(() => [...conversations.value].sort((a, b) => dateTime(b.updatedAt || b.createdAt) - dateTime(a.updatedAt || a.createdAt)))
const latestConversation = computed(() => sortedConversations.value[0])
const olderConversations = computed(() => sortedConversations.value.slice(1))

async function refresh() {
  const response = await listConversations()
  conversations.value = response.data
}

async function create() {
  if (!title.value.trim()) return
  loading.value = true
  try {
    await createConversation(title.value.trim())
    title.value = ''
    notice.value = '会话已创建'
    await refresh()
  } finally {
    loading.value = false
  }
}

async function remove(id: string) {
  if (!window.confirm('删除后只会移除该会话和聊天消息，不会删除由它创建的待办、目标、计划、项目关联和记忆。确认删除这个会话？')) return
  removingId.value = id
  try {
    await deleteConversation(id)
    notice.value = '会话已删除'
    await refresh()
  } finally {
    removingId.value = ''
  }
}

onMounted(refresh)

function dateTime(value?: string | null) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function formatDateTime(value?: string | null) {
  if (!value) return '暂无时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}
</script>

<template>
  <section class="page conversations-page">
    <div class="toolbar">
      <div>
        <h1>会话</h1>
        <p class="muted">管理聊天历史，快速回到正在推进的上下文。</p>
      </div>
      <span class="badge">{{ conversations.length }} 个会话</span>
    </div>

    <div v-if="notice" class="notice">{{ notice }}</div>

    <div class="conversation-create panel">
      <div>
        <strong>新建会话</strong>
        <p class="muted">给会话起一个清楚的标题，后续更容易检索。</p>
      </div>
      <form class="conversation-create-form" @submit.prevent="create">
        <input v-model="title" placeholder="例如：V3 测试复盘" />
        <button type="submit" :disabled="loading || !title.trim()">{{ loading ? '创建中' : '创建' }}</button>
      </form>
    </div>

    <div v-if="latestConversation" class="conversation-layout">
      <article class="conversation-feature panel">
        <small class="memory-meta">最近会话</small>
        <h2>{{ latestConversation.title }}</h2>
        <p class="muted">更新于 {{ formatDateTime(latestConversation.updatedAt || latestConversation.createdAt) }}</p>
        <div class="conversation-meta-row">
          <span>ID {{ shortId(latestConversation.id) }}</span>
          <span>创建于 {{ formatDateTime(latestConversation.createdAt) }}</span>
        </div>
        <div class="row">
          <RouterLink class="button-link primary" :to="{ name: 'chat', query: { conversationId: latestConversation.id } }">打开聊天</RouterLink>
          <button class="secondary danger" type="button" :disabled="removingId === latestConversation.id" @click="remove(latestConversation.id)">
            {{ removingId === latestConversation.id ? '删除中' : '删除' }}
          </button>
        </div>
      </article>

      <div class="conversation-list panel">
        <div class="section-title">
          <h2>历史会话</h2>
          <span class="badge">{{ olderConversations.length }}</span>
        </div>
        <article v-for="item in olderConversations" :key="item.id" class="conversation-row">
          <div>
            <h3>{{ item.title }}</h3>
            <p class="muted">更新于 {{ formatDateTime(item.updatedAt || item.createdAt) }}</p>
          </div>
          <span class="conversation-id">ID {{ shortId(item.id) }}</span>
          <div class="row conversation-actions">
            <RouterLink class="button-link" :to="{ name: 'chat', query: { conversationId: item.id } }">打开</RouterLink>
            <button class="secondary danger" type="button" :disabled="removingId === item.id" @click="remove(item.id)">
              {{ removingId === item.id ? '删除中' : '删除' }}
            </button>
          </div>
        </article>
        <div v-if="olderConversations.length === 0" class="empty-state compact">
          <strong>暂无更多历史会话</strong>
          <span>新的聊天会在这里沉淀下来。</span>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <strong>还没有会话</strong>
      <span>创建一个会话，或者直接去聊天页开始第一轮对话。</span>
    </div>
  </section>
</template>
