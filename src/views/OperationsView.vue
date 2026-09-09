<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  confirmPendingOperation,
  listPendingOperations,
  rejectPendingOperation
} from '@/api/app'
import type { PendingOperationItem } from '@/api/types'

const operations = ref<PendingOperationItem[]>([])
const loading = ref(false)
const error = ref('')
const notice = ref('')
const activeTab = ref<'pending' | 'confirmed' | 'rejected' | 'all'>('pending')
const actionLoading = ref<Record<number, boolean>>({})

const visibleOperations = computed(() => {
  if (activeTab.value === 'all') return operations.value
  return operations.value.filter((item) => item.status === activeTab.value)
})
const pendingCount = computed(() => operations.value.filter((item) => item.status === 'pending').length)
const confirmedCount = computed(() => operations.value.filter((item) => item.status === 'confirmed').length)
const rejectedCount = computed(() => operations.value.filter((item) => item.status === 'rejected').length)

onMounted(refresh)

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await listPendingOperations(100)
    operations.value = response.data.items
  } catch {
    error.value = '操作记录加载失败，请确认后端服务已经启动。'
  } finally {
    loading.value = false
  }
}

async function confirmOperation(item: PendingOperationItem) {
  actionLoading.value[item.id] = true
  error.value = ''
  notice.value = ''
  try {
    const response = await confirmPendingOperation(item.id)
    notice.value = String(response.data.result?.content || (response.data.idempotentReplay ? '该操作已处理，本次未重复执行。' : '操作已确认。'))
    await refresh()
  } catch {
    error.value = '操作确认失败，可能已经被处理或不存在。'
  } finally {
    actionLoading.value[item.id] = false
  }
}

async function rejectOperation(item: PendingOperationItem) {
  actionLoading.value[item.id] = true
  error.value = ''
  notice.value = ''
  try {
    await rejectPendingOperation(item.id)
    notice.value = '操作已拒绝。'
    await refresh()
  } catch {
    error.value = '操作拒绝失败，可能已经被处理或不存在。'
  } finally {
    actionLoading.value[item.id] = false
  }
}

function statusText(status: string) {
  if (status === 'confirmed') return '已执行'
  if (status === 'rejected') return '已拒绝'
  return '待确认'
}

function operationTypeText(value: string) {
  if (value === 'todo.create') return '创建待办'
  if (value === 'calendar.create') return '创建日程'
  return value
}

function riskText(value: string) {
  if (value === 'write') return '写操作'
  if (value === 'high_risk') return '高风险'
  if (value === 'read') return '只读'
  return value || '未分级'
}

function statusClass(status: string) {
  return {
    pending: status === 'pending',
    success: status === 'confirmed',
    danger: status === 'rejected'
  }
}

function formatTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function payloadText(item: PendingOperationItem) {
  const payload = item.payload || {}
  if (item.operationType === 'todo.create') {
    return [`标题：${payload.title || '-'}`, `截止时间：${formatTime(String(payload.dueAt || ''))}`].join(' · ')
  }
  if (item.operationType === 'calendar.create') {
    return [`标题：${payload.title || '-'}`, `开始时间：${formatTime(String(payload.startsAt || ''))}`].join(' · ')
  }
  return JSON.stringify(payload)
}

function resultText(item: PendingOperationItem) {
  if (!item.result) return ''
  const content = item.result.content
  if (typeof content === 'string') return content
  return JSON.stringify(item.result)
}
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>操作</h1>
        <p class="muted">查看 AI 提出的写操作、你的确认记录和执行结果。</p>
      </div>
      <button :disabled="loading" type="button" @click="refresh">
        {{ loading ? '刷新中' : '刷新' }}
      </button>
    </div>

    <p v-if="error" class="alert danger">{{ error }}</p>
    <p v-if="notice" class="alert success">{{ notice }}</p>

    <div class="status-grid">
      <div>
        <span class="metric">{{ pendingCount }}</span>
        <span class="muted">待确认</span>
      </div>
      <div>
        <span class="metric">{{ confirmedCount }}</span>
        <span class="muted">已执行</span>
      </div>
      <div>
        <span class="metric">{{ rejectedCount }}</span>
        <span class="muted">已拒绝</span>
      </div>
      <div>
        <span class="metric">{{ operations.length }}</span>
        <span class="muted">全部操作</span>
      </div>
    </div>

    <article class="item stack">
      <div class="section-title">
        <h2>操作记录</h2>
        <div class="segmented">
          <button :class="{ active: activeTab === 'pending' }" type="button" @click="activeTab = 'pending'">待确认</button>
          <button :class="{ active: activeTab === 'confirmed' }" type="button" @click="activeTab = 'confirmed'">已执行</button>
          <button :class="{ active: activeTab === 'rejected' }" type="button" @click="activeTab = 'rejected'">已拒绝</button>
          <button :class="{ active: activeTab === 'all' }" type="button" @click="activeTab = 'all'">全部</button>
        </div>
      </div>

      <div v-if="visibleOperations.length === 0" class="empty-state compact">
        <strong>暂无操作记录</strong>
        <span>聊天里触发写操作后，会先出现在这里等待确认。</span>
      </div>

      <div
        v-for="item in visibleOperations"
        :key="item.id"
        class="operation-row"
        :class="{ disabled: item.status !== 'pending' }"
      >
        <div class="operation-row-head">
          <div>
            <strong>{{ item.summary }}</strong>
            <p class="muted">{{ operationTypeText(item.operationType) }} · {{ payloadText(item) }}</p>
          </div>
          <div class="tool-badges">
            <span class="badge" :class="statusClass(item.status)">{{ statusText(item.status) }}</span>
            <span class="badge danger">{{ riskText(item.riskLevel) }}</span>
          </div>
        </div>

        <div class="operation-meta-grid">
          <span>工具：{{ item.toolName }}</span>
          <span>创建：{{ formatTime(item.createdAt) }}</span>
          <span v-if="item.confirmedAt">确认：{{ formatTime(item.confirmedAt) }}</span>
          <span v-if="item.rejectedAt">拒绝：{{ formatTime(item.rejectedAt) }}</span>
        </div>

        <p v-if="item.sourceText" class="operation-source">来源：{{ item.sourceText }}</p>
        <p v-if="resultText(item)" class="operation-result">结果：{{ resultText(item) }}</p>

        <div v-if="item.status === 'pending'" class="row">
          <button
            class="inline"
            type="button"
            data-testid="operation-confirm-button"
            :disabled="actionLoading[item.id]"
            @click="confirmOperation(item)"
          >
            确认执行
          </button>
          <button
            class="inline secondary"
            type="button"
            data-testid="operation-reject-button"
            :disabled="actionLoading[item.id]"
            @click="rejectOperation(item)"
          >
            拒绝
          </button>
        </div>
      </div>
    </article>
  </section>
</template>
