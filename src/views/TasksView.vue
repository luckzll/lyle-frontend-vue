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

const visibleTodos = computed(() => {
  if (activeTab.value === 'open') return todos.value.filter((item) => item.status === 'open')
  if (activeTab.value === 'today') return todos.value.filter((item) => item.status === 'open' && isToday(item.dueAt))
  if (activeTab.value === 'overdue') return todos.value.filter((item) => isOverdue(item))
  if (activeTab.value === 'done') return todos.value.filter((item) => item.status === 'done')
  if (activeTab.value === 'cancelled') return todos.value.filter((item) => item.status === 'cancelled')
  return todos.value
})

const unreadReminders = computed(() => reminders.value.filter((item) => item.status !== 'read'))
const upcomingEvents = computed(() => calendar.value.filter((item) => item.status === 'scheduled'))
const openTodos = computed(() => todos.value.filter((item) => item.status === 'open'))
const overdueTodos = computed(() => todos.value.filter((item) => isOverdue(item)))
const todayTodos = computed(() => todos.value.filter((item) => item.status === 'open' && isToday(item.dueAt)))

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
  await refresh()
}

async function saveTodoDueAt(item: AgentTodoItem) {
  const value = dueEdits.value[item.id]
  await updateAgentTodoDueAt(item.id, value ? new Date(value).toISOString() : null)
  await refresh()
}

async function postponeTodoToTomorrow(item: AgentTodoItem) {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)
  await updateAgentTodoDueAt(item.id, next.toISOString())
  await refresh()
}

async function removeTodo(id: number) {
  await deleteAgentTodo(id)
  await refresh()
}

async function setCalendarStatus(id: number, status: string) {
  await updateAgentCalendarStatus(id, status)
  await refresh()
}

async function removeCalendar(id: number) {
  await deleteAgentCalendar(id)
  await refresh()
}

async function readReminder(id: number) {
  await markAgentReminderRead(id)
  await refresh()
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
  return new Date(item.dueAt).toLocaleString()
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
        <p class="muted">查看智能体创建的待办、日历事件和到期提醒。</p>
      </div>
      <button :disabled="loading" type="button" @click="refresh">刷新</button>
    </div>

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

    <article class="item">
      <div class="section-title">
        <h2>提醒</h2>
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
        <span>{{ item.message }} · {{ item.createdAt }}</span>
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
            <button :class="{ active: activeTab === 'open' }" type="button" @click="activeTab = 'open'">进行中</button>
            <button :class="{ active: activeTab === 'today' }" type="button" @click="activeTab = 'today'">今日</button>
            <button :class="{ active: activeTab === 'overdue' }" type="button" @click="activeTab = 'overdue'">逾期</button>
            <button :class="{ active: activeTab === 'done' }" type="button" @click="activeTab = 'done'">已完成</button>
            <button :class="{ active: activeTab === 'cancelled' }" type="button" @click="activeTab = 'cancelled'">已取消</button>
            <button :class="{ active: activeTab === 'all' }" type="button" @click="activeTab = 'all'">全部</button>
          </div>
        </div>
        <p v-if="visibleTodos.length === 0" class="muted">暂无待办。你可以在聊天里说“创建待办：整理知识库”。</p>
        <div v-for="item in visibleTodos" :key="item.id" class="memory-row stacked" :class="{ disabled: item.status !== 'open' }">
          <strong>
            {{ item.title }}
            <span v-if="isOverdue(item)" class="badge danger">逾期</span>
            <span v-else-if="isToday(item.dueAt)" class="badge pending">今日</span>
          </strong>
          <span>{{ statusText(item.status) }} · {{ todoTimeText(item) }}</span>
          <small v-if="item.sourceRef" class="memory-meta">来源：{{ item.sourceRef }}</small>
          <small v-if="item.goalLinks?.length" class="memory-meta">
            关联目标：{{ item.goalLinks.map((goal) => goal.value).join('、') }}
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
          <span>{{ statusText(item.status) }} · {{ item.startsAt || '未设置时间' }}</span>
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
