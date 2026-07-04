<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  deleteAgentCalendar,
  deleteAgentTodo,
  listAgentCalendar,
  listAgentReminders,
  listAgentTodos,
  markAgentReminderRead,
  updateAgentTodoDueAt,
  updateAgentCalendarStatus,
  updateAgentTodoStatus
} from '@/api/app'
import type { AgentCalendarItem, AgentReminderItem, AgentTodoItem } from '@/api/types'

const todos = ref<AgentTodoItem[]>([])
const calendar = ref<AgentCalendarItem[]>([])
const reminders = ref<AgentReminderItem[]>([])
const loading = ref(false)
const activeTab = ref<'open' | 'today' | 'overdue' | 'done' | 'cancelled' | 'all'>('open')
const dueEdits = ref<Record<number, string>>({})
const notice = ref('')

const visibleTodos = computed(() => {
  const source = activeTab.value === 'open'
    ? todos.value.filter((item) => item.status === 'open')
    : activeTab.value === 'today'
      ? todos.value.filter((item) => item.status === 'open' && isToday(item.dueAt))
      : activeTab.value === 'overdue'
        ? todos.value.filter((item) => isOverdue(item))
        : activeTab.value === 'done'
          ? todos.value.filter((item) => item.status === 'done')
          : activeTab.value === 'cancelled'
            ? todos.value.filter((item) => item.status === 'cancelled')
            : todos.value
  return sortTodos(dedupeTodos(source))
})

const unreadReminders = computed(() => reminders.value.filter((item) => item.status !== 'read'))
const upcomingEvents = computed(() => calendar.value.filter((item) => item.status === 'scheduled'))
const openTodos = computed(() => todos.value.filter((item) => item.status === 'open'))
const overdueTodos = computed(() => todos.value.filter((item) => isOverdue(item)))
const todayTodos = computed(() => todos.value.filter((item) => item.status === 'open' && isToday(item.dueAt)))
const duplicateTodoCount = computed(() => todos.value.length - dedupeTodos(todos.value).length)
const nextTodo = computed(() => sortTodos(openTodos.value)[0])
const unreadReminderPreview = computed(() => unreadReminders.value[0])

onMounted(refresh)

async function refresh() {
  loading.value = true
  try {
    const [todoResponse, calendarResponse, reminderResponse] = await Promise.all([
      listAgentTodos(),
      listAgentCalendar(),
      listAgentReminders()
    ])
    todos.value = todoResponse.data.items
    calendar.value = calendarResponse.data.items
    reminders.value = reminderResponse.data.items
  } finally {
    loading.value = false
  }
}

async function setTodoStatus(id: number, status: string) {
  await updateAgentTodoStatus(id, status)
  showNotice(status === 'done' ? '待办已完成' : status === 'cancelled' ? '待办已取消' : '待办已重新打开')
  await refresh()
}

async function saveTodoDueAt(item: AgentTodoItem) {
  const value = dueEdits.value[item.id]
  await updateAgentTodoDueAt(item.id, value ? new Date(value).toISOString() : null)
  showNotice('截止时间已保存')
  await refresh()
}

async function postponeTodoToTomorrow(item: AgentTodoItem) {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)
  await updateAgentTodoDueAt(item.id, next.toISOString())
  showNotice('已顺延到明天 9 点')
  await refresh()
}

async function removeTodo(id: number) {
  await deleteAgentTodo(id)
  showNotice('待办已删除')
  await refresh()
}

async function setCalendarStatus(id: number, status: string) {
  await updateAgentCalendarStatus(id, status)
  showNotice(status === 'done' ? '日历事件已完成' : '日历事件已取消')
  await refresh()
}

async function removeCalendar(id: number) {
  await deleteAgentCalendar(id)
  showNotice('日历事件已删除')
  await refresh()
}

async function readReminder(id: number) {
  await markAgentReminderRead(id)
  showNotice('提醒已标记已读')
  await refresh()
}

function showNotice(message: string) {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 2200)
}

function statusText(status: string) {
  if (status === 'done') return '已完成'
  if (status === 'cancelled') return '已取消'
  if (status === 'scheduled') return '已计划'
  return '进行中'
}

function isOverdue(item: AgentTodoItem) {
  return item.status === 'open' && Boolean(item.dueAt) && new Date(item.dueAt as string).getTime() < Date.now()
}

function isToday(value?: string | null) {
  if (!value) return false
  const date = new Date(value)
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

function todoTimeText(item: AgentTodoItem) {
  if (!item.dueAt) return '未设置截止时间'
  return formatTime(item.dueAt)
}

function reminderTimeText(value?: string | null) {
  if (!value) return ''
  return formatTime(value)
}

function calendarTimeText(value?: string | null) {
  if (!value) return '未设置时间'
  return formatTime(value)
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function sortTodos(items: AgentTodoItem[]) {
  return [...items].sort((a, b) => todoPriority(b) - todoPriority(a) || dueTime(a) - dueTime(b) || b.id - a.id)
}

function todoPriority(item: AgentTodoItem) {
  if (isOverdue(item)) return 4
  if (item.status === 'open' && isToday(item.dueAt)) return 3
  if (item.status === 'open' && item.dueAt) return 2
  if (item.status === 'open') return 1
  return 0
}

function dueTime(item: AgentTodoItem) {
  if (!item.dueAt) return Number.MAX_SAFE_INTEGER
  const time = new Date(item.dueAt).getTime()
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time
}

function dedupeTodos(items: AgentTodoItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${normalizeTodoTitle(item.title)}:${item.status}:${item.dueAt || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeTodoTitle(value: string) {
  return value.trim().replace(/\s+/g, '').replace(/^创建待办[:：]/, '').toLowerCase()
}

function tabCount(tab: typeof activeTab.value) {
  if (tab === 'open') return openTodos.value.length
  if (tab === 'today') return todayTodos.value.length
  if (tab === 'overdue') return overdueTodos.value.length
  if (tab === 'done') return todos.value.filter((item) => item.status === 'done').length
  if (tab === 'cancelled') return todos.value.filter((item) => item.status === 'cancelled').length
  return todos.value.length
}

function goalLinkText(item: AgentTodoItem) {
  const goals = (item.goalLinks || [])
    .filter((goal) => goal.schemaPath?.startsWith('goals.'))
    .map((goal) => cleanGoalLinkValue(String(goal.value || '')))
    .filter(Boolean)
  return Array.from(new Set(goals)).join('、')
}

function cleanGoalLinkValue(value: string) {
  return value
    .replace(/^用户当前目标包括/, '')
    .replace(/^当前目标包括/, '')
    .replace(/[。.]$/, '')
    .trim()
}

function todoDueInputValue(item: AgentTodoItem) {
  if (dueEdits.value[item.id] !== undefined) return dueEdits.value[item.id]
  if (!item.dueAt) return ''
  const date = new Date(item.dueAt)
  const offsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function setTodoDueEdit(item: AgentTodoItem, event: Event) {
  dueEdits.value[item.id] = (event.target as HTMLInputElement).value
}
</script>

<template>
  <section class="page">
    <div class="toolbar">
      <div>
        <h1>任务</h1>
        <p class="muted">查看智能体创建的待办、日历事件和到期提醒，持续追踪可靠执行状态。</p>
      </div>
      <button :disabled="loading" type="button" @click="refresh">刷新</button>
    </div>
    <p v-if="notice" class="toast">{{ notice }}</p>

    <div class="status-grid">
      <div>
        <span class="metric">{{ openTodos.length }}</span>
        <span class="muted">进行中待办</span>
      </div>
      <div>
        <span class="metric">{{ todayTodos.length }}</span>
        <span class="muted">今日到期</span>
      </div>
      <div>
        <span class="metric">{{ overdueTodos.length }}</span>
        <span class="muted">已逾期</span>
      </div>
      <div>
        <span class="metric">{{ unreadReminders.length }}</span>
        <span class="muted">未读提醒</span>
      </div>
    </div>

    <article v-if="nextTodo || unreadReminderPreview || duplicateTodoCount > 0" class="item task-command-center">
      <div class="section-title">
        <div>
          <h2>执行焦点</h2>
          <p class="muted">优先展示当前最应该处理的任务、提醒和重复项。</p>
        </div>
        <span class="badge" :class="{ danger: overdueTodos.length > 0, pending: todayTodos.length > 0 && overdueTodos.length === 0, success: overdueTodos.length === 0 && todayTodos.length === 0 }">
          {{ overdueTodos.length > 0 ? `${overdueTodos.length} 个逾期` : todayTodos.length > 0 ? `${todayTodos.length} 个今日` : '状态稳定' }}
        </span>
      </div>
      <div class="task-focus-grid">
        <section v-if="nextTodo" class="task-focus-card" :class="{ danger: isOverdue(nextTodo), pending: isToday(nextTodo.dueAt) }">
          <small class="memory-meta">优先待办</small>
          <strong>{{ nextTodo.title }}</strong>
          <span>{{ statusText(nextTodo.status) }} · {{ todoTimeText(nextTodo) }}</span>
          <small v-if="goalLinkText(nextTodo)" class="memory-meta">关联目标：{{ goalLinkText(nextTodo) }}</small>
          <span class="row">
            <button class="inline secondary" type="button" @click="postponeTodoToTomorrow(nextTodo)">明天 9 点</button>
            <button class="inline" type="button" @click="setTodoStatus(nextTodo.id, 'done')">完成</button>
          </span>
        </section>
        <section v-if="unreadReminderPreview" class="task-focus-card pending">
          <small class="memory-meta">未读提醒</small>
          <strong>{{ unreadReminderPreview.title }}</strong>
          <span>{{ unreadReminderPreview.message }}</span>
          <button class="inline" type="button" @click="readReminder(unreadReminderPreview.id)">标记已读</button>
        </section>
        <section v-if="duplicateTodoCount > 0" class="task-focus-card pending">
          <small class="memory-meta">重复提醒</small>
          <strong>已隐藏 {{ duplicateTodoCount }} 个重复待办</strong>
          <span>列表按标题、状态和截止时间去重展示，避免测试数据干扰执行判断。</span>
        </section>
      </div>
    </article>

    <article class="item collapsible-section">
      <div class="section-title">
        <div>
          <h2>提醒</h2>
          <p class="muted">展示由待办、日历和 Agent 跟进产生的提醒。</p>
        </div>
        <span class="badge">{{ unreadReminders.length }} 未读</span>
      </div>
      <p v-if="reminders.length === 0" class="muted">暂无提醒。</p>
      <div
        v-for="item in reminders"
        :key="item.id"
        class="memory-row stacked"
        :class="{ disabled: item.status === 'read' }"
      >
        <strong>{{ item.title }}</strong>
        <span>{{ item.message }} · {{ reminderTimeText(item.createdAt) }}</span>
        <span class="row">
          <button
            v-if="item.status !== 'read'"
            class="inline"
            type="button"
            @click="readReminder(item.id)"
          >
            标记已读
          </button>
          <small v-else class="memory-meta">已读</small>
        </span>
      </div>
    </article>

    <div class="grid">
      <article class="item">
        <div class="section-title">
          <h2>待办</h2>
          <div class="segmented">
            <button :class="{ active: activeTab === 'open' }" type="button" @click="activeTab = 'open'">进行中 {{ tabCount('open') }}</button>
            <button :class="{ active: activeTab === 'today' }" type="button" @click="activeTab = 'today'">今日 {{ tabCount('today') }}</button>
            <button :class="{ active: activeTab === 'overdue' }" type="button" @click="activeTab = 'overdue'">逾期 {{ tabCount('overdue') }}</button>
            <button :class="{ active: activeTab === 'done' }" type="button" @click="activeTab = 'done'">已完成 {{ tabCount('done') }}</button>
            <button :class="{ active: activeTab === 'cancelled' }" type="button" @click="activeTab = 'cancelled'">已取消 {{ tabCount('cancelled') }}</button>
            <button :class="{ active: activeTab === 'all' }" type="button" @click="activeTab = 'all'">全部 {{ tabCount('all') }}</button>
          </div>
        </div>
        <p v-if="visibleTodos.length === 0" class="muted">暂无待办。你可以在聊天里说“创建待办：整理知识库”。</p>
        <div v-for="item in visibleTodos" :key="item.id" class="task-row" :class="{ disabled: item.status !== 'open', danger: isOverdue(item), pending: isToday(item.dueAt) }">
          <strong>
            {{ item.title }}
            <span v-if="isOverdue(item)" class="badge danger">逾期</span>
            <span v-else-if="isToday(item.dueAt)" class="badge pending">今日</span>
          </strong>
          <span>{{ statusText(item.status) }} · {{ todoTimeText(item) }}</span>
          <small v-if="item.sourceRef" class="memory-meta">来源证据：{{ item.sourceRef }}</small>
          <small v-if="goalLinkText(item)" class="memory-meta">
            关联目标：{{ goalLinkText(item) }}
          </small>
          <span v-if="item.status === 'open'" class="row">
            <input
              class="inline-input"
              type="datetime-local"
              :value="todoDueInputValue(item)"
              @input="setTodoDueEdit(item, $event)"
            />
            <button class="inline secondary" type="button" @click="saveTodoDueAt(item)">保存时间</button>
            <button class="inline secondary" type="button" @click="postponeTodoToTomorrow(item)">明天 9 点</button>
          </span>
          <span class="row">
            <button v-if="item.status !== 'done'" class="inline" type="button" @click="setTodoStatus(item.id, 'done')">完成</button>
            <button v-if="item.status !== 'open'" class="inline secondary" type="button" @click="setTodoStatus(item.id, 'open')">重新打开</button>
            <button v-if="item.status !== 'cancelled'" class="inline secondary" type="button" @click="setTodoStatus(item.id, 'cancelled')">取消</button>
            <button class="inline danger" type="button" @click="removeTodo(item.id)">删除</button>
          </span>
        </div>
      </article>

      <article class="item">
        <h2>日历</h2>
        <p v-if="calendar.length === 0" class="muted">暂无日历事件。你可以在聊天里说“创建日历：2026-07-01 10:00 开会”。</p>
        <div v-for="item in calendar" :key="item.id" class="memory-row stacked">
          <strong>{{ item.title }}</strong>
          <span>{{ statusText(item.status) }} · {{ calendarTimeText(item.startsAt) }}</span>
          <small v-if="item.sourceRef" class="memory-meta">来源：{{ item.sourceRef }}</small>
          <span class="row">
            <button class="inline" type="button" @click="setCalendarStatus(item.id, 'done')">完成</button>
            <button class="inline secondary" type="button" @click="setCalendarStatus(item.id, 'cancelled')">取消</button>
            <button class="inline danger" type="button" @click="removeCalendar(item.id)">删除</button>
          </span>
        </div>
      </article>
    </div>
  </section>
</template>
